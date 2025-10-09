import { createModal } from '../ui/modal';
import { createPanelVisibility } from '../ui/panel-visibility';
import { createStatusManager } from '../ui/status-manager';
import { createStateView } from '../ui/state-view';
import { createPrivacyConfigurator } from '../ui/privacy-config';
import { createPanelSettingsController } from '../ui/panel-settings-modal';

import type {
  GMHNamespace,
  PanelSettingsController,
  PanelStateApi,
  PanelVisibilityController,
} from '../types';

type ConsoleLike = Console | { warn?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void; log?: (...args: unknown[]) => void } | null;

interface ComposeUIEnv {
  console?: ConsoleLike;
  localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

interface ComposeUIOptions {
  GMH: GMHNamespace;
  documentRef: Document;
  windowRef: Window & typeof globalThis;
  PanelSettings: PanelSettingsController;
  stateManager: PanelStateApi;
  stateEnum: Record<string, string>;
  ENV: ComposeUIEnv;
  privacyConfig: { blacklist?: string[]; whitelist?: string[]; [key: string]: unknown };
  privacyProfiles?: Record<string, { label?: string; [key: string]: unknown }>;
  setCustomList(type: string, values: string[]): void;
  parseListInput(value: string): string[];
  isModernUIActive(): boolean;
}

type ComposeUIResult = {
  modal: ReturnType<typeof createModal>;
  panelVisibility: PanelVisibilityController;
  statusManager: ReturnType<typeof createStatusManager>;
  setPanelStatus: ReturnType<typeof createStatusManager>['setStatus'];
  attachStatusElement: ReturnType<typeof createStatusManager>['attachStatusElement'];
  stateView: ReturnType<typeof createStateView>;
  configurePrivacyLists: ReturnType<typeof createPrivacyConfigurator>['configurePrivacyLists'];
  openPanelSettings: () => Promise<void>;
};

/**
 * Composes core UI helpers (modal, panel visibility, status view, privacy controls).
 *
 * @param options Dependency container.
 * @returns Composed UI helpers.
 */
export const composeUI = ({
  GMH,
  documentRef,
  windowRef,
  PanelSettings,
  stateManager,
  stateEnum,
  ENV,
  privacyConfig,
  privacyProfiles: _privacyProfiles,
  setCustomList,
  parseListInput,
  isModernUIActive,
}: ComposeUIOptions): ComposeUIResult => {
  const modal = createModal({ documentRef, windowRef });
  (GMH.UI as Record<string, unknown>).Modal = modal;

  const panelVisibility = createPanelVisibility({
    panelSettings: PanelSettings,
    stateEnum,
    stateApi: stateManager,
    modal,
    documentRef,
    windowRef,
    storage: ENV.localStorage ?? null,
    logger: ENV.console ?? null,
  });

  const statusManager = createStatusManager({ panelVisibility });
  const { setStatus: setPanelStatus, attachStatusElement } = statusManager;

  const stateView = createStateView({
    stateApi: stateManager,
    statusManager,
    stateEnum,
  });
  (GMH.UI as Record<string, unknown>).StateView = stateView;

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
};

export default composeUI;
