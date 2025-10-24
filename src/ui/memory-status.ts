import type {
  BlockStorageController,
  MemoryBlockInit,
  MemoryStatusController,
  MemoryStatusOptions,
  MemoryStatusSnapshot,
  MessageStreamController,
} from '../types';

type ConsoleLike = Pick<Console, 'log' | 'warn' | 'error'>;
type RafHandle = number | null;

const SECTION_ID = 'gmh-section-memory';
const SECTION_CLASS = 'gmh-panel__section';
const DEFAULT_STATUS_TEXT = '상태: ⛔ 비활성화됨';

const noop = (): void => {};

const isPromiseLike = <T>(value: unknown): value is PromiseLike<T> =>
  typeof value === 'object' && value !== null && 'then' in (value as Record<string, unknown>);

const cloneMessage = <T>(value: T): T => {
  if (!value || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // fall back to JSON clone
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const formatRelativeTime = (timestamp: number | null, now: number): string => {
  if (!timestamp) return '마지막 저장: 기록 없음';
  const diff = Math.max(0, now - timestamp);
  if (diff < 1000) return '마지막 저장: 방금 전';
  if (diff < 60_000) {
    const seconds = Math.floor(diff / 1000);
    return `마지막 저장: ${seconds}초 전`;
  }
  if (diff < 3_600_000) {
    const minutes = Math.floor(diff / 60_000);
    return `마지막 저장: ${minutes}분 전`;
  }
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    return `마지막 저장: ${hours}시간 전`;
  }
  const days = Math.floor(diff / 86_400_000);
  return `마지막 저장: ${days}일 전`;
};

const formatSessionLabel = (sessionUrl: string | null): string => {
  if (!sessionUrl) return '현재 세션: -';
  try {
    const parsed = new URL(sessionUrl);
    const query = parsed.search ? parsed.search : '';
    const base = `${parsed.hostname}${parsed.pathname.replace(/\/$/, '') || ''}${query}`;
    if (base.length <= 64) {
      return `현재 세션: ${base}`;
    }
    return `현재 세션: ${base.slice(0, 61)}…`;
  } catch {
    return sessionUrl.length <= 64 ? `현재 세션: ${sessionUrl}` : `현재 세션: ${sessionUrl.slice(0, 61)}…`;
  }
};

const resolveBlockMessageCount = (block: MemoryBlockInit): number => {
  if (Array.isArray(block.messages)) {
    return block.messages.length;
  }
  const metaSize = Number((block.meta as Record<string, unknown> | undefined)?.blockSize);
  if (Number.isFinite(metaSize) && metaSize >= 0) {
    return Math.floor(metaSize);
  }
  return 0;
};

export const createMemoryStatus = (options: MemoryStatusOptions = {}): MemoryStatusController => {
  const doc = options.documentRef ?? (typeof document !== 'undefined' ? document : null);
  const win = options.windowRef ?? (typeof window !== 'undefined' ? window : null);
  const logger: ConsoleLike | null =
    options.console ?? (typeof console !== 'undefined' ? console : null);

  let enabled = Boolean(options.experimentalEnabled);
  const sessionTotals = new Map<string, { blocks: number; messages: number }>();
  const resolvingSessions = new Set<string>();

  let snapshot: MemoryStatusSnapshot = {
    enabled,
    totalBlocks: 0,
    totalMessages: 0,
    sessionUrl: null,
    sessionBlocks: 0,
    sessionMessages: 0,
    lastSavedAt: null,
  };

  let section: HTMLElement | null = null;
  let stateField: HTMLElement | null = null;
  let totalsField: HTMLElement | null = null;
  let sessionField: HTMLElement | null = null;
  let lastField: HTMLElement | null = null;

  let rafHandle: RafHandle = null;
  let pendingRender = false;
  let relativeTimer: number | NodeJS.Timeout | null = null;

  let blockUnsubscribe: (() => void) | null = null;

  let storageResolved: BlockStorageController | null = null;
  let storagePromise: Promise<BlockStorageController | null> | null = null;
  let storageError: unknown = null;

  const messageStream: MessageStreamController | null = options.messageStream ?? null;

  const requestFrame = (callback: FrameRequestCallback): number => {
    if (win && typeof win.requestAnimationFrame === 'function') {
      return win.requestAnimationFrame(callback);
    }
    return (setTimeout(callback, 16) as unknown) as number;
  };

  const cancelFrame = (handle: RafHandle): void => {
    if (handle === null) return;
    if (win && typeof win.cancelAnimationFrame === 'function') {
      win.cancelAnimationFrame(handle);
    } else {
      clearTimeout(handle as unknown as NodeJS.Timeout);
    }
  };

  const ensureRelativeTimer = (): void => {
    if (!enabled || !snapshot.lastSavedAt) {
      if (relativeTimer) {
        if (win && typeof win.clearInterval === 'function') {
          win.clearInterval(relativeTimer as number);
        } else {
          clearInterval(relativeTimer as NodeJS.Timeout);
        }
        relativeTimer = null;
      }
      return;
    }
    if (relativeTimer) return;
    const handler = () => {
      if (!enabled || !snapshot.lastSavedAt) {
        if (relativeTimer) {
          if (win && typeof win.clearInterval === 'function') {
            win.clearInterval(relativeTimer as number);
          } else {
            clearInterval(relativeTimer as NodeJS.Timeout);
          }
          relativeTimer = null;
        }
        return;
      }
      scheduleRender();
    };
    if (win && typeof win.setInterval === 'function') {
      relativeTimer = win.setInterval(handler, 1_000);
    } else {
      relativeTimer = setInterval(handler, 1_000);
    }
  };

  const resolveStorage = async (): Promise<BlockStorageController | null> => {
    if (storageResolved) return storageResolved;
    if (storageError) return null;
    if (storagePromise) return storagePromise;
    const source = options.blockStorage;
    if (!source) return null;
    if (isPromiseLike<BlockStorageController>(source)) {
      storagePromise = source
        .then((store) => {
          storageResolved = store;
          return store;
        })
        .catch((err) => {
          storageError = err;
          logger?.warn?.('[GMH] memory status storage unavailable', err);
          return null;
        });
      return storagePromise;
    }
    storageResolved = source;
    return storageResolved;
  };

  const getCurrentSessionUrl = (): string | null => {
    if (options.getSessionUrl) {
      try {
        const derived = options.getSessionUrl();
        if (derived) return derived;
      } catch (err) {
        logger?.warn?.('[GMH] memory status session resolver failed', err);
      }
    }
    if (messageStream && typeof messageStream.getSessionUrl === 'function') {
      try {
        return messageStream.getSessionUrl();
      } catch (err) {
        logger?.warn?.('[GMH] memory status stream session lookup failed', err);
      }
    }
    return null;
  };

  const computeSessionTotals = (blocks: MemoryBlockInit[]): { blocks: number; messages: number } => {
    const totals = blocks.reduce(
      (acc, block) => {
        const count = resolveBlockMessageCount(block);
        return {
          blocks: acc.blocks + 1,
          messages: acc.messages + count,
        };
      },
      { blocks: 0, messages: 0 },
    );
    return totals;
  };

  const ensureSessionStats = async (sessionUrl: string | null): Promise<void> => {
    if (!sessionUrl || sessionTotals.has(sessionUrl) || resolvingSessions.has(sessionUrl)) return;
    resolvingSessions.add(sessionUrl);
    try {
      const store = await resolveStorage();
      if (!store) return;
      const blocks = await store.getBySession(sessionUrl);
      sessionTotals.set(sessionUrl, computeSessionTotals(blocks));
      scheduleRender();
    } catch (err) {
      logger?.warn?.('[GMH] memory status session fetch failed', err);
    } finally {
      resolvingSessions.delete(sessionUrl);
    }
  };

  const refreshTotals = async (): Promise<void> => {
    try {
      const store = await resolveStorage();
      if (!store) return;
      const stats = await store.getStats();
      snapshot = {
        ...snapshot,
        totalBlocks: stats.totalBlocks ?? 0,
        totalMessages: stats.totalMessages ?? 0,
      };
      const currentSession = getCurrentSessionUrl();
      snapshot = { ...snapshot, sessionUrl: currentSession };
      if (currentSession) {
        await ensureSessionStats(currentSession);
      }
      scheduleRender();
    } catch (err) {
      logger?.warn?.('[GMH] memory status stats refresh failed', err);
    }
  };

  const scheduleRender = (): void => {
    if (!section) return;
    if (pendingRender) return;
    pendingRender = true;
    rafHandle = requestFrame(() => {
      pendingRender = false;
      render();
    });
  };

  const render = (): void => {
    if (!section) return;

    snapshot = {
      ...snapshot,
      enabled,
      sessionUrl: getCurrentSessionUrl(),
    };

    if (!stateField || !totalsField || !sessionField || !lastField) return;

    if (!enabled) {
      section.hidden = true;
      snapshot = {
        ...snapshot,
        sessionBlocks: 0,
        sessionMessages: 0,
      };
      stateField.textContent = DEFAULT_STATUS_TEXT;
      totalsField.textContent = '저장된 블록: 0개 (0 메시지)';
      sessionField.textContent = '현재 세션: -';
      lastField.textContent = '마지막 저장: 기록 없음';
      return;
    }

    section.hidden = false;
    stateField.textContent = '상태: ✅ 활성화됨';

    const currentSession = snapshot.sessionUrl;
    if (currentSession && !sessionTotals.has(currentSession)) {
      void ensureSessionStats(currentSession);
    }

    const sessionCounts = currentSession
      ? sessionTotals.get(currentSession) ?? { blocks: 0, messages: 0 }
      : { blocks: 0, messages: 0 };

    snapshot = {
      ...snapshot,
      sessionBlocks: sessionCounts.blocks,
      sessionMessages: sessionCounts.messages,
    };

    totalsField.textContent = `저장된 블록: ${snapshot.totalBlocks}개 (${snapshot.totalMessages} 메시지)`;
    sessionField.textContent = `${formatSessionLabel(currentSession)} · ${sessionCounts.blocks}개 (${sessionCounts.messages} 메시지)`;

    const now = Date.now();
    lastField.textContent = formatRelativeTime(snapshot.lastSavedAt, now);

    if (snapshot.lastSavedAt) {
      ensureRelativeTimer();
    }
  };

  const ensureSection = (panel: Element | null): HTMLElement | null => {
    if (!doc || !panel) return null;
    const existing = panel.querySelector<HTMLElement>(`#${SECTION_ID}`);
    if (existing) {
      section = existing;
    } else if (!section) {
      section = doc.createElement('section');
      section.id = SECTION_ID;
      section.className = SECTION_CLASS;
      section.innerHTML = `
        <div class="gmh-panel__section-title">
          <span aria-hidden="true">🧠</span>
          <span style="margin-left:6px;">Memory Index</span>
          <span style="margin-left:8px; font-size:11px; color:#93c5fd;">실험 기능</span>
        </div>
        <div class="gmh-memory-status__body">
          <p data-field="state" class="gmh-memory-status__line">${DEFAULT_STATUS_TEXT}</p>
          <p data-field="totals" class="gmh-memory-status__line">저장된 블록: 0개 (0 메시지)</p>
          <p data-field="session" class="gmh-memory-status__line">현재 세션: -</p>
          <p data-field="last" class="gmh-memory-status__line">마지막 저장: 기록 없음</p>
        </div>
      `;
    }

    if (!section) return null;

    stateField = section.querySelector<HTMLElement>('[data-field="state"]');
    totalsField = section.querySelector<HTMLElement>('[data-field="totals"]');
    sessionField = section.querySelector<HTMLElement>('[data-field="session"]');
    lastField = section.querySelector<HTMLElement>('[data-field="last"]');

    if (!section.parentElement) {
      const exportSection = panel.querySelector(`#gmh-section-export`);
      if (exportSection?.parentElement === panel) {
        panel.insertBefore(section, exportSection);
      } else {
        panel.insertBefore(section, panel.firstChild);
      }
    }

    return section;
  };

  const handleBlock = (block: MemoryBlockInit): void => {
    const safeBlock = cloneMessage(block);
    snapshot = {
      ...snapshot,
      totalBlocks: snapshot.totalBlocks + 1,
      totalMessages: snapshot.totalMessages + resolveBlockMessageCount(safeBlock),
      lastSavedAt: Math.max(snapshot.lastSavedAt ?? 0, Number(safeBlock.timestamp) || Date.now()),
    };
    const current = sessionTotals.get(safeBlock.sessionUrl) ?? { blocks: 0, messages: 0 };
    const increment = resolveBlockMessageCount(safeBlock);
    sessionTotals.set(safeBlock.sessionUrl, {
      blocks: current.blocks + 1,
      messages: current.messages + increment,
    });
    scheduleRender();
  };

  const ensureSubscriptions = (): void => {
    if (!enabled) return;
    if (!messageStream || typeof messageStream.subscribeBlocks !== 'function') return;
    if (blockUnsubscribe) return;
    blockUnsubscribe = messageStream.subscribeBlocks((block) => handleBlock(block));
  };

  const teardownSubscriptions = (): void => {
    if (blockUnsubscribe) {
      blockUnsubscribe();
      blockUnsubscribe = null;
    }
    if (relativeTimer) {
      if (win && typeof win.clearInterval === 'function') {
        win.clearInterval(relativeTimer as number);
      } else {
        clearInterval(relativeTimer as NodeJS.Timeout);
      }
      relativeTimer = null;
    }
  };

  const mount = (panel: Element | null): void => {
    if (!panel) return;
    const target = ensureSection(panel);
    if (!target) return;
    if (!enabled) {
      target.hidden = true;
      render();
      return;
    }
    target.hidden = false;
    ensureSubscriptions();
    void refreshTotals();
  };

  const setEnabled = (next: boolean): void => {
    if (enabled === next) return;
    enabled = next;
    snapshot = { ...snapshot, enabled: next };
    if (!section) return;
    if (!enabled) {
      teardownSubscriptions();
      section.hidden = true;
      render();
      return;
    }
    ensureSubscriptions();
    void refreshTotals();
    section.hidden = false;
    scheduleRender();
  };

  const destroy = (): void => {
    teardownSubscriptions();
    cancelFrame(rafHandle);
    rafHandle = null;
    pendingRender = false;
    if (section?.parentElement) {
      section.parentElement.removeChild(section);
    }
    section = null;
    stateField = null;
    totalsField = null;
    sessionField = null;
    lastField = null;
  };

  const forceRefresh = async (): Promise<void> => {
    await refreshTotals();
  };

  return {
    mount,
    setEnabled,
    destroy,
    forceRefresh,
  };
};

export default createMemoryStatus;
