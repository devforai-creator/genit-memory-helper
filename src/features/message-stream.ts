import type {
  BlockBuilderController,
  BlockBuilderFlushOptions,
  BlockStorageController,
  MessageIndexer,
  MessageIndexerEvent,
  MessageStreamController,
  MessageStreamOptions,
  MemoryBlockInit,
  StructuredSnapshotMessage,
} from '../types';
import {
  collectMessageIdsFromBlock,
  formatBlockPreview,
  formatTimestampLabel,
} from '../utils/block-debug';

type ConsoleLike = Pick<Console, 'log' | 'warn' | 'error'>;

const noop = (): void => {};

const MESSAGE_EVENT_SETTLE_DELAY_MS = 4000;
const MESSAGE_EVENT_RETRY_INTERVAL_MS = 2000;
const MESSAGE_EVENT_MAX_ATTEMPTS = 8;

const selectConsole = (consoleRef?: ConsoleLike | null): ConsoleLike => {
  if (consoleRef) return consoleRef;
  if (typeof console !== 'undefined') return console;
  return {
    log: noop,
    warn: noop,
    error: noop,
  };
};

const isPromiseLike = <T>(value: unknown): value is PromiseLike<T> => {
  return typeof value === 'object' && value !== null && 'then' in (value as Record<string, unknown>);
};

const cloneStructuredMessage = (message: StructuredSnapshotMessage): StructuredSnapshotMessage => {
  if (!message || typeof message !== 'object') {
    return message;
  }
  if (typeof structuredClone === 'function') {
    try {
      const cloned = structuredClone(message) as StructuredSnapshotMessage;
      const legacyLines = Reflect.get(message as Record<string, unknown>, 'legacyLines');
      if (Array.isArray(legacyLines)) {
        Object.defineProperty(cloned, 'legacyLines', {
          value: legacyLines.slice(),
          enumerable: false,
          configurable: true,
          writable: true,
        });
      }
      return cloned;
    } catch {
      // fallback to JSON clone below
    }
  }
  const cloned = JSON.parse(JSON.stringify(message ?? null)) as StructuredSnapshotMessage;
  if (!cloned) return cloned;
  const legacyLines = Reflect.get(message as Record<string, unknown>, 'legacyLines');
  if (Array.isArray(legacyLines)) {
    Object.defineProperty(cloned, 'legacyLines', {
      value: legacyLines.slice(),
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return cloned;
};

const resolveTimestamp = (value?: number): number => {
  if (Number.isFinite(value)) {
    return Math.floor(Number(value));
  }
  return Date.now();
};

export const createMessageStream = (options: MessageStreamOptions): MessageStreamController => {
  const logger = selectConsole(options.console ?? null);
  const { messageIndexer, blockBuilder } = options;

  if (!messageIndexer || typeof messageIndexer.subscribeMessages !== 'function') {
    throw new Error('createMessageStream requires a messageIndexer with subscribeMessages support.');
  }
  if (!blockBuilder) {
    throw new Error('createMessageStream requires a blockBuilder instance.');
  }

  const blockListeners = new Set<(block: MemoryBlockInit) => void>();
  const structuredListeners = new Set<(message: StructuredSnapshotMessage) => void>();
  const pendingMessageEvents: MessageIndexerEvent[] = [];
  const delayedEventTimers = new Set<ReturnType<typeof setTimeout>>();

  let running = false;
  let unsubscribeMessages: (() => void) | null = null;
  let storage: BlockStorageController | null = null;
  let storagePromise: Promise<BlockStorageController> | null = null;
  let storageInitError: unknown = null;
  let saveChain: Promise<void> = Promise.resolve();
  let primed = false;
  let primePromise: Promise<void> | null = null;
  let currentPrimingSession: string | null = null;
  let lastPrimedSession: string | null = null;
  let primeGeneration = 0;

  if (options.blockStorage) {
    if (isPromiseLike<BlockStorageController>(options.blockStorage)) {
      storagePromise = options.blockStorage.then((store) => {
        storage = store;
        return store;
      });
    } else {
      storage = options.blockStorage;
    }
  }

  const ensureStorage = async (): Promise<BlockStorageController | null> => {
    if (storage) return storage;
    if (storageInitError) return null;
    if (storagePromise) {
      try {
        storage = await storagePromise;
        return storage;
      } catch (err) {
        storageInitError = err;
        logger.warn?.('[GMH] message stream storage unavailable', err);
        return null;
      }
    }
    return null;
  };

  const logBlockReady = (block: MemoryBlockInit): void => {
    const ordinalRange = Array.isArray(block.ordinalRange)
      ? block.ordinalRange
      : [Number.NaN, Number.NaN];
    const [startOrdinal, endOrdinal] = ordinalRange;
    const messageCount = Array.isArray(block.messages) ? block.messages.length : 0;
    const preview = formatBlockPreview(block);
    const messageIds = collectMessageIdsFromBlock(block);
    const timestampValue = Number(block.timestamp);
    const timestampLabel = formatTimestampLabel(timestampValue);
    logger.log?.('[GMH] block ready', {
      id: String(block.id ?? ''),
      ordinalRange: [startOrdinal, endOrdinal],
      messageCount,
      preview,
      messageIds,
      timestamp: timestampLabel,
    });
  };

  const notifyBlockListeners = (block: MemoryBlockInit): void => {
    logBlockReady(block);
    blockListeners.forEach((listener) => {
      try {
        listener(block);
      } catch (err) {
        logger.warn?.('[GMH] block listener failed', err);
      }
    });
  };

  const notifyStructuredListeners = (message: StructuredSnapshotMessage): void => {
    structuredListeners.forEach((listener) => {
      try {
        listener(cloneStructuredMessage(message));
      } catch (err) {
        logger.warn?.('[GMH] message listener failed', err);
      }
    });
  };

  const persistBlocks = (blocks: MemoryBlockInit[]): Promise<void> => {
    if (!blocks.length) return saveChain;
    saveChain = saveChain
      .then(async () => {
        const store = await ensureStorage();
        if (!store) {
          blocks.forEach((block) => notifyBlockListeners(block));
          return;
        }
        for (const block of blocks) {
          try {
            await store.save(block);
            notifyBlockListeners(block);
          } catch (err) {
            logger.warn?.('[GMH] failed to persist memory block', err);
          }
        }
      })
      .catch((err) => {
        logger.warn?.('[GMH] block persistence chain failed', err);
      });
    return saveChain;
  };

  const resolveSessionUrl = (): string | null => {
    const derived =
      typeof options.getSessionUrl === 'function' ? options.getSessionUrl() : null;
    const current = blockBuilder.getSessionUrl();
    if (derived && derived !== current) {
      blockBuilder.setSessionUrl(derived);
      const updated = blockBuilder.getSessionUrl();
      if (updated && updated !== lastPrimedSession && updated !== currentPrimingSession) {
        schedulePrime(updated);
      }
      return updated;
    }
    if (!current && derived) {
      blockBuilder.setSessionUrl(derived);
      const updated = blockBuilder.getSessionUrl();
      if (updated && updated !== lastPrimedSession && updated !== currentPrimingSession) {
        schedulePrime(updated);
      }
      return updated;
    }
    if (current && current !== lastPrimedSession && current !== currentPrimingSession) {
      schedulePrime(current);
    }
    return current ?? derived ?? null;
  };

  const messageHasRenderableContent = (message: StructuredSnapshotMessage | null): boolean => {
    if (!message) return false;
    if (Array.isArray(message.parts)) {
      const richPart = message.parts.some((part) => {
        if (!part || part.type === 'info' || part.speaker === 'INFO') return false;
        if (typeof part.text === 'string' && part.text.trim().length > 0) return true;
        if (Array.isArray(part.lines) && part.lines.some((line) => typeof line === 'string' && line.trim().length > 0)) {
          return true;
        }
        if (
          Array.isArray(part.items) &&
          part.items.some((item) => {
            const text = typeof item === 'string' ? item : String(item ?? '');
            return text.trim().length > 0;
          })
        ) {
          return true;
        }
        return false;
      });
      if (richPart) return true;
    }
    const legacyLines = Reflect.get(message as Record<string, unknown>, 'legacyLines');
    if (Array.isArray(legacyLines)) {
      return legacyLines.some((line) => {
        if (typeof line !== 'string') return false;
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (trimmed.toUpperCase() === 'INFO') return false;
        return true;
      });
    }
    return false;
  };

  const commitStructuredMessage = (
    structured: StructuredSnapshotMessage,
    event: MessageIndexerEvent,
  ): void => {
    if (!structured.id && event.messageId) {
      structured.id = event.messageId;
    }
    if (event.index >= 0) {
      structured.ordinal = event.index + 1;
    } else {
      structured.ordinal = event.ordinal;
    }
    if (!structured.channel && event.channel) {
      structured.channel = event.channel;
    }
    if (structured.index === undefined || structured.index === null) {
      structured.index = event.index >= 0 ? event.index : null;
    }

    notifyStructuredListeners(structured);

    const sessionUrl = resolveSessionUrl();
    const blocks = blockBuilder.append(structured, {
      sessionUrl,
      timestamp: event.timestamp,
    });
    if (blocks.length) {
      void persistBlocks(blocks);
    }
  };

  const attemptProcessMessageEvent = (event: MessageIndexerEvent, attempt: number): void => {
    if (!running) return;
    let structured: StructuredSnapshotMessage | null = null;
    try {
      structured = options.collectStructuredMessage(event.element);
    } catch (err) {
      logger.warn?.('[GMH] collectStructuredMessage failed', err);
      structured = null;
    }

    const hasRenderableContent = messageHasRenderableContent(structured);
    if ((!structured || !hasRenderableContent) && attempt < MESSAGE_EVENT_MAX_ATTEMPTS) {
      scheduleMessageEventProcessing(event, attempt + 1);
      return;
    }
    if (!structured) return;
    commitStructuredMessage(structured, event);
  };

  const scheduleMessageEventProcessing = (
    event: MessageIndexerEvent,
    attempt: number = 0,
  ): void => {
    if (!running) return;
    const delay =
      attempt === 0 ? MESSAGE_EVENT_SETTLE_DELAY_MS : MESSAGE_EVENT_RETRY_INTERVAL_MS;
    const timer = setTimeout(() => {
      delayedEventTimers.delete(timer);
      if (!running) return;
      attemptProcessMessageEvent(event, attempt);
    }, delay);
    delayedEventTimers.add(timer);
  };

  const flushPendingEvents = (): void => {
    if (!primed || !pendingMessageEvents.length) return;
    const queue = pendingMessageEvents.splice(0, pendingMessageEvents.length);
    queue.forEach((event) => {
      scheduleMessageEventProcessing(event);
    });
  };

  const handleMessageEvent = (event: MessageIndexerEvent): void => {
    if (!primed) {
      pendingMessageEvents.push(event);
      return;
    }
    scheduleMessageEventProcessing(event);
  };

  const awaitPriming = async (): Promise<void> => {
    if (primePromise) {
      try {
        await primePromise;
      } catch {
        // errors already logged in schedulePrime
      }
    }
    flushPendingEvents();
  };

  const primeFromStorage = async (sessionUrl: string | null): Promise<void> => {
    if (!sessionUrl) return;
    if (typeof blockBuilder.primeFromBlocks !== 'function') return;
    const store = await ensureStorage();
    if (!store) return;
    try {
      const existingBlocks = await store.getBySession(sessionUrl);
      if (Array.isArray(existingBlocks) && existingBlocks.length) {
        blockBuilder.primeFromBlocks(existingBlocks);
      }
    } catch (err) {
      logger.warn?.('[GMH] failed to prime block builder from storage', err);
    }
  };

  const schedulePrime = (sessionUrl: string | null): void => {
    if (!sessionUrl) {
      primed = true;
      flushPendingEvents();
      return;
    }
    if (sessionUrl === currentPrimingSession) {
      return;
    }
    if (sessionUrl === lastPrimedSession) {
      primed = true;
      flushPendingEvents();
      return;
    }
    currentPrimingSession = sessionUrl;
    primed = false;
    const generation = ++primeGeneration;
    primePromise = (async () => {
      await primeFromStorage(sessionUrl);
    })();
    primePromise
      ?.catch((err) => {
        logger.warn?.('[GMH] block priming failed', err);
      })
      .finally(() => {
        if (generation !== primeGeneration) {
          return;
        }
        primePromise = null;
        lastPrimedSession = sessionUrl;
        currentPrimingSession = null;
        primed = true;
        flushPendingEvents();
      });
  };

  const start = (): void => {
    if (running) return;
    running = true;
    resolveSessionUrl();
    unsubscribeMessages = messageIndexer.subscribeMessages(handleMessageEvent);
    messageIndexer.refresh({ immediate: true });
    messageIndexer.start();
  };

  const stop = (): void => {
    if (!running) return;
    running = false;
    delayedEventTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    delayedEventTimers.clear();
    pendingMessageEvents.length = 0;
    if (unsubscribeMessages) {
      unsubscribeMessages();
      unsubscribeMessages = null;
    }
    messageIndexer.stop();
  };

  const flush = async (optionsArg?: BlockBuilderFlushOptions): Promise<number> => {
    await awaitPriming();
    const sessionUrl = optionsArg?.sessionUrl ?? resolveSessionUrl();
    const timestamp = resolveTimestamp(optionsArg?.timestamp);
    const blocks = blockBuilder.flush({
      includePartial: optionsArg?.includePartial,
      sessionUrl,
      timestamp,
    });
    await persistBlocks(blocks);
    return blocks.length;
  };

  const api: MessageStreamController = {
    start,
    stop,
    isRunning() {
      return running;
    },
    flush(optionsArg) {
      return flush(optionsArg);
    },
    getBuffer() {
      return blockBuilder.getBuffer();
    },
    getSessionUrl() {
      return blockBuilder.getSessionUrl();
    },
    setSessionUrl(next) {
      blockBuilder.setSessionUrl(next);
      schedulePrime(blockBuilder.getSessionUrl());
    },
    subscribeBlocks(listener) {
      if (typeof listener !== 'function') return () => {};
      blockListeners.add(listener);
      return () => blockListeners.delete(listener);
    },
    subscribeMessages(listener) {
      if (typeof listener !== 'function') return () => {};
      structuredListeners.add(listener);
      return () => structuredListeners.delete(listener);
    },
  };

  return api;
};

export default createMessageStream;
