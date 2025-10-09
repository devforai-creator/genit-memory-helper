import { GMH } from './core/namespace';
import { clone, deepMerge } from './core/utils';
import { ENV } from './env';
import { GMH_STATE, createStateManager } from './core/state';
import { createErrorHandler } from './core/error-handler';
import { createExportRange } from './core/export-range';
import { createTurnBookmarks } from './core/turn-bookmarks';
import { createMessageIndexer } from './core/message-indexer';
import { createBookmarkListener } from './core/bookmark-listener';
import {
  adapterRegistry,
  registerAdapterConfig,
  getAdapterSelectors,
  getAdapterMetadata,
  listAdapterNames,
  createGenitAdapter,
} from './adapters/index';
import {
  PRIVACY_PROFILES,
  DEFAULT_PRIVACY_PROFILE,
  createPrivacyStore,
  escapeForRegex,
  redactText as privacyRedactText,
  hasMinorSexualContext,
  formatRedactionCounts,
  createPrivacyPipeline,
} from './privacy/index';
import {
  toJSONExport,
  toTXTExport,
  toMarkdownExport,
  toStructuredMarkdown,
  toStructuredJSON,
  toStructuredTXT,
  buildExportBundle as buildExportBundleStandalone,
  buildExportManifest as buildExportManifestStandalone,
  PLAYER_MARK,
  PLAYER_NAME_FALLBACKS,
  setPlayerNames,
  getPlayerNames,
  setEntryOriginProvider,
  normalizeTranscript,
  parseTurns,
  deriveMeta,
  buildSession,
} from './export/index';
import {
  normNL,
  stripTicks,
  collapseSpaces,
  stripQuotes,
  stripBrackets,
  sanitizeText,
  parseListInput,
} from './utils/text';
import { sleep, triggerDownload, isScrollable } from './utils/dom';
import { luhnValid } from './utils/validation';
import { withPlayerNames } from './utils/factories';
import { ensureLegacyPreviewStyles, ensureDesignSystemStyles } from './ui/styles';
import { createPanelSettings } from './ui/panel-settings';
import { createSnapshotFeature, createStructuredSnapshotReader } from './features/snapshot';
import { createAutoLoader } from './features/auto-loader';
import { createAutoLoaderControls } from './ui/auto-loader-controls';
import { createRangeControls } from './ui/range-controls';
import { createPanelShortcuts } from './ui/panel-shortcuts';
import { createShareWorkflow } from './features/share';
import { createPanelInteractions } from './ui/panel-interactions';
import { createModernPanel } from './ui/panel-modern';
import { createLegacyPanel } from './ui/panel-legacy';
import { createLegacyPrivacyGate, createModernPrivacyGate } from './ui/privacy-gate';
import { createGuidePrompts } from './features/guides';
import { createGuideControls } from './ui/guide-controls';
import { composeAdapters } from './composition/adapter-composition';
import { composePrivacy } from './composition/privacy-composition';
import { composeShareWorkflow } from './composition/share-composition';
import { composeUI } from './composition/ui-composition';
import { setupBootstrap } from './composition/bootstrap';
import { CONFIG } from './config';
import type {
  ClassicJSONExportOptions,
  ErrorHandler,
  ExportBundleOptions,
  ExportBundleResult,
  ExportManifest,
  ExportManifestOptions,
  PanelSettingsValue,
  ShareWorkflowOptions,
  StructuredJSONOptions,
  StructuredMarkdownOptions,
  StructuredTXTOptions,
  TranscriptSession,
} from './types';

type PageWindow = (Window & typeof globalThis) & {
  __GMHBookmarkListener?: unknown;
  __GMHTest?: {
    runPrivacyCheck: (rawText: string, profileKey?: string) => unknown;
    profiles: typeof PRIVACY_PROFILES;
    formatCounts: typeof formatRedactionCounts;
  };
  GMH?: typeof GMH;
  [key: string]: unknown;
};

interface GMHFlags {
  newUI: boolean;
  killSwitch: boolean;
  betaQuery: boolean;
  [key: string]: boolean;
}

(function () {
  'use strict';

  const { unsafeWindow: unsafeGlobalWindow } = globalThis as typeof globalThis & {
    unsafeWindow?: Window & typeof globalThis;
  };
  const fallbackWindow =
    typeof window !== 'undefined' ? (window as Window & typeof globalThis) : undefined;
  const PAGE_WINDOW = (ENV.window ??
    unsafeGlobalWindow ??
    fallbackWindow ??
    (globalThis as Window & typeof globalThis)) as PageWindow;

  const detectScriptVersion = (): string => {
    const gmInfo = ENV.GM_info;
    const version = gmInfo?.script?.version;
    if (typeof version === 'string' && version.trim()) {
      return version.trim();
    }
    return '0.0.0-dev';
  };

  const scriptVersion = detectScriptVersion();

  GMH.VERSION = scriptVersion;

  const toErrorMessage = (err: unknown): string =>
    err instanceof Error && typeof err.message === 'string' ? err.message : String(err);

  const {
    genitAdapter,
    getActiveAdapter,
    updatePlayerNames,
  } = composeAdapters({
    GMH,
    adapterRegistry,
    registerAdapterConfig,
    getAdapterSelectors,
    getAdapterMetadata,
    listAdapterNames,
    createGenitAdapter,
    errorHandler: GMH.Core?.ErrorHandler as ErrorHandler | null | undefined,
    getPlayerNames,
    setPlayerNames,
    PLAYER_NAME_FALLBACKS: [...PLAYER_NAME_FALLBACKS],
  });
  updatePlayerNames();
  const buildExportBundle = (
    session: TranscriptSession,
    normalizedRaw: string,
    format: string,
    stamp: string,
    options: ExportBundleOptions = {},
  ): ExportBundleResult =>
    buildExportBundleStandalone(session, normalizedRaw, format, stamp, {
      ...options,
      playerNames: options.playerNames ? [...options.playerNames] : [...getPlayerNames()],
      playerMark: options.playerMark ?? PLAYER_MARK,
    });

  const buildExportManifest = (params: ExportManifestOptions): ExportManifest =>
    buildExportManifestStandalone({ ...params, version: GMH.VERSION });

  const toJSONExportLegacy = withPlayerNames(getPlayerNames, toJSONExport);

  const toJSONExportForShare: ShareWorkflowOptions['toJSONExport'] = (
    session,
    options: ClassicJSONExportOptions = {},
  ): string =>
    toJSONExport(session, '', {
      ...options,
      playerNames: options.playerNames ? [...options.playerNames] : [...getPlayerNames()],
    });

  const toStructuredMarkdownLegacy = (options: StructuredMarkdownOptions = {}): string => {
    const { playerNames, playerMark, ...rest } = options;
    return toStructuredMarkdown({
      ...rest,
      playerNames: playerNames ? [...playerNames] : [...getPlayerNames()],
      playerMark: playerMark ?? PLAYER_MARK,
    });
  };

  const toStructuredJSONLegacy = (options: StructuredJSONOptions = {}): string => {
    const { playerNames, playerMark, ...rest } = options;
    return toStructuredJSON({
      ...rest,
      playerNames: playerNames ? [...playerNames] : [...getPlayerNames()],
      playerMark: playerMark ?? PLAYER_MARK,
    });
  };

  const toStructuredTXTLegacy = (options: StructuredTXTOptions = {}): string => {
    const { playerNames, playerMark, ...rest } = options;
    return toStructuredTXT({
      ...rest,
      playerNames: playerNames ? [...playerNames] : [...getPlayerNames()],
      playerMark: playerMark ?? PLAYER_MARK,
    });
  };

  const PanelSettings = createPanelSettings({
    clone,
    deepMerge,
    storage: ENV.localStorage,
    logger: ENV.console,
  });

  GMH.Settings = {
    panel: {
      get: () => PanelSettings.get(),
      update: (patch: Partial<PanelSettingsValue>) => PanelSettings.update(patch),
      reset: () => PanelSettings.reset(),
      defaults: PanelSettings.defaults,
      STORAGE_KEY: PanelSettings.STORAGE_KEY,
    },
  };

  const exportRange = createExportRange({
    console: ENV.console,
    window: PAGE_WINDOW,
    localStorage: ENV.localStorage,
  });

  GMH.Core.ExportRange = exportRange;

  const turnBookmarks = createTurnBookmarks({ console: ENV.console });
  GMH.Core.TurnBookmarks = turnBookmarks;

  let getSnapshotEntryOrigin: (() => Array<number | null>) | null = null;

  const messageIndexer = createMessageIndexer({
    console: ENV.console,
    document,
    MutationObserver: typeof MutationObserver !== 'undefined' ? MutationObserver : undefined,
    requestAnimationFrame:
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined,
    exportRange,
    getActiveAdapter: () => getActiveAdapter(),
    getEntryOrigin: () => (getSnapshotEntryOrigin ? getSnapshotEntryOrigin() : []),
  });

  GMH.Core.MessageIndexer = messageIndexer;

  const bookmarkListener = createBookmarkListener({
    document,
    ElementClass: typeof Element !== 'undefined' ? Element : undefined,
    messageIndexer,
    turnBookmarks,
    console: ENV.console,
  });

  GMH.Core.BookmarkListener = bookmarkListener;

  if (!PAGE_WINDOW.__GMHBookmarkListener) {
    try {
      Object.defineProperty(PAGE_WINDOW, '__GMHBookmarkListener', {
        value: bookmarkListener,
        writable: false,
        configurable: false,
      });
    } catch (err) {
      PAGE_WINDOW.__GMHBookmarkListener = bookmarkListener;
    }
  }

  const Flags: GMHFlags = (() => {
    let betaQuery = false;
    try {
      const params = new URLSearchParams(location.search || '');
      betaQuery = params.has('gmhBeta');
    } catch (err) {
      betaQuery = false;
    }
    const storedNewUI = (() => {
      try {
        return localStorage.getItem('gmh_flag_newUI');
      } catch (err) {
        return null;
      }
    })();
    const storedKill = (() => {
      try {
        return localStorage.getItem('gmh_kill');
      } catch (err) {
        return null;
      }
    })();
    const newUI = storedNewUI === '1' || betaQuery;
    const killSwitch = storedKill === '1';
    return {
      newUI,
      killSwitch,
      betaQuery,
    };
  })();

  GMH.Flags = Flags;

  const isModernUIActive = Flags.newUI && !Flags.killSwitch;

  const stateManager = createStateManager({
    console: ENV.console,
    debug: (...args: unknown[]) => {
      if (isModernUIActive) {
        ENV.console?.debug?.('[GMH]', ...args);
      }
    },
  });

  const normalizeState = (value: unknown): string | null => {
    if (!value) return null;
    const next = String(value).toLowerCase();
    const states = Object.values(GMH_STATE) as string[];
    return states.includes(next) ? next : null;
  };

  GMH.Core.STATE = GMH_STATE;
  GMH.Core.State = stateManager;

  const errorHandler = createErrorHandler({
    console: ENV.console,
    alert: typeof alert === 'function' ? alert : undefined,
    localStorage: ENV.localStorage,
    state: stateManager,
  });

  GMH.Core.ErrorHandler = errorHandler;

  const ensureDefaultUIFlag = () => {
    try {
      const storage = ENV.localStorage || localStorage;
      if (!storage) return;
      const killSwitchEnabled = storage.getItem('gmh_kill') === '1';
      if (killSwitchEnabled) return;
      const currentValue = storage.getItem('gmh_flag_newUI');
      if (currentValue !== '1') {
        storage.setItem('gmh_flag_newUI', '1');
      }
    } catch (err) {
      const level = errorHandler.LEVELS?.WARN || 'warn';
      errorHandler.handle(err, 'storage/write', level);
    }
  };

  ensureDefaultUIFlag();

  // -------------------------------
  // 0) Privacy composition
  // -------------------------------
  const {
    privacyStore,
    privacyConfig: PRIVACY_CFG,
    setPrivacyProfile: setPrivacyProfileInternal,
    setCustomList: setCustomListInternal,
    applyPrivacyPipeline,
    boundRedactText,
  } = composePrivacy({
    createPrivacyStore,
    createPrivacyPipeline,
    PRIVACY_PROFILES,
    DEFAULT_PRIVACY_PROFILE,
    collapseSpaces,
    privacyRedactText: (value, profileKey, counts, config, profiles) =>
      privacyRedactText(value, profileKey, counts ?? {}, config, profiles),
    hasMinorSexualContext,
    getPlayerNames,
    ENV,
    errorHandler,
  });

  let syncPrivacyProfileSelect: (profileKey: string) => void = () => {};

  const setPrivacyProfile = (profileKey: string): void => {
    setPrivacyProfileInternal(profileKey);
    syncPrivacyProfileSelect(profileKey);
  };

  const setCustomList = (type: 'blacklist' | 'whitelist', items: unknown): void => {
    setCustomListInternal(type, items);
  };

  const {
    modal,
    panelVisibility: PanelVisibility,
    statusManager,
    setPanelStatus,
    attachStatusElement,
    stateView,
    configurePrivacyLists,
    openPanelSettings,
  } = composeUI({
    GMH,
    documentRef: document,
    windowRef: PAGE_WINDOW,
    PanelSettings,
    stateManager,
    stateEnum: GMH_STATE,
    ENV,
    privacyConfig: PRIVACY_CFG,
    privacyProfiles: PRIVACY_PROFILES,
    setCustomList,
    parseListInput,
    isModernUIActive: () => isModernUIActive,
  });

  GMH.UI.StateView = stateView;

  const { describeNode, downloadDomSnapshot } = createSnapshotFeature({
    getActiveAdapter: () => getActiveAdapter(),
    triggerDownload,
    setPanelStatus,
    errorHandler,
    documentRef: document,
    locationRef: location,
  });

  const {
    captureStructuredSnapshot,
    readTranscriptText,
    projectStructuredMessages,
    readStructuredMessages,
    getEntryOrigin: structuredGetEntryOrigin,
  } = createStructuredSnapshotReader({
    getActiveAdapter,
    setEntryOriginProvider,
    documentRef: document,
  });

  getSnapshotEntryOrigin = structuredGetEntryOrigin;

  GMH.Core.getEntryOrigin = () => (getSnapshotEntryOrigin ? getSnapshotEntryOrigin() : []);

  const {
    autoLoader,
    autoState: AUTO_STATE,
    startTurnMeter,
    subscribeProfileChange,
    getProfile: getAutoProfile,
  } = createAutoLoader({
    stateApi: stateManager,
    stateEnum: GMH_STATE,
    errorHandler,
    messageIndexer,
    exportRange,
    setPanelStatus,
    getActiveAdapter,
    sleep,
    isScrollable,
    documentRef: document,
    windowRef: PAGE_WINDOW,
    normalizeTranscript,
    buildSession,
    readTranscriptText,
    logger: ENV.console,
  });

  const {
    ensureAutoLoadControlsModern,
    ensureAutoLoadControlsLegacy,
    mountStatusActionsModern,
    mountStatusActionsLegacy,
  } = createAutoLoaderControls({
    documentRef: document,
    autoLoader,
    autoState: AUTO_STATE,
    setPanelStatus,
    startTurnMeter,
    getAutoProfile,
    subscribeProfileChange,
    downloadDomSnapshot,
  });

  const { bindRangeControls } = createRangeControls({
    documentRef: document,
    windowRef: PAGE_WINDOW,
    exportRange,
    turnBookmarks,
    messageIndexer,
    setPanelStatus,
  });

  const { confirm: confirmPrivacyGateLegacy } = createLegacyPrivacyGate({
    documentRef: document,
    formatRedactionCounts,
    privacyProfiles: PRIVACY_PROFILES,
    ensureLegacyPreviewStyles,
    previewLimit: CONFIG.LIMITS.PREVIEW_TURN_LIMIT,
  });

  const { confirm: confirmPrivacyGateModern } = createModernPrivacyGate({
    documentRef: document,
    formatRedactionCounts,
    privacyProfiles: PRIVACY_PROFILES,
    ensureDesignSystemStyles,
    modal,
    previewLimit: CONFIG.LIMITS.PREVIEW_TURN_LIMIT,
  });

  type PrivacyGateConfirmOptions = Parameters<typeof confirmPrivacyGateModern>[0];
  const confirmPrivacyGate = (options: PrivacyGateConfirmOptions) =>
    (isModernUIActive ? confirmPrivacyGateModern : confirmPrivacyGateLegacy)(options);

  const {
    parseAll,
    prepareShare,
    performExport,
    copyRecent: copyRecentShare,
    copyAll: copyAllShare,
    reparse: reparseShare,
    collectSessionStats,
  } = composeShareWorkflow({
    createShareWorkflow,
    captureStructuredSnapshot,
    normalizeTranscript,
    buildSession,
    exportRange,
    projectStructuredMessages,
    applyPrivacyPipeline,
    privacyConfig: PRIVACY_CFG,
    privacyProfiles: PRIVACY_PROFILES,
    formatRedactionCounts,
    setPanelStatus,
    toMarkdownExport,
    toJSONExport: toJSONExportForShare,
    toTXTExport,
    toStructuredMarkdown: toStructuredMarkdownLegacy,
    toStructuredJSON: toStructuredJSONLegacy,
    toStructuredTXT: toStructuredTXTLegacy,
    buildExportBundle,
    buildExportManifest,
    triggerDownload,
    clipboard: {
      set: (value: string, options?: Record<string, unknown>) =>
        ENV.GM_setClipboard(
          value,
          options as Parameters<typeof ENV.GM_setClipboard>[1],
        ),
    },
    stateApi: stateManager,
    stateEnum: GMH_STATE,
    confirmPrivacyGate: confirmPrivacyGate as unknown as ShareWorkflowOptions['confirmPrivacyGate'],
    getEntryOrigin: () => getSnapshotEntryOrigin?.() ?? [],
    logger: ENV.console,
  });


  const { copySummaryGuide, copyResummaryGuide } = createGuidePrompts({
    clipboard: {
      set: (value: string, options?: Record<string, unknown>) =>
        ENV.GM_setClipboard(
          value,
          options as Parameters<typeof ENV.GM_setClipboard>[1],
        ),
    },
    setPanelStatus,
  });

  const { bindGuideControls } = createGuideControls({
    reparse: reparseShare,
    copySummaryGuide,
    copyResummaryGuide,
    logger: ENV.console,
  });


  const { bindShortcuts } = createPanelShortcuts({
    windowRef: PAGE_WINDOW,
    panelVisibility: PanelVisibility,
    autoLoader,
    autoState: AUTO_STATE,
    configurePrivacyLists,
    modal,
  });


  const {
    bindPanelInteractions,
    syncPrivacyProfileSelect: syncPrivacyProfileSelectFromUI,
  } = createPanelInteractions({
    panelVisibility: PanelVisibility,
    setPanelStatus,
    setPrivacyProfile,
    getPrivacyProfile: () => PRIVACY_CFG.profile,
    privacyProfiles: PRIVACY_PROFILES,
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
    autoState: AUTO_STATE,
    stateApi: stateManager,
    stateEnum: GMH_STATE,
    alert: typeof alert === 'function' ? alert : undefined,
    logger: ENV.console,
  });

  syncPrivacyProfileSelect = (profileKey: string) => {
    syncPrivacyProfileSelectFromUI(profileKey);
  };

  const { mount: mountPanelModern } = createModernPanel({
    documentRef: document,
    ensureStyles: ensureDesignSystemStyles,
    version: GMH.VERSION,
    getActiveAdapter: () => getActiveAdapter(),
    attachStatusElement,
    stateView,
    bindPanelInteractions,
    logger: ENV.console,
  });

  const { mount: mountPanelLegacy } = createLegacyPanel({
    documentRef: document,
    getActiveAdapter: () => getActiveAdapter(),
    attachStatusElement,
    setPanelStatus,
    stateView,
    bindPanelInteractions,
  });
  const { boot, mountPanel } = setupBootstrap({
    documentRef: document,
    windowRef: PAGE_WINDOW,
    mountPanelModern,
    mountPanelLegacy,
    isModernUIActive: () => isModernUIActive,
    Flags,
    errorHandler,
    messageIndexer,
    bookmarkListener,
  });

  if (!PAGE_WINDOW.__GMHTest) {
    Object.defineProperty(PAGE_WINDOW, '__GMHTest', {
      value: {
        runPrivacyCheck(rawText: string, profileKey: string = 'safe') {
          try {
            const normalized = normalizeTranscript(rawText || '');
            const session = buildSession(normalized);
            return applyPrivacyPipeline(session, normalized, profileKey, null);
          } catch (error) {
            const level = errorHandler.LEVELS?.ERROR || 'error';
            errorHandler.handle(error, 'privacy/redact', level);
            return { error: toErrorMessage(error) };
          }
        },
        profiles: PRIVACY_PROFILES,
        formatCounts: formatRedactionCounts,
      },
      writable: false,
      configurable: false,
    });
  }

  Object.assign(GMH.Util, {
    normNL,
    stripTicks,
    collapseSpaces,
    stripQuotes,
    stripBrackets,
    sanitizeText,
    parseListInput,
    luhnValid,
    escapeForRegex,
    describeNode,
  });

  Object.assign(GMH.Privacy, {
    profiles: PRIVACY_PROFILES,
    config: PRIVACY_CFG,
    setPrivacyProfile,
    setCustomList,
    applyPrivacyPipeline,
    redactText: boundRedactText,
    hasMinorSexualContext,
    formatRedactionCounts,
  });

  Object.assign(GMH.Export, {
    toJSONExport: toJSONExportLegacy,
    toTXTExport,
    toMarkdownExport,
    toStructuredJSON: toStructuredJSONLegacy,
    toStructuredMarkdown: toStructuredMarkdownLegacy,
    toStructuredTXT: toStructuredTXTLegacy,
    buildExportBundle,
    buildExportManifest,
  });

  Object.assign(GMH.UI, {
    mountPanel,
    setPanelStatus,
    configurePrivacyLists,
    openPanelSettings,
    openPanel: (options?: { focus?: boolean; persist?: boolean }) => PanelVisibility.open(options),
    closePanel: (reason?: string) => PanelVisibility.close(reason),
    togglePanel: () => PanelVisibility.toggle(),
    isPanelCollapsed: () => PanelVisibility.isCollapsed(),
  });

  Object.assign(GMH.Core, {
    getAdapter: getActiveAdapter,
    readTranscriptText,
    captureStructuredSnapshot,
    readStructuredMessages,
    projectStructuredMessages,
    normalizeTranscript,
    parseTurns,
    buildSession,
    collectSessionStats,
    autoLoader,
    MessageIndexer: messageIndexer,
    BookmarkListener: bookmarkListener,
  });

  if (!PAGE_WINDOW.GMH) {
    try {
      Object.defineProperty(PAGE_WINDOW, 'GMH', {
        value: GMH,
        writable: false,
        configurable: false,
      });
    } catch (err) {
      const level = errorHandler.LEVELS?.WARN || 'warn';
      errorHandler.handle(err, 'ui/panel', level);
    }
  }
})();

export { GMH, ENV };
