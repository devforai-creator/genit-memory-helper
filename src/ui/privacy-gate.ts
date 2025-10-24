import type {
  StructuredSnapshotMessage,
  StructuredSelectionRangeInfo,
  ExportRangeInfo,
  ModalController,
  TranscriptTurn,
} from '../types';

const DEFAULT_PREVIEW_LIMIT = 5;

interface PrivacyGateStats {
  userMessages: number;
  llmMessages: number;
  totalMessages?: number | null;
  entryCount?: number | null;
  metadata?: Record<string, unknown>;
}

interface PrivacyGateCounts {
  redactions?: Record<string, number>;
  details?: Record<string, number>;
  total?: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface PrivacyPreviewTurn {
  role?: string;
  speaker?: string;
  text?: string;
  __gmhIndex?: number;
  __gmhOrdinal?: number;
  parts?: StructuredSnapshotMessage['parts'];
  [key: string]: unknown;
}

interface PrivacyGateConfirmOptions {
  profile: string;
  counts: PrivacyGateCounts | Record<string, number>;
  stats: PrivacyGateStats;
  overallStats?: PrivacyGateStats | null;
  rangeInfo?: StructuredSelectionRangeInfo | ExportRangeInfo | null;
  selectedIndices?: number[];
  selectedOrdinals?: number[];
  previewTurns?: Array<PrivacyPreviewTurn | StructuredSnapshotMessage | TranscriptTurn | null | undefined>;
  actionLabel?: string;
  heading?: string;
  subheading?: string;
}

interface PrivacyGateOptions {
  documentRef?: Document | null;
  formatRedactionCounts?: (counts: Record<string, number>) => string;
  privacyProfiles?: Record<string, { label?: string; [key: string]: unknown }>;
  previewLimit?: number;
  truncateText?: (value: unknown, max?: number) => string;
}

type ModernPrivacyGateOptions = PrivacyGateOptions & {
  ensureDesignSystemStyles?: () => void;
  modal?: ModalController | null;
};

const ensureDocument = (documentRef?: Document | null): Document => {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new Error('privacy gate requires a document reference');
  }
  return documentRef;
};

const defaultTruncate = (value: unknown, max = 220): string => {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
};

const normalizeCounts = (
  counts: PrivacyGateCounts | Record<string, number> | undefined,
): Record<string, number> => {
  if (!counts) return {};
  if (
    typeof counts === 'object' &&
    'redactions' in counts &&
    counts.redactions &&
    typeof counts.redactions === 'object'
  ) {
    return counts.redactions as Record<string, number>;
  }
  return counts as Record<string, number>;
};

interface BuildTurnsParams {
  documentRef?: Document | null;
  previewTurns?:
    | Array<PrivacyPreviewTurn | StructuredSnapshotMessage | TranscriptTurn | null | undefined>
    | null;
  previewLimit: number;
  rangeInfo?: StructuredSelectionRangeInfo | ExportRangeInfo | null;
  selectedIndices: number[];
  selectedOrdinals: number[];
  truncateText?: (value: unknown, max?: number) => string;
}

const buildTurns = ({
  documentRef,
  previewTurns,
  previewLimit,
  rangeInfo,
  selectedIndices,
  selectedOrdinals,
  truncateText,
}: BuildTurnsParams): HTMLElement => {
  const doc = ensureDocument(documentRef);
  const list = doc.createElement('ul');
  list.className = 'gmh-turn-list';

  const highlightActive = Boolean(rangeInfo?.active);
  const selectedIndexSet = new Set(selectedIndices ?? []);
  const ordinalLookup = new Map<number, number | null>();
  (selectedIndices ?? []).forEach((index, i) => {
    const ordinal = selectedOrdinals?.[i] ?? null;
    ordinalLookup.set(index, ordinal);
  });

  const turns = Array.isArray(previewTurns) ? previewTurns : [];
  turns.slice(-previewLimit).forEach((turnRaw) => {
    if (!turnRaw) return;
    const turn = turnRaw as PrivacyPreviewTurn;
    const item = doc.createElement('li');
    item.className = 'gmh-turn-list__item';
    item.tabIndex = 0;

    const turnData = turn as PrivacyPreviewTurn & Record<string, unknown>;
    const sourceIndex =
      typeof turnData.__gmhIndex === 'number' ? (turnData.__gmhIndex as number) : null;
    if (sourceIndex !== null) item.dataset.turnIndex = String(sourceIndex);

    const playerOrdinal =
      typeof turnData.__gmhOrdinal === 'number'
        ? (turnData.__gmhOrdinal as number)
        : sourceIndex !== null && ordinalLookup.has(sourceIndex)
          ? ordinalLookup.get(sourceIndex) ?? null
          : null;
    if (typeof playerOrdinal === 'number') {
      item.dataset.playerTurn = String(playerOrdinal);
    }

    if (highlightActive && sourceIndex !== null && selectedIndexSet.has(sourceIndex)) {
      item.classList.add('gmh-turn-list__item--selected');
    }

    const speaker = doc.createElement('div');
    speaker.className = 'gmh-turn-list__speaker';
    const speakerLabel = doc.createElement('span');
    const speakerName =
      typeof turn.speaker === 'string' && turn.speaker.trim().length ? turn.speaker : '??';
    const roleLabel = typeof turn.role === 'string' ? turn.role : '';
    speakerLabel.textContent = `${speakerName} · ${roleLabel}`;
    speaker.appendChild(speakerLabel);

    if (typeof playerOrdinal === 'number' && playerOrdinal > 0) {
      const badge = doc.createElement('span');
      badge.className = 'gmh-turn-list__badge';
      badge.textContent = `메시지 ${playerOrdinal}`;
      speaker.appendChild(badge);
    }

    const text = doc.createElement('div');
    text.className = 'gmh-turn-list__text';
    const truncate = typeof truncateText === 'function' ? truncateText : defaultTruncate;
    const turnText =
      typeof turn.text === 'string'
        ? turn.text
        : typeof (turn as Record<string, unknown>).text === 'string'
          ? ((turn as Record<string, unknown>).text as string)
          : '';
    text.textContent = truncate(turnText || '');

    item.appendChild(speaker);
    item.appendChild(text);
    list.appendChild(item);
  });

  if (!list.children.length) {
    const empty = doc.createElement('li');
    empty.className = 'gmh-turn-list__item gmh-turn-list__empty';
    empty.textContent = '표시할 메시지가 없습니다. 상단 요약만 확인해주세요.';
    list.appendChild(empty);
  }

  return list;
};

interface BuildSummaryBoxParams {
  documentRef?: Document | null;
  formatRedactionCounts?: (counts: Record<string, number>) => string;
  privacyProfiles?: Record<string, { label?: string; [key: string]: unknown }>;
  profile: string;
  counts: PrivacyGateCounts | Record<string, number>;
  stats: PrivacyGateStats;
  overallStats?: PrivacyGateStats | null;
  rangeInfo?: StructuredSelectionRangeInfo | ExportRangeInfo | null;
}

const buildSummaryBox = ({
  documentRef,
  formatRedactionCounts,
  privacyProfiles,
  profile,
  counts,
  stats,
  overallStats = null,
  rangeInfo,
}: BuildSummaryBoxParams): HTMLElement => {
  const doc = ensureDocument(documentRef);
  const summaryCounts = normalizeCounts(counts);
  const summary =
    typeof formatRedactionCounts === 'function' ? formatRedactionCounts(summaryCounts) : '';
  const profileLabel = privacyProfiles?.[profile]?.label ?? profile;
  const statsTotal = stats.totalMessages ?? stats.userMessages + stats.llmMessages;
  const overallTotal = overallStats?.totalMessages ?? overallStats?.userMessages ?? statsTotal;

  const turnsLabel = overallStats
    ? `유저 메시지 ${stats.userMessages}/${overallStats.userMessages} · 전체 메시지 ${statsTotal}/${overallTotal}`
    : `유저 메시지 ${stats.userMessages} · 전체 메시지 ${statsTotal}`;

  const container = doc.createElement('div');
  container.className = 'gmh-privacy-summary';

  const createRow = (labelText: string, valueText: string): HTMLElement => {
    const row = doc.createElement('div');
    row.className = 'gmh-privacy-summary__row';
    const labelEl = doc.createElement('span');
    labelEl.className = 'gmh-privacy-summary__label';
    labelEl.textContent = labelText;
    const valueEl = doc.createElement('span');
    valueEl.textContent = valueText;
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
  };

  [
    createRow('프로필', profileLabel),
    createRow('메시지 수', turnsLabel),
    createRow('레다크션', summary),
  ].forEach((row) => container.appendChild(row));

  if (rangeInfo?.total) {
    const messageTotal =
      (typeof rangeInfo.messageTotal === 'number' && Number.isFinite(rangeInfo.messageTotal)
        ? rangeInfo.messageTotal
        : null) ?? rangeInfo.total;
    const rangeText = rangeInfo.active
      ? `메시지 ${rangeInfo.start}-${rangeInfo.end} · ${rangeInfo.count}/${messageTotal}`
      : `메시지 ${messageTotal}개 전체`;
    const extraParts: string[] = [];
    if (typeof rangeInfo.userTotal === 'number' && Number.isFinite(rangeInfo.userTotal)) {
      extraParts.push(`유저 ${rangeInfo.userTotal}개`);
    }
    if (typeof rangeInfo.llmTotal === 'number' && Number.isFinite(rangeInfo.llmTotal)) {
      extraParts.push(`LLM ${rangeInfo.llmTotal}개`);
    }
    const complement = extraParts.length ? ` · ${extraParts.join(' · ')}` : '';
    container.appendChild(createRow('범위', rangeText + complement));
  }

  return container;
};

export function createModernPrivacyGate({
  documentRef = typeof document !== 'undefined' ? document : null,
  formatRedactionCounts,
  privacyProfiles,
  ensureDesignSystemStyles,
  modal,
  truncateText = defaultTruncate,
  previewLimit = DEFAULT_PREVIEW_LIMIT,
}: ModernPrivacyGateOptions = {}): { confirm: (confirmOptions: PrivacyGateConfirmOptions) => Promise<boolean> } {
  const doc = ensureDocument(documentRef);
  if (typeof ensureDesignSystemStyles !== 'function') {
    throw new Error('modern privacy gate requires ensureDesignSystemStyles');
  }
  if (!modal || typeof modal.open !== 'function') {
    throw new Error('modern privacy gate requires modal.open');
  }

  const confirm = async (options: PrivacyGateConfirmOptions): Promise<boolean> => {
    const {
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
    } = options;

    if (!profile) throw new Error('privacy gate confirm requires profile');
    if (!counts) throw new Error('privacy gate confirm requires counts');
    if (!stats) throw new Error('privacy gate confirm requires stats');

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
      }),
    );

    const previewList = Array.isArray(previewTurns) ? previewTurns : [];
    const previewTitle = doc.createElement('div');
    previewTitle.className = 'gmh-section-title';
    previewTitle.textContent = `미리보기 (${Math.min(previewList.length, previewLimit)}메시지)`;
    stack.appendChild(previewTitle);

    stack.appendChild(
      buildTurns({
        documentRef: doc,
        previewTurns: previewList,
        previewLimit,
        rangeInfo,
        selectedIndices,
        selectedOrdinals,
        truncateText,
      }),
    );

    const footnote = doc.createElement('div');
    footnote.className = 'gmh-modal-footnote';
    footnote.textContent = subheading;
    stack.appendChild(footnote);

    const result = await modal.open({
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
    });

    return Boolean(result);
  };

  return { confirm };
}

export { DEFAULT_PREVIEW_LIMIT };
