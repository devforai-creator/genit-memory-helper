import { requireDeps } from '../utils/validation';
import type {
  ShareWorkflowOptions,
  ShareWorkflowApi,
  PreparedShareResult,
  ExportRangeController,
  PanelStateApi,
  TranscriptSession,
  TranscriptTurn,
  StructuredSnapshot,
  StructuredSelectionResult,
  ExportRangeInfo,
  ClipboardHelper,
  ExportRangeSelection,
} from '../types';

type PrepareShareOptions = {
  confirmLabel?: string;
  cancelStatusMessage?: string;
  blockedStatusMessage?: string;
};

type ParseAllResult = {
  session: TranscriptSession;
  raw: string;
  snapshot: StructuredSnapshot;
};

export function createShareWorkflow(options: ShareWorkflowOptions): ShareWorkflowApi {
  const typedOptions = options as ShareWorkflowOptions;
  const {
    captureStructuredSnapshot,
    normalizeTranscript,
    buildSession,
    exportRange: exportRangeOption,
    projectStructuredMessages,
    cloneSession,
    applyPrivacyPipeline,
    privacyConfig,
    privacyProfiles,
    formatRedactionCounts,
    setPanelStatus,
    toMarkdownExport,
    toJSONExport,
    toTXTExport,
    toStructuredMarkdown,
    toStructuredJSON,
    toStructuredTXT,
    buildExportBundle,
    buildExportManifest,
    triggerDownload,
    clipboard,
    stateApi: stateApiOption,
    stateEnum,
    confirmPrivacyGate,
    getEntryOrigin,
    collectSessionStats,
    alert: alertFn = (msg) => globalThis.alert?.(msg),
    logger = typeof console !== 'undefined' ? console : null,
  } = typedOptions;
  const exportRange = exportRangeOption as ExportRangeController | null | undefined;
  const stateApi = stateApiOption as PanelStateApi;
  requireDeps(
    {
      captureStructuredSnapshot,
      normalizeTranscript,
      buildSession,
      exportRange,
      projectStructuredMessages,
      cloneSession,
      applyPrivacyPipeline,
      privacyConfig,
      privacyProfiles,
      formatRedactionCounts,
      setPanelStatus,
      toMarkdownExport,
      toJSONExport,
      toTXTExport,
      toStructuredMarkdown,
      toStructuredJSON,
      toStructuredTXT,
      buildExportBundle,
      buildExportManifest,
      triggerDownload,
      clipboard,
      stateApi,
      stateEnum,
      confirmPrivacyGate,
      getEntryOrigin,
      collectSessionStats,
    },
    {
      captureStructuredSnapshot: (fn) => typeof fn === 'function',
      normalizeTranscript: (fn) => typeof fn === 'function',
      buildSession: (fn) => typeof fn === 'function',
      projectStructuredMessages: (fn) => typeof fn === 'function',
      cloneSession: (fn) => typeof fn === 'function',
      applyPrivacyPipeline: (fn) => typeof fn === 'function',
      privacyConfig: (value) => Boolean(value),
      privacyProfiles: (value) => Boolean(value),
      formatRedactionCounts: (fn) => typeof fn === 'function',
      setPanelStatus: (fn) => typeof fn === 'function',
      toMarkdownExport: (fn) => typeof fn === 'function',
      toJSONExport: (fn) => typeof fn === 'function',
      toTXTExport: (fn) => typeof fn === 'function',
      toStructuredMarkdown: (fn) => typeof fn === 'function',
      toStructuredJSON: (fn) => typeof fn === 'function',
      toStructuredTXT: (fn) => typeof fn === 'function',
      buildExportBundle: (fn) => typeof fn === 'function',
      buildExportManifest: (fn) => typeof fn === 'function',
      triggerDownload: (fn) => typeof fn === 'function',
      exportRange: (value) => {
        const controller = value as ExportRangeController | null | undefined;
        return Boolean(controller?.setTotals);
      },
      'clipboard.set': (fn) => typeof fn === 'function',
      stateApi: (value) => {
        const api = value as PanelStateApi | null | undefined;
        return Boolean(api?.setState);
      },
      stateEnum: (value) => Boolean(value),
      confirmPrivacyGate: (fn) => typeof fn === 'function',
      getEntryOrigin: (fn) => typeof fn === 'function',
      collectSessionStats: (fn) => typeof fn === 'function',
    },
  );

  const resolveStateKey = (value: string | undefined, fallback: string): string =>
    typeof value === 'string' && value.length > 0 ? value : fallback;

  const setState = (value: string | undefined, fallback: string, payload: unknown): void => {
    stateApi.setState(resolveStateKey(value, fallback), payload);
  };

  const toErrorMessage = (err: unknown): string =>
    err instanceof Error && typeof err.message === 'string' ? err.message : String(err);

  const parseAll = (): ParseAllResult => {
    const snapshot = captureStructuredSnapshot({ force: true });
    const raw = snapshot.legacyLines.join('\n');
    const normalized = normalizeTranscript(raw);
    const session = buildSession(normalized);
    if (!session.turns.length) throw new Error('대화 메시지를 찾을 수 없습니다.');
    const userCount = session.turns.filter((turn) => turn.channel === 'user').length;
    const llmCount = session.turns.filter((turn) => turn.channel === 'llm').length;
    const entryCount = session.turns.reduce((sum, turn) => {
      if (Array.isArray(turn?.__gmhEntries)) return sum + turn.__gmhEntries.length;
      return sum + 1;
    }, 0);
    exportRange?.setTotals?.({
      message: session.turns.length,
      user: userCount,
      llm: llmCount,
      entry: entryCount,
    });
    return { session, raw: normalized, snapshot };
  };

  const prepareShare = async ({
    confirmLabel,
    cancelStatusMessage,
    blockedStatusMessage,
  }: PrepareShareOptions = {}): Promise<PreparedShareResult | null> => {
    try {
      setState(stateEnum.REDACTING, 'REDACTING', {
        label: '민감정보 마스킹 중',
        message: '레다크션 파이프라인 적용 중...',
        tone: 'progress',
        progress: { indeterminate: true },
      });
      const { session, raw, snapshot } = parseAll();
      const privacy = applyPrivacyPipeline(session, raw, privacyConfig.profile, snapshot);
      if (privacy.blocked) {
        alertFn(`미성년자 성적 맥락이 감지되어 작업을 중단했습니다.

차단 이유를 확인하려면:
1. F12 키를 눌러 개발자 도구 열기
2. 콘솔(Console) 탭 선택
3. 다음 명령어 입력 후 Enter:
   localStorage.setItem('gmh_debug_blocking', '1')
4. 다시 내보내기/복사 시도
5. 콘솔에서 상세 정보 확인

※ 정당한 교육/상담 내용이 차단되었다면 GitHub Issues로 신고해주세요.
https://github.com/devforai-creator/genit-memory-helper/issues`);
        setState(stateEnum.ERROR, 'ERROR', {
          label: '작업 차단',
          message: blockedStatusMessage || '미성년자 민감 맥락으로 작업이 차단되었습니다.',
          tone: 'error',
          progress: { value: 1 },
        });
        return null;
      }
      const requestedRange = exportRange?.getRange?.() || { start: null, end: null };
      const sanitizedUserCount = privacy.sanitizedSession.turns.filter((turn) => turn.channel === 'user').length;
      const sanitizedLlmCount = privacy.sanitizedSession.turns.filter((turn) => turn.channel === 'llm').length;
      const sanitizedEntryCount = privacy.sanitizedSession.turns.reduce(
        (sum, turn) => sum + (Array.isArray(turn?.__gmhEntries) ? turn.__gmhEntries.length : 1),
        0,
      );
      exportRange?.setTotals?.({
        message: privacy.sanitizedSession.turns.length,
        user: sanitizedUserCount,
        llm: sanitizedLlmCount,
        entry: sanitizedEntryCount,
      });
      if (requestedRange.start || requestedRange.end) {
        exportRange?.setRange?.(requestedRange.start, requestedRange.end);
      }
      const selection: ExportRangeSelection =
        exportRange?.apply?.(privacy.sanitizedSession.turns) || {
          indices: [],
          ordinals: [],
          turns: [],
          rangeDetails: null,
          info: exportRange?.describe?.(privacy.sanitizedSession.turns.length),
        };
      const rangeInfo = selection?.info || exportRange?.describe?.(privacy.sanitizedSession.turns.length);
      const structuredSelection = projectStructuredMessages(privacy.structured, rangeInfo);
      const exportSession = cloneSession(privacy.sanitizedSession) as TranscriptSession;
      const entryOrigin = typeof getEntryOrigin === 'function' ? getEntryOrigin() : [];
      const selectedIndices = selection.indices?.length
        ? selection.indices
        : privacy.sanitizedSession.turns.map((_, idx) => idx);

      const selectedIndexSet = new Set(selectedIndices);

      exportSession.turns = selectedIndices.map((index, localIndex) => {
        const original = privacy.sanitizedSession.turns[index] || {};
        const clone = { ...original } as TranscriptTurn;
        Object.defineProperty(clone, '__gmhIndex', {
          value: index,
          enumerable: false,
        });
        Object.defineProperty(clone, '__gmhOrdinal', {
          value: selection.ordinals?.[localIndex] ?? null,
          enumerable: false,
        });
        Object.defineProperty(clone, '__gmhSourceBlock', {
          value: entryOrigin[index] ?? null,
          enumerable: false,
        });
        return clone;
      });

      exportSession.meta = {
        ...(exportSession.meta || {}),
        selection: {
          active: Boolean(selection.info?.active),
          range: {
            start: selection.info?.start ?? null,
            end: selection.info?.end ?? null,
            count: selection.info?.count ?? null,
            total: selection.info?.total ?? null,
          },
          indices: {
            start: selection.info?.startIndex ?? null,
            end: selection.info?.endIndex ?? null,
          },
        },
      };

      const stats = collectSessionStats(exportSession);
      const overallStats = collectSessionStats(privacy.sanitizedSession);
      const previewTurns = exportSession.turns.slice(-5) as TranscriptTurn[];
      setState(stateEnum.PREVIEW, 'PREVIEW', {
        label: '미리보기 준비 완료',
        message: '레다크션 결과를 검토하세요.',
        tone: 'info',
        progress: { value: 0.75 },
      });

      const ok = await confirmPrivacyGate({
        profile: privacy.profile,
        counts: privacy.counts,
        stats,
        overallStats,
        rangeInfo,
        selectedIndices: Array.from(selectedIndexSet),
        selectedOrdinals: selection.ordinals || [],
        previewTurns,
        actionLabel: confirmLabel || '계속',
      });
      if (!ok) {
        setState(stateEnum.IDLE, 'IDLE', {
          label: '대기 중',
          message: cancelStatusMessage || '작업을 취소했습니다.',
          tone: cancelStatusMessage ? 'muted' : 'info',
          progress: { value: 0 },
        });
        if (cancelStatusMessage) setPanelStatus?.(cancelStatusMessage, 'muted');
        return null;
      }

      return {
        privacy,
        stats,
        overallStats,
        selection,
        rangeInfo,
        exportSession,
        structuredSelection,
      };
    } catch (error) {
      const errorMsg = toErrorMessage(error);
      alertFn(`오류: ${errorMsg}`);
      setState(stateEnum.ERROR, 'ERROR', {
        label: '작업 실패',
        message: '작업 준비 중 오류가 발생했습니다.',
        tone: 'error',
        progress: { value: 1 },
      });
      return null;
    }
  };

  /**
   * Executes the export flow for the selected format.
   *
   * @param {PreparedShareResult | null} prepared
   * @param {string} format
   * @returns {Promise<boolean>}
   */
  const performExport = async (
    prepared: PreparedShareResult | null,
    format: string,
  ): Promise<boolean> => {
    if (!prepared) return false;
    try {
      setState(stateEnum.EXPORTING, 'EXPORTING', {
        label: '내보내기 진행 중',
        message: `${format.toUpperCase()} 내보내기를 준비하는 중입니다...`,
        tone: 'progress',
        progress: { indeterminate: true },
      });
      const {
        privacy,
        stats,
        exportSession,
        selection,
        overallStats,
        structuredSelection,
        rangeInfo: preparedRangeInfo,
      } = prepared;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const sessionForExport = exportSession || privacy.sanitizedSession;
      const rangeInfo = preparedRangeInfo || selection?.info || exportRange?.describe?.();
      const hasCustomRange = Boolean(rangeInfo?.active);
      const selectionRaw = hasCustomRange
        ? sessionForExport.turns
            .map((turn) => {
              const label = turn.role === 'narration' ? '내레이션' : turn.speaker || turn.role || '메시지';
              return `${label}: ${turn.text}`;
            })
            .join('\n')
        : privacy.sanitizedRaw;
      const bundleOptions = {
        structuredSelection,
        structuredSnapshot: privacy.structured,
        profile: privacy.profile,
        playerNames: privacy.playerNames,
        rangeInfo,
      };
      let targetFormat = format;
      let bundle;
      let structuredFallback = false;
      try {
        bundle = buildExportBundle(sessionForExport, selectionRaw, targetFormat, stamp, bundleOptions);
      } catch (error) {
        if (
          targetFormat === 'structured-json' ||
          targetFormat === 'structured-md' ||
          targetFormat === 'structured-txt'
        ) {
          logger?.warn?.('[GMH] structured export failed, falling back', error);
          structuredFallback = true;
          if (targetFormat === 'structured-json') targetFormat = 'json';
          else if (targetFormat === 'structured-md') targetFormat = 'md';
          else targetFormat = 'txt';
          bundle = buildExportBundle(sessionForExport, selectionRaw, targetFormat, stamp, bundleOptions);
        } else {
          throw error;
        }
      }
      const fileBlob = new Blob([bundle.content], { type: bundle.mime });
      triggerDownload(fileBlob, bundle.filename);

      const manifest = buildExportManifest({
        profile: privacy.profile,
        counts: { ...privacy.counts },
        stats,
        overallStats: overallStats ?? undefined,
        format: targetFormat,
        warnings: privacy.sanitizedSession.warnings,
        source: privacy.sanitizedSession.source,
        range: sessionForExport.meta?.selection || rangeInfo,
      });
      const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], {
        type: 'application/json',
      });
      const manifestName = `${bundle.filename.replace(/\.[^.]+$/, '')}.manifest.json`;
      triggerDownload(manifestBlob, manifestName);

      const summary = formatRedactionCounts(privacy.counts);
      const profileLabel = privacyProfiles[privacy.profile]?.label || privacy.profile;
      const messageTotalAvailable =
        rangeInfo?.messageTotal ?? sessionForExport.turns.length;
      const userTotalAvailable =
        rangeInfo?.userTotal ?? overallStats?.userMessages ?? stats.userMessages;
      const llmTotalAvailable =
        rangeInfo?.llmTotal ?? overallStats?.llmMessages ?? stats.llmMessages;
      let rangeNote: string;
      if (hasCustomRange && rangeInfo) {
        const startLabel = rangeInfo.start ?? '?';
        const endLabel = rangeInfo.end ?? '?';
        const totalLabel = rangeInfo.total ?? '?';
        rangeNote = ` · (선택) 메시지 ${startLabel}-${endLabel}/${totalLabel}`;
      } else {
        rangeNote = ` · 전체 메시지 ${messageTotalAvailable}개`;
      }
      if (Number.isFinite(userTotalAvailable)) {
        rangeNote += ` · 유저 ${stats.userMessages}개`;
      }
      if (Number.isFinite(llmTotalAvailable)) {
        rangeNote += ` · LLM ${stats.llmMessages}개`;
      }
      const message = `${targetFormat.toUpperCase()} 내보내기 완료${rangeNote} · ${profileLabel} · ${summary}`;
      setState(stateEnum.DONE, 'DONE', {
        label: '내보내기 완료',
        message,
        tone: 'success',
        progress: { value: 1 },
      });
      if (structuredFallback) {
        setPanelStatus?.('구조 보존 내보내기에 실패하여 Classic 포맷으로 전환했습니다.', 'warning');
      }
      if (privacy.sanitizedSession.warnings.length) {
        logger?.warn?.('[GMH] warnings:', privacy.sanitizedSession.warnings);
      }
      return true;
    } catch (error) {
      const errorMsg = toErrorMessage(error);
      alertFn(`오류: ${errorMsg}`);
      setState(stateEnum.ERROR, 'ERROR', {
        label: '내보내기 실패',
        message: '내보내기 실패',
        tone: 'error',
        progress: { value: 1 },
      });
      return false;
    }
  };

  /**
   * Copies the last 15 sanitized turns to the clipboard.
   *
   * @param {ShareWorkflowApi['prepareShare']} prepareShareFn
   * @returns {Promise<void>}
   */
  const copyRecent = async (prepareShareFn: ShareWorkflowApi['prepareShare']): Promise<void> => {
    const prepared = await prepareShareFn({
      confirmLabel: '복사 계속',
      cancelStatusMessage: '복사를 취소했습니다.',
      blockedStatusMessage: '미성년자 민감 맥락으로 복사가 차단되었습니다.',
    });
    if (!prepared) return;
    try {
      setState(stateEnum.EXPORTING, 'EXPORTING', {
        label: '복사 진행 중',
        message: '최근 15메시지를 복사하는 중입니다...',
        tone: 'progress',
        progress: { indeterminate: true },
      });
      const { privacy, overallStats, stats } = prepared;
      const effectiveStats = overallStats || stats;
      const turns = privacy.sanitizedSession.turns.slice(-15);
      const md = toMarkdownExport(privacy.sanitizedSession, {
        turns,
        includeMeta: false,
        heading: '## 최근 15메시지',
      });
      clipboard.set(md, { type: 'text', mimetype: 'text/plain' });
      const summary = formatRedactionCounts(privacy.counts);
      const profileLabel = privacyProfiles[privacy.profile]?.label || privacy.profile;
      const message = `최근 15메시지 복사 완료 · 유저 ${effectiveStats.userMessages}개 · LLM ${effectiveStats.llmMessages}개 · ${profileLabel} · ${summary}`;
      setState(stateEnum.DONE, 'DONE', {
        label: '복사 완료',
        message,
        tone: 'success',
        progress: { value: 1 },
      });
      if (privacy.sanitizedSession.warnings.length) {
        logger?.warn?.('[GMH] warnings:', privacy.sanitizedSession.warnings);
      }
    } catch (error) {
      const errorMsg = toErrorMessage(error);
      alertFn(`오류: ${errorMsg}`);
      setState(stateEnum.ERROR, 'ERROR', {
        label: '복사 실패',
        message: '복사 실패',
        tone: 'error',
        progress: { value: 1 },
      });
    }
  };

  /**
   * Copies the full sanitized transcript to the clipboard.
   *
   * @param {ShareWorkflowApi['prepareShare']} prepareShareFn
   * @returns {Promise<void>}
   */
  const copyAll = async (prepareShareFn: ShareWorkflowApi['prepareShare']): Promise<void> => {
    const prepared = await prepareShareFn({
      confirmLabel: '복사 계속',
      cancelStatusMessage: '복사를 취소했습니다.',
      blockedStatusMessage: '미성년자 민감 맥락으로 복사가 차단되었습니다.',
    });
    if (!prepared) return;
    try {
      setState(stateEnum.EXPORTING, 'EXPORTING', {
        label: '복사 진행 중',
        message: '전체 Markdown을 복사하는 중입니다...',
        tone: 'progress',
        progress: { indeterminate: true },
      });
      const { privacy, overallStats, stats } = prepared;
      const effectiveStats = overallStats || stats;
      const md = toMarkdownExport(privacy.sanitizedSession);
      clipboard.set(md, { type: 'text', mimetype: 'text/plain' });
      const summary = formatRedactionCounts(privacy.counts);
      const profileLabel = privacyProfiles[privacy.profile]?.label || privacy.profile;
      const message = `전체 Markdown 복사 완료 · 유저 ${effectiveStats.userMessages}개 · LLM ${effectiveStats.llmMessages}개 · ${profileLabel} · ${summary}`;
      setState(stateEnum.DONE, 'DONE', {
        label: '복사 완료',
        message,
        tone: 'success',
        progress: { value: 1 },
      });
      if (privacy.sanitizedSession.warnings.length) {
        logger?.warn?.('[GMH] warnings:', privacy.sanitizedSession.warnings);
      }
    } catch (error) {
      const errorMsg = toErrorMessage(error);
      alertFn(`오류: ${errorMsg}`);
      setState(stateEnum.ERROR, 'ERROR', {
        label: '복사 실패',
        message: '복사 실패',
        tone: 'error',
        progress: { value: 1 },
      });
    }
  };

  /**
   * Forces a reparse cycle to refresh sanitized stats without exporting.
   */
  const reparse = (): void => {
    try {
      setState(stateEnum.REDACTING, 'REDACTING', {
        label: '재파싱 중',
        message: '대화 로그를 다시 분석하는 중입니다...',
        tone: 'progress',
        progress: { indeterminate: true },
      });
      const { session, raw, snapshot } = parseAll();
      const privacy = applyPrivacyPipeline(session, raw, privacyConfig.profile, snapshot);
      const stats = collectSessionStats(privacy.sanitizedSession);
      const summary = formatRedactionCounts(privacy.counts);
      const profileLabel = privacyProfiles[privacy.profile]?.label || privacy.profile;
      const extra = privacy.blocked ? ' · ⚠️ 미성년자 맥락 감지' : '';
      const message = `재파싱 완료 · 유저 ${stats.userMessages}개 · LLM ${stats.llmMessages}개 · 경고 ${
        privacy.sanitizedSession.warnings.length
      }건 · ${profileLabel} · ${summary}${extra}`;
      setState(stateEnum.DONE, 'DONE', {
        label: '재파싱 완료',
        message,
        tone: 'info',
        progress: { value: 1 },
      });
      if (privacy.sanitizedSession.warnings.length) {
        logger?.warn?.('[GMH] warnings:', privacy.sanitizedSession.warnings);
      }
    } catch (error) {
      const errorMsg = toErrorMessage(error);
      alertFn(`오류: ${errorMsg}`);
    }
  };

  return {
    parseAll,
    prepareShare,
    performExport,
    copyRecent,
    copyAll,
    reparse,
  };
}
