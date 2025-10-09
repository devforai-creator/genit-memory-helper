import { GMH } from './core/namespace.ts';
import { clone, deepMerge } from './core/utils.ts';
import { ENV } from './env.js';
import { GMH_STATE, createStateManager } from './core/state.ts';
import { createErrorHandler } from './core/error-handler.ts';
import { createExportRange } from './core/export-range.ts';
import { createTurnBookmarks } from './core/turn-bookmarks.ts';
import { createMessageIndexer } from './core/message-indexer.ts';
import { createBookmarkListener } from './core/bookmark-listener.ts';
import {
  adapterRegistry,
  registerAdapterConfig,
  getAdapterSelectors,
  getAdapterMetadata,
  listAdapterNames,
  createGenitAdapter,
} from './adapters/index.js';
import {
  PRIVACY_PROFILES,
  DEFAULT_PRIVACY_PROFILE,
  createPrivacyStore,
  escapeForRegex,
  redactText as privacyRedactText,
  hasMinorSexualContext,
  formatRedactionCounts,
  createPrivacyPipeline,
} from './privacy/index.ts';
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
} from './utils/text.ts';
import { sleep, triggerDownload, isScrollable } from './utils/dom.ts';
import { luhnValid } from './utils/validation.ts';
import { withPlayerNames } from './utils/factories.js';
import { ensureLegacyPreviewStyles, ensureDesignSystemStyles } from './ui/styles.js';
import { createPanelSettings } from './ui/panel-settings.js';
import { createSnapshotFeature, createStructuredSnapshotReader } from './features/snapshot.ts';
import { createAutoLoader } from './features/auto-loader.ts';
import { createAutoLoaderControls } from './ui/auto-loader-controls.js';
import { createRangeControls } from './ui/range-controls.js';
import { createPanelShortcuts } from './ui/panel-shortcuts.js';
import { createShareWorkflow } from './features/share.ts';
import { createPanelInteractions } from './ui/panel-interactions.js';
import { createModernPanel } from './ui/panel-modern.js';
import { createLegacyPanel } from './ui/panel-legacy.js';
import { createLegacyPrivacyGate, createModernPrivacyGate } from './ui/privacy-gate.js';
import { createGuidePrompts } from './features/guides.ts';
import { createGuideControls } from './ui/guide-controls.js';
import { composeAdapters } from './composition/adapter-composition.js';
import { composePrivacy } from './composition/privacy-composition.js';
import { composeShareWorkflow } from './composition/share-composition.js';
import { composeUI } from './composition/ui-composition.js';
import { setupBootstrap } from './composition/bootstrap.js';
import { CONFIG } from './config.js';

(function () {
  'use strict';

  const PAGE_WINDOW =
    ENV.window || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
  const detectScriptVersion = () => {
    const gmInfo = ENV.GM_info;
    const version = gmInfo?.script?.version;
    if (typeof version === 'string' && version.trim()) {
      return version.trim();
    }
    return '0.0.0-dev';
  };

  const scriptVersion = detectScriptVersion();

  GMH.VERSION = scriptVersion;

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
    errorHandler: GMH.Core?.ErrorHandler,
    getPlayerNames,
    setPlayerNames,
    PLAYER_NAME_FALLBACKS,
  });
  updatePlayerNames();
  const buildExportBundle = (
    session,
    normalizedRaw,
    format,
    stamp,
    options = {},
  ) =>
    buildExportBundleStandalone(session, normalizedRaw, format, stamp, {
      playerNames: getPlayerNames(),
      playerMark: PLAYER_MARK,
      ...options,
    });

  const buildExportManifest = (params) =>
    buildExportManifestStandalone({ ...params, version: GMH.VERSION });

  const toJSONExportLegacy = withPlayerNames(getPlayerNames, toJSONExport);

  const toStructuredMarkdownLegacy = (options = {}) =>
    toStructuredMarkdown({
      playerNames: getPlayerNames(),
      playerMark: PLAYER_MARK,
      ...options,
    });

  const toStructuredJSONLegacy = (options = {}) =>
    toStructuredJSON({
      playerNames: getPlayerNames(),
      ...options,
    });

  const toStructuredTXTLegacy = (options = {}) =>
    toStructuredTXT({
      playerNames: getPlayerNames(),
      ...options,
    });

  const PanelSettings = createPanelSettings({
    clone,
    deepMerge,
    storage: ENV.localStorage,
    logger: ENV.console,
  });

  GMH.Settings = {
    panel: {
      get: () => PanelSettings.get(),
      update: (patch) => PanelSettings.update(patch),
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

  const messageIndexer = createMessageIndexer({
    console: ENV.console,
    document,
    MutationObserver: typeof MutationObserver !== 'undefined' ? MutationObserver : undefined,
    requestAnimationFrame:
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined,
    exportRange,
    getActiveAdapter: () => getActiveAdapter(),
    getEntryOrigin: () => getSnapshotEntryOrigin(),
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

  const Flags = (() => {
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
    debug: (...args) => {
      if (isModernUIActive && typeof ENV.console?.debug === 'function') {
        ENV.console.debug('[GMH]', ...args);
      }
    },
  });

  const normalizeState = (value) => {
    if (!value) return null;
    const next = String(value).toLowerCase();
    return Object.values(GMH_STATE).includes(next) ? next : null;
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
    privacyRedactText,
    hasMinorSexualContext,
    getPlayerNames,
    ENV,
    errorHandler,
  });

  let syncPrivacyProfileSelect = () => {};

  const setPrivacyProfile = (profileKey) => {
    setPrivacyProfileInternal(profileKey);
    syncPrivacyProfileSelect(profileKey);
  };

  const setCustomList = (type, items) => {
    setCustomListInternal(type, items);
  };

  const {
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
    errorHandler: GMH.Core.ErrorHandler,
    documentRef: document,
    locationRef: location,
  });

  const {
    captureStructuredSnapshot,
    readTranscriptText,
    projectStructuredMessages,
    readStructuredMessages,
    getEntryOrigin: getSnapshotEntryOrigin,
  } = createStructuredSnapshotReader({
    getActiveAdapter,
    setEntryOriginProvider,
    documentRef: document,
  });

  GMH.Core.getEntryOrigin = () => getSnapshotEntryOrigin();

  const {
    autoLoader,
    autoState: AUTO_STATE,
    startTurnMeter,
    subscribeProfileChange,
    getProfile: getAutoProfile,
  } = createAutoLoader({
    stateApi: stateManager,
    stateEnum: GMH_STATE,
    errorHandler: GMH.Core.ErrorHandler,
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
    modal: GMH.UI.Modal,
    previewLimit: CONFIG.LIMITS.PREVIEW_TURN_LIMIT,
  });

  const confirmPrivacyGate = (options) =>
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
    toJSONExport: toJSONExportLegacy,
    toTXTExport,
    toStructuredMarkdown: toStructuredMarkdownLegacy,
    toStructuredJSON: toStructuredJSONLegacy,
    toStructuredTXT: toStructuredTXTLegacy,
    buildExportBundle,
    buildExportManifest,
    triggerDownload,
    clipboard: { set: (value, options) => ENV.GM_setClipboard(value, options) },
    stateApi: GMH.Core.State,
    stateEnum: GMH.Core.STATE,
    confirmPrivacyGate,
    getEntryOrigin: () => getSnapshotEntryOrigin?.(),
    logger: ENV.console,
  });


  const { copySummaryGuide, copyResummaryGuide } = createGuidePrompts({
    clipboard: { set: (value, options) => ENV.GM_setClipboard(value, options) },
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
    modal: GMH.UI.Modal,
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
    stateApi: GMH.Core.State,
    stateEnum: GMH.Core.STATE,
    alert: typeof alert === 'function' ? alert : undefined,
    logger: ENV.console,
  });

  syncPrivacyProfileSelect = (profileKey) => {
    syncPrivacyProfileSelectFromUI(profileKey);
  };

  const { mount: mountPanelModern } = createModernPanel({
    documentRef: document,
    ensureStyles: ensureDesignSystemStyles,
    version: GMH.VERSION,
    getActiveAdapter: () => getActiveAdapter(),
    attachStatusElement,
    stateView: GMH.UI.StateView,
    bindPanelInteractions,
    logger: ENV.console,
  });

  const { mount: mountPanelLegacy } = createLegacyPanel({
    documentRef: document,
    getActiveAdapter: () => getActiveAdapter(),
    attachStatusElement,
    setPanelStatus,
    stateView: GMH.UI.StateView,
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
        runPrivacyCheck(rawText, profileKey = 'safe') {
          try {
            const normalized = normalizeTranscript(rawText || '');
            const session = buildSession(normalized);
            return applyPrivacyPipeline(session, normalized, profileKey, null);
          } catch (error) {
            const level = errorHandler.LEVELS?.ERROR || 'error';
            errorHandler.handle(error, 'privacy/redact', level);
            return { error: error?.message || String(error) };
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
    openPanel: (options) => PanelVisibility.open(options),
    closePanel: (reason) => PanelVisibility.close(reason),
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
