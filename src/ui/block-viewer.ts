import type {
  BlockStorageController,
  BlockViewerController,
  DebugBlockDetails,
  DebugBlockSummary,
  DebugNamespace,
  ModalController,
} from '../types';
import { buildDebugBlockDetail, toDebugBlockSummary } from '../utils/block-debug';

type ConsoleLike = Pick<Console, 'log' | 'warn' | 'error'> | null;

interface BlockViewerOptions {
  documentRef?: Document | null;
  windowRef?: (Window & typeof globalThis) | null;
  modal?: ModalController | null;
  blockStorage?: BlockStorageController | Promise<BlockStorageController> | null;
  getSessionUrl?: () => string | null;
  getDebugApi?: () => DebugNamespace | null;
  logger?: ConsoleLike;
}

interface ViewerEntry {
  summary: DebugBlockSummary;
  detail: DebugBlockDetails | null;
  detailLoaded: boolean;
  detailLoading: boolean;
  detailError: string | null;
  overlap: [number, number] | null;
  ensureDetail(): Promise<DebugBlockDetails | null>;
}

const isPromiseLike = <T>(value: unknown): value is PromiseLike<T> =>
  typeof value === 'object' && value !== null && 'then' in (value as Record<string, unknown>);

const safeNumber = (value: unknown): number => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.floor(numeric);
  }
  return 0;
};

const collectMessageLines = (message: DebugBlockDetails['messages'][number]): string[] => {
  if (!message || typeof message !== 'object') return [];
  const seen = new Set<string>();
  const mainLines: string[] = [];
  const infoLines: string[] = [];

  const pushLine = (line: unknown, bucket: 'info' | 'main') => {
    if (typeof line !== 'string') return;
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.toUpperCase() === 'INFO' && bucket === 'info') {
      // keep "INFO" headers with the rest of the info block, but dedupe separately
    }
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    if (bucket === 'info') {
      infoLines.push(trimmed);
    } else {
      mainLines.push(trimmed);
    }
  };

  if (Array.isArray(message.parts)) {
    message.parts.forEach((part) => {
      if (!part) return;
      const bucket = part.type === 'info' || part.speaker === 'INFO' ? 'info' : 'main';
      pushLine(part.text, bucket);
      if (Array.isArray(part.lines)) {
        part.lines.forEach((line) => pushLine(line, bucket));
      }
      if (Array.isArray(part.legacyLines)) {
        part.legacyLines.forEach((line) => pushLine(line, bucket));
      }
      if (Array.isArray(part.items)) {
        part.items.forEach((item) => {
          const text = typeof item === 'string' ? item : String(item ?? '');
          pushLine(text, bucket);
        });
      }
    });
  }

  const legacyLines = Reflect.get(message as Record<string, unknown>, 'legacyLines');
  if (Array.isArray(legacyLines)) {
    legacyLines.forEach((line) => {
      const trimmed = typeof line === 'string' ? line.trim() : '';
      if (!trimmed) return;
      const bucket =
        trimmed.toUpperCase() === 'INFO' || trimmed.startsWith('기록코드') ? 'info' : 'main';
      pushLine(trimmed, bucket);
    });
  }

  return mainLines.concat(infoLines);
};

const summarizeMessageBody = (
  message: DebugBlockDetails['messages'][number],
): { full: string; excerpt: string; truncated: boolean } => {
  const lines = collectMessageLines(message);
  const full = lines.length ? lines.join('\n').trim() : '';
  if (!full) {
    return { full: '', excerpt: '(내용 없음)', truncated: false };
  }
  if (full.length > 150) {
    const excerpt = `${full.slice(0, 147).trimEnd()}…`;
    return { full, excerpt, truncated: true };
  }
  return { full, excerpt: full, truncated: false };
};

const normalizeMessageId = (message: DebugBlockDetails['messages'][number]): string => {
  if (typeof message?.id === 'string' && message.id.trim()) {
    return message.id.trim();
  }
  return 'NO_ID';
};

const selectDebugApi = (resolver?: () => DebugNamespace | null): DebugNamespace | null => {
  if (!resolver) return null;
  try {
    const api = resolver();
    if (api && typeof api.getSessionBlocks === 'function') {
      return api;
    }
    return null;
  } catch {
    return null;
  }
};

const createEntry = (
  summary: DebugBlockSummary,
  loader: () => Promise<DebugBlockDetails | null>,
  preloaded?: DebugBlockDetails | null,
): ViewerEntry => {
  const entry: ViewerEntry = {
    summary,
    detail: preloaded ?? null,
    detailLoaded: Boolean(preloaded),
    detailLoading: false,
    detailError: null,
    overlap: null,
    async ensureDetail() {
      if (entry.detailLoaded && entry.detail) {
        return entry.detail;
      }
      if (entry.detailLoading) {
        return entry.detail;
      }
      entry.detailLoading = true;
      try {
        const detail = await loader();
        if (detail) {
          entry.detail = detail;
          entry.detailLoaded = true;
          entry.detailError = null;
          return detail;
        }
        entry.detail = null;
        entry.detailLoaded = false;
        entry.detailError = '블록을 불러올 수 없습니다';
        return null;
      } catch (err) {
        entry.detail = null;
        entry.detailLoaded = false;
        entry.detailError =
          err instanceof Error && err.message ? err.message : '블록을 불러올 수 없습니다';
        return null;
      } finally {
        entry.detailLoading = false;
      }
    },
  };
  return entry;
};

export const createBlockViewer = (options: BlockViewerOptions = {}): BlockViewerController => {
  const doc = options.documentRef ?? (typeof document !== 'undefined' ? document : null);
  const modal = options.modal ?? null;
  const logger: ConsoleLike =
    options.logger ?? (typeof console !== 'undefined' ? console : null);

  if (!doc || !modal) {
    return {
      async open() {
        logger?.warn?.('[GMH] block viewer unavailable');
      },
    };
  }

  let storageResolved: BlockStorageController | null = null;
  let storagePromise: Promise<BlockStorageController | null> | null = null;
  let storageError: unknown = null;

  const ensureStorage = async (): Promise<BlockStorageController | null> => {
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
          logger?.warn?.('[GMH] block viewer storage unavailable', err);
          return null;
        });
      return storagePromise;
    }
    storageResolved = source;
    return storageResolved;
  };

  const resolveSessionUrl = (): string | null => {
    if (typeof options.getSessionUrl === 'function') {
      try {
        const candidate = options.getSessionUrl();
        return candidate ?? null;
      } catch (err) {
        logger?.warn?.('[GMH] block viewer session resolver failed', err);
      }
    }
    return null;
  };

  const fetchEntries = async (
    sessionUrl: string | null,
  ): Promise<{ entries: ViewerEntry[]; hadError: boolean }> => {
    if (!sessionUrl) {
      return { entries: [], hadError: false };
    }
    const entries = new Map<string, ViewerEntry>();
    let storageAttempted = false;
    let storageFailed = false;

    const debugApi = selectDebugApi(options.getDebugApi);
    if (debugApi) {
      try {
        const summaries = debugApi.getSessionBlocks() ?? [];
        summaries.forEach((summary) => {
          if (!summary || typeof summary.id !== 'string') return;
          entries.set(summary.id, createEntry(summary, async () => debugApi.getBlockDetails(summary.id)));
        });
      } catch (err) {
        logger?.warn?.('[GMH] debug block fetch failed', err);
      }
    }

    try {
      storageAttempted = true;
      const store = await ensureStorage();
      if (!store) {
        storageFailed = true;
      } else {
        const records = await store.getBySession(sessionUrl);
        records.forEach((record) => {
          if (!record || typeof record.id !== 'string') return;
          if (entries.has(record.id)) return;
          const detail = buildDebugBlockDetail(record);
          const summary = toDebugBlockSummary(detail);
          entries.set(record.id, createEntry(summary, async () => detail, detail));
        });
      }
    } catch (err) {
      storageFailed = true;
      logger?.warn?.('[GMH] block viewer storage fetch failed', err);
    }

    const list = Array.from(entries.values());
    list.sort((a, b) => {
      const aStart = safeNumber(a.summary.ordinalRange?.[0]);
      const bStart = safeNumber(b.summary.ordinalRange?.[0]);
      if (aStart !== bStart) return aStart - bStart;
      if (a.summary.timestamp !== b.summary.timestamp) {
        return a.summary.timestamp - b.summary.timestamp;
      }
      return a.summary.id.localeCompare(b.summary.id);
    });

    let previous: ViewerEntry | null = null;
    list.forEach((entry) => {
      entry.overlap = null;
      if (previous) {
        const prevStart = safeNumber(previous.summary.ordinalRange?.[0]);
        const prevEnd = safeNumber(previous.summary.ordinalRange?.[1]);
        const currentStart = safeNumber(entry.summary.ordinalRange?.[0]);
        const currentEnd = safeNumber(entry.summary.ordinalRange?.[1]);
        const overlapStart = Math.max(prevStart, currentStart);
        const overlapEnd = Math.min(prevEnd, currentEnd);
        if (overlapStart <= overlapEnd) {
          entry.overlap = [overlapStart, overlapEnd];
        }
      }
      previous = entry;
    });

    const hadError = list.length === 0 && storageAttempted && storageFailed;

    return { entries: list, hadError };
  };

  const createStatusElement = (docRef: Document, text: string, tone: 'info' | 'error' = 'info'): HTMLElement => {
    const node = docRef.createElement('p');
    node.className = 'gmh-block-viewer__status';
    if (tone === 'error') {
      node.classList.add('gmh-block-viewer__status--error');
    }
    node.textContent = text;
    return node;
  };

  const renderMessages = (docRef: Document, detail: DebugBlockDetails): HTMLElement => {
    const wrapper = docRef.createElement('div');
    wrapper.className = 'gmh-block-viewer__messages';
    if (!Array.isArray(detail.messages) || !detail.messages.length) {
      const empty = docRef.createElement('p');
      empty.className = 'gmh-block-viewer__status';
      empty.textContent = '메시지가 없습니다';
      wrapper.appendChild(empty);
      return wrapper;
    }
    detail.messages.forEach((message, index) => {
      const item = docRef.createElement('div');
      item.className = 'gmh-block-viewer__message';
      const title = docRef.createElement('div');
      title.className = 'gmh-block-viewer__message-title';
      const speaker =
        typeof message?.speaker === 'string' && message.speaker.trim()
          ? message.speaker.trim()
          : typeof message?.role === 'string' && message.role.trim()
            ? message.role.trim()
            : '메시지';
      title.textContent = `[${index + 1}] ${speaker}`;
      item.appendChild(title);

      const summary = summarizeMessageBody(message);

      const body = docRef.createElement('div');
      body.className = 'gmh-block-viewer__message-body';
      body.textContent = summary.truncated ? summary.excerpt : summary.full;
      item.appendChild(body);

      if (summary.truncated) {
        const toggle = docRef.createElement('button');
        toggle.type = 'button';
        toggle.className = 'gmh-block-viewer__message-toggle';
        toggle.textContent = '더보기';
        let expanded = false;
        const applyState = () => {
          body.textContent = expanded ? summary.full : summary.excerpt;
          toggle.textContent = expanded ? '접기' : '더보기';
        };
        toggle.addEventListener('click', () => {
          expanded = !expanded;
          applyState();
        });
        applyState();
        item.appendChild(toggle);
      }

      const idLine = docRef.createElement('div');
      idLine.className = 'gmh-block-viewer__message-id';
      idLine.textContent = `ID: ${normalizeMessageId(message)}`;
      item.appendChild(idLine);

      wrapper.appendChild(item);
    });
    return wrapper;
  };

  const buildBlockItem = (docRef: Document, entry: ViewerEntry, index: number): HTMLElement => {
    const item = docRef.createElement('div');
    item.className = 'gmh-block-viewer__item';

    const header = docRef.createElement('div');
    header.className = 'gmh-block-viewer__item-header';

    const info = docRef.createElement('div');
    info.className = 'gmh-block-viewer__item-info';
    const [start, end] = entry.summary.ordinalRange;
    const title = docRef.createElement('p');
    title.className = 'gmh-block-viewer__item-title';
    title.textContent = `📦 블록 ${index + 1}: 메시지 ${start}-${end} (${entry.summary.messageCount}개)`;
    info.appendChild(title);

    const timestampLine = docRef.createElement('p');
    timestampLine.className = 'gmh-block-viewer__meta';
    timestampLine.textContent = `생성: ${entry.summary.timestampLabel}`;
    info.appendChild(timestampLine);

    if (entry.overlap) {
      const overlap = docRef.createElement('p');
      overlap.className = 'gmh-block-viewer__overlap';
      overlap.textContent = `overlap: ${entry.overlap[0]}-${entry.overlap[1]}`;
      info.appendChild(overlap);
    }

    header.appendChild(info);

    const toggle = docRef.createElement('button');
    toggle.type = 'button';
    toggle.className = 'gmh-block-viewer__toggle';
    toggle.textContent = '▼ 상세보기';
    header.appendChild(toggle);

    item.appendChild(header);

    const detail = docRef.createElement('div');
    detail.className = 'gmh-block-viewer__detail';
    detail.hidden = true;
    item.appendChild(detail);

    let expanded = false;

    const setToggleLabel = (): void => {
      toggle.textContent = expanded ? '▲ 접기' : '▼ 상세보기';
    };

    const showStatus = (text: string, tone: 'info' | 'error' = 'info'): void => {
      detail.innerHTML = '';
      detail.appendChild(createStatusElement(docRef, text, tone));
    };

    const ensureDetailRendered = async (): Promise<void> => {
      const detailData = await entry.ensureDetail();
      detail.innerHTML = '';
      if (!detailData) {
        const errorMessage = entry.detailError || '블록을 불러올 수 없습니다';
        detail.appendChild(createStatusElement(docRef, errorMessage, 'error'));
        return;
      }
      detail.appendChild(renderMessages(docRef, detailData));
    };

    toggle.addEventListener('click', async () => {
      expanded = !expanded;
      setToggleLabel();
      if (expanded) {
        detail.hidden = false;
        if (!entry.detailLoaded && !entry.detailLoading) {
          showStatus('메시지를 불러오는 중...');
          await ensureDetailRendered();
        } else if (entry.detailLoading) {
          showStatus('메시지를 불러오는 중...');
        } else if (entry.detail) {
          detail.innerHTML = '';
          detail.appendChild(renderMessages(docRef, entry.detail));
        } else {
          await ensureDetailRendered();
        }
      } else {
        detail.hidden = true;
      }
    });

    return item;
  };

  const renderEntries = (
    container: HTMLElement,
    entries: ViewerEntry[],
    hadError: boolean,
  ): void => {
    container.innerHTML = '';
    if (hadError) {
      container.appendChild(createStatusElement(container.ownerDocument, '블록을 불러올 수 없습니다', 'error'));
      return;
    }
    if (!entries.length) {
      container.appendChild(createStatusElement(container.ownerDocument, '아직 저장된 블록이 없습니다'));
      return;
    }
    const header = container.ownerDocument.createElement('div');
    header.className = 'gmh-block-viewer__header';
    const title = container.ownerDocument.createElement('h3');
    title.className = 'gmh-block-viewer__heading';
    title.textContent = `💾 저장된 블록 (${entries.length}개)`;
    header.appendChild(title);
    container.appendChild(header);

    const list = container.ownerDocument.createElement('div');
    list.className = 'gmh-block-viewer__list';
    entries.forEach((entry, index) => {
      list.appendChild(buildBlockItem(container.ownerDocument, entry, index));
    });
    container.appendChild(list);
  };

  const renderError = (container: HTMLElement): void => {
    container.innerHTML = '';
    container.appendChild(createStatusElement(container.ownerDocument, '블록을 불러올 수 없습니다', 'error'));
  };

  const open = async (): Promise<void> => {
    const container = doc.createElement('div');
    container.className = 'gmh-block-viewer';
    container.appendChild(createStatusElement(doc, '블록 불러오는 중...'));
    const sessionUrl = resolveSessionUrl();

    const modalPromise = modal.open({
      title: '💾 저장된 블록',
      content: container,
      size: 'large',
      actions: [{ label: '닫기', value: false, variant: 'secondary' }],
    });

    void fetchEntries(sessionUrl)
      .then(({ entries, hadError }) => {
        if (!container.isConnected) return;
        renderEntries(container, entries, hadError);
      })
      .catch((err) => {
        logger?.warn?.('[GMH] block viewer failed to load entries', err);
        if (!container.isConnected) return;
        renderError(container);
      });

    await modalPromise;
  };

  return {
    open,
  };
};

export default createBlockViewer;
