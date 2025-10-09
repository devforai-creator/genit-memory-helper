import type {
  ExportRangeController,
  TurnBookmarks,
  TurnBookmarkEntry,
  MessageIndexer,
} from '../types';

interface RangeControlsOptions {
  documentRef?: Document | null;
  windowRef?: (Window & typeof globalThis) | null;
  exportRange: ExportRangeController;
  turnBookmarks: TurnBookmarks;
  messageIndexer: MessageIndexer;
  setPanelStatus?: (message: string, tone?: string | null) => void;
}

type RangeBounds = ReturnType<ExportRangeController['describe']>;
type RangeTotals = ReturnType<ExportRangeController['getTotals']>;
type RangeRange = ReturnType<ExportRangeController['getRange']>;

interface RangeSnapshot {
  bounds: RangeBounds;
  totals: RangeTotals;
  range: RangeRange;
}

interface MessageContext {
  element: Element;
  index: number | null;
  ordinal: number | null;
  messageId: string | null;
}

const toNumber = (value: unknown): number | null => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const listMessageIdElements = (doc: Document, messageId: string, cssEscape?: (value: string) => string): Element[] => {
  if (!messageId) return [];
  try {
    const escaped = typeof cssEscape === 'function' ? cssEscape(messageId) : messageId.replace(/"/g, '\\"');
    const selector = `[data-gmh-message-id="${escaped}"]`;
    return Array.from(doc.querySelectorAll(selector));
  } catch {
    return [];
  }
};

export function createRangeControls({
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? window : null,
  exportRange,
  turnBookmarks,
  messageIndexer,
  setPanelStatus,
}: RangeControlsOptions) {
  if (!documentRef) throw new Error('createRangeControls requires document reference');
  if (!exportRange) throw new Error('createRangeControls requires exportRange');
  if (!turnBookmarks) throw new Error('createRangeControls requires turnBookmarks');
  if (!messageIndexer) throw new Error('createRangeControls requires messageIndexer');

  const doc = documentRef;
  const win = windowRef;
  const cssEscape = doc?.defaultView?.CSS?.escape ?? win?.CSS?.escape;

  let rangeUnsubscribe: (() => void) | null = null;
  let selectedBookmarkKey = '';
  let bookmarkSelectionPinned = false;

  const subscribeRange = (handler: (snapshot: RangeSnapshot) => void): void => {
    if (typeof exportRange?.subscribe !== 'function') return;
    if (typeof rangeUnsubscribe === 'function') rangeUnsubscribe();
    rangeUnsubscribe = exportRange.subscribe((snapshot: RangeSnapshot) => handler(snapshot));
  };

  const updateRangeSnapshot = (handler: (snapshot: RangeSnapshot) => void): void => {
    if (typeof handler !== 'function') return;
    if (typeof exportRange?.snapshot === 'function') {
      handler(exportRange.snapshot() as RangeSnapshot);
      return;
    }
    if (typeof exportRange?.describe === 'function') {
      const bounds = exportRange.describe();
      const totals =
        typeof exportRange?.getTotals === 'function'
          ? exportRange.getTotals()
          : { message: 0, user: 0, llm: 0, entry: 0 };
      const range =
        typeof exportRange?.getRange === 'function'
          ? exportRange.getRange()
          : { start: null, end: null };
      handler({ bounds, totals, range } as RangeSnapshot);
    }
  };

  const syncBookmarkSelect = (
    select: HTMLSelectElement | null,
    entries: TurnBookmarkEntry[] = [],
  ): void => {
    if (!select) return;
    const previous = selectedBookmarkKey || select.value || '';
    select.innerHTML = '';
    const placeholder = doc.createElement('option');
    placeholder.value = '';
    placeholder.textContent = entries.length
      ? '최근 클릭한 메시지를 선택하세요'
      : '최근 클릭한 메시지가 없습니다';
    select.appendChild(placeholder);
    entries.forEach((entry) => {
      const option = doc.createElement('option');
      option.value = entry.key;
      const axisLabel = '메시지';
      const ordinalText = Number.isFinite(entry.ordinal)
        ? `${axisLabel} ${entry.ordinal}`
        : `${axisLabel} ?`;
      const idText = entry.messageId ? entry.messageId : `index ${entry.index}`;
      option.textContent = `${ordinalText} · ${idText}`;
      option.dataset.index = String(entry.index);
      select.appendChild(option);
    });
    let nextValue = '';
    if (bookmarkSelectionPinned && entries.some((entry) => entry.key === previous)) {
      nextValue = previous;
    } else if (entries.length) {
      nextValue = entries[0].key;
      bookmarkSelectionPinned = false;
    }
    select.value = nextValue;
    selectedBookmarkKey = nextValue || '';
    if (!nextValue && !entries.length) {
      select.selectedIndex = 0;
    }
  };

  const registerBookmarkSelect = (select: HTMLSelectElement | null): void => {
    if (!select) return;
    if (select.dataset.gmhBookmarksReady === 'true') return;
    select.dataset.gmhBookmarksReady = 'true';
    select.addEventListener('change', () => {
      selectedBookmarkKey = select.value || '';
      bookmarkSelectionPinned = Boolean(selectedBookmarkKey);
    });
    if (typeof turnBookmarks?.subscribe === 'function') {
      turnBookmarks.subscribe((entries) => syncBookmarkSelect(select, entries));
    }
    if (typeof turnBookmarks?.list === 'function') {
      syncBookmarkSelect(select, turnBookmarks.list());
    }
  };

  const bindRangeControls = (panel: Element | null): void => {
    if (!panel) return;
    const rangeStartInput = panel.querySelector<HTMLInputElement>('#gmh-range-start');
    const rangeEndInput = panel.querySelector<HTMLInputElement>('#gmh-range-end');
    const rangeClearBtn = panel.querySelector<HTMLButtonElement>('#gmh-range-clear');
    const rangeMarkStartBtn = panel.querySelector<HTMLButtonElement>('#gmh-range-mark-start');
    const rangeMarkEndBtn = panel.querySelector<HTMLButtonElement>('#gmh-range-mark-end');
    const rangeSummary = panel.querySelector<HTMLElement>('#gmh-range-summary');
    const rangeBookmarkSelect = panel.querySelector<HTMLSelectElement>('#gmh-range-bookmark-select');

    registerBookmarkSelect(rangeBookmarkSelect);

    const syncRangeControls = (snapshot: RangeSnapshot): void => {
      if (!snapshot) return;
      const { bounds, totals, range } = snapshot;
      const messageTotal =
        totals.message ?? bounds.messageTotal ?? bounds.total ?? 0;
      const userTotal = totals.user ?? bounds.userTotal ?? 0;
      const llmTotal = totals.llm ?? bounds.llmTotal ?? 0;
      const resolvedStart = bounds.active ? bounds.start : null;
      const resolvedEnd = bounds.active ? bounds.end : null;

      if (rangeStartInput) {
        if (messageTotal) rangeStartInput.max = String(messageTotal);
        else rangeStartInput.removeAttribute('max');
        rangeStartInput.dataset.gmhAxis = 'message';
        rangeStartInput.value = resolvedStart ? String(resolvedStart) : '';
        rangeStartInput.dataset.gmhRequested = range.start ? String(range.start) : '';
      }
      if (rangeEndInput) {
        if (messageTotal) rangeEndInput.max = String(messageTotal);
        else rangeEndInput.removeAttribute('max');
        rangeEndInput.dataset.gmhAxis = 'message';
        rangeEndInput.value = resolvedEnd ? String(resolvedEnd) : '';
        rangeEndInput.dataset.gmhRequested = range.end ? String(range.end) : '';
      }
      if (rangeMarkStartBtn) {
        if (messageTotal) rangeMarkStartBtn.removeAttribute('disabled');
        else rangeMarkStartBtn.setAttribute('disabled', 'true');
      }
      if (rangeMarkEndBtn) {
        if (messageTotal) rangeMarkEndBtn.removeAttribute('disabled');
        else rangeMarkEndBtn.setAttribute('disabled', 'true');
      }
      if (rangeSummary) {
        if (!messageTotal) {
          rangeSummary.textContent = '로드된 메시지가 없습니다.';
          rangeSummary.title = '';
        } else if (!bounds.active) {
          let textLabel = `최근 메시지 ${messageTotal}개 전체`;
          if (userTotal) textLabel += ` · 유저 ${userTotal}개`;
          if (llmTotal) textLabel += ` · LLM ${llmTotal}개`;
          rangeSummary.textContent = textLabel;
          rangeSummary.title = '';
        } else {
          let textLabel = `최근 메시지 ${bounds.start}-${bounds.end} · ${bounds.count}개 / 전체 ${bounds.total}개`;
          if (userTotal) textLabel += ` · 유저 ${userTotal}개`;
          if (llmTotal) textLabel += ` · LLM ${llmTotal}개`;
          rangeSummary.textContent = textLabel;
          rangeSummary.title = '';
        }
      }
    };

    if (rangeStartInput || rangeEndInput || rangeSummary || rangeMarkStartBtn || rangeMarkEndBtn) {
      subscribeRange(syncRangeControls);
      updateRangeSnapshot(syncRangeControls);

      const handleStartChange = (): void => {
        if (!rangeStartInput) return;
        const value = toNumber(rangeStartInput.value);
        if (value && value > 0) {
          exportRange?.setStart?.(value);
        } else {
          exportRange?.setStart?.(null);
          rangeStartInput.value = '';
        }
      };

      const handleEndChange = (): void => {
        if (!rangeEndInput) return;
        const value = toNumber(rangeEndInput.value);
        if (value && value > 0) {
          exportRange?.setEnd?.(value);
        } else {
          exportRange?.setEnd?.(null);
          rangeEndInput.value = '';
        }
      };

      if (rangeStartInput && rangeStartInput.dataset.gmhRangeReady !== 'true') {
        rangeStartInput.dataset.gmhRangeReady = 'true';
        rangeStartInput.addEventListener('change', handleStartChange);
        rangeStartInput.addEventListener('blur', handleStartChange);
      }
      if (rangeEndInput && rangeEndInput.dataset.gmhRangeReady !== 'true') {
        rangeEndInput.dataset.gmhRangeReady = 'true';
        rangeEndInput.addEventListener('change', handleEndChange);
        rangeEndInput.addEventListener('blur', handleEndChange);
      }
      if (rangeClearBtn && rangeClearBtn.dataset.gmhRangeReady !== 'true') {
        rangeClearBtn.dataset.gmhRangeReady = 'true';
        rangeClearBtn.addEventListener('click', () => {
          exportRange?.clear?.();
          turnBookmarks?.clear?.();
          selectedBookmarkKey = '';
          bookmarkSelectionPinned = false;
          if (rangeBookmarkSelect) rangeBookmarkSelect.value = '';
        });
      }

      const getActiveBookmark = (): TurnBookmarkEntry | null => {
        if (rangeBookmarkSelect) {
          const key = rangeBookmarkSelect.value || selectedBookmarkKey || '';
          if (key && typeof turnBookmarks?.pick === 'function') {
            const picked = turnBookmarks.pick(key);
            if (picked) return picked;
          }
        }
        return typeof turnBookmarks?.latest === 'function' ? turnBookmarks.latest() : null;
      };

      const buildContextFromElement = (element: Element | null): MessageContext | null => {
        if (!(element instanceof Element)) return null;
        const messageEl = element.closest('[data-gmh-message-index]');
        if (!messageEl) return null;
        const indexAttr = messageEl.getAttribute('data-gmh-message-index');
        const messageIdAttr =
          messageEl.getAttribute('data-gmh-message-id') || messageEl.getAttribute('data-message-id');
        const index = toNumber(indexAttr);

        const lookupOrdinalByIndex = messageIndexer?.lookupOrdinalByIndex;
        const lookupOrdinalByMessageId = messageIndexer?.lookupOrdinalByMessageId;
        const numericIndex = typeof index === 'number' && Number.isFinite(index) ? index : null;
        const resolvedOrdinal = [
          numericIndex !== null && typeof lookupOrdinalByIndex === 'function'
            ? lookupOrdinalByIndex(numericIndex)
            : null,
          messageIdAttr && typeof lookupOrdinalByMessageId === 'function'
            ? lookupOrdinalByMessageId(messageIdAttr)
            : null,
          toNumber(messageEl.getAttribute('data-gmh-message-ordinal')),
        ].find((value) => Number.isFinite(value) && (value as number) > 0);

        return {
          element: messageEl,
          index: Number.isFinite(index) ? (index as number) : null,
          ordinal:
            Number.isFinite(resolvedOrdinal) && resolvedOrdinal !== null
              ? (resolvedOrdinal as number)
              : null,
          messageId: messageIdAttr || null,
        };
      };

      const selectBestCandidate = (
        candidates: Element[],
        preferredIndex: number | null = null,
      ): Element | null => {
        const elements = Array.from(new Set(candidates.filter((el) => el instanceof Element)));
        if (!elements.length) return null;
        if (Number.isFinite(preferredIndex)) {
          const exact = elements.find(
            (el) => Number(el.getAttribute('data-gmh-message-index')) === preferredIndex,
          );
          if (exact) return exact;
        }
        const withOrdinal = elements
          .map((el) => ({
            el,
            ord: toNumber(el.getAttribute('data-gmh-message-ordinal')),
            idx: toNumber(el.getAttribute('data-gmh-message-index')),
          }))
          .sort((a, b) => {
            if (Number.isFinite(a.ord) && Number.isFinite(b.ord)) return (a.ord as number) - (b.ord as number);
            if (Number.isFinite(a.idx) && Number.isFinite(b.idx)) return (b.idx as number) - (a.idx as number);
            return 0;
          });
        return withOrdinal[0]?.el || elements[elements.length - 1];
      };

      const safeQueryById = (messageId: string | null, preferredIndex: number | null = null): Element | null => {
        if (!messageId) return null;
        const candidates = listMessageIdElements(doc, messageId, cssEscape);
        return selectBestCandidate(candidates, preferredIndex);
      };

      const getCandidateContext = (): MessageContext | null => {
        const bookmark = getActiveBookmark();
        if (bookmark) {
          const fromBookmark =
            safeQueryById(bookmark.messageId, bookmark.index) ||
            (Number.isFinite(bookmark.index)
              ? selectBestCandidate(
                  Array.from(
                    doc.querySelectorAll(`[data-gmh-message-index="${bookmark.index}"]`),
                  ),
                  bookmark.index,
                )
              : null);
          const resolvedBookmark = buildContextFromElement(fromBookmark);
          if (resolvedBookmark) return resolvedBookmark;
        }
        const active = doc.activeElement;
        const resolvedActive = buildContextFromElement(active instanceof Element ? active : null);
        if (resolvedActive) return resolvedActive;
        const latest = doc.querySelector('[data-gmh-message-ordinal="1"]');
        return buildContextFromElement(latest);
      };

      const doBookmark = (mode: 'start' | 'end'): void => {
        const context = getCandidateContext();
        if (!context) {
          setPanelStatus?.('메시지를 찾을 수 없습니다.', 'warning');
          return;
        }

        try {
          messageIndexer?.refresh?.({ immediate: true });
        } catch (error) {
          win?.console?.warn?.('[GMH] ordinal refresh failed', error);
        }

        const reselectElement = (): Element | null => {
          if (context.element instanceof Element && context.element.isConnected) {
            return context.element;
          }
          return (
            safeQueryById(context.messageId, context.index) ||
            selectBestCandidate(
              Array.from(
                doc.querySelectorAll(`[data-gmh-message-index="${context.index ?? ''}"]`),
              ),
              context.index,
            )
          );
        };

        const updatedContext = buildContextFromElement(reselectElement());
        if (!updatedContext) {
          setPanelStatus?.('메시지를 찾을 수 없습니다.', 'warning');
          return;
        }

        if (mode === 'start') {
          if (Number.isFinite(updatedContext.ordinal)) {
            exportRange?.setStart?.(updatedContext.ordinal ?? null);
          }
        } else if (mode === 'end') {
          if (Number.isFinite(updatedContext.ordinal)) {
            exportRange?.setEnd?.(updatedContext.ordinal ?? null);
          }
        }
      };

      if (rangeMarkStartBtn && rangeMarkStartBtn.dataset.gmhRangeReady !== 'true') {
        rangeMarkStartBtn.dataset.gmhRangeReady = 'true';
        rangeMarkStartBtn.addEventListener('click', () => doBookmark('start'));
      }
      if (rangeMarkEndBtn && rangeMarkEndBtn.dataset.gmhRangeReady !== 'true') {
        rangeMarkEndBtn.dataset.gmhRangeReady = 'true';
        rangeMarkEndBtn.addEventListener('click', () => doBookmark('end'));
      }
    }
  };

  return { bindRangeControls };
}
