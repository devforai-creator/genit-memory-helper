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

type ConsoleLike = Pick<Console, 'log' | 'warn' | 'error'>;

const noop = (): void => {};

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

  let running = false;
  let unsubscribeMessages: (() => void) | null = null;
  let storage: BlockStorageController | null = null;
  let storagePromise: Promise<BlockStorageController> | null = null;
  let storageInitError: unknown = null;
  let saveChain: Promise<void> = Promise.resolve();

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

  const notifyBlockListeners = (block: MemoryBlockInit): void => {
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
      return blockBuilder.getSessionUrl();
    }
    if (!current && derived) {
      blockBuilder.setSessionUrl(derived);
      return blockBuilder.getSessionUrl();
    }
    return current ?? derived ?? null;
  };

  const handleMessageEvent = (event: MessageIndexerEvent): void => {
    if (!running) return;
    let structured: StructuredSnapshotMessage | null = null;
    try {
      structured = options.collectStructuredMessage(event.element);
    } catch (err) {
      logger.warn?.('[GMH] collectStructuredMessage failed', err);
      return;
    }
    if (!structured) return;

    if (!structured.id && event.messageId) {
      structured.id = event.messageId;
    }
    structured.ordinal = event.ordinal;
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
    if (unsubscribeMessages) {
      unsubscribeMessages();
      unsubscribeMessages = null;
    }
    messageIndexer.stop();
  };

  const flush = async (optionsArg?: BlockBuilderFlushOptions): Promise<number> => {
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
