/**
 * Connects panel buttons, share workflow actions, and keyboard shortcuts.
 *
 * @typedef {import('../../types/api').PanelInteractionsOptions} PanelInteractionsOptions
 * @returns {{ bindPanelInteractions: (panel: Element | null, options?: { modern?: boolean }) => void; syncPrivacyProfileSelect: (profileKey?: string | null) => void }}
 */
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
  alert: alertFn = (message) => globalThis.alert?.(message),
  logger = typeof console !== 'undefined' ? console : null,
} = /** @type {PanelInteractionsOptions} */ ({})) {
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

  /** @type {HTMLSelectElement | null} */
  let privacySelect = null;

  /**
   * @param {string | null | undefined} [profileKey]
   * @returns {void}
   */
  const syncPrivacyProfileSelect = (profileKey) => {
    if (!privacySelect) return;
    const nextValue = profileKey ?? getPrivacyProfile?.();
    if (typeof nextValue === 'string' && privacySelect.value !== nextValue) {
      privacySelect.value = nextValue;
    }
  };

  /**
   * @param {string} message
   * @param {string} [tone]
   */
  const notify = (message, tone) => {
    if (typeof setPanelStatus === 'function' && message) {
      setPanelStatus(message, tone);
    }
  };

  /**
   * @param {Element | null} panel
   * @param {{ modern?: boolean }} [options]
   */
  const attachShareHandlers = (panel, { modern = false } = {}) => {
    /** @type {HTMLSelectElement | null} */
    const exportFormatSelect = panel.querySelector('#gmh-export-format');
    /** @type {HTMLButtonElement | null} */
    const quickExportBtn = panel.querySelector('#gmh-quick-export');

    /**
     * @param {{ confirmLabel?: string; cancelStatusMessage?: string; blockedStatusMessage?: string }} [options]
     * @returns {ReturnType<PanelInteractionsOptions['prepareShare']>}
     */
    const prepareShareWithDialog = (options = {}) =>
      prepareShare({
        confirmLabel: options.confirmLabel,
        cancelStatusMessage: options.cancelStatusMessage,
        blockedStatusMessage: options.blockedStatusMessage,
      });

    /**
     * @param {string} format
     * @param {{ confirmLabel?: string; cancelStatusMessage?: string; blockedStatusMessage?: string }} [options]
     * @returns {Promise<void>}
     */
    const exportWithFormat = async (format, options = {}) => {
      const prepared = await prepareShareWithDialog(options);
      if (!prepared) return;
      await performExport(prepared, format);
    };

    /**
     * @returns {ReturnType<PanelInteractionsOptions['copyRecentShare']>}
     */
    const copyRecent = () => copyRecentShare(prepareShareWithDialog);
    /**
     * @returns {ReturnType<PanelInteractionsOptions['copyAllShare']>}
     */
    const copyAll = () => copyAllShare(prepareShareWithDialog);

    /** @type {HTMLButtonElement | null} */
    const copyRecentBtn = panel.querySelector('#gmh-copy-recent');
    if (copyRecentBtn) {
      copyRecentBtn.onclick = () => copyRecent();
    }

    /** @type {HTMLButtonElement | null} */
    const copyAllBtn = panel.querySelector('#gmh-copy-all');
    if (copyAllBtn) {
      copyAllBtn.onclick = () => copyAll();
    }

    /** @type {HTMLButtonElement | null} */
    const exportBtn = panel.querySelector('#gmh-export');
    if (exportBtn) {
      exportBtn.onclick = async () => {
        const format = exportFormatSelect?.value || 'json';
        await exportWithFormat(format, {
          confirmLabel: '내보내기 진행',
          cancelStatusMessage: '내보내기를 취소했습니다.',
          blockedStatusMessage: '미성년자 민감 맥락으로 내보내기가 차단되었습니다.',
        });
      };
    }

    if (quickExportBtn) {
      quickExportBtn.onclick = async () => {
        if (autoState?.running) {
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
          await autoLoader?.start?.('all');
          const format = exportFormatSelect?.value || 'json';
          await exportWithFormat(format, {
            confirmLabel: `${format.toUpperCase()} 내보내기`,
            cancelStatusMessage: '내보내기를 취소했습니다.',
            blockedStatusMessage: '미성년자 민감 맥락으로 내보내기가 차단되었습니다.',
          });
        } catch (error) {
          alertFn?.(`오류: ${(error && error.message) || error}`);
          stateApi.setState(stateEnum.ERROR, {
            label: '원클릭 실패',
            message: '원클릭 내보내기 실패',
            tone: 'error',
            progress: { value: 1 },
          });
        } finally {
          quickExportBtn.disabled = false;
          quickExportBtn.textContent = originalText;
        }
      };
    }
  };

  /**
   * @param {Element | null} panel
   * @param {{ modern?: boolean }} [options]
   * @returns {void}
   */
  const bindPanelInteractions = (panel, { modern = false } = {}) => {
    if (!panel || typeof panel.querySelector !== 'function') {
      if (logger?.warn) {
        logger.warn('[GMH] panel interactions: invalid panel element');
      }
      return;
    }

    panelVisibility.bind(panel, { modern });

    privacySelect = /** @type {HTMLSelectElement | null} */ (panel.querySelector('#gmh-privacy-profile'));
    if (privacySelect) {
      syncPrivacyProfileSelect();
      privacySelect.onchange = (event) => {
        const value = /** @type {HTMLSelectElement} */ (event.target).value;
        setPrivacyProfile(value);
        const label = privacyProfiles?.[value]?.label || value;
        notify(`프라이버시 프로필이 ${label}로 설정되었습니다.`, 'info');
      };
    }

    /** @type {HTMLButtonElement | null} */
    const privacyConfigBtn = panel.querySelector('#gmh-privacy-config');
    if (privacyConfigBtn) {
      privacyConfigBtn.onclick = () => configurePrivacyLists?.();
    }

    /** @type {HTMLButtonElement | null} */
    const settingsBtn = panel.querySelector('#gmh-panel-settings');
    if (settingsBtn) {
      settingsBtn.onclick = () => openPanelSettings?.();
    }

    if (modern) {
      ensureAutoLoadControlsModern?.(panel);
      mountStatusActionsModern?.(panel);
    } else {
      ensureAutoLoadControlsLegacy?.(panel);
      mountStatusActionsLegacy?.(panel);
    }

    bindRangeControls(panel);
    bindShortcuts(panel, { modern });
    bindGuideControls?.(panel);

    attachShareHandlers(panel, { modern });
  };

  return {
    bindPanelInteractions,
    syncPrivacyProfileSelect,
  };
}

export default createPanelInteractions;
