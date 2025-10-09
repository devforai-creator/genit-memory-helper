import { CONFIG } from '../config';
import type {
  AutoLoaderExports,
  AutoLoaderOptions,
  AutoLoaderStats,
  AutoLoaderStartOptions,
  AutoLoaderController,
  ExportRangeController,
  MessageIndexer,
  StructuredSnapshot,
  TranscriptSession,
  TranscriptTurn,
} from '../types';

const METER_INTERVAL_MS = CONFIG.TIMING.AUTO_LOADER.METER_INTERVAL_MS;

const toElementArray = (collection: Iterable<Element> | Element[] | NodeListOf<Element> | null | undefined): Element[] => {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  return Array.from(collection);
};

type ScrollElement = Element & { scrollTop: number; scrollHeight: number };
type StatsCache = {
  summaryKey: string | null;
  rawKey: string | null;
  data: AutoLoaderStats | null;
};
type CollectStatsOptions = { force?: boolean };

export function createAutoLoader({
  stateApi,
  stateEnum,
  errorHandler,
  messageIndexer,
  exportRange,
  setPanelStatus,
  getActiveAdapter,
  sleep,
  isScrollable,
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? (window as Window & typeof globalThis) : null,
  normalizeTranscript,
  buildSession,
  readTranscriptText,
  logger = typeof console !== 'undefined' ? console : null,
}: AutoLoaderOptions = {} as AutoLoaderOptions): AutoLoaderExports {
  if (!stateApi || typeof stateApi.setState !== 'function') {
    throw new Error('createAutoLoader requires stateApi with setState');
  }
  if (!stateEnum) throw new Error('createAutoLoader requires stateEnum');
  if (!errorHandler || typeof errorHandler.handle !== 'function') {
    throw new Error('createAutoLoader requires errorHandler');
  }
  if (!getActiveAdapter) throw new Error('createAutoLoader requires getActiveAdapter');
  if (!sleep) throw new Error('createAutoLoader requires sleep helper');
  if (!isScrollable) throw new Error('createAutoLoader requires isScrollable helper');
  if (!normalizeTranscript || !buildSession || !readTranscriptText) {
    throw new Error('createAutoLoader requires transcript helpers');
  }
  if (!documentRef) throw new Error('createAutoLoader requires document reference');
  if (!windowRef) throw new Error('createAutoLoader requires window reference');

  const doc = documentRef;
  const win = windowRef;
  const ElementCtor = doc?.defaultView?.Element || (typeof Element !== 'undefined' ? Element : null);
  const MutationObserverCtor =
    win?.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
  const setTimeoutFn = typeof win?.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
  const setIntervalFn =
    typeof win?.setInterval === 'function' ? win.setInterval.bind(win) : setInterval;
  const clearIntervalFn =
    typeof win?.clearInterval === 'function' ? win.clearInterval.bind(win) : clearInterval;

  const AUTO_PROFILES = CONFIG.TIMING.AUTO_LOADER.PROFILES;

  const AUTO_CFG: { profile: string } = {
    profile: 'default',
  };

  const AUTO_STATE: {
    running: boolean;
    container: Element | null;
    meterTimer: ReturnType<typeof setInterval> | null;
  } = {
    running: false,
    container: null,
    meterTimer: null,
  };

  const profileListeners = new Set<(profile: string) => void>();
  const warnWithHandler = (err: unknown, context: string, fallbackMessage: string) => {
    if (errorHandler?.handle) {
      const level = errorHandler.LEVELS?.WARN || 'warn';
      errorHandler.handle(err, context, level);
    } else if (logger?.warn) {
      logger.warn(fallbackMessage, err);
    }
  };

  const notifyProfileChange = () => {
    profileListeners.forEach((listener) => {
      try {
        listener(AUTO_CFG.profile);
      } catch (err) {
        warnWithHandler(err, 'autoload', '[GMH] auto profile listener failed');
      }
    });
  };

  const getProfile = () => AUTO_CFG.profile;

  function ensureScrollContainer(): Element | null {
    const adapter = typeof getActiveAdapter === 'function' ? getActiveAdapter() : null;
    const adapterContainer = adapter?.findContainer?.(doc);
    if (adapterContainer) {
      if (isScrollable(adapterContainer)) return adapterContainer;
      if (ElementCtor && adapterContainer instanceof ElementCtor) {
        let ancestor = adapterContainer.parentElement;
        for (let depth = 0; depth < 6 && ancestor; depth += 1) {
          if (isScrollable(ancestor)) return ancestor;
          ancestor = ancestor.parentElement;
        }
      }
      return adapterContainer;
    }
    const messageBlocks = toElementArray(adapter?.listMessageBlocks?.(doc));
    if (messageBlocks.length) {
      let ancestor = messageBlocks[0]?.parentElement || null;
      for (let depth = 0; depth < 6 && ancestor; depth += 1) {
        if (isScrollable(ancestor)) return ancestor;
        ancestor = ancestor.parentElement;
      }
    }
    return (doc.scrollingElement || doc.documentElement || doc.body) as Element | null;
  }

  function waitForGrowth(el: ScrollElement, startHeight: number, timeout: number): Promise<boolean> {
    if (!MutationObserverCtor) {
      return new Promise((resolve) => {
        setTimeoutFn(() => resolve(false), timeout);
      });
    }
    return new Promise((resolve) => {
      let finished = false;
      const obs = new MutationObserverCtor(() => {
        if (el.scrollHeight > startHeight + 4) {
          finished = true;
          obs.disconnect();
          resolve(true);
        }
      });
      obs.observe(el, { childList: true, subtree: true });
      setTimeoutFn(() => {
        if (!finished) {
          obs.disconnect();
          resolve(false);
        }
      }, timeout);
    });
  }

  async function scrollUpCycle(container: Element | null, profile: any) {
    if (!container) return { grew: false, before: 0, after: 0 };
    const target = container as ScrollElement;
    const before = target.scrollHeight;
    target.scrollTop = 0;
    const grew = await waitForGrowth(target, before, profile.settleTimeoutMs);
    return { grew, before, after: target.scrollHeight };
  }

  const statsCache: StatsCache = {
    summaryKey: null,
    rawKey: null,
    data: null,
  };

  const clearStatsCache = () => {
    statsCache.summaryKey = null;
    statsCache.rawKey = null;
    statsCache.data = null;
  };

  let lastSessionSignature = windowRef?.location?.href || (typeof location !== 'undefined' ? location.href : null);

  const makeSummaryKey = (summary) => {
    if (!summary) return null;
    const total = Number.isFinite(summary.totalMessages) ? summary.totalMessages : 'na';
    const user = Number.isFinite(summary.userMessages) ? summary.userMessages : 'na';
    const stamp = summary.timestamp || 'na';
    return `${total}:${user}:${stamp}`;
  };

  function collectTurnStats(options: CollectStatsOptions = {}): AutoLoaderStats {
    const force = Boolean(options.force);
    let summary: any = null;
    try {
      const currentSignature = windowRef?.location?.href || (typeof location !== 'undefined' ? location.href : null);
      if (currentSignature && currentSignature !== lastSessionSignature) {
        lastSessionSignature = currentSignature;
        clearStatsCache();
        exportRange?.clear?.();
        exportRange?.setTotals?.({ message: 0, user: 0, llm: 0, entry: 0 });
      }
      try {
        summary = messageIndexer?.refresh?.({ immediate: true }) || null;
      } catch (err) {
        warnWithHandler(err, 'autoload', '[GMH] message indexing before stats failed');
      }
      const summaryKey = makeSummaryKey(summary);
      if (!force && summaryKey && statsCache.data && statsCache.summaryKey === summaryKey) {
        return statsCache.data;
      }

      let rawText: string | null = null;
      let rawKey: string | null = null;
      const transcriptOptions = force ? { force: true } : {};
      if (!summaryKey) {
        rawText = readTranscriptText(transcriptOptions);
        rawKey = typeof rawText === 'string' ? rawText : String(rawText ?? '');
        if (!force && statsCache.data && statsCache.rawKey === rawKey) {
          return statsCache.data;
        }
      } else {
        rawText = readTranscriptText(transcriptOptions);
      }

      const normalized = normalizeTranscript(rawText);
      const session = buildSession(normalized);
      const userMessages = session.turns.filter((t) => t.channel === 'user').length;
      const llmMessages = session.turns.filter((t) => t.channel === 'llm').length;
      const previousTotals = exportRange?.getTotals?.() || {
        message: 0,
        user: 0,
        llm: 0,
        entry: 0,
      };
      const blockSet = new Set();
      session.turns.forEach((turn) => {
        const blocks = Array.isArray(turn?.__gmhSourceBlocks) ? turn.__gmhSourceBlocks : [];
        blocks
          .filter((idx) => Number.isInteger(idx) && idx >= 0)
          .forEach((idx) => blockSet.add(idx));
      });
      const entryCount = blockSet.size || session.turns.length;
      const nextTotals = {
        message: session.turns.length,
        user: userMessages,
        llm: llmMessages,
        entry: entryCount,
      };
      const totalsShrank =
        Number.isFinite(previousTotals.message) && previousTotals.message > nextTotals.message;
      const userShrank = Number.isFinite(previousTotals.user) && previousTotals.user > nextTotals.user;
      const llmShrank = Number.isFinite(previousTotals.llm) && previousTotals.llm > nextTotals.llm;
      const entryShrank = Number.isFinite(previousTotals.entry) && previousTotals.entry > nextTotals.entry;
      if (totalsShrank || userShrank || llmShrank || entryShrank) {
        exportRange?.clear?.();
      }
      exportRange?.setTotals?.(nextTotals);
      const stats: AutoLoaderStats = {
        session,
        userMessages,
        llmMessages,
        totalMessages: session.turns.length,
      };
      statsCache.summaryKey = summaryKey;
      statsCache.rawKey = summaryKey ? null : rawKey;
      statsCache.data = stats;
      lastSessionSignature = currentSignature || lastSessionSignature;
      return stats;
    } catch (error) {
      clearStatsCache();
      if (errorHandler?.handle) {
        const level = errorHandler.LEVELS?.ERROR || 'error';
        errorHandler.handle(error, 'autoload', level);
      }
      return {
        session: null,
        userMessages: 0,
        llmMessages: 0,
        totalMessages: 0,
        error,
      } as AutoLoaderStats;
    }
  }

  const notifyScan = (payload) => {
    stateApi.setState(stateEnum.SCANNING, payload);
  };

  const notifyDone = (payload) => {
    stateApi.setState(stateEnum.DONE, payload);
  };

  const notifyError = (payload) => {
    stateApi.setState(stateEnum.ERROR, payload);
  };

  const notifyIdle = (payload) => {
    stateApi.setState(stateEnum.IDLE, payload);
  };

  async function autoLoadAll(): Promise<AutoLoaderStats> {
    const profile = AUTO_PROFILES[getProfile()] || AUTO_PROFILES.default;
    const container = ensureScrollContainer();
    if (!container) {
      notifyError({
        label: '자동 로딩 실패',
        message: '채팅 컨테이너를 찾을 수 없습니다.',
        tone: 'error',
        progress: { value: 1 },
      });
      return {
        session: null,
        userMessages: 0,
        llmMessages: 0,
        totalMessages: 0,
        error: new Error('container missing'),
      };
    }
    AUTO_STATE.running = true;
    AUTO_STATE.container = container;
    let stableRounds = 0;
    let guard = 0;

    while (AUTO_STATE.running && guard < profile.guardLimit) {
      guard += 1;
      notifyScan({
        label: '위로 끝까지 로딩',
        message: `추가 수집 중 (${guard}/${profile.guardLimit})`,
        tone: 'progress',
        progress: { indeterminate: true },
      });
      const { grew, before, after } = await scrollUpCycle(container, profile);
      if (!AUTO_STATE.running) break;
      const delta = after - before;
      stableRounds = !grew || delta < 6 ? stableRounds + 1 : 0;
      if (stableRounds >= profile.maxStableRounds) break;
      await sleep(profile.cycleDelayMs);
    }

    AUTO_STATE.running = false;
    const stats = collectTurnStats();
    if (stats.error) {
      notifyError({
        label: '자동 로딩 실패',
        message: '스크롤 후 파싱 실패',
        tone: 'error',
        progress: { value: 1 },
      });
    } else {
      notifyDone({
        label: '자동 로딩 완료',
        message: `유저 메시지 ${stats.userMessages}개 확보`,
        tone: 'success',
        progress: { value: 1 },
      });
    }
    return stats;
  }

  async function autoLoadUntilPlayerTurns(target: number): Promise<AutoLoaderStats> {
    const profile = AUTO_PROFILES[getProfile()] || AUTO_PROFILES.default;
    const container = ensureScrollContainer();
    if (!container) {
      notifyError({
        label: '자동 로딩 실패',
        message: '채팅 컨테이너를 찾을 수 없습니다.',
        tone: 'error',
        progress: { value: 1 },
      });
      return {
        session: null,
        userMessages: 0,
        llmMessages: 0,
        totalMessages: 0,
        error: new Error('container missing'),
      };
    }
    AUTO_STATE.running = true;
    AUTO_STATE.container = container;
    let stableRounds = 0;
    let stagnantRounds = 0;
    let loopCount = 0;
    let prevUserMessages = -1;

    while (AUTO_STATE.running && loopCount < profile.guardLimit) {
      loopCount += 1;
      const stats = collectTurnStats();
      if (stats.error) {
        notifyError({
          label: '자동 로딩 실패',
          message: '파싱 실패 - DOM 변화를 감지하지 못했습니다.',
          tone: 'error',
          progress: { value: 1 },
        });
        break;
      }
      if (stats.userMessages >= target) {
        notifyDone({
          label: '자동 로딩 완료',
          message: `목표 달성 · 유저 메시지 ${stats.userMessages}개 확보`,
          tone: 'success',
          progress: { value: 1 },
        });
        break;
      }

      const ratio = target > 0 ? Math.min(1, stats.userMessages / target) : 0;
      notifyScan({
        label: '메시지 확보 중',
        message: `유저 메시지 ${stats.userMessages}/${target}`,
        tone: 'progress',
        progress: { value: ratio },
      });

      const { grew, before, after } = await scrollUpCycle(container, profile);
      if (!AUTO_STATE.running) break;
      const delta = after - before;
      stableRounds = !grew || delta < 6 ? stableRounds + 1 : 0;

      stagnantRounds = stats.userMessages === prevUserMessages ? stagnantRounds + 1 : 0;
      prevUserMessages = stats.userMessages;

      if (stableRounds >= profile.maxStableRounds || stagnantRounds >= profile.guardLimit) {
        notifyDone({
          label: '자동 로딩 종료',
          message: '추가 데이터를 불러오지 못했습니다. 더 이상 기록이 없거나 막혀있습니다.',
          tone: 'warning',
          progress: { value: ratio },
        });
        break;
      }
      await sleep(profile.cycleDelayMs);
    }

    AUTO_STATE.running = false;
    const finalStats = collectTurnStats();
    if (finalStats?.error) {
      notifyError({
        label: '자동 로딩 실패',
        message: '메시지 정보를 수집하지 못했습니다.',
        tone: 'error',
        progress: { value: 1 },
      });
      return finalStats;
    }
    if (stateApi.getState?.() === stateEnum.SCANNING) {
      const ratio = target > 0 ? Math.min(1, finalStats.userMessages / target) : 0;
      notifyDone({
        label: '자동 로딩 종료',
        message: `유저 메시지 ${finalStats.userMessages}/${target}`,
        tone: 'warning',
        progress: { value: ratio },
      });
    }
    return finalStats;
  }

  function stopAutoLoad() {
    if (!AUTO_STATE.running) return;
    AUTO_STATE.running = false;
    notifyIdle({
      label: '대기 중',
      message: '자동 로딩을 중지했습니다.',
      tone: 'info',
      progress: { value: 0 },
    });
  }

  function startTurnMeter(meter) {
    if (!meter) return;
    const render = () => {
      const stats = collectTurnStats();
      if (stats.error) {
        meter.textContent = '메시지 측정 실패: DOM을 읽을 수 없습니다.';
        return;
      }
      meter.textContent = `메시지 현황 · 유저 ${stats.userMessages} · LLM ${stats.llmMessages}`;
    };
    render();
    if (AUTO_STATE.meterTimer) return;
    AUTO_STATE.meterTimer = setIntervalFn(() => {
      if (!meter.isConnected) {
        clearIntervalFn(AUTO_STATE.meterTimer);
        AUTO_STATE.meterTimer = null;
        return;
      }
      render();
    }, METER_INTERVAL_MS);
  }

  const autoLoader: AutoLoaderExports['autoLoader'] = {
    lastMode: null,
    lastTarget: null,
    lastProfile: AUTO_CFG.profile,
    async start(mode: 'all' | 'turns', target?: number | null, opts: AutoLoaderStartOptions = {}) {
      if (AUTO_STATE.running) {
        setPanelStatus?.('이미 자동 로딩이 진행 중입니다.', 'muted');
        return null;
      }
      if (opts.profile) {
        AUTO_CFG.profile = AUTO_PROFILES[opts.profile] ? opts.profile : 'default';
        this.lastProfile = AUTO_CFG.profile;
        notifyProfileChange();
      }
      this.lastMode = mode;
      this.lastProfile = AUTO_CFG.profile;
      try {
        if (mode === 'all') {
          this.lastTarget = null;
          return await autoLoadAll();
        }
        if (mode === 'turns') {
          const numericTarget = Number(target);
          const goal = Number.isFinite(numericTarget) ? numericTarget : Number(target) || 0;
          if (!goal || goal <= 0) {
            setPanelStatus?.('유저 메시지 목표가 올바르지 않습니다.', 'error');
            return null;
          }
          this.lastTarget = goal;
          return await autoLoadUntilPlayerTurns(goal);
        }
      } catch (error) {
        errorHandler.handle(error, 'autoload', errorHandler.LEVELS?.ERROR);
        throw error;
      }
      return null;
    },
    async startCurrent(profileName) {
      if (!this.lastMode) {
        setPanelStatus?.('재시도할 이전 작업이 없습니다.', 'muted');
        return null;
      }
      if (profileName) {
        AUTO_CFG.profile = AUTO_PROFILES[profileName] ? profileName : 'default';
      } else {
        AUTO_CFG.profile = this.lastProfile || 'default';
      }
      this.lastProfile = AUTO_CFG.profile;
      notifyProfileChange();
      return this.start(this.lastMode, this.lastTarget);
    },
    setProfile(profileName) {
      const next = AUTO_PROFILES[profileName] ? profileName : 'default';
      AUTO_CFG.profile = next;
      this.lastProfile = next;
      setPanelStatus?.(`프로파일이 '${next}'로 설정되었습니다.`, 'info');
      notifyProfileChange();
    },
    stop() {
      stopAutoLoad();
    },
  };

  const subscribeProfileChange = (listener) => {
    if (typeof listener !== 'function') return () => {};
    profileListeners.add(listener);
    return () => profileListeners.delete(listener);
  };

  notifyProfileChange();

  return {
    autoLoader,
    autoState: AUTO_STATE,
    autoProfiles: AUTO_PROFILES,
    getProfile,
    subscribeProfileChange,
    startTurnMeter,
    collectTurnStats,
  };
}
