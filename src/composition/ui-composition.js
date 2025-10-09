import { createModal } from '../ui/modal.ts';
import { createPanelVisibility } from '../ui/panel-visibility.ts';
import { createStatusManager } from '../ui/status-manager.ts';
import { createStateView } from '../ui/state-view.ts';
import { createPrivacyConfigurator } from '../ui/privacy-config.ts';
import { createPanelSettingsController } from '../ui/panel-settings-modal.ts';

/**
 * Composes core UI helpers (modal, panel visibility, status view, privacy controls).
 *
 * @param {object} options - Dependency container.
 * @param {typeof import('../core/namespace.ts').GMH} options.GMH - Global namespace reference.
 * @param {Document} options.documentRef - Document handle.
 * @param {Window} options.windowRef - Window handle.
 * @param {object} options.PanelSettings - Panel settings API.
 * @param {object} options.stateManager - State manager instance.
 * @param {object} options.stateEnum - State enum map.
 * @param {object} options.ENV - Environment shims (console/storage).
 * @param {object} options.privacyConfig - Active privacy configuration object.
 * @param {object} options.privacyProfiles - Privacy profile definitions.
 * @param {Function} options.setCustomList - Setter for custom privacy lists.
 * @param {Function} options.parseListInput - Parser for list inputs.
 * @param {Function} options.isModernUIActive - Getter returning whether modern UI is enabled.
 * @returns {object} Composed UI helpers.
 */
export function composeUI({
  GMH,
  documentRef,
  windowRef,
  PanelSettings,
  stateManager,
  stateEnum,
  ENV,
  privacyConfig,
  privacyProfiles,
  setCustomList,
  parseListInput,
  isModernUIActive,
}) {
  const modal = createModal({ documentRef, windowRef });
  GMH.UI.Modal = modal;

  const panelVisibility = createPanelVisibility({
    panelSettings: PanelSettings,
    stateEnum,
    stateApi: stateManager,
    modal,
    documentRef,
    windowRef,
    storage: ENV.localStorage,
    logger: ENV.console,
  });

  const statusManager = createStatusManager({ panelVisibility });
  const { setStatus: setPanelStatus, attachStatusElement } = statusManager;

  const stateView = createStateView({
    stateApi: stateManager,
    statusManager,
    stateEnum,
  });
  GMH.UI.StateView = stateView;

  const { configurePrivacyLists } = createPrivacyConfigurator({
    privacyConfig,
    setCustomList,
    parseListInput,
    setPanelStatus,
    modal,
    isModernUIActive,
    documentRef,
    windowRef,
  });

  const { openPanelSettings } = createPanelSettingsController({
    panelSettings: PanelSettings,
    modal,
    setPanelStatus,
    configurePrivacyLists,
    documentRef,
  });

  return {
    modal,
    panelVisibility,
    statusManager,
    setPanelStatus,
    attachStatusElement,
    stateView,
    configurePrivacyLists,
    openPanelSettings,
  };
}

export default composeUI;
