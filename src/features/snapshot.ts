import type {
  SnapshotFeatureOptions,
  SnapshotCaptureOptions,
  SnapshotAdapter,
  StructuredSnapshotReaderOptions,
  StructuredSnapshot,
  StructuredSnapshotMessage,
  StructuredSnapshotMessagePart,
  StructuredSelectionResult,
  StructuredSelectionRangeInfo,
  ExportRangeInfo,
} from '../types';

type CacheEntry = {
  structured: StructuredSnapshotMessage | null;
  lines: string[];
  errors: string[];
  signature: string;
};

const normalizeBlocks = (
  collection: Iterable<Element> | Element[] | NodeListOf<Element> | null | undefined,
): Element[] => {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  return Array.from(collection);
};

const normalizeNumeric = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const ensureDocument = (documentRef: Document | null | undefined): Document => {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new Error('snapshot feature requires a document reference');
  }
  return documentRef;
};

const createDescribeNode =
  (documentRef: Document | null | undefined) =>
  (node: Element | null | undefined): string | null => {
    const doc = ensureDocument(documentRef);
    const ElementCtor = doc?.defaultView?.Element || (typeof Element !== 'undefined' ? Element : null);
    if (!ElementCtor || !node || !(node instanceof ElementCtor)) return null;
    const parts: string[] = [];
    let current: Element | null = node;
    let depth = 0;
    while (current && depth < 5) {
      let part = current.tagName.toLowerCase();
      if (current.id) part += `#${current.id}`;
      if (current.classList?.length)
        part += `.${Array.from(current.classList).slice(0, 3).join('.')}`;
      parts.unshift(part);
      current = current.parentElement;
      depth += 1;
    }
    return parts.join(' > ');
  };

export function createSnapshotFeature({
  getActiveAdapter,
  triggerDownload,
  setPanelStatus,
  errorHandler,
  documentRef = typeof document !== 'undefined' ? document : null,
  locationRef = typeof location !== 'undefined' ? location : null,
}: SnapshotFeatureOptions) {
  if (!getActiveAdapter || !triggerDownload || !setPanelStatus || !errorHandler) {
    throw new Error('createSnapshotFeature missing required dependencies');
  }

  const describeNode = createDescribeNode(documentRef);

  const downloadDomSnapshot = (): void => {
    const doc = documentRef;
    const loc = locationRef;
    if (!doc || !loc) return;
    try {
      const adapter = getActiveAdapter();
      const container = adapter?.findContainer?.(doc);
      const blocks = normalizeBlocks(adapter?.listMessageBlocks?.(container || doc));
      const snapshot = {
        url: loc.href,
        captured_at: new Date().toISOString(),
        container_path: describeNode(container),
        block_count: blocks.length,
        selector_strategies: adapter?.dumpSelectors?.(),
        container_html_sample: container ? (container.innerHTML || '').slice(0, 40000) : null,
      };
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: 'application/json',
      });
      triggerDownload(blob, `genit-snapshot-${Date.now()}.json`);
      setPanelStatus('DOM 스냅샷이 저장되었습니다.', 'success');
    } catch (error) {
      const handler = errorHandler?.handle ? errorHandler : null;
      const message = handler?.handle
        ? handler.handle(error, 'snapshot', handler.LEVELS?.ERROR)
        : error?.message || String(error);
      setPanelStatus(`스냅샷 실패: ${message}`, 'error');
    }
  };

  return {
    describeNode,
    downloadDomSnapshot,
  };
}

export function createStructuredSnapshotReader({
  getActiveAdapter,
  setEntryOriginProvider,
  documentRef = typeof document !== 'undefined' ? document : null,
}: StructuredSnapshotReaderOptions) {
  if (!getActiveAdapter) throw new Error('createStructuredSnapshotReader requires getActiveAdapter');
  const doc = ensureDocument(documentRef);

  let entryOrigin: number[] = [];
  let latestStructuredSnapshot: StructuredSnapshot | null = null;
  let blockCache: WeakMap<Element, CacheEntry> = new WeakMap();
  let blockIdRegistry: WeakMap<Element, number> = new WeakMap();
  let blockIdCounter = 0;

  if (typeof setEntryOriginProvider === 'function') {
    setEntryOriginProvider(() => entryOrigin);
  }

  const getBlockId = (block: Element | null | undefined): number | null => {
    if (!block) return null;
    if (!blockIdRegistry.has(block)) {
      blockIdCounter += 1;
      blockIdRegistry.set(block, blockIdCounter);
    }
    return blockIdRegistry.get(block);
  };

  const fingerprintText = (value: string | null | undefined): string => {
    if (!value) return '0:0';
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return `${value.length}:${hash.toString(16)}`;
  };

  const getBlockSignature = (block: Element | null | undefined): string => {
    if (!block || typeof block.getAttribute !== 'function') return 'none';
    const idAttr =
      block.getAttribute('data-gmh-message-id') ||
      block.getAttribute('data-message-id') ||
      block.getAttribute('data-id');
    if (idAttr) return `id:${idAttr}`;
    const text = block.textContent || '';
    return `text:${fingerprintText(text)}`;
  };

  /**
   * Deep clones structured message payloads to avoid adapter mutation.
   *
   * @param {StructuredSnapshotMessage | null | undefined} message
   * @returns {StructuredSnapshotMessage | null}
   */
  const cloneStructuredMessage = (
    message: StructuredSnapshotMessage | null | undefined,
  ): StructuredSnapshotMessage | null => {
    if (!message || typeof message !== 'object') return null;
    const cloned: StructuredSnapshotMessage = { ...message };
    if (Array.isArray(message.parts)) {
      cloned.parts = message.parts.map((part) =>
        part && typeof part === 'object' ? { ...part } : part,
      ) as StructuredSnapshotMessagePart[];
    }
    if (Array.isArray(message.legacyLines)) cloned.legacyLines = message.legacyLines.slice();
    if (Array.isArray(message.__gmhEntries)) cloned.__gmhEntries = message.__gmhEntries.slice();
    if (Array.isArray(message.__gmhSourceBlocks)) cloned.__gmhSourceBlocks = message.__gmhSourceBlocks.slice();
    return cloned;
  };

  const ensureCacheEntry = (
    adapter: SnapshotAdapter | null | undefined,
    block: Element | null | undefined,
    forceReparse: boolean,
  ): CacheEntry => {
    if (!block) return { structured: null, lines: [], errors: [], signature: 'none' };
    const signature = getBlockSignature(block);
    if (!forceReparse && blockCache.has(block)) {
      const cached = blockCache.get(block);
      if (cached && cached.signature === signature) {
        return cached;
      }
    }

    const localSeen = new Set<string>();
    const errors: string[] = [];
    let structured: StructuredSnapshotMessage | null = null;
    let lines: string[] = [];

    try {
      const collected = adapter?.collectStructuredMessage?.(block);
      if (collected && typeof collected === 'object') {
        structured = cloneStructuredMessage(collected);
        const legacy = Array.isArray(collected.legacyLines) ? collected.legacyLines : [];
        lines = legacy.reduce<string[]>((acc, line) => {
          const trimmed = (line || '').trim();
          if (!trimmed || localSeen.has(trimmed)) return acc;
          localSeen.add(trimmed);
          acc.push(trimmed);
          return acc;
        }, []);
      }
    } catch (error) {
      errors.push(error?.message || String(error));
    }

    if (!structured) {
      const fallbackLines: string[] = [];
      const pushLine = (line: string) => {
        const trimmed = (line || '').trim();
        if (!trimmed || localSeen.has(trimmed)) return;
        localSeen.add(trimmed);
        fallbackLines.push(trimmed);
      };
      try {
        adapter?.emitTranscriptLines?.(block, pushLine);
      } catch (error) {
        errors.push(error?.message || String(error));
      }
      lines = fallbackLines;
    }

    const entry: CacheEntry = {
      structured,
      lines,
      errors,
      signature,
    };
    blockCache.set(block, entry);
    return entry;
  };

  const captureStructuredSnapshot = (options: SnapshotCaptureOptions = {}): StructuredSnapshot => {
    const { force } = options || {};
    if (force) {
      blockCache = new WeakMap();
      blockIdRegistry = new WeakMap();
      blockIdCounter = 0;
    }
    const adapter = getActiveAdapter();
    const container = adapter?.findContainer?.(doc);
    const blocks = normalizeBlocks(adapter?.listMessageBlocks?.(container || doc));
    if (!container && !blocks.length) throw new Error('채팅 컨테이너를 찾을 수 없습니다.');
    if (!blocks.length) {
      entryOrigin = [];
      latestStructuredSnapshot = {
        messages: [],
        legacyLines: [],
        entryOrigin: [],
        errors: [],
        generatedAt: Date.now(),
      };
      return latestStructuredSnapshot;
    }

    const seenLine = new Set<string>();
    const legacyLines: string[] = [];
    const origins: Array<number | null> = [];
    const messages: StructuredSnapshotMessage[] = [];
    const errors: Array<{ index: number; error: string }> = [];
    const totalBlocks = blocks.length;

    adapter?.resetInfoRegistry?.();

    blocks.forEach((block, idx) => {
      const fallbackIndex = Number(block?.getAttribute?.('data-gmh-message-index'));
      const originIndex = Number.isFinite(fallbackIndex) ? fallbackIndex : idx;
      const blockId = getBlockId(block);
      const cacheEntry = ensureCacheEntry(adapter, block, Boolean(force));
      const cacheLines = Array.isArray(cacheEntry.lines) ? cacheEntry.lines : [];

      const structured = cacheEntry.structured ? cloneStructuredMessage(cacheEntry.structured) : null;
      if (structured) {
        const ordinalAttr = Number(block?.getAttribute?.('data-gmh-message-ordinal'));
        const indexAttr = Number(block?.getAttribute?.('data-gmh-message-index'));
        const userOrdinalAttr = Number(block?.getAttribute?.('data-gmh-user-ordinal'));
        const channelAttr = block?.getAttribute?.('data-gmh-channel');
        structured.ordinal = Number.isFinite(ordinalAttr) ? ordinalAttr : totalBlocks - idx;
        structured.index = Number.isFinite(indexAttr) ? indexAttr : originIndex;
        if (Number.isFinite(userOrdinalAttr)) structured.userOrdinal = userOrdinalAttr;
        else if (structured.userOrdinal) delete structured.userOrdinal;
        if (channelAttr) structured.channel = channelAttr;
        else if (!structured.channel) {
          structured.channel =
            structured.role === 'player'
              ? 'user'
              : structured.role === 'npc'
              ? 'llm'
              : 'system';
        }
        messages.push(structured);
      }

      cacheLines.forEach((line: string) => {
        const trimmed = (line || '').trim();
        if (!trimmed) return;
        const lineKey = `${blockId ?? originIndex}::${trimmed}`;
        if (seenLine.has(lineKey)) return;
        seenLine.add(lineKey);
        legacyLines.push(trimmed);
        origins.push(originIndex);
      });

      if (Array.isArray(cacheEntry.errors)) {
        cacheEntry.errors.forEach((message) => {
          errors.push({ index: originIndex, error: message });
        });
      }
    });

    if (origins.length < legacyLines.length) {
      while (origins.length < legacyLines.length) origins.push(null);
    } else if (origins.length > legacyLines.length) {
      origins.length = legacyLines.length;
    }

    entryOrigin = origins.slice();
    latestStructuredSnapshot = {
      messages,
      legacyLines,
      entryOrigin: origins,
      errors,
      generatedAt: Date.now(),
    };
    return latestStructuredSnapshot;
  };

  const readTranscriptText = (options: SnapshotCaptureOptions = {}): string =>
    captureStructuredSnapshot(options).legacyLines.join('\n');

  const projectStructuredMessages = (
    structuredSnapshot: StructuredSnapshot | null | undefined,
    rangeInfo: ExportRangeInfo | StructuredSelectionRangeInfo | null | undefined,
  ): StructuredSelectionResult => {
    if (!structuredSnapshot) {
      return {
        messages: [],
        sourceTotal: 0,
        range: {
          active: false,
          start: null,
          end: null,
          messageStartIndex: null,
          messageEndIndex: null,
        },
      };
    }
    const messages = Array.isArray(structuredSnapshot.messages)
      ? structuredSnapshot.messages.slice()
      : [];
    const total = messages.length;
    const baseRange: StructuredSelectionRangeInfo = {
      active: Boolean(rangeInfo?.active),
      start: normalizeNumeric(rangeInfo?.start),
      end: normalizeNumeric(rangeInfo?.end),
      messageStartIndex: normalizeNumeric(rangeInfo?.messageStartIndex),
      messageEndIndex: normalizeNumeric(rangeInfo?.messageEndIndex),
      count: normalizeNumeric(rangeInfo?.count) ?? undefined,
      total: normalizeNumeric(rangeInfo?.total) ?? undefined,
      messageTotal: normalizeNumeric(rangeInfo?.messageTotal) ?? undefined,
    };
    if (!messages.length || !baseRange.active) {
      return { messages, sourceTotal: total, range: { ...baseRange, active: false } };
    }

    let filtered = messages;
    if (Number.isFinite(baseRange.messageStartIndex) && Number.isFinite(baseRange.messageEndIndex)) {
      const lower = Math.min(baseRange.messageStartIndex, baseRange.messageEndIndex);
      const upper = Math.max(baseRange.messageStartIndex, baseRange.messageEndIndex);
      filtered = messages.filter((message) => {
        const idx = Number(message?.index);
        return Number.isFinite(idx) ? idx >= lower && idx <= upper : false;
      });
    } else if (Number.isFinite(baseRange.start) && Number.isFinite(baseRange.end)) {
      const lowerOrdinal = Math.min(baseRange.start, baseRange.end);
      const upperOrdinal = Math.max(baseRange.start, baseRange.end);
      filtered = messages.filter((message) => {
        const ord = Number(message?.ordinal);
        return Number.isFinite(ord) ? ord >= lowerOrdinal && ord <= upperOrdinal : false;
      });
    }

    if (!filtered.length) {
      filtered = messages.slice();
    }

    return {
      messages: filtered,
      sourceTotal: total,
      range: {
        ...baseRange,
        active: Boolean(baseRange.active && filtered.length && filtered.length <= total),
      },
    };
  };

  const readStructuredMessages = (options: SnapshotCaptureOptions = {}): StructuredSnapshotMessage[] => {
    const { force } = options || {};
    if (!force && latestStructuredSnapshot) {
      return Array.isArray(latestStructuredSnapshot.messages)
        ? latestStructuredSnapshot.messages.slice()
        : [];
    }
    const snapshot = captureStructuredSnapshot(options);
    return Array.isArray(snapshot.messages) ? snapshot.messages.slice() : [];
  };

  const getEntryOrigin = (): number[] => entryOrigin.slice();

  return {
    captureStructuredSnapshot,
    readTranscriptText,
    projectStructuredMessages,
    readStructuredMessages,
    getEntryOrigin,
  };
}
