/**
 * Creates DOM bindings for export range selectors and bookmark integration.
 */
export function createRangeControls({
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? window : null,
  exportRange,
  turnBookmarks,
  messageIndexer,
  setPanelStatus,
}) {
  if (!documentRef) throw new Error('createRangeControls requires document reference');
  if (!exportRange) throw new Error('createRangeControls requires exportRange');
  if (!turnBookmarks) throw new Error('createRangeControls requires turnBookmarks');
  if (!messageIndexer) throw new Error('createRangeControls requires messageIndexer');

  const doc = documentRef;
  const win = windowRef;
  const cssEscape = () => doc?.defaultView?.CSS?.escape || win?.CSS?.escape;

  let rangeUnsubscribe = null;
  let selectedBookmarkKey = '';
  let bookmarkSelectionPinned = false;

  const toNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const subscribeRange = (handler) => {
    if (typeof exportRange?.subscribe !== 'function') return;
    if (typeof rangeUnsubscribe === 'function') rangeUnsubscribe();
    rangeUnsubscribe = exportRange.subscribe(handler);
  };

  const updateRangeSnapshot = (handler) => {
    if (typeof handler !== 'function') return;
    if (typeof exportRange?.snapshot === 'function') {
      handler(exportRange.snapshot());
      return;
    }
    if (typeof exportRange?.describe === 'function') {
      const bounds = exportRange.describe();
      const totals = typeof exportRange?.getTotals === 'function' ? exportRange.getTotals() : {};
      const range = typeof exportRange?.getRange === 'function'
        ? exportRange.getRange()
        : { start: null, end: null };
      handler({ bounds, totals, range });
    }
  };

  const syncBookmarkSelect = (select, entries = []) => {
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

  const registerBookmarkSelect = (select) => {
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

  const bindRangeControls = (panel) => {
    if (!panel) return;
    const rangeStartInput = panel.querySelector('#gmh-range-start');
    const rangeEndInput = panel.querySelector('#gmh-range-end');
    const rangeClearBtn = panel.querySelector('#gmh-range-clear');
    const rangeMarkStartBtn = panel.querySelector('#gmh-range-mark-start');
    const rangeMarkEndBtn = panel.querySelector('#gmh-range-mark-end');
    const rangeSummary = panel.querySelector('#gmh-range-summary');
    const rangeBookmarkSelect = panel.querySelector('#gmh-range-bookmark-select');

    registerBookmarkSelect(rangeBookmarkSelect);

    const syncRangeControls = (snapshot) => {
      if (!snapshot) return;
      const { bounds, totals, range } = snapshot;
      const messageTotal = totals?.message ?? bounds.messageTotal ?? 0;
      const userTotal = totals?.user ?? bounds.userTotal ?? 0;
      const llmTotal = totals?.llm ?? bounds.llmTotal ?? 0;
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

      const handleStartChange = () => {
        if (!rangeStartInput) return;
        const value = toNumber(rangeStartInput.value);
        if (value && value > 0) {
          exportRange?.setStart?.(value);
        } else {
          exportRange?.setStart?.(null);
          rangeStartInput.value = '';
        }
      };

      const handleEndChange = () => {
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

      const getActiveBookmark = () => {
        if (rangeBookmarkSelect) {
          const key = rangeBookmarkSelect.value || selectedBookmarkKey || '';
          if (key) {
            const picked = turnBookmarks?.pick?.(key);
            if (picked) return picked;
          }
        }
        return turnBookmarks?.latest?.();
      };

      const doBookmark = (mode) => {
        const lookupOrdinalByIndex = messageIndexer?.lookupOrdinalByIndex;
        const lookupOrdinalByMessageId = messageIndexer?.lookupOrdinalByMessageId;

        const buildContextFromElement = (element) => {
          if (!(element instanceof Element)) return null;
          const messageEl = element.closest('[data-gmh-message-index]');
          if (!messageEl) return null;
          const indexAttr = messageEl.getAttribute('data-gmh-message-index');
          const messageIdAttr =
            messageEl.getAttribute('data-gmh-message-id') ||
            messageEl.getAttribute('data-message-id');
          const index = toNumber(indexAttr);

          const resolvedOrdinal = [
            Number.isFinite(index) && typeof lookupOrdinalByIndex === 'function'
              ? lookupOrdinalByIndex(index)
              : null,
            messageIdAttr && typeof lookupOrdinalByMessageId === 'function'
              ? lookupOrdinalByMessageId(messageIdAttr)
              : null,
            toNumber(messageEl.getAttribute('data-gmh-message-ordinal')),
          ].find((value) => Number.isFinite(value) && value > 0);

          return {
            element: messageEl,
            index: Number.isFinite(index) ? index : null,
            ordinal: Number.isFinite(resolvedOrdinal) ? resolvedOrdinal : null,
            messageId: messageIdAttr || null,
          };
        };

        const resolveFromElement = (element) => buildContextFromElement(element);

        const escapeForAttr = (value) => {
          if (typeof value !== 'string') return '';
          const esc = cssEscape();
          return typeof esc === 'function' ? esc(value) : value.replace(/"/g, '\\"');
        };

        const listByMessageId = (messageId) => {
          if (!messageId) return [];
          try {
            const selector = `[data-gmh-message-id="${escapeForAttr(messageId)}"]`;
            return Array.from(doc.querySelectorAll(selector));
          } catch (err) {
            return [];
          }
        };

        const selectBestCandidate = (candidates, preferredIndex = null) => {
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
              if (Number.isFinite(a.ord) && Number.isFinite(b.ord)) return a.ord - b.ord;
              if (Number.isFinite(a.idx) && Number.isFinite(b.idx)) return b.idx - a.idx;
              return 0;
            });
          return withOrdinal[0]?.el || elements[elements.length - 1];
        };

        const safeQueryById = (messageId, preferredIndex = null) => {
          const candidates = listByMessageId(messageId);
          return selectBestCandidate(candidates, preferredIndex);
        };

        const getCandidateContext = () => {
          const bookmark = getActiveBookmark();
          if (bookmark) {
            const fromBookmark =
              safeQueryById(bookmark.messageId, bookmark.index) ||
              (Number.isFinite(bookmark.index)
                ? selectBestCandidate(
                    Array.from(doc.querySelectorAll(`[data-gmh-message-index="${bookmark.index}"]`)),
                    bookmark.index,
                  )
                : null);
            const resolvedBookmark = resolveFromElement(fromBookmark);
            if (resolvedBookmark) return resolvedBookmark;
          }
          const active = doc.activeElement;
          const resolvedActive = resolveFromElement(active);
          if (resolvedActive) return resolvedActive;
          const latest = doc.querySelector('[data-gmh-message-ordinal="1"]');
          return resolveFromElement(latest);
        };

        const context = getCandidateContext();
        if (!context) {
          setPanelStatus?.('메시지를 찾을 수 없습니다.', 'warning');
          return;
        }

        try {
          messageIndexer?.refresh?.({ immediate: true });
        } catch (err) {
          win?.console?.warn?.('[GMH] ordinal refresh failed', err);
        }

        const reselectElement = () => {
          if (context.element instanceof Element && context.element.isConnected) {
            const current = buildContextFromElement(context.element);
            if (current) return current;
          }

          const candidates = [];
          if (context.messageId) candidates.push(...listByMessageId(context.messageId));
          if (Number.isFinite(context.index)) {
            candidates.push(...doc.querySelectorAll(`[data-gmh-message-index="${context.index}"]`));
          }

          const chosen = selectBestCandidate(candidates, context.index);
          return chosen ? buildContextFromElement(chosen) : null;
        };

        const refreshedContext = reselectElement() || context;

        const ordinalFromIndex =
          Number.isFinite(refreshedContext.index) && typeof messageIndexer?.lookupOrdinalByIndex === 'function'
            ? messageIndexer.lookupOrdinalByIndex(refreshedContext.index)
            : null;
        const ordinalFromId =
          refreshedContext.messageId && typeof messageIndexer?.lookupOrdinalByMessageId === 'function'
            ? messageIndexer.lookupOrdinalByMessageId(refreshedContext.messageId)
            : null;
        const ordinalFromAttr = toNumber(
          refreshedContext.element?.getAttribute?.('data-gmh-message-ordinal') ?? refreshedContext.ordinal,
        );
        const resolvedOrdinal = [ordinalFromIndex, ordinalFromId, ordinalFromAttr].find(
          (value) => Number.isFinite(value) && value > 0,
        );
        if (!Number.isFinite(resolvedOrdinal) || resolvedOrdinal <= 0) {
          setPanelStatus?.('메시지 순서를 찾을 수 없습니다. 화면을 새로고침해 주세요.', 'warning');
          return;
        }

        if (mode === 'start') {
          exportRange?.setStart?.(resolvedOrdinal);
          if (rangeStartInput) rangeStartInput.value = String(resolvedOrdinal);
          setPanelStatus?.(`메시지 ${resolvedOrdinal}을 시작으로 지정했습니다.`, 'info');
        } else {
          exportRange?.setEnd?.(resolvedOrdinal);
          if (rangeEndInput) rangeEndInput.value = String(resolvedOrdinal);
          setPanelStatus?.(`메시지 ${resolvedOrdinal}을 끝으로 지정했습니다.`, 'info');
        }

        const recorded = turnBookmarks?.record?.(
          refreshedContext.index,
          resolvedOrdinal,
          refreshedContext.messageId,
          'message',
        );
        if (recorded?.key) {
          selectedBookmarkKey = recorded.key;
          bookmarkSelectionPinned = false;
          if (rangeBookmarkSelect) rangeBookmarkSelect.value = recorded.key;
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

  return {
    bindRangeControls,
  };
}
