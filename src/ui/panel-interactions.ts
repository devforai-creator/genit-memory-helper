import type { PanelInteractionsOptions, StructuredSnapshot } from '../types';
import { exportFromStructuredData, downloadHtml } from '../features/html-export';
import { GMH } from '../core/namespace';

type ShareDialogOptions = {
  confirmLabel?: string;
  cancelStatusMessage?: string;
  blockedStatusMessage?: string;
};

const DEFAULT_ALERT = (message: string) => {
  globalThis.alert?.(message);
};

export function createPanelInteractions({
  panelVisibility,
  setPanelStatus,
  setPrivacyProfile,
  getPrivacyProfile,
  privacyProfiles,
  configurePrivacyLists,
  openPanelSettings,
  ensureAutoLoadControlsModern,
  mountStatusActionsModern,
  mountMemoryStatusModern,
  bindRangeControls,
  bindShortcuts,
  prepareShare,
  performExport,
  autoLoader,
  autoState,
  stateApi,
  stateEnum,
  alert: alertFn = DEFAULT_ALERT,
  logger = typeof console !== 'undefined' ? console : null,
}: PanelInteractionsOptions): {
  bindPanelInteractions: (panel: Element | null) => void;
  syncPrivacyProfileSelect: (profileKey?: string | null) => void;
} {
  if (!panelVisibility) throw new Error('createPanelInteractions requires panelVisibility');
  if (!setPrivacyProfile) throw new Error('createPanelInteractions requires setPrivacyProfile');
  if (!bindRangeControls) throw new Error('createPanelInteractions requires bindRangeControls');
  if (!bindShortcuts) throw new Error('createPanelInteractions requires bindShortcuts');
  if (!prepareShare || !performExport) {
    throw new Error('createPanelInteractions requires share workflow helpers');
  }
  if (!stateApi || !stateEnum) {
    throw new Error('createPanelInteractions requires state helpers');
  }

  let privacySelect: HTMLSelectElement | null = null;

  const notify = (message: string, tone?: string | null) => {
    if (typeof setPanelStatus === 'function' && message) {
      setPanelStatus(message, tone);
    }
  };

  const syncPrivacyProfileSelect = (profileKey?: string | null): void => {
    if (!privacySelect) return;
    const nextValue = profileKey ?? getPrivacyProfile?.();
    if (typeof nextValue === 'string' && privacySelect.value !== nextValue) {
      privacySelect.value = nextValue;
    }
  };

  const prepareShareWithDialog: PanelInteractionsOptions['prepareShare'] = (options) =>
    prepareShare({
      confirmLabel: options?.confirmLabel,
      cancelStatusMessage: options?.cancelStatusMessage,
      blockedStatusMessage: options?.blockedStatusMessage,
    });

  const exportWithFormat = async (
    format: string,
    options: ShareDialogOptions = {},
  ): Promise<void> => {
    const prepared = await prepareShareWithDialog({
      confirmLabel: options.confirmLabel,
      cancelStatusMessage: options.cancelStatusMessage,
      blockedStatusMessage: options.blockedStatusMessage,
    });
    if (!prepared) return;
    await performExport(prepared, format);
  };

  const attachShareHandlers = (panel: Element): void => {
    const exportFormatSelect = panel.querySelector<HTMLSelectElement>('#gmh-export-format');

    const exportBtn = panel.querySelector<HTMLButtonElement>('#gmh-export');
    exportBtn?.addEventListener('click', async () => {
      const format = exportFormatSelect?.value || 'json';
      await exportWithFormat(format, {
        confirmLabel: '내보내기 진행',
        cancelStatusMessage: '내보내기를 취소했습니다.',
        blockedStatusMessage: '미성년자 민감 맥락으로 내보내기가 차단되었습니다.',
      });
    });

    // HTML export button handler
    const htmlExportBtn = panel.querySelector<HTMLButtonElement>('#gmh-export-html');
    if (htmlExportBtn) {
      htmlExportBtn.addEventListener('click', async () => {
        const originalText = htmlExportBtn.textContent;
        htmlExportBtn.disabled = true;
        htmlExportBtn.textContent = '이미지 변환 중...';

        try {
          // Access captureStructuredSnapshot from GMH.Core namespace
          const captureStructuredSnapshot = (GMH.Core as Record<string, unknown>)?.captureStructuredSnapshot as
            | (() => StructuredSnapshot)
            | undefined;

          if (typeof captureStructuredSnapshot !== 'function') {
            throw new Error('captureStructuredSnapshot not available');
          }

          notify('HTML 백업 생성 중... (이미지 변환에 시간이 걸릴 수 있습니다)', 'progress');

          const snapshot = captureStructuredSnapshot();
          const result = await exportFromStructuredData(snapshot, {
            title: document.title || 'Chat Backup',
            includeImages: true,
          });

          if (result.success && result.html) {
            const timestamp = new Date().toISOString().slice(0, 10);
            const filename = `chat-backup-${timestamp}.html`;
            downloadHtml(result.html, filename);
            notify(`HTML 백업 완료: ${result.stats?.capturedImages || 0}개 이미지 포함`, 'success');
          } else {
            throw new Error(result.error || 'HTML 생성 실패');
          }
        } catch (error) {
          const message =
            error && typeof error === 'object' && 'message' in error
              ? String((error as Error).message)
              : String(error);
          notify(`HTML 백업 실패: ${message}`, 'error');
          logger?.warn?.('[GMH] HTML export failed:', error);
        } finally {
          htmlExportBtn.disabled = false;
          htmlExportBtn.textContent = originalText ?? '';
        }
      });
    }
  };

  const bindPanelInteractions = (panel: Element | null): void => {
    if (!panel || typeof panel.querySelector !== 'function') {
      logger?.warn?.('[GMH] panel interactions: invalid panel element');
      return;
    }

    panelVisibility.bind(panel);

    privacySelect = panel.querySelector<HTMLSelectElement>('#gmh-privacy-profile');
    if (privacySelect) {
      syncPrivacyProfileSelect();
      privacySelect.addEventListener('change', (event) => {
        const value = (event.target as HTMLSelectElement).value;
        setPrivacyProfile(value);
        const label = privacyProfiles?.[value]?.label || value;
        notify(`프라이버시 프로필이 ${label}로 설정되었습니다.`, 'info');
      });
    }

    const privacyConfigBtn = panel.querySelector<HTMLButtonElement>('#gmh-privacy-config');
    privacyConfigBtn?.addEventListener('click', () => {
      void configurePrivacyLists?.();
    });

    const settingsBtn = panel.querySelector<HTMLButtonElement>('#gmh-panel-settings');
    settingsBtn?.addEventListener('click', () => {
      openPanelSettings?.();
    });

    mountMemoryStatusModern?.(panel);
    ensureAutoLoadControlsModern?.(panel);
    mountStatusActionsModern?.(panel);

    bindRangeControls(panel);
    bindShortcuts(panel);
    attachShareHandlers(panel);
  };

  return {
    bindPanelInteractions,
    syncPrivacyProfileSelect,
  };
}

export default createPanelInteractions;
