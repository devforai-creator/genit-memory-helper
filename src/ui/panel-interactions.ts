import type { PanelInteractionsOptions } from '../types';

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
  ensureAutoLoadControlsLegacy,
  mountStatusActionsModern,
  mountStatusActionsLegacy,
  mountMemoryStatusModern,
  bindRangeControls,
  bindShortcuts,
  bindGuideControls,
  prepareShare,
  performExport,
  copyRecentShare,
  copyAllShare,
  autoLoader,
  autoState,
  stateApi,
  stateEnum,
  alert: alertFn = DEFAULT_ALERT,
  logger = typeof console !== 'undefined' ? console : null,
}: PanelInteractionsOptions): {
  bindPanelInteractions: (panel: Element | null, options?: { modern?: boolean }) => void;
  syncPrivacyProfileSelect: (profileKey?: string | null) => void;
} {
  if (!panelVisibility) throw new Error('createPanelInteractions requires panelVisibility');
  if (!setPrivacyProfile) throw new Error('createPanelInteractions requires setPrivacyProfile');
  if (!bindRangeControls) throw new Error('createPanelInteractions requires bindRangeControls');
  if (!bindShortcuts) throw new Error('createPanelInteractions requires bindShortcuts');
  if (!prepareShare || !performExport || !copyRecentShare || !copyAllShare) {
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

  const copyRecent = () => copyRecentShare(prepareShareWithDialog);
  const copyAll = () => copyAllShare(prepareShareWithDialog);

  const isAutoRunning = () => Boolean(autoState?.running);

  const attachShareHandlers = (panel: Element, modern = false): void => {
    const exportFormatSelect = panel.querySelector<HTMLSelectElement>('#gmh-export-format');
    const quickExportBtn = panel.querySelector<HTMLButtonElement>('#gmh-quick-export');

    const copyRecentBtn = panel.querySelector<HTMLButtonElement>('#gmh-copy-recent');
    copyRecentBtn?.addEventListener('click', () => void copyRecent());

    const copyAllBtn = panel.querySelector<HTMLButtonElement>('#gmh-copy-all');
    copyAllBtn?.addEventListener('click', () => void copyAll());

    const exportBtn = panel.querySelector<HTMLButtonElement>('#gmh-export');
    exportBtn?.addEventListener('click', async () => {
      const format = exportFormatSelect?.value || 'json';
      await exportWithFormat(format, {
        confirmLabel: '내보내기 진행',
        cancelStatusMessage: '내보내기를 취소했습니다.',
        blockedStatusMessage: '미성년자 민감 맥락으로 내보내기가 차단되었습니다.',
      });
    });

    if (quickExportBtn) {
      quickExportBtn.addEventListener('click', async () => {
        if (!autoLoader || typeof autoLoader.start !== 'function') {
          notify('자동 로더 기능을 사용할 수 없습니다.', 'warning');
          return;
        }
        if (isAutoRunning()) {
          notify('이미 자동 로딩이 진행 중입니다.', 'muted');
          return;
        }
        const originalText = quickExportBtn.textContent;
        quickExportBtn.disabled = true;
        quickExportBtn.textContent = '진행 중...';
        try {
          stateApi.setState(stateEnum.SCANNING, {
            label: '원클릭 내보내기',
            message: '전체 로딩 중...',
            tone: 'progress',
            progress: { indeterminate: true },
          });
          await autoLoader.start('all');
          const format = exportFormatSelect?.value || 'json';
          await exportWithFormat(format, {
            confirmLabel: `${format.toUpperCase()} 내보내기`,
            cancelStatusMessage: '내보내기를 취소했습니다.',
            blockedStatusMessage: '미성년자 민감 맥락으로 내보내기가 차단되었습니다.',
          });
        } catch (error) {
          const message =
            error && typeof error === 'object' && 'message' in error
              ? String((error as Error).message)
              : String(error);
          alertFn?.(`오류: ${message}`);
          stateApi.setState(stateEnum.ERROR, {
            label: '원클릭 실패',
            message: '원클릭 내보내기 실패',
            tone: 'error',
            progress: { value: 1 },
          });
        } finally {
          quickExportBtn.disabled = false;
          quickExportBtn.textContent = originalText ?? '';
        }
      });
    }
  };

  const bindPanelInteractions = (panel: Element | null, { modern = false } = {}): void => {
    if (!panel || typeof panel.querySelector !== 'function') {
      logger?.warn?.('[GMH] panel interactions: invalid panel element');
      return;
    }

    panelVisibility.bind(panel, { modern });

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

    if (modern) {
      mountMemoryStatusModern?.(panel);
      ensureAutoLoadControlsModern?.(panel);
      mountStatusActionsModern?.(panel);
    } else {
      ensureAutoLoadControlsLegacy?.(panel);
      mountStatusActionsLegacy?.(panel);
    }

    bindRangeControls(panel);
    bindShortcuts(panel, { modern });
    bindGuideControls?.(panel);
    attachShareHandlers(panel, modern);
  };

  return {
    bindPanelInteractions,
    syncPrivacyProfileSelect,
  };
}

export default createPanelInteractions;
