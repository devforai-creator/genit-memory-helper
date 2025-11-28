import { CONFIG } from '../config';
import type { AutoLoaderProfile, AutoLoaderProfileKey } from '../config';
import type {
  AutoLoaderExports,
  AutoLoaderOptions,
  AutoLoaderStats,
  AutoLoaderStartOptions,
  AutoLoaderController,
  ExportRangeController,
  MessageIndexer,
  MessageIndexerSummary,
  StructuredSnapshot,
  StructuredSnapshotMessage,
  TranscriptSession,
  TranscriptTurn,
  GenitAdapter,
} from '../types';
import type { BabechatAdapter } from '../adapters/babechat';
// DOM marking is now used for deduplication instead of progressive-collector

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

  const isProfileKey = (value: string | null | undefined): value is AutoLoaderProfileKey =>
    value === 'default' || value === 'stability' || value === 'fast';

  const resolveProfileKey = (value: string | null | undefined): AutoLoaderProfileKey =>
    isProfileKey(value) ? value : 'default';

  const resolveStateKey = (value: string | undefined, fallback: string): string =>
    typeof value === 'string' && value.length > 0 ? value : fallback;

  const AUTO_CFG: { profile: AutoLoaderProfileKey } = {
    profile: 'default',
  };

  const AUTO_STATE: {
    running: boolean;
    container: Element | null;
    meterTimer: ReturnType<typeof setInterval> | null;
    lastProgressiveMessages: StructuredSnapshotMessage[] | null;
  } = {
    running: false,
    container: null,
    meterTimer: null,
    lastProgressiveMessages: null,
  };

  // Check if current adapter uses virtual scrolling (only visible messages in DOM)
  const isVirtualScrollAdapter = (): boolean => {
    const adapter = typeof getActiveAdapter === 'function' ? getActiveAdapter() : null;
    // babechat uses virtual scrolling
    return adapter?.id === 'babechat';
  };

  // Check if current adapter supports API-based collection (bypasses virtual scroll)
  const canUseApiCollection = (): boolean => {
    const adapter = typeof getActiveAdapter === 'function' ? getActiveAdapter() : null;
    if (adapter?.id === 'babechat') {
      const babechatAdapter = adapter as unknown as BabechatAdapter;
      return typeof babechatAdapter.canUseApiCollection === 'function' && babechatAdapter.canUseApiCollection();
    }
    return false;
  };

  // Fetch all messages via API (for adapters that support it)
  const fetchMessagesViaApi = async (): Promise<StructuredSnapshotMessage[]> => {
    const adapter = typeof getActiveAdapter === 'function' ? getActiveAdapter() : null;
    if (adapter?.id === 'babechat') {
      const babechatAdapter = adapter as unknown as BabechatAdapter;
      if (typeof babechatAdapter.fetchAllMessagesViaApi === 'function') {
        return babechatAdapter.fetchAllMessagesViaApi();
      }
    }
    return [];
  };

  // Collect current visible messages using adapter (no deduplication here)
  const collectVisibleMessages = (): StructuredSnapshotMessage[] => {
    const adapter = typeof getActiveAdapter === 'function' ? getActiveAdapter() : null;
    if (!adapter?.listMessageBlocks || !adapter?.collectStructuredMessage) {
      return [];
    }

    const messages: StructuredSnapshotMessage[] = [];
    try {
      const blocksResult = adapter.listMessageBlocks(doc);
      const blocks = blocksResult ? toElementArray(blocksResult) : [];
      for (const block of blocks) {
        const msg = adapter.collectStructuredMessage(block);
        if (msg) {
          messages.push(msg);
        }
      }
    } catch (err) {
      warnWithHandler(err, 'autoload', '[GMH] progressive collection failed');
    }
    return messages;
  };

  /**
   * Generate a content signature for a message
   */
  const getMessageSignature = (msg: StructuredSnapshotMessage): string => {
    const role = msg.role || 'unknown';
    const speaker = msg.speaker || '';
    const contentParts: string[] = [];
    if (Array.isArray(msg.parts)) {
      for (const part of msg.parts) {
        if (Array.isArray(part.lines)) {
          contentParts.push(...part.lines);
        }
      }
    }
    return `${role}:${speaker}:${contentParts.join('\n')}`;
  };

  /**
   * Merge new messages into accumulated list using Set-based deduplication.
   * Works for virtual scroll where visible window can be any portion of conversation.
   *
   * When scrolling DOWN (Top to Bottom):
   * - newBatch contains current viewport (mix of old and new messages)
   * - We filter to only truly new messages and APPEND them
   */
  const mergeMessageBatch = (
    accumulated: StructuredSnapshotMessage[],
    newBatch: StructuredSnapshotMessage[],
  ): StructuredSnapshotMessage[] => {
    if (accumulated.length === 0) {
      return [...newBatch];
    }
    if (newBatch.length === 0) {
      return [...accumulated]; // Always return new array to avoid reference issues
    }

    // Build set of existing signatures for O(1) lookup
    const existingSignatures = new Set<string>();
    for (const msg of accumulated) {
      existingSignatures.add(getMessageSignature(msg));
    }

    // Filter newBatch to only include truly new messages
    const newMessages: StructuredSnapshotMessage[] = [];
    for (const msg of newBatch) {
      const sig = getMessageSignature(msg);
      if (!existingSignatures.has(sig)) {
        newMessages.push(msg);
        existingSignatures.add(sig); // Prevent duplicates within newBatch too
      }
    }

    if (newMessages.length === 0) {
      return [...accumulated]; // Always return a new array to avoid reference issues
    }

    // APPEND new messages (they're newer, from scrolling DOWN)
    return [...accumulated, ...newMessages];
  };

  const profileListeners = new Set<(profile: AutoLoaderProfileKey) => void>();
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

  async function scrollUpCycle(
    container: Element | null,
    profile: AutoLoaderProfile,
  ): Promise<{ grew: boolean; before: number; after: number }> {
    if (!container) return { grew: false, before: 0, after: 0 };
    const target = container as ScrollElement;
    const before = target.scrollHeight;
    target.scrollTop = 0;
    const grew = await waitForGrowth(target, before, profile.settleTimeoutMs);
    return { grew, before, after: target.scrollHeight };
  }

  /**
   * Gradual scroll DOWN for virtual scroll adapters (e.g., babechat)
   * Strategy: Start from TOP, scroll DOWN to collect all messages in order
   * This works better with virtual scroll that removes messages from both ends
   */
  async function gradualScrollDownCycle(
    container: Element | null,
    profile: AutoLoaderProfile,
  ): Promise<{ reachedBottom: boolean; beforeScroll: number; afterScroll: number }> {
    if (!container) {
      logger?.warn?.('[GMH] gradualScrollDownCycle: no container');
      return { reachedBottom: true, beforeScroll: 0, afterScroll: 0 };
    }
    const target = container as ScrollElement;
    const beforeScroll = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const clientHeight = (target as HTMLElement).clientHeight;
    const maxScroll = scrollHeight - clientHeight;

    logger?.log?.(`[GMH] scroll: before=${beforeScroll}, height=${scrollHeight}, client=${clientHeight}, max=${maxScroll}`);

    // Already at bottom
    if (beforeScroll >= maxScroll - 5) {
      logger?.log?.('[GMH] Already at bottom, stopping');
      return { reachedBottom: true, beforeScroll, afterScroll: beforeScroll };
    }

    // Scroll down by 50% of the container's client height
    const scrollStep = Math.max(200, clientHeight * 0.5);
    const newScrollTop = Math.min(maxScroll, beforeScroll + scrollStep);
    target.scrollTop = newScrollTop;

    // Wait for DOM to settle
    await sleep(profile.settleTimeoutMs);

    const afterScroll = target.scrollTop;
    const newMaxScroll = target.scrollHeight - clientHeight;
    const reachedBottom = afterScroll >= newMaxScroll - 5;

    logger?.log?.(`[GMH] scroll: after=${afterScroll}, reachedBottom=${reachedBottom}`);

    return { reachedBottom, beforeScroll, afterScroll };
  }

  const statsCache: StatsCache = {
    summaryKey: null,
    rawKey: null,
    data: null,
  };

  const clearStatsCache = (): void => {
    statsCache.summaryKey = null;
    statsCache.rawKey = null;
    statsCache.data = null;
  };

  let lastSessionSignature = windowRef?.location?.href || (typeof location !== 'undefined' ? location.href : null);

  const makeSummaryKey = (summary: MessageIndexerSummary | null | undefined): string | null => {
    if (!summary) return null;
    const total = Number.isFinite(summary.totalMessages) ? summary.totalMessages : 'na';
    const user = Number.isFinite(summary.userMessages) ? summary.userMessages : 'na';
    const stamp = typeof summary.timestamp === 'number' && Number.isFinite(summary.timestamp)
      ? summary.timestamp
      : 'na';
    return `${total}:${user}:${stamp}`;
  };

  function collectTurnStats(options: CollectStatsOptions = {}): AutoLoaderStats {
    const force = Boolean(options.force);
    let summary: MessageIndexerSummary | null = null;
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
      const currentRange = typeof exportRange?.getRange === 'function'
        ? exportRange.getRange()
        : { start: null, end: null };
      const hasRequestedRange =
        (typeof currentRange?.start === 'number' && Number.isFinite(currentRange.start) && currentRange.start > 0) ||
        (typeof currentRange?.end === 'number' && Number.isFinite(currentRange.end) && currentRange.end > 0);
      if (!hasRequestedRange && (totalsShrank || userShrank || llmShrank || entryShrank)) {
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

  const notifyScan = (payload: unknown): void => {
    stateApi.setState(resolveStateKey(stateEnum.SCANNING, 'SCANNING'), payload);
  };

  const notifyDone = (payload: unknown): void => {
    stateApi.setState(resolveStateKey(stateEnum.DONE, 'DONE'), payload);
  };

  const notifyError = (payload: unknown): void => {
    stateApi.setState(resolveStateKey(stateEnum.ERROR, 'ERROR'), payload);
  };

  const notifyIdle = (payload: unknown): void => {
    stateApi.setState(resolveStateKey(stateEnum.IDLE, 'IDLE'), payload);
  };

  async function autoLoadAll(): Promise<AutoLoaderStats> {
    const profile = AUTO_PROFILES[resolveProfileKey(getProfile())];
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

    // Check if API-based collection is available (bypasses virtual scroll entirely)
    const useApiCollection = canUseApiCollection();
    // Progressive collection fallback for virtual scroll adapters
    const useProgressiveCollection = !useApiCollection && isVirtualScrollAdapter();
    const collectedMessages: StructuredSnapshotMessage[] = [];
    if (useApiCollection || useProgressiveCollection) {
      AUTO_STATE.lastProgressiveMessages = null;
    }

    // API-based collection (best option for babechat - no scrolling needed)
    if (useApiCollection) {
      logger?.log?.('[GMH] Using API-based collection (no scrolling needed)');
      notifyScan({
        label: 'API 수집',
        message: 'API에서 메시지를 가져오는 중...',
        tone: 'progress',
        progress: { indeterminate: true },
      });

      try {
        const apiMessages = await fetchMessagesViaApi();
        collectedMessages.push(...apiMessages);
        AUTO_STATE.lastProgressiveMessages = collectedMessages;

        const userCount = collectedMessages.filter(m => m.channel === 'user' || m.role === 'player').length;
        logger?.log?.(`[GMH] API collection complete: ${collectedMessages.length} messages (${userCount} user)`);

        notifyDone({
          label: 'API 수집 완료',
          message: `${collectedMessages.length}개 메시지 수집 (유저 ${userCount}개)`,
          tone: 'success',
          progress: { value: 1 },
        });

        AUTO_STATE.running = false;
        const stats = collectTurnStats();
        return stats;
      } catch (err) {
        // API failed, fall back to progressive collection
        logger?.warn?.('[GMH] API collection failed, falling back to scroll-based:', err);
        warnWithHandler(err, 'autoload', '[GMH] API collection failed');
        // Continue to progressive collection
      }
    }

    // Different scroll strategies for virtual scroll vs traditional infinite scroll
    if (useProgressiveCollection || (useApiCollection && collectedMessages.length === 0)) {
      // Virtual scroll: Start from TOP, scroll DOWN to collect all messages
      // Use 3x the normal guard limit for virtual scroll
      const virtualScrollGuardLimit = profile.guardLimit * 3;
      const target = container as ScrollElement;

      // Step 1: Jump to TOP first
      logger?.log?.('[GMH] Virtual scroll: jumping to top first');
      target.scrollTop = 0;
      await sleep(profile.settleTimeoutMs);

      // Step 2: Collect messages at top
      const initialBatch = collectVisibleMessages();
      collectedMessages.push(...initialBatch);
      logger?.log?.(`[GMH] Initial collection at top: ${initialBatch.length} messages`);

      notifyScan({
        label: '전체 로딩',
        message: `시작 위치에서 ${collectedMessages.length}개 수집`,
        tone: 'progress',
        progress: { indeterminate: true },
      });

      await sleep(profile.cycleDelayMs);

      // Step 3: Scroll DOWN gradually, collecting new messages at each step
      while (AUTO_STATE.running && guard < virtualScrollGuardLimit) {
        guard += 1;

        // Gradual scroll down
        const { reachedBottom } = await gradualScrollDownCycle(container, profile);
        if (!AUTO_STATE.running) break;

        // Collect visible messages and merge
        const newBatch = collectVisibleMessages();
        const beforeMerge = collectedMessages.length;
        const merged = mergeMessageBatch(collectedMessages, newBatch);
        const added = merged.length - beforeMerge;
        collectedMessages.length = 0;
        collectedMessages.push(...merged);

        logger?.log?.(`[GMH] collect: batch=${newBatch.length}, added=${added}, total=${collectedMessages.length}`);

        notifyScan({
          label: '전체 로딩',
          message: `수집 중 (${guard}/${virtualScrollGuardLimit}) · ${collectedMessages.length}개 누적`,
          tone: 'progress',
          progress: { indeterminate: true },
        });

        // Stop if we've reached the bottom
        if (reachedBottom) {
          logger?.log?.(`[GMH] Reached bottom: total=${collectedMessages.length} messages`);
          break;
        }

        await sleep(profile.cycleDelayMs);
      }
    } else {
      // Traditional infinite scroll: jump to top and wait for content growth
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
    }

    // Final collection after scroll completes (catch any remaining messages)
    if (useProgressiveCollection) {
      const finalBatch = collectVisibleMessages();
      const merged = mergeMessageBatch(collectedMessages, finalBatch);
      AUTO_STATE.lastProgressiveMessages = merged;

      logger?.log?.(`[GMH] Progressive collection complete: ${merged.length} messages`);
    }

    AUTO_STATE.running = false;
    const stats = collectTurnStats();
    if (stats.error && !useProgressiveCollection) {
      notifyError({
        label: '자동 로딩 실패',
        message: '스크롤 후 파싱 실패',
        tone: 'error',
        progress: { value: 1 },
      });
    } else if (useProgressiveCollection && AUTO_STATE.lastProgressiveMessages) {
      // For virtual scroll, show progressive collection count
      const progressiveCount = AUTO_STATE.lastProgressiveMessages.length;
      const userCount = AUTO_STATE.lastProgressiveMessages.filter(m => m.channel === 'user' || m.role === 'player').length;
      notifyDone({
        label: '자동 로딩 완료',
        message: `${progressiveCount}개 메시지 수집 (유저 ${userCount}개)`,
        tone: 'success',
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
    const profile = AUTO_PROFILES[resolveProfileKey(getProfile())];
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

  function startTurnMeter(meter: HTMLElement | null): void {
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
        if (AUTO_STATE.meterTimer !== null) {
          clearIntervalFn(AUTO_STATE.meterTimer);
          AUTO_STATE.meterTimer = null;
        }
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
        AUTO_CFG.profile = resolveProfileKey(opts.profile);
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
        AUTO_CFG.profile = resolveProfileKey(profileName);
      } else {
        AUTO_CFG.profile = resolveProfileKey(this.lastProfile || null);
      }
      this.lastProfile = AUTO_CFG.profile;
      notifyProfileChange();
      return this.start(this.lastMode, this.lastTarget);
    },
    setProfile(profileName) {
      const next = resolveProfileKey(profileName);
      AUTO_CFG.profile = next;
      this.lastProfile = next;
      setPanelStatus?.(`프로파일이 '${next}'로 설정되었습니다.`, 'info');
      notifyProfileChange();
    },
    stop() {
      stopAutoLoad();
    },
  };

  const subscribeProfileChange = (
    listener: ((profile: AutoLoaderProfileKey) => void) | null | undefined,
  ): (() => void) => {
    if (typeof listener !== 'function') return () => {};
    profileListeners.add(listener);
    return () => profileListeners.delete(listener);
  };

  /**
   * Get progressively collected messages (for virtual scroll adapters like babechat)
   * Returns null if progressive collection wasn't used or no messages collected
   */
  const getProgressiveMessages = (): StructuredSnapshotMessage[] | null => {
    return AUTO_STATE.lastProgressiveMessages;
  };

  /**
   * Clear progressive collection cache
   */
  const clearProgressiveMessages = (): void => {
    AUTO_STATE.lastProgressiveMessages = null;
  };

  /**
   * Check if progressive collection is available for current adapter
   */
  const hasProgressiveMessages = (): boolean => {
    return Array.isArray(AUTO_STATE.lastProgressiveMessages) && AUTO_STATE.lastProgressiveMessages.length > 0;
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
    getProgressiveMessages,
    clearProgressiveMessages,
    hasProgressiveMessages,
  };
}
