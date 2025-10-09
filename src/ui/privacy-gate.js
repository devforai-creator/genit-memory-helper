const DEFAULT_PREVIEW_LIMIT = 5;

/**
 * @typedef {import('../types').StructuredSnapshotMessage} StructuredSnapshotMessage
 * @typedef {import('../types').StructuredSelectionRangeInfo} StructuredSelectionRangeInfo
 * @typedef {import('../types').ExportRangeInfo} ExportRangeInfo
 * @typedef {import('../types').ModalController} ModalController
 */

/**
 * @typedef {object} PrivacyGateStats
 * @property {number} userMessages
 * @property {number} llmMessages
 * @property {number} [totalMessages]
 * @property {number} [entryCount]
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {object} PrivacyGateCounts
 * @property {Record<string, number>} [redactions]
 * @property {Record<string, number>} [details]
 * @property {number} [total]
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {object} PrivacyPreviewTurn
 * @property {string} [role]
 * @property {string} [speaker]
 * @property {string} [text]
 * @property {number} [__gmhIndex]
 * @property {number} [__gmhOrdinal]
 * @property {StructuredSnapshotMessage['parts']} [parts]
 */

/**
 * @typedef {object} PrivacyGateConfirmOptions
 * @property {string} profile
 * @property {PrivacyGateCounts | Record<string, number>} counts
 * @property {PrivacyGateStats} stats
 * @property {PrivacyGateStats | null} [overallStats]
 * @property {StructuredSelectionRangeInfo | ExportRangeInfo | null} [rangeInfo]
 * @property {number[]} [selectedIndices]
 * @property {number[]} [selectedOrdinals]
 * @property {PrivacyPreviewTurn[]} [previewTurns]
 * @property {string} [actionLabel]
 * @property {string} [heading]
 * @property {string} [subheading]
 */

/**
 * @typedef {object} PrivacyGateOptions
 * @property {Document | null} [documentRef]
 * @property {(counts: Record<string, number>) => string} [formatRedactionCounts]
 * @property {Record<string, { label?: string }>} [privacyProfiles]
 * @property {number} [previewLimit]
 * @property {(value: string) => string} [truncateText]
 */

/**
 * @typedef {PrivacyGateOptions & {
 *   ensureLegacyPreviewStyles?: () => void;
 * }} LegacyPrivacyGateOptions
 */

/**
 * @typedef {PrivacyGateOptions & {
 *   ensureDesignSystemStyles?: () => void;
 *   modal?: ModalController | null;
 * }} ModernPrivacyGateOptions
 */

/**
 * Validates that a document reference is available.
 * @param {Document | null | undefined} documentRef
 * @returns {Document}
 */
const ensureDocument = (documentRef) => {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new Error('privacy gate requires a document reference');
  }
  return documentRef;
};

/**
 * Truncates preview text to a configurable length.
 * @param {unknown} value
 * @param {number} [max=220]
 * @returns {string}
 */
const defaultTruncate = (value, max = 220) => {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
};

/**
 * Renders preview turn items for the privacy gate.
 * @param {object} params
 * @param {Document | null | undefined} params.documentRef
 * @param {PrivacyPreviewTurn[] | StructuredSnapshotMessage[] | null | undefined} params.previewTurns
 * @param {number} params.previewLimit
 * @param {StructuredSelectionRangeInfo | ExportRangeInfo | null | undefined} params.rangeInfo
 * @param {number[]} params.selectedIndices
 * @param {number[]} params.selectedOrdinals
 * @param {(value: unknown, max?: number) => string} [params.truncateText]
 * @param {boolean} params.modern
 * @returns {HTMLElement}
 */
const buildTurns = ({
  documentRef,
  previewTurns,
  previewLimit,
  rangeInfo,
  selectedIndices,
  selectedOrdinals,
  truncateText,
  modern,
}) => {
  const doc = ensureDocument(documentRef);
  const list = doc.createElement('ul');
  list.className = modern ? 'gmh-turn-list' : 'gmh-preview-turns';
  const highlightActive = rangeInfo?.active;
  const selectedIndexSet = new Set(selectedIndices || []);
  const ordinalLookup = new Map();
  (selectedIndices || []).forEach((idx, i) => {
    const ord = selectedOrdinals?.[i] ?? null;
    ordinalLookup.set(idx, ord);
  });

  const turns = Array.isArray(previewTurns) ? previewTurns : [];
  turns.slice(-previewLimit).forEach((turn) => {
    if (!turn) return;
    const item = doc.createElement('li');
    item.className = modern ? 'gmh-turn-list__item' : 'gmh-preview-turn';
    item.tabIndex = 0;

    const sourceIndex = typeof turn.__gmhIndex === 'number' ? turn.__gmhIndex : null;
    if (sourceIndex !== null) item.dataset.turnIndex = String(sourceIndex);

    const playerOrdinal = (() => {
      if (typeof turn.__gmhOrdinal === 'number') return turn.__gmhOrdinal;
      if (sourceIndex !== null && ordinalLookup.has(sourceIndex)) {
        return ordinalLookup.get(sourceIndex);
      }
      return null;
    })();
    if (typeof playerOrdinal === 'number') {
      item.dataset.playerTurn = String(playerOrdinal);
    }

    if (highlightActive && sourceIndex !== null && selectedIndexSet.has(sourceIndex)) {
      item.classList.add(modern ? 'gmh-turn-list__item--selected' : 'gmh-preview-turn--selected');
    }

    const speaker = doc.createElement('div');
    speaker.className = modern ? 'gmh-turn-list__speaker' : 'gmh-preview-turn-speaker';
    const speakerLabel = doc.createElement('span');
    speakerLabel.textContent = `${turn.speaker || '??'} · ${turn.role}`;
    speaker.appendChild(speakerLabel);

    if (typeof playerOrdinal === 'number' && playerOrdinal > 0) {
      const badge = doc.createElement('span');
      badge.className = modern ? 'gmh-turn-list__badge' : 'gmh-turn-list__badge';
      badge.textContent = `메시지 ${playerOrdinal}`;
      speaker.appendChild(badge);
    }

    const text = doc.createElement('div');
    text.className = modern ? 'gmh-turn-list__text' : 'gmh-preview-turn-text';
    const truncate = typeof truncateText === 'function' ? truncateText : defaultTruncate;
    text.textContent = truncate(turn.text || '');

    item.appendChild(speaker);
    item.appendChild(text);
    list.appendChild(item);
  });

  if (!list.children.length) {
    const empty = doc.createElement(modern ? 'li' : 'div');
    empty.className = modern
      ? 'gmh-turn-list__item gmh-turn-list__empty'
      : 'gmh-preview-turn';
    const emptyText = modern ? empty : doc.createElement('div');
    if (!modern) {
      emptyText.className = 'gmh-preview-turn-text';
      emptyText.textContent = '표시할 메시지가 없습니다. 상단 요약만 확인해주세요.';
      empty.appendChild(emptyText);
    } else {
      empty.textContent = '표시할 메시지가 없습니다. 상단 요약만 확인해주세요.';
    }
    list.appendChild(empty);
  }

  return list;
};

/**
 * Builds the summary box summarizing counts and stats for the dialog.
 * @param {object} params
 * @param {Document | null | undefined} params.documentRef
 * @param {(counts: Record<string, number>) => string} [params.formatRedactionCounts]
 * @param {Record<string, { label?: string }>} [params.privacyProfiles]
 * @param {string} params.profile
 * @param {Record<string, number>} params.counts
 * @param {PrivacyGateStats} params.stats
 * @param {PrivacyGateStats | null} [params.overallStats]
 * @param {StructuredSelectionRangeInfo | ExportRangeInfo | null | undefined} [params.rangeInfo]
 * @param {boolean} params.modern
 * @returns {HTMLElement}
 */
const buildSummaryBox = ({
  documentRef,
  formatRedactionCounts,
  privacyProfiles,
  profile,
  counts,
  stats,
  overallStats,
  rangeInfo,
  modern,
}) => {
  const doc = ensureDocument(documentRef);
  const summary = typeof formatRedactionCounts === 'function'
    ? formatRedactionCounts(counts)
    : '';
  const profileLabel = privacyProfiles?.[profile]?.label || profile;
  const turnsLabel = overallStats
    ? `유저 메시지 ${stats.userMessages}/${overallStats.userMessages} · 전체 메시지 ${stats.totalMessages}/${overallStats.totalMessages}`
    : `유저 메시지 ${stats.userMessages} · 전체 메시지 ${stats.totalMessages}`;

  const container = doc.createElement('div');
  container.className = modern ? 'gmh-privacy-summary' : 'gmh-preview-summary';

  const createRow = (labelText, valueText) => {
    const row = doc.createElement('div');
    if (modern) {
      row.className = 'gmh-privacy-summary__row';
      const labelEl = doc.createElement('span');
      labelEl.className = 'gmh-privacy-summary__label';
      labelEl.textContent = labelText;
      const valueEl = doc.createElement('span');
      valueEl.textContent = valueText;
      row.appendChild(labelEl);
      row.appendChild(valueEl);
    } else {
      const strong = doc.createElement('strong');
      strong.textContent = labelText;
      const value = doc.createElement('span');
      value.textContent = valueText;
      row.appendChild(strong);
      row.appendChild(value);
    }
    return row;
  };

  [
    createRow('프로필', profileLabel),
    createRow('메시지 수', turnsLabel),
    createRow('레다크션', summary),
  ].forEach((row) => container.appendChild(row));

  if (rangeInfo?.total) {
    const messageTotal = rangeInfo.messageTotal ?? rangeInfo.total;
    const rangeText = rangeInfo.active
      ? `메시지 ${rangeInfo.start}-${rangeInfo.end} · ${rangeInfo.count}/${messageTotal}`
      : `메시지 ${messageTotal}개 전체`;
    const extraParts = [];
    if (Number.isFinite(rangeInfo.userTotal)) extraParts.push(`유저 ${rangeInfo.userTotal}개`);
    if (Number.isFinite(rangeInfo.llmTotal)) extraParts.push(`LLM ${rangeInfo.llmTotal}개`);
    const complement = extraParts.length ? ` · ${extraParts.join(' · ')}` : '';
    container.appendChild(createRow('범위', rangeText + complement));
  }

  return container;
};

/**
 * Builds the classic privacy confirmation dialog rendered inside the legacy panel.
 *
 * @param {LegacyPrivacyGateOptions} [options]
 * @returns {{ confirm: (confirmOptions?: PrivacyGateConfirmOptions) => Promise<boolean> }}
 */
export function createLegacyPrivacyGate({
  documentRef = typeof document !== 'undefined' ? document : null,
  formatRedactionCounts,
  privacyProfiles,
  ensureLegacyPreviewStyles,
  truncateText = defaultTruncate,
  previewLimit = DEFAULT_PREVIEW_LIMIT,
} = {}) {
  const doc = ensureDocument(documentRef);
  if (typeof ensureLegacyPreviewStyles !== 'function') {
    throw new Error('legacy privacy gate requires ensureLegacyPreviewStyles');
  }

  /**
   * Opens the legacy overlay preview and resolves with the user choice.
   * @param {PrivacyGateConfirmOptions} [params]
   * @returns {Promise<boolean>}
   */
  const confirm = ({
    profile,
    counts,
    stats,
    overallStats = null,
    rangeInfo = null,
    selectedIndices = [],
    selectedOrdinals = [],
    previewTurns = [],
    actionLabel = '계속',
    heading = '공유 전 확인',
    subheading = '외부로 공유하기 전에 민감정보가 없는지 확인하세요.',
  } = {}) => {
    ensureLegacyPreviewStyles();

    const overlay = doc.createElement('div');
    overlay.className = 'gmh-preview-overlay';
    const card = doc.createElement('div');
    card.className = 'gmh-preview-card';
    overlay.appendChild(card);

    const header = doc.createElement('div');
    header.className = 'gmh-preview-header';
    const headerLabel = doc.createElement('span');
    headerLabel.textContent = heading;
    header.appendChild(headerLabel);
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'gmh-preview-close';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.textContent = '✕';
    header.appendChild(closeBtn);
    card.appendChild(header);

    const body = doc.createElement('div');
    body.className = 'gmh-preview-body';
    body.appendChild(
      buildSummaryBox({
        documentRef: doc,
        formatRedactionCounts,
        privacyProfiles,
        profile,
        counts,
        stats,
        overallStats,
        rangeInfo,
        modern: false,
      }),
    );

    const previewTitle = doc.createElement('div');
    previewTitle.style.fontWeight = '600';
    previewTitle.style.color = '#cbd5f5';
    previewTitle.textContent = `미리보기 (${Math.min(previewTurns.length, previewLimit)}메시지)`;
    body.appendChild(previewTitle);

    body.appendChild(
      buildTurns({
        documentRef: doc,
        previewTurns,
        previewLimit,
        rangeInfo,
        selectedIndices,
        selectedOrdinals,
        truncateText,
        modern: false,
      }),
    );

    const footnote = doc.createElement('div');
    footnote.className = 'gmh-preview-footnote';
    footnote.textContent = subheading;
    body.appendChild(footnote);

    card.appendChild(body);

    const actions = doc.createElement('div');
    actions.className = 'gmh-preview-actions';
    const cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'gmh-preview-cancel';
    cancelBtn.textContent = '취소';
    const confirmBtn = doc.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'gmh-preview-confirm';
    confirmBtn.textContent = actionLabel;
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    card.appendChild(actions);

    const bodyEl = doc.body || doc.querySelector('body');
    if (!bodyEl) throw new Error('document body missing');
    const prevOverflow = bodyEl.style.overflow;
    bodyEl.style.overflow = 'hidden';
    bodyEl.appendChild(overlay);

    return new Promise((resolve) => {
      const cleanup = (result) => {
        bodyEl.style.overflow = prevOverflow;
        overlay.remove();
        doc.removeEventListener('keydown', onKey);
        resolve(result);
      };

      const onKey = (event) => {
        if (event.key === 'Escape') cleanup(false);
      };
      doc.addEventListener('keydown', onKey);

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) cleanup(false);
      });
      closeBtn.addEventListener('click', () => cleanup(false));
      cancelBtn.addEventListener('click', () => cleanup(false));
      confirmBtn.addEventListener('click', () => cleanup(true));
    });
  };

  return { confirm };
}

/**
 * Builds the modern privacy confirmation modal using design-system styles.
 *
 * @param {ModernPrivacyGateOptions} [options]
 * @returns {{ confirm: (confirmOptions?: PrivacyGateConfirmOptions) => Promise<boolean> }}
 */
export function createModernPrivacyGate({
  documentRef = typeof document !== 'undefined' ? document : null,
  formatRedactionCounts,
  privacyProfiles,
  ensureDesignSystemStyles,
  modal,
  truncateText = defaultTruncate,
  previewLimit = DEFAULT_PREVIEW_LIMIT,
} = {}) {
  const doc = ensureDocument(documentRef);
  if (typeof ensureDesignSystemStyles !== 'function') {
    throw new Error('modern privacy gate requires ensureDesignSystemStyles');
  }
  if (!modal || typeof modal.open !== 'function') {
    throw new Error('modern privacy gate requires modal.open');
  }

  /**
   * Opens the design-system modal and resolves with the user's decision.
   * @param {PrivacyGateConfirmOptions} [params]
   * @returns {Promise<boolean>}
   */
  const confirm = ({
    profile,
    counts,
    stats,
    overallStats = null,
    rangeInfo = null,
    selectedIndices = [],
    selectedOrdinals = [],
    previewTurns = [],
    actionLabel = '계속',
    heading = '공유 전 확인',
    subheading = '외부로 공유하기 전에 민감정보가 없는지 확인하세요.',
  } = {}) => {
    ensureDesignSystemStyles();

    const stack = doc.createElement('div');
    stack.className = 'gmh-modal-stack';

    stack.appendChild(
      buildSummaryBox({
        documentRef: doc,
        formatRedactionCounts,
        privacyProfiles,
        profile,
        counts,
        stats,
        overallStats,
        rangeInfo,
        modern: true,
      }),
    );

    const previewTitle = doc.createElement('div');
    previewTitle.className = 'gmh-section-title';
    previewTitle.textContent = `미리보기 (${Math.min(previewTurns.length, previewLimit)}메시지)`;
    stack.appendChild(previewTitle);

    stack.appendChild(
      buildTurns({
        documentRef: doc,
        previewTurns,
        previewLimit,
        rangeInfo,
        selectedIndices,
        selectedOrdinals,
        truncateText,
        modern: true,
      }),
    );

    const footnote = doc.createElement('div');
    footnote.className = 'gmh-modal-footnote';
    footnote.textContent = subheading;
    stack.appendChild(footnote);

    return modal
      .open({
        title: heading,
        description: '',
        content: stack,
        size: 'medium',
        initialFocus: '[data-action="confirm"]',
        actions: [
          {
            id: 'cancel',
            label: '취소',
            variant: 'secondary',
            value: false,
            attrs: { 'data-action': 'cancel' },
          },
          {
            id: 'confirm',
            label: actionLabel,
            variant: 'primary',
            value: true,
            attrs: { 'data-action': 'confirm' },
          },
        ],
      })
      .then((result) => Boolean(result));
  };

  return { confirm };
}

export { DEFAULT_PREVIEW_LIMIT };
