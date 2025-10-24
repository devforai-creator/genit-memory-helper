import type {
  DebugBlockDetails,
  DebugBlockSummary,
  MemoryBlockInit,
  MemoryBlockRecord,
  StructuredSnapshotMessage,
} from '../types';

type BlockInput = MemoryBlockInit | MemoryBlockRecord;

const DEFAULT_SESSION_FALLBACK = 'about:blank';

const cloneValue = <T>(value: T): T => {
  if (value === null || value === undefined) return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // fall through to JSON clone
    }
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
};

const cloneArrayBuffer = (buffer: ArrayBufferLike): ArrayBuffer => {
  if (buffer instanceof ArrayBuffer && typeof buffer.slice === 'function') {
    return buffer.slice(0);
  }
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(new Uint8Array(buffer));
  return copy.buffer;
};

const cloneEmbedding = (value: ArrayBuffer | ArrayBufferView | null | undefined): ArrayBuffer | null => {
  if (!value) return null;
  if (value instanceof ArrayBuffer) {
    return cloneArrayBuffer(value);
  }
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return cloneArrayBuffer(view.buffer);
  }
  return null;
};

export const cloneStructuredMessage = (
  message: StructuredSnapshotMessage,
): StructuredSnapshotMessage => {
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

export const cloneStructuredMessages = (
  messages: StructuredSnapshotMessage[],
): StructuredSnapshotMessage[] => messages.map((message) => cloneStructuredMessage(message));

const collectMessageCandidates = (message: StructuredSnapshotMessage | null | undefined): string[] => {
  if (!message || typeof message !== 'object') return [];
  const collected: string[] = [];
  const legacyLines = Reflect.get(message as Record<string, unknown>, 'legacyLines');
  if (Array.isArray(legacyLines)) {
    legacyLines.forEach((line) => {
      if (typeof line === 'string' && line.trim()) {
        collected.push(line.trim());
      }
    });
  }
  if (Array.isArray(message.parts)) {
    message.parts.forEach((part) => {
      if (!part) return;
      if (typeof part.text === 'string' && part.text.trim()) {
        collected.push(part.text.trim());
      }
      if (Array.isArray(part.lines)) {
        part.lines.forEach((line) => {
          if (typeof line === 'string' && line.trim()) {
            collected.push(line.trim());
          }
        });
      }
      if (Array.isArray(part.legacyLines)) {
        part.legacyLines.forEach((line) => {
          if (typeof line === 'string' && line.trim()) {
            collected.push(line.trim());
          }
        });
      }
      if (Array.isArray(part.items)) {
        part.items.forEach((item) => {
          const text = typeof item === 'string' ? item : String(item ?? '');
          if (text.trim()) {
            collected.push(text.trim());
          }
        });
      }
    });
  }
  return collected;
};

export const selectPreviewText = (
  message: StructuredSnapshotMessage | null | undefined,
): string => {
  const candidates = collectMessageCandidates(message);
  if (candidates.length) {
    return candidates[0];
  }
  const fallbackSpeaker =
    message && typeof message.speaker === 'string' && message.speaker.trim()
      ? message.speaker.trim()
      : '';
  return fallbackSpeaker;
};

export const formatBlockPreviewFromMessages = (
  messages: StructuredSnapshotMessage[],
): string => {
  const firstMessage = messages.length ? messages[0] : null;
  if (!firstMessage) return '(no preview)';
  const speaker =
    typeof firstMessage?.speaker === 'string' && firstMessage.speaker.trim()
      ? `${firstMessage.speaker.trim()}: `
      : '';
  const text = selectPreviewText(firstMessage);
  const preview = `${speaker}${text}`.trim();
  if (!preview) return '(no preview)';
  return preview.length > 80 ? `${preview.slice(0, 77)}...` : preview;
};

export const formatBlockPreview = (block: BlockInput): string => {
  const messages = Array.isArray(block.messages) ? block.messages : [];
  return formatBlockPreviewFromMessages(messages);
};

export const collectMessageIdsFromMessages = (
  messages: StructuredSnapshotMessage[],
  limit = 3,
): string[] =>
  messages.slice(0, Math.max(0, limit)).map((message) => {
    const id = typeof message?.id === 'string' && message.id.trim() ? message.id.trim() : null;
    return id ?? 'NO_ID';
  });

export const collectMessageIdsFromBlock = (block: BlockInput, limit = 3): string[] => {
  const messages = Array.isArray(block.messages) ? block.messages : [];
  return collectMessageIdsFromMessages(messages, limit);
};

export const normalizeOrdinalRange = (
  range: [number, number] | undefined | null,
): [number, number] => {
  const startCandidate = Array.isArray(range) ? Number(range[0]) : Number.NaN;
  const endCandidate = Array.isArray(range) ? Number(range[1]) : Number.NaN;
  const start = Number.isFinite(startCandidate) ? Math.floor(startCandidate) : 0;
  const end = Number.isFinite(endCandidate) ? Math.floor(endCandidate) : start;
  return [start, end];
};

export const normalizeId = (value: unknown): string => {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.trim();
};

export const normalizeSessionUrl = (value: unknown): string => {
  const text = typeof value === 'string' ? value : String(value ?? '');
  const trimmed = text.trim();
  return trimmed || DEFAULT_SESSION_FALLBACK;
};

const resolveTimestamp = (value: unknown): number => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.floor(numeric);
  }
  return Date.now();
};

export const formatTimestampLabel = (value: number): string => {
  if (!Number.isFinite(value)) return '(invalid)';
  try {
    return new Date(value).toLocaleTimeString();
  } catch {
    return '(invalid)';
  }
};

export const buildDebugBlockDetail = (block: BlockInput): DebugBlockDetails => {
  const messages = Array.isArray(block.messages) ? cloneStructuredMessages(block.messages) : [];
  const ordinalRange = normalizeOrdinalRange((block as MemoryBlockInit).ordinalRange);
  const timestamp = resolveTimestamp((block as MemoryBlockInit).timestamp);
  const detail: DebugBlockDetails = {
    id: normalizeId((block as MemoryBlockInit).id),
    sessionUrl: normalizeSessionUrl((block as MemoryBlockInit).sessionUrl),
    ordinalRange,
    messageCount: messages.length,
    messageIds: collectMessageIdsFromMessages(messages),
    timestamp,
    timestampLabel: formatTimestampLabel(timestamp),
    preview: formatBlockPreviewFromMessages(messages),
    raw: typeof (block as MemoryBlockInit).raw === 'string'
      ? (block as MemoryBlockInit).raw
      : String((block as MemoryBlockInit).raw ?? ''),
    messages,
    meta: (block as MemoryBlockInit).meta ? cloneValue((block as MemoryBlockInit).meta) : undefined,
    embedding: cloneEmbedding((block as MemoryBlockInit).embedding ?? null),
  };
  return detail;
};

export const cloneDebugBlockDetail = (detail: DebugBlockDetails): DebugBlockDetails => ({
  id: detail.id,
  sessionUrl: detail.sessionUrl,
  ordinalRange: [detail.ordinalRange[0], detail.ordinalRange[1]],
  messageCount: detail.messageCount,
  messageIds: detail.messageIds.slice(),
  timestamp: detail.timestamp,
  timestampLabel: detail.timestampLabel,
  preview: detail.preview,
  raw: detail.raw,
  messages: cloneStructuredMessages(detail.messages),
  meta: detail.meta ? cloneValue(detail.meta) : undefined,
  embedding: cloneEmbedding(detail.embedding ?? null),
});

export const toDebugBlockSummary = (detail: DebugBlockDetails): DebugBlockSummary => ({
  id: detail.id,
  sessionUrl: detail.sessionUrl,
  ordinalRange: [detail.ordinalRange[0], detail.ordinalRange[1]],
  messageCount: detail.messageCount,
  messageIds: detail.messageIds.slice(),
  timestamp: detail.timestamp,
  timestampLabel: detail.timestampLabel,
  preview: detail.preview,
});
