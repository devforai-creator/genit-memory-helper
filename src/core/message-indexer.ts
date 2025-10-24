import type {
  ExportRangeController,
  MessageIndexer,
  MessageIndexerEvent,
  MessageIndexerOptions,
  MessageIndexerSummary,
} from '../types';

type ConsoleWithWarnError =
  | Console
  | {
      warn?: (...args: unknown[]) => void;
      error?: (...args: unknown[]) => void;
    };

type AdapterRef =
  | {
      findContainer?(doc: Document): Element | null;
      listMessageBlocks?(
        doc: Document | Element,
      ): Iterable<Element> | Element[] | NodeListOf<Element> | null;
      detectRole?(block: Element): string;
    }
  | null
  | undefined;

type RangeTotalsSetter = Pick<ExportRangeController, 'setTotals'>;

type SummaryListener = (summary: MessageIndexerSummary) => void;
type MessageListener = (event: MessageIndexerEvent) => void;

const noop = (): void => {};

const cloneSummary = (summary: MessageIndexerSummary): MessageIndexerSummary => ({ ...summary });

const toIterableElements = (
  nodes: Iterable<Element> | Element[] | NodeListOf<Element>,
): Element[] => Array.from(nodes).filter((node): node is Element => node instanceof Element);

export const createMessageIndexer = ({
  console: consoleLike,
  document: documentLike,
  MutationObserver: MutationObserverLike,
  requestAnimationFrame: rafLike,
  exportRange,
  getActiveAdapter,
  getEntryOrigin,
}: MessageIndexerOptions = {}): MessageIndexer => {
  const logger: ConsoleWithWarnError =
    (consoleLike as ConsoleWithWarnError | null | undefined) ??
    (typeof console !== 'undefined' ? console : {});
  const warn =
    typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop;
  const documentRef: Document | undefined =
    documentLike ?? (typeof document !== 'undefined' ? document : undefined);

  const MutationObserverRef: typeof MutationObserver | undefined =
    MutationObserverLike ?? (typeof MutationObserver !== 'undefined' ? MutationObserver : undefined);

  const raf: ((callback: FrameRequestCallback) => number) | null =
    typeof rafLike === 'function'
      ? rafLike
      : typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame.bind(globalThis)
        : null;

  const exportRangeRef: ExportRangeController | null | undefined = exportRange;
  const getAdapter: () => AdapterRef =
    typeof getActiveAdapter === 'function' ? getActiveAdapter : () => null;
  const getOrigins: () => Array<number | null> =
    typeof getEntryOrigin === 'function' ? getEntryOrigin : () => [];

  if (!documentRef) {
    throw new Error('createMessageIndexer requires a document reference');
  }

  let observer: MutationObserver | null = null;
  let scheduled = false;
  let active = false;
  const ordinalCacheByIndex = new Map<number, number>();
  const ordinalCacheById = new Map<string, number>();
  let lastSummary: MessageIndexerSummary = {
    totalMessages: 0,
    userMessages: 0,
    llmMessages: 0,
    containerPresent: false,
    timestamp: 0,
  };
  const listeners = new Set<SummaryListener>();
  const messageListeners = new Set<MessageListener>();
  let knownMessages: WeakSet<Element> = new WeakSet();
  let lastContainer: Element | null = null;

  const notify = (): void => {
    const snapshot = cloneSummary(lastSummary);
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        warn('[GMH] index listener failed', err);
      }
    });
  };

  const indexMessages = (): MessageIndexerSummary => {
    const adapter = getAdapter();
    const container = adapter?.findContainer?.(documentRef) ?? null;
    const blockNodes =
      adapter?.listMessageBlocks?.(container ?? documentRef) ?? [];

    const blocks = Array.isArray(blockNodes)
      ? toIterableElements(blockNodes)
      : blockNodes
        ? toIterableElements(blockNodes as Iterable<Element>)
        : [];

    if (!container) {
      knownMessages = new WeakSet();
      lastContainer = null;
    } else if (container !== lastContainer) {
      knownMessages = new WeakSet();
      lastContainer = container;
    }

    let userMessageCount = 0;
    ordinalCacheByIndex.clear();
    ordinalCacheById.clear();
    const newBlocks: Element[] = [];

    blocks.forEach((block, idx) => {
      try {
        block.setAttribute('data-gmh-message', '1');
        block.setAttribute('data-gmh-message-index', String(idx));
        const messageId =
          block.getAttribute('data-gmh-message-id') ||
          block.getAttribute('data-message-id') ||
          block.getAttribute('data-id') ||
          null;
        if (messageId) {
          block.setAttribute('data-gmh-message-id', messageId);
        } else {
          block.removeAttribute('data-gmh-message-id');
        }
        const role = adapter?.detectRole?.(block) || 'unknown';
        block.setAttribute('data-gmh-message-role', role);
        const channel = role === 'player' ? 'user' : 'llm';
        block.setAttribute('data-gmh-channel', channel);
        if (channel === 'user') userMessageCount += 1;
        block.removeAttribute('data-gmh-player-turn');
        block.removeAttribute('data-gmh-user-ordinal');
        block.removeAttribute('data-gmh-message-ordinal');
        if (!knownMessages.has(block)) {
          knownMessages.add(block);
          newBlocks.push(block);
        }
      } catch {
        // ignore per-node errors
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
        if (Number.isFinite(numericIdx)) {
          ordinalCacheByIndex.set(numericIdx, messageOrdinal);
        }
      }
      const blockMessageId = block.getAttribute('data-gmh-message-id');
      if (blockMessageId) {
        ordinalCacheById.set(blockMessageId, messageOrdinal);
      }
    }

    if (newBlocks.length && messageListeners.size) {
      const timestamp = Date.now();
      const events: MessageIndexerEvent[] = [];
      newBlocks.forEach((block) => {
        const ordinalAttr = Number(block.getAttribute('data-gmh-message-ordinal'));
        if (!Number.isFinite(ordinalAttr)) return;
        const indexAttr = Number(block.getAttribute('data-gmh-message-index'));
        const messageId = block.getAttribute('data-gmh-message-id') || null;
        const channelAttr = block.getAttribute('data-gmh-channel') || null;
        events.push({
          element: block,
          ordinal: ordinalAttr,
          index: Number.isFinite(indexAttr) ? indexAttr : -1,
          messageId,
          channel: channelAttr,
          timestamp,
        });
      });
      if (events.length) {
        events.forEach((event) => {
          messageListeners.forEach((listener) => {
            try {
              listener(event);
            } catch (err) {
              warn('[GMH] message event listener failed', err);
            }
          });
        });
      }
    }

    const entryOrigin = getOrigins() || [];
    const entryOriginIndices = Array.isArray(entryOrigin)
      ? entryOrigin.filter(
          (idx): idx is number => typeof idx === 'number' && Number.isInteger(idx) && idx >= 0,
        )
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

    const range = exportRangeRef as RangeTotalsSetter | null | undefined;
    if (range && typeof range.setTotals === 'function') {
      try {
        range.setTotals({
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

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    const runIndexing = (): void => {
      try {
        indexMessages();
      } catch (err) {
        warn('[GMH] message indexing failed', err);
      } finally {
        scheduled = false;
      }
    };

    if (raf) {
      raf(() => runIndexing());
    } else {
      setTimeout(runIndexing, 16);
    }
  };

  const ensureObserver = (): void => {
    if (observer || !MutationObserverRef || !documentRef) return;
    const target = documentRef.body || documentRef.documentElement;
    if (!target) return;
    observer = new MutationObserverRef(() => {
      if (!active) return;
      schedule();
    });
    observer.observe(target, { childList: true, subtree: true });
  };

  const api: MessageIndexer = {
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
      knownMessages = new WeakSet();
      lastContainer = null;
    },
    refresh(options?: { immediate?: boolean }) {
      const immediate = Boolean(options?.immediate);
      if (immediate) return indexMessages();
      schedule();
      return cloneSummary(lastSummary);
    },
    getSummary() {
      return cloneSummary(lastSummary);
    },
    lookupOrdinalByIndex(index: number) {
      const numericIndex = Number(index);
      if (!Number.isFinite(numericIndex)) return null;
      return ordinalCacheByIndex.has(numericIndex)
        ? (ordinalCacheByIndex.get(numericIndex) as number)
        : null;
    },
    lookupOrdinalByMessageId(messageId: string) {
      if (typeof messageId !== 'string' || !messageId) return null;
      return ordinalCacheById.has(messageId)
        ? (ordinalCacheById.get(messageId) as number)
        : null;
    },
    subscribe(listener: SummaryListener) {
      if (typeof listener !== 'function') return noop;
      listeners.add(listener);
      try {
        listener(cloneSummary(lastSummary));
      } catch (err) {
        warn('[GMH] index subscriber failed', err);
      }
      return () => listeners.delete(listener);
    },
    subscribeMessages(listener: MessageListener) {
      if (typeof listener !== 'function') return noop;
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
  };

  return api;
};

export default createMessageIndexer;
