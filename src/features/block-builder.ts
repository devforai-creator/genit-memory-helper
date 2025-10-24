import type {
  BlockBuilderAppendOptions,
  BlockBuilderController,
  BlockBuilderFlushOptions,
  BlockBuilderOptions,
  MemoryBlockInit,
  StructuredSnapshotMessage,
} from '../types';

type ConsoleLike = Pick<Console, 'warn' | 'error'>;

interface BufferedMessage {
  message: StructuredSnapshotMessage;
  ordinal: number;
}

const isNarrationMessage = (message: StructuredSnapshotMessage | null | undefined): boolean => {
  if (!message || typeof message !== 'object') return false;
  const role = typeof message.role === 'string' ? message.role.trim().toLowerCase() : '';
  const channel = typeof message.channel === 'string' ? message.channel.trim().toLowerCase() : '';
  if (role === 'narration' || channel === 'system') {
    return true;
  }
  if (Array.isArray(message.parts) && message.parts.length) {
    let narrationParts = 0;
    message.parts.forEach((part) => {
      if (!part) return;
      const flavor = typeof part.flavor === 'string' ? part.flavor.trim().toLowerCase() : '';
      const partRole = typeof part.role === 'string' ? part.role.trim().toLowerCase() : '';
      if (flavor === 'narration' || partRole === 'narration') {
        narrationParts += 1;
      }
    });
    if (narrationParts === message.parts.length) {
      return true;
    }
  }
  return false;
};

const DEFAULT_BLOCK_SIZE = 5;
const DEFAULT_BLOCK_OVERLAP = 2;
const DEFAULT_SESSION_FALLBACK = 'about:blank';

const noop = (): void => {};

const selectConsole = (consoleRef?: ConsoleLike | null): ConsoleLike => {
  if (consoleRef) return consoleRef;
  if (typeof console !== 'undefined') return console;
  return {
    warn: noop,
    error: noop,
  };
};

const selectClock = (clockRef?: (() => number) | null): (() => number) => {
  if (typeof clockRef === 'function') return clockRef;
  return () => Date.now();
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
      // fall through to JSON clone
    }
  }
  const jsonClone = JSON.parse(JSON.stringify(message ?? null)) as StructuredSnapshotMessage;
  if (!jsonClone) return jsonClone;
  const legacyLines = Reflect.get(message as Record<string, unknown>, 'legacyLines');
  if (Array.isArray(legacyLines)) {
    Object.defineProperty(jsonClone, 'legacyLines', {
      value: legacyLines.slice(),
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return jsonClone;
};

const toNormalizedLines = (
  message: StructuredSnapshotMessage,
  removeNarration: boolean,
): string[] => {
  if (!message) return [];
  if (removeNarration && (message.role === 'narration' || message.channel === 'system')) {
    return [];
  }

  const legacyLines = Reflect.get(message as Record<string, unknown>, 'legacyLines');
  if (Array.isArray(legacyLines) && legacyLines.length) {
    return legacyLines.map((line) => String(line || '').trim()).filter((line) => line.length > 0);
  }

  if (!Array.isArray(message.parts)) return [];

  const lines: string[] = [];
  message.parts.forEach((part) => {
    if (!part) return;
    if (
      removeNarration &&
      (part.flavor === 'narration' || part.role === 'narration' || message.role === 'narration')
    ) {
      return;
    }
    if (typeof part.text === 'string' && part.text.trim()) {
      lines.push(part.text.trim());
    }
    if (Array.isArray(part.lines)) {
      part.lines.forEach((line) => {
        if (typeof line === 'string' && line.trim()) {
          lines.push(line.trim());
        }
      });
    }
    if (Array.isArray(part.legacyLines)) {
      part.legacyLines.forEach((line) => {
        if (typeof line === 'string' && line.trim()) {
          lines.push(line.trim());
        }
      });
    }
    if (Array.isArray(part.items)) {
      part.items.forEach((item) => {
        const text = typeof item === 'string' ? item : String(item ?? '');
        if (text.trim()) {
          lines.push(text.trim());
        }
      });
    }
  });

  return lines;
};

const buildRawText = (
  sequence: BufferedMessage[],
  removeNarration: boolean,
): string => {
  const sections: string[] = [];
  sequence.forEach(({ message }) => {
    const lines = toNormalizedLines(message, removeNarration);
    if (!lines.length) return;
    const speaker = message.speaker || message.role || message.channel || 'message';
    const head = lines[0];
    const tail = lines.slice(1);
    const formatted: string[] = [`${speaker}: ${head}`];
    tail.forEach((line) => {
      formatted.push(line);
    });
    sections.push(formatted.join('\n'));
  });
  return sections.join('\n\n');
};

const sanitizeSessionUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const resolveOrdinal = (candidate: unknown, fallback: number): number => {
  const numeric = Number(candidate);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }
  return fallback;
};

const defaultBuildBlockId = ({
  startOrdinal,
  endOrdinal,
  timestamp,
  counter,
}: {
  startOrdinal: number;
  endOrdinal: number;
  timestamp: number;
  counter: number;
}): string => {
  return `gmh-block-${startOrdinal}-${endOrdinal}-${timestamp}-${counter}`;
};

export const createBlockBuilder = (options: BlockBuilderOptions = {}): BlockBuilderController => {
  const blockSize = Math.max(1, Math.floor(options.blockSize ?? DEFAULT_BLOCK_SIZE));
  const overlapCandidate = Math.max(0, Math.floor(options.overlap ?? DEFAULT_BLOCK_OVERLAP));
  const overlap = Math.min(overlapCandidate, blockSize - 1);
  const removeNarration = options.removeNarration !== false;
  const logger = selectConsole(options.console ?? null);
  const clock = selectClock(options.clock ?? null);
  const buildBlockId =
    typeof options.buildBlockId === 'function' ? options.buildBlockId : defaultBuildBlockId;
  const onBlockReady = typeof options.onBlockReady === 'function' ? options.onBlockReady : null;
  const getSessionUrlOption =
    typeof options.getSessionUrl === 'function' ? options.getSessionUrl : null;

  let sessionUrlRef = sanitizeSessionUrl(options.sessionUrl ?? null);
  let ordinalCursor = 0;
  let blockCounter = 0;
  const buffer: BufferedMessage[] = [];
  const seenIds = new Set<string>();

  const emitBlocks = (blocks: MemoryBlockInit[]): MemoryBlockInit[] => {
    if (!blocks.length || !onBlockReady) return blocks;
    blocks.forEach((block) => {
      try {
        onBlockReady(block);
      } catch (err) {
        logger.warn?.('[GMH] block builder onBlockReady failed', err);
      }
    });
    return blocks;
  };

  const resetState = (): void => {
    buffer.length = 0;
    seenIds.clear();
    ordinalCursor = 0;
  };

  const ensureSessionUrl = (override?: string | null): string => {
    if (override !== undefined) {
      sessionUrlRef = sanitizeSessionUrl(override);
    }
    if (sessionUrlRef) return sessionUrlRef;
    if (getSessionUrlOption) {
      try {
        const derived = sanitizeSessionUrl(getSessionUrlOption());
        if (derived) {
          sessionUrlRef = derived;
          return sessionUrlRef;
        }
      } catch (err) {
        logger.warn?.('[GMH] block builder session resolver failed', err);
      }
    }
    return DEFAULT_SESSION_FALLBACK;
  };

  const resolveTimestamp = (override?: number): number => {
    if (Number.isFinite(override)) {
      return Math.floor(Number(override));
    }
    return clock();
  };

  const buildBlock = (
    slice: BufferedMessage[],
    sessionUrl: string,
    timestamp: number,
  ): MemoryBlockInit => {
    if (!slice.length) {
      throw new Error('Cannot build block without messages.');
    }
    const orderedSlice = slice.slice().sort((a, b) => a.ordinal - b.ordinal);
    const startOrdinal = orderedSlice[0]?.ordinal ?? 0;
    const endOrdinal = orderedSlice[orderedSlice.length - 1]?.ordinal ?? startOrdinal;
    blockCounter += 1;
    const blockId = buildBlockId({
      startOrdinal,
      endOrdinal,
      timestamp,
      counter: blockCounter,
    });
    const filteredEntries =
      removeNarration && orderedSlice.length
        ? orderedSlice.filter((entry) => !isNarrationMessage(entry.message))
        : orderedSlice.slice();
    const messages = filteredEntries.map((entry) => cloneStructuredMessage(entry.message));
    const raw = buildRawText(orderedSlice, removeNarration);
    const block: MemoryBlockInit = {
      id: blockId,
      sessionUrl,
      raw,
      messages,
      ordinalRange: [startOrdinal, endOrdinal],
      timestamp,
      meta: {
        blockSize: slice.length,
        configuredBlockSize: blockSize,
        overlap,
        sourceOrdinals: orderedSlice.map((entry) => entry.ordinal),
      },
    };
    return block;
  };

  const drain = ({
    allowPartial = false,
    sessionOverride,
    timestampOverride,
  }: {
    allowPartial?: boolean;
    sessionOverride?: string | null;
    timestampOverride?: number;
  }): MemoryBlockInit[] => {
    const produced: MemoryBlockInit[] = [];
    const sessionUrl = ensureSessionUrl(sessionOverride);
    const makeTimestamp = () => resolveTimestamp(timestampOverride);

    while (buffer.length >= blockSize) {
      const slice = buffer.slice(0, blockSize);
      const block = buildBlock(slice, sessionUrl, makeTimestamp());
      produced.push(block);

      const removeCount = blockSize - overlap;
      buffer.splice(0, removeCount);
      // no need to update seenIds; retain set to avoid duplicates for remainder of session
    }

    if (allowPartial && buffer.length > 0) {
      const slice = buffer.splice(0, buffer.length);
      const block = buildBlock(slice, sessionUrl, makeTimestamp());
      produced.push(block);
      buffer.length = 0;
    }

    return emitBlocks(produced);
  };

  const appendInternal = (
    message: StructuredSnapshotMessage,
    optionsArg?: BlockBuilderAppendOptions,
  ): MemoryBlockInit[] => {
    if (!message || typeof message !== 'object') return [];

    const messageId =
      typeof message.id === 'string' && message.id.trim().length ? message.id.trim() : null;
    if (messageId && seenIds.has(messageId)) {
      return [];
    }

    const ordinal = resolveOrdinal(message.ordinal, ordinalCursor + 1);
    ordinalCursor = Math.max(ordinalCursor + 1, ordinal);

    const cloned = cloneStructuredMessage(message);
    buffer.push({
      message: cloned,
      ordinal,
    });

    if (messageId) {
      seenIds.add(messageId);
    }

    return drain({
      allowPartial: false,
      sessionOverride: optionsArg?.sessionUrl,
      timestampOverride: optionsArg?.timestamp,
    });
  };

  const appendManyInternal = (
    messages: StructuredSnapshotMessage[],
    optionsArg?: BlockBuilderAppendOptions,
  ): MemoryBlockInit[] => {
    if (!Array.isArray(messages) || !messages.length) return [];
    const produced: MemoryBlockInit[] = [];
    messages.forEach((entry) => {
      const blocks = appendInternal(entry, optionsArg);
      if (blocks.length) {
        produced.push(...blocks);
      }
    });
    return produced;
  };

  const primeFromBlocksInternal = (blocks: MemoryBlockInit[]): void => {
    if (!Array.isArray(blocks) || !blocks.length) return;
    let highestOrdinal = ordinalCursor;
    blocks.forEach((block) => {
      if (!block) return;
      if (Array.isArray(block.messages)) {
        block.messages.forEach((message) => {
          const messageId =
            typeof message?.id === 'string' && message.id.trim().length ? message.id.trim() : null;
          if (messageId) {
            seenIds.add(messageId);
          }
        });
      }
      let blockEndOrdinal = Array.isArray(block.ordinalRange)
        ? Number(block.ordinalRange[1])
        : Number.NaN;
      if (!Number.isFinite(blockEndOrdinal)) {
        const sourceOrdinals = Array.isArray((block.meta as { sourceOrdinals?: number[] } | undefined)?.sourceOrdinals)
          ? ((block.meta as { sourceOrdinals?: number[] }).sourceOrdinals as number[])
          : [];
        if (sourceOrdinals.length) {
          blockEndOrdinal = Number(sourceOrdinals[sourceOrdinals.length - 1]);
        }
      }
      if (Number.isFinite(blockEndOrdinal)) {
        highestOrdinal = Math.max(highestOrdinal, Math.floor(blockEndOrdinal));
      }
    });
    ordinalCursor = Math.max(ordinalCursor, highestOrdinal);
  };

  return {
    append(message, optionsArg) {
      return appendInternal(message, optionsArg);
    },
    appendMany(messages, optionsArg) {
      return appendManyInternal(messages, optionsArg);
    },
    flush(optionsArg) {
      if (optionsArg?.includePartial) {
        return drain({
          allowPartial: true,
          sessionOverride: optionsArg.sessionUrl,
          timestampOverride: optionsArg.timestamp,
        });
      }
      return drain({
        allowPartial: false,
        sessionOverride: optionsArg?.sessionUrl,
        timestampOverride: optionsArg?.timestamp,
      });
    },
    clear() {
      resetState();
    },
    getBuffer() {
      return buffer.map((entry) => cloneStructuredMessage(entry.message));
    },
    getSessionUrl() {
      return sessionUrlRef ?? null;
    },
    setSessionUrl(next) {
      const normalized = sanitizeSessionUrl(next);
      if (sessionUrlRef && normalized && sessionUrlRef !== normalized) {
        resetState();
      } else if (sessionUrlRef && !normalized) {
        resetState();
      }
      sessionUrlRef = normalized ?? null;
    },
    primeFromBlocks(blocks) {
      primeFromBlocksInternal(blocks);
    },
  };
};

export default createBlockBuilder;
