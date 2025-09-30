import { GMH } from './core/namespace.js';
import { clone, deepMerge } from './core/utils.js';
import { ENV } from './env.js';
import { GMH_STATE, createStateManager } from './core/state.js';
import { createErrorHandler } from './core/error-handler.js';
import { createExportRange } from './core/export-range.js';
import { createTurnBookmarks } from './core/turn-bookmarks.js';
import { createMessageIndexer } from './core/message-indexer.js';
import { createBookmarkListener } from './core/bookmark-listener.js';
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
} from './privacy/index.js';
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
} from './export/index.js';
import {
  normNL,
  stripTicks,
  collapseSpaces,
  stripQuotes,
  stripBrackets,
  sanitizeText,
  parseListInput,
} from './utils/text.js';
import { sleep, triggerDownload, isScrollable } from './utils/dom.js';
import { luhnValid } from './utils/validation.js';
import { ensureLegacyPreviewStyles, ensureDesignSystemStyles } from './ui/styles.js';
import { createModal } from './ui/modal.js';
import { createPanelSettings } from './ui/panel-settings.js';
import { createPanelVisibility } from './ui/panel-visibility.js';
import { createStatusManager } from './ui/status-manager.js';
import { createStateView } from './ui/state-view.js';
import { createSnapshotFeature, createStructuredSnapshotReader } from './features/snapshot.js';
import { createPanelSettingsController } from './ui/panel-settings-modal.js';
import { createAutoLoader } from './features/auto-loader.js';
import { createPrivacyConfigurator } from './ui/privacy-config.js';
import { createAutoLoaderControls } from './ui/auto-loader-controls.js';
import { createRangeControls } from './ui/range-controls.js';
import { createPanelShortcuts } from './ui/panel-shortcuts.js';
import { createShareWorkflow } from './features/share.js';
import { createPanelInteractions } from './ui/panel-interactions.js';
import { createModernPanel } from './ui/panel-modern.js';
import { createLegacyPanel } from './ui/panel-legacy.js';
import { createLegacyPrivacyGate, createModernPrivacyGate } from './ui/privacy-gate.js';
import { createGuidePrompts } from './features/guides.js';
import { createGuideControls } from './ui/guide-controls.js';

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

  GMH.Adapters.Registry = adapterRegistry;
  GMH.Adapters.register = function registerAdapter(name, config) {
    registerAdapterConfig(name, config);
  };

  GMH.Adapters.getSelectors = function getSelectors(name) {
    return getAdapterSelectors(name);
  };

  GMH.Adapters.getMetadata = function getMetadata(name) {
    return getAdapterMetadata(name);
  };

  GMH.Adapters.list = function listAdapters() {
    return listAdapterNames();
  };

  registerAdapterConfig('genit', {
    selectors: {
      chatContainers: [
        '[data-chat-container]',
        '[data-testid="chat-scroll-region"]',
        '[data-testid="conversation-scroll"]',
        '[data-testid="chat-container"]',
        '[data-role="conversation"]',
        '[data-overlayscrollbars]',
        '.flex-1.min-h-0.overflow-y-auto',
        'main [class*="overflow-y"]',
      ],
      messageRoot: [
        '[data-message-id]',
        '[role="listitem"][data-id]',
        '[data-testid="message-wrapper"]',
      ],
      infoCode: ['code.language-INFO', 'pre code.language-INFO'],
      playerScopes: [
        '[data-role="user"]',
        '[data-from-user="true"]',
        '[data-author-role="user"]',
        '.flex.w-full.justify-end',
        '.flex.flex-col.items-end',
      ],
      playerText: [
        '.space-y-3.mb-6 > .markdown-content:nth-of-type(1)',
        '[data-role="user"] .markdown-content:not(.text-muted-foreground)',
        '[data-author-role="user"] .markdown-content:not(.text-muted-foreground)',
        '.flex.w-full.justify-end .markdown-content:not(.text-muted-foreground)',
        '.flex.flex-col.items-end .markdown-content:not(.text-muted-foreground)',
        '.markdown-content.text-right',
        '.p-4.rounded-xl.bg-background p',
        '[data-role="user"] .markdown-content.text-muted-foreground',
        '[data-author-role="user"] .markdown-content.text-muted-foreground',
        '.flex.w-full.justify-end .markdown-content.text-muted-foreground',
        '.flex.flex-col.items-end .markdown-content.text-muted-foreground',
        '.flex.justify-end .text-muted-foreground.text-sm',
        '.flex.justify-end .text-muted-foreground',
        '.flex.flex-col.items-end .text-muted-foreground',
        '.p-3.rounded-lg.bg-muted\\/50 p',
        '.flex.justify-end .p-3.rounded-lg.bg-muted\\/50 p',
        '.flex.flex-col.items-end .p-3.rounded-lg.bg-muted\\/50 p',
      ],
      npcGroups: ['[data-role="assistant"]', '.flex.flex-col.w-full.group'],
      npcName: [
        '[data-author-name]',
        '[data-author]',
        '[data-username]',
        '.text-sm.text-muted-foreground.mb-1.ml-1',
      ],
      npcBubble: [
        '.p-4.rounded-xl.bg-background',
        '.p-3.rounded-lg.bg-muted\\/50',
      ],
      narrationBlocks: [
        '.markdown-content.text-muted-foreground > p',
        '.text-muted-foreground.text-sm > p',
      ],
      panelAnchor: ['[data-testid="app-root"]', '#__next', '#root', 'main'],
      playerNameHints: [
        '[data-role="user"] [data-username]',
        '[data-profile-name]',
        '[data-user-name]',
        '[data-testid="profile-name"]',
        'header [data-username]',
      ],
      textHints: ['메시지', '채팅', '대화'],
    },
  });

  const genitAdapter = createGenitAdapter({
    registry: adapterRegistry,
    getPlayerNames,
    isPrologueBlock,
    errorHandler: GMH.Core.ErrorHandler,
  });

  GMH.Adapters.genit = genitAdapter;

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

  const toJSONExportLegacy = (session, normalizedRaw, options = {}) =>
    toJSONExport(session, normalizedRaw, {
      playerNames: getPlayerNames(),
      ...options,
    });

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

  bookmarkListener.start();
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
  // 0) Constants & utils
  // -------------------------------
  const privacyStore = createPrivacyStore({
    storage: ENV.localStorage,
    errorHandler: GMH.Core.ErrorHandler,
    collapseSpaces,
    defaultProfile: DEFAULT_PRIVACY_PROFILE,
    profiles: PRIVACY_PROFILES,
  });

  const PRIVACY_CFG = privacyStore.config;

  let syncPrivacyProfileSelect = () => {};

  function setPrivacyProfile(profileKey) {
    privacyStore.setProfile(profileKey);
    syncPrivacyProfileSelect(profileKey);
  }

  function setCustomList(type, items) {
    privacyStore.setCustomList(type, items);
  }

  const boundRedactText = (text, profileKey, counts) =>
    privacyRedactText(text, profileKey, counts, PRIVACY_CFG, PRIVACY_PROFILES);

  const { applyPrivacyPipeline } = createPrivacyPipeline({
    profiles: PRIVACY_PROFILES,
    getConfig: () => PRIVACY_CFG,
    redactText: boundRedactText,
    hasMinorSexualContext,
    getPlayerNames,
  });

  function cloneSession(session) {
    const clonedTurns = Array.isArray(session?.turns)
      ? session.turns.map((turn) => {
          const clone = { ...turn };
          if (Array.isArray(turn.__gmhEntries)) {
            Object.defineProperty(clone, '__gmhEntries', {
              value: turn.__gmhEntries.slice(),
              enumerable: false,
              writable: true,
              configurable: true,
            });
          }
          if (Array.isArray(turn.__gmhSourceBlocks)) {
            Object.defineProperty(clone, '__gmhSourceBlocks', {
              value: turn.__gmhSourceBlocks.slice(),
              enumerable: false,
              writable: true,
              configurable: true,
            });
          }
          return clone;
        })
      : [];
    return {
      meta: { ...(session?.meta || {}) },
      turns: clonedTurns,
      warnings: Array.isArray(session?.warnings) ? [...session.warnings] : [],
      source: session?.source,
    };
  }


  function collectSessionStats(session) {
    if (!session) return { userMessages: 0, llmMessages: 0, totalMessages: 0, warnings: 0 };
    const userMessages = session.turns?.filter((turn) => turn.channel === 'user')?.length || 0;
    const llmMessages = session.turns?.filter((turn) => turn.channel === 'llm')?.length || 0;
    const totalMessages = session.turns?.length || 0;
    const warnings = session.warnings?.length || 0;
    return { userMessages, llmMessages, totalMessages, warnings };
  }

  const PREVIEW_TURN_LIMIT = 5;

  GMH.UI.Modal = createModal({ documentRef: document, windowRef: PAGE_WINDOW });

  const PanelVisibility = createPanelVisibility({
    panelSettings: PanelSettings,
    stateEnum: GMH_STATE,
    stateApi: stateManager,
    modal: GMH.UI.Modal,
    documentRef: document,
    windowRef: PAGE_WINDOW,
    storage: ENV.localStorage,
    logger: ENV.console,
  });

  const statusManager = createStatusManager({ panelVisibility: PanelVisibility });
  const { setStatus: setPanelStatus, attachStatusElement } = statusManager;

  GMH.UI.StateView = createStateView({
    stateApi: stateManager,
    statusManager,
    stateEnum: GMH_STATE,
  });

  const { describeNode, downloadDomSnapshot } = createSnapshotFeature({
    getActiveAdapter: () => getActiveAdapter(),
    triggerDownload,
    setPanelStatus,
    errorHandler: GMH.Core.ErrorHandler,
    documentRef: document,
    locationRef: location,
  });

  const { configurePrivacyLists } = createPrivacyConfigurator({
    privacyConfig: PRIVACY_CFG,
    setCustomList,
    parseListInput,
    setPanelStatus,
    modal: GMH.UI.Modal,
    isModernUIActive: () => isModernUIActive,
    documentRef: document,
    windowRef: PAGE_WINDOW,
  });

  const { openPanelSettings } = createPanelSettingsController({
    panelSettings: PanelSettings,
    modal: GMH.UI.Modal,
    setPanelStatus,
    configurePrivacyLists,
    documentRef: document,
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
    previewLimit: PREVIEW_TURN_LIMIT,
  });

  const { confirm: confirmPrivacyGateModern } = createModernPrivacyGate({
    documentRef: document,
    formatRedactionCounts,
    privacyProfiles: PRIVACY_PROFILES,
    ensureDesignSystemStyles,
    modal: GMH.UI.Modal,
    previewLimit: PREVIEW_TURN_LIMIT,
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
  } = createShareWorkflow({
    captureStructuredSnapshot,
    normalizeTranscript,
    buildSession,
    exportRange,
    projectStructuredMessages,
    cloneSession,
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
    collectSessionStats,
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
  GMH.Core.adapters = [GMH.Adapters.genit];

  GMH.Core.pickAdapter = function pickAdapter(loc = location, doc = document) {
    const candidates = Array.isArray(GMH.Core.adapters) ? GMH.Core.adapters : [];
    for (const adapter of candidates) {
      try {
        if (adapter?.match?.(loc, doc)) return adapter;
      } catch (err) {
        const level = errorHandler.LEVELS?.WARN || 'warn';
        errorHandler.handle(err, 'adapter/detect', level);
      }
    }
    return GMH.Adapters.genit;
  };

let ACTIVE_ADAPTER = null;

function getActiveAdapter() {
  if (!ACTIVE_ADAPTER) {
    ACTIVE_ADAPTER = GMH.Core.pickAdapter(location, document);
  }
  return ACTIVE_ADAPTER;
}






  function guessPlayerNamesFromDOM() {
    const adapter = getActiveAdapter();
    return adapter?.guessPlayerNames?.() || [];
  }

  const updatePlayerNames = () => {
    const names = Array.from(
      new Set([...PLAYER_NAME_FALLBACKS, ...guessPlayerNamesFromDOM()].filter(Boolean)),
    );
    setPlayerNames(names);
    GMH.Adapters.genit?.setPlayerNameAccessor?.(() => getPlayerNames());
  };

  updatePlayerNames();

  // -------------------------------
  // 2) Writers handled via src/export modules
  // -------------------------------

  function isPrologueBlock(element) {
    let current = element instanceof Element ? element : null;
    let hops = 0;
    while (current && hops < 400) {
      if (current.hasAttribute?.('data-gmh-player-turn')) return false;
      if (current.previousElementSibling) {
        current = current.previousElementSibling;
      } else {
        current = current.parentElement;
      }
      hops += 1;
    }
    return true;
  }

  // -------------------------------
  // 4) UI Panel
  // -------------------------------


  function mountPanel() {
    if (isModernUIActive) {
      mountPanelModern();
    } else {
      if (Flags.killSwitch) {
        const level = errorHandler.LEVELS?.INFO || 'info';
        errorHandler.handle('modern UI disabled by kill switch', 'ui/panel', level);
      }
      mountPanelLegacy();
    }
  }

  // -------------------------------
  // 5) Boot
  // -------------------------------
  function boot() {
    try {
      mountPanel();
      GMH.Core.MessageIndexer.start();
      bookmarkListener.start();
    } catch (e) {
      const level = errorHandler.LEVELS?.ERROR || 'error';
      errorHandler.handle(e, 'ui/panel', level);
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 1200);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1200));
  }

  if (!PAGE_WINDOW.__GMHTeardownHook) {
    const teardown = () => {
      try {
        bookmarkListener.stop();
      } catch (err) {
        const level = errorHandler.LEVELS?.WARN || 'warn';
        errorHandler.handle(err, 'bookmark', level);
      }
      try {
        messageIndexer.stop();
      } catch (err) {
        const level = errorHandler.LEVELS?.WARN || 'warn';
        errorHandler.handle(err, 'adapter', level);
      }
    };
    window.addEventListener('pagehide', teardown);
    window.addEventListener('beforeunload', teardown);
    PAGE_WINDOW.__GMHTeardownHook = true;
  }

  let moScheduled = false;
  const mo = new MutationObserver(() => {
    if (moScheduled) return;
    moScheduled = true;
    requestAnimationFrame(() => {
      moScheduled = false;
      if (!document.querySelector('#genit-memory-helper-panel')) boot();
    });
  });
  mo.observe(document.documentElement, { subtree: true, childList: true });

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
