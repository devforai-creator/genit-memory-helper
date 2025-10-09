/**
 * @typedef {import('../types').MessageIndexerOptions} MessageIndexerOptions
 * @typedef {import('../types').MessageIndexer} MessageIndexer
 * @typedef {import('../types').MessageIndexerSummary} MessageIndexerSummary
 * @typedef {import('../types').ExportRangeController} ExportRangeController
 */

/**
 * @returns {void}
 */
const noop = () => {};

/**
 * Observes Genit chat DOM, annotating blocks with GMH metadata and publishing summaries.
 */
/**
 * Observes Genit chat DOM, annotating blocks with GMH metadata and publishing summaries.
 *
 * @param {MessageIndexerOptions} [options]
 * @returns {MessageIndexer}
 */
export const createMessageIndexer = ({
  console: consoleLike,
  document: documentLike,
  MutationObserver: MutationObserverLike,
  requestAnimationFrame: rafLike,
  exportRange,
  getActiveAdapter,
  getEntryOrigin,
} = {}) => {
  const logger = consoleLike || (typeof console !== 'undefined' ? console : {});
  const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop;
  const error = typeof logger.error === 'function' ? logger.error.bind(logger) : noop;
  /** @type {Document | undefined} */
  const documentRef = documentLike || (typeof document !== 'undefined' ? document : undefined);
  /** @type {typeof MutationObserver | undefined} */
  const MutationObserverRef =
    MutationObserverLike || (typeof MutationObserver !== 'undefined' ? MutationObserver : undefined);
  /** @type {((callback: FrameRequestCallback) => number) | null} */
  const raf = typeof rafLike === 'function'
    ? rafLike
    : typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame.bind(globalThis)
      : null;
  /** @type {ExportRangeController | null | undefined} */
  const exportRangeRef = exportRange;
  const getAdapter = typeof getActiveAdapter === 'function' ? getActiveAdapter : () => null;
  const getOrigins = typeof getEntryOrigin === 'function' ? getEntryOrigin : () => [];

  if (!documentRef) {
    throw new Error('createMessageIndexer requires a document reference');
  }

  /** @type {MutationObserver | null} */
  let observer = null;
  let scheduled = false;
  let active = false;
  /** @type {Map<number, number>} */
  const ordinalCacheByIndex = new Map();
  /** @type {Map<string, number>} */
  const ordinalCacheById = new Map();
  /** @type {MessageIndexerSummary} */
  let lastSummary = {
    totalMessages: 0,
    userMessages: 0,
    llmMessages: 0,
    containerPresent: false,
    timestamp: 0,
  };
  /** @type {Set<(summary: MessageIndexerSummary) => void>} */
  const listeners = new Set();

  /**
   * @param {MessageIndexerSummary} summary
   * @returns {MessageIndexerSummary}
   */
  const cloneSummary = (summary) => ({ ...summary });

  /**
   * @returns {void}
   */
  const notify = () => {
    const snapshot = cloneSummary(lastSummary);
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        warn('[GMH] index listener failed', err);
      }
    });
  };

  /**
   * @returns {MessageIndexerSummary}
   */
  const indexMessages = () => {
    const adapter = getAdapter();
    const container = adapter?.findContainer?.(documentRef);
    const blockNodes = adapter?.listMessageBlocks?.(container || documentRef) || [];
    const blocks = Array.from(blockNodes).filter((node) => node instanceof Element);

    let userMessageCount = 0;
    ordinalCacheByIndex.clear();
    ordinalCacheById.clear();

    blocks.forEach((block, idx) => {
      try {
        block.setAttribute('data-gmh-message', '1');
        block.setAttribute('data-gmh-message-index', String(idx));
        const messageId =
          block.getAttribute('data-gmh-message-id') ||
          block.getAttribute('data-message-id') ||
          block.getAttribute('data-id') ||
          null;
        if (messageId) block.setAttribute('data-gmh-message-id', messageId);
        else block.removeAttribute('data-gmh-message-id');
        const role = adapter?.detectRole?.(block) || 'unknown';
        block.setAttribute('data-gmh-message-role', role);
        const channel = role === 'player' ? 'user' : 'llm';
        block.setAttribute('data-gmh-channel', channel);
        if (channel === 'user') userMessageCount += 1;
        block.removeAttribute('data-gmh-player-turn');
        block.removeAttribute('data-gmh-user-ordinal');
        block.removeAttribute('data-gmh-message-ordinal');
      } catch (err) {
        /* ignore per-node errors */
      }
    });

    let messageOrdinal = 0;
    let userOrdinal = 0;
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const block = blocks[i];
      if (!block) continue;
      messageOrdinal += 1;
      block.setAttribute('data-gmh-message-ordinal', String(messageOrdinal));
      if (block.getAttribute('data-gmh-channel') === 'user') {
        userOrdinal += 1;
        block.setAttribute('data-gmh-user-ordinal', String(userOrdinal));
      } else {
        block.removeAttribute('data-gmh-user-ordinal');
      }
      const blockIdxAttr = block.getAttribute('data-gmh-message-index');
      if (blockIdxAttr !== null) {
        const numericIdx = Number(blockIdxAttr);
        if (Number.isFinite(numericIdx)) ordinalCacheByIndex.set(numericIdx, messageOrdinal);
      }
      const blockMessageId = block.getAttribute('data-gmh-message-id');
      if (blockMessageId) ordinalCacheById.set(blockMessageId, messageOrdinal);
    }

    const entryOrigin = getOrigins() || [];
    const entryOriginIndices = Array.isArray(entryOrigin)
      ? entryOrigin.filter((idx) => Number.isInteger(idx) && idx >= 0)
      : [];
    const uniqueEntryCount = entryOriginIndices.length ? new Set(entryOriginIndices).size : 0;
    const entryCount = blocks.length || uniqueEntryCount;
    const llmCount = Math.max(blocks.length - userMessageCount, 0);

    lastSummary = {
      totalMessages: blocks.length,
      userMessages: userMessageCount,
      llmMessages: llmCount,
      containerPresent: Boolean(container),
      timestamp: Date.now(),
    };

    if (exportRangeRef && typeof exportRangeRef.setTotals === 'function') {
      try {
        exportRangeRef.setTotals({
          message: blocks.length,
          user: userMessageCount,
          llm: llmCount,
          entry: entryCount,
        });
      } catch (err) {
        warn('[GMH] failed to update export range totals', err);
      }
    }

    notify();
    return lastSummary;
  };

  /**
   * @returns {void}
   */
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const runner = () => {
      try {
        indexMessages();
      } catch (err) {
        warn('[GMH] message indexing failed', err);
      } finally {
        scheduled = false;
      }
    };
    if (raf) {
      raf(runner);
    } else {
      setTimeout(runner, 16);
    }
  };

  /**
   * @returns {void}
   */
  const ensureObserver = () => {
    if (observer || !MutationObserverRef || !documentRef) return;
    const target = documentRef.body || documentRef.documentElement;
    if (!target) return;
    observer = new MutationObserverRef(() => {
      if (!active) return;
      schedule();
    });
    observer.observe(target, { childList: true, subtree: true });
  };

  const api = {
    start() {
      if (active) {
        schedule();
        return;
      }
      active = true;
      ensureObserver();
      try {
        indexMessages();
      } catch (err) {
        warn('[GMH] initial message indexing failed', err);
      }
    },
    stop() {
      active = false;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      scheduled = false;
    },
    refresh(options = {}) {
      const immediate = Boolean(options?.immediate);
      if (immediate) return indexMessages();
      schedule();
      return cloneSummary(lastSummary);
    },
    getSummary() {
      return cloneSummary(lastSummary);
    },
    lookupOrdinalByIndex(index) {
      const numericIndex = Number(index);
      if (!Number.isFinite(numericIndex)) return null;
      return ordinalCacheByIndex.has(numericIndex) ? ordinalCacheByIndex.get(numericIndex) : null;
    },
    lookupOrdinalByMessageId(messageId) {
      if (typeof messageId !== 'string' || !messageId) return null;
      return ordinalCacheById.has(messageId) ? ordinalCacheById.get(messageId) : null;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return noop;
      listeners.add(listener);
      try {
        listener(cloneSummary(lastSummary));
      } catch (err) {
        warn('[GMH] index subscriber failed', err);
      }
      return () => listeners.delete(listener);
    },
  };

  return /** @type {MessageIndexer} */ (api);
};

export default createMessageIndexer;
