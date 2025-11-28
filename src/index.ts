import { GMH } from './core/namespace';
import GMHExperimental from './experimental';
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
  createBabechatAdapter,
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
import { ensureDesignSystemStyles } from './ui/styles';
import { createPanelSettings } from './ui/panel-settings';
import { createSnapshotFeature, createStructuredSnapshotReader } from './features/snapshot';
import { createAutoLoader } from './features/auto-loader';
import { createAutoLoaderControls } from './ui/auto-loader-controls';
import { createRangeControls } from './ui/range-controls';
import { createPanelShortcuts } from './ui/panel-shortcuts';
import { createShareWorkflow } from './features/share';
import createBlockBuilder from './features/block-builder';
import createMessageStream from './features/message-stream';
import {
  testImageCapture,
  exportAsHtml,
  exportFromStructuredData,
  downloadHtml,
  captureImageAsBase64,
} from './features/html-export';
import createMemoryStatus from './ui/memory-status';
import createBlockViewer from './ui/block-viewer';
import { createPanelInteractions } from './ui/panel-interactions';
import { createModernPanel } from './ui/panel-modern';
import { createModernPrivacyGate } from './ui/privacy-gate';
import { createGuidePrompts } from './features/guides';
import { createGuideControls } from './ui/guide-controls';
import { composeAdapters } from './composition/adapter-composition';
import { composePrivacy } from './composition/privacy-composition';
import { composeShareWorkflow } from './composition/share-composition';
import { composeUI } from './composition/ui-composition';
import { setupBootstrap } from './composition/bootstrap';
import { CONFIG } from './config';
import createBlockStorage from './storage/block-storage';
import {
  buildDebugBlockDetail,
  cloneDebugBlockDetail,
  toDebugBlockSummary,
} from './utils/block-debug';
import type {
  ClassicJSONExportOptions,
  ErrorHandler,
  ExportBundleOptions,
  ExportBundleResult,
  ExportManifest,
  ExportManifestOptions,
  DebugBlockDetails,
  DebugBlockSummary,
  DebugNamespace,
  PanelSettingsValue,
  ShareWorkflowOptions,
  StructuredJSONOptions,
  StructuredMarkdownOptions,
  StructuredSnapshotMessage,
  StructuredTXTOptions,
  MemoryBlockInit,
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
  killSwitch: boolean;
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
    babechatAdapter,
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
    createBabechatAdapter,
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

  const toJSONExportDefault = withPlayerNames(getPlayerNames, toJSONExport);

  const toJSONExportForShare: ShareWorkflowOptions['toJSONExport'] = (
    session,
    options: ClassicJSONExportOptions = {},
  ): string =>
    toJSONExport(session, '', {
      ...options,
      playerNames: options.playerNames ? [...options.playerNames] : [...getPlayerNames()],
    });

  const toStructuredMarkdownDefault = (options: StructuredMarkdownOptions = {}): string => {
    const { playerNames, playerMark, ...rest } = options;
    return toStructuredMarkdown({
      ...rest,
      playerNames: playerNames ? [...playerNames] : [...getPlayerNames()],
      playerMark: playerMark ?? PLAYER_MARK,
    });
  };

  const toStructuredJSONDefault = (options: StructuredJSONOptions = {}): string => {
    const { playerNames, playerMark, ...rest } = options;
    return toStructuredJSON({
      ...rest,
      playerNames: playerNames ? [...playerNames] : [...getPlayerNames()],
      playerMark: playerMark ?? PLAYER_MARK,
    });
  };

  const toStructuredTXTDefault = (options: StructuredTXTOptions = {}): string => {
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
    const storedKill = (() => {
      try {
        return localStorage.getItem('gmh_kill');
      } catch (err) {
        return null;
      }
    })();
    const killSwitch = storedKill === '1';
    return {
      killSwitch,
    };
  })();

  GMH.Flags = Flags;
  GMH.Experimental = GMHExperimental;

  if (Flags.killSwitch) {
    ENV.console?.warn?.('[GMH] Script disabled via kill switch');
    return;
  }

  const stateManager = createStateManager({
    console: ENV.console,
    debug: (...args: unknown[]) => {
      ENV.console?.debug?.('[GMH]', ...args);
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

  const blockStoragePromise = createBlockStorage({
    console: ENV.console,
  });

  blockStoragePromise
    .then((storage) => {
      if (storage) {
        GMH.Core.BlockStorage = storage;
      }
      return storage;
    })
    .catch((err) => {
      const level = errorHandler.LEVELS?.WARN || 'warn';
      errorHandler.handle?.(err, 'message-stream/storage', level);
      ENV.console?.warn?.('[GMH] block storage initialization failed', err);
      return null;
    });

  const blockBuilder = createBlockBuilder({
    console: ENV.console,
    removeNarration: false,
    overlap: 0,
    getSessionUrl: () => {
      try {
        return PAGE_WINDOW?.location?.href ?? null;
      } catch (err) {
        return null;
      }
    },
  });

  const messageStream = createMessageStream({
    messageIndexer,
    blockBuilder,
    blockStorage: blockStoragePromise,
    collectStructuredMessage: (element) => {
      const adapter = getActiveAdapter();
      const collector = adapter?.collectStructuredMessage;
      if (typeof collector === 'function') {
        try {
          return collector.call(adapter, element) ?? null;
        } catch (err) {
          const level = errorHandler.LEVELS?.WARN || 'warn';
          errorHandler.handle?.(err, 'message-stream/collect', level);
          return null;
        }
      }
      return null;
    },
    getSessionUrl: () => {
      try {
        return PAGE_WINDOW?.location?.href ?? null;
      } catch (err) {
        return null;
      }
    },
    console: ENV.console,
  });

  const createDebugStore = () => {
    const buckets = new Map<string, DebugBlockDetails>();

    const listInternal = (): DebugBlockDetails[] => {
      const entries = Array.from(buckets.values());
      entries.sort((a, b) => {
        if (a.timestamp !== b.timestamp) {
          return a.timestamp - b.timestamp;
        }
        const aStart = a.ordinalRange[0];
        const bStart = b.ordinalRange[0];
        if (aStart !== bStart) {
          return aStart - bStart;
        }
        return a.id.localeCompare(b.id);
      });
      return entries;
    };

    return {
      capture(block: MemoryBlockInit) {
        try {
          const detail = buildDebugBlockDetail(block);
          if (!detail.id) return;
          buckets.set(detail.id, detail);
        } catch (err) {
          ENV.console?.warn?.('[GMH] debug block capture failed', err);
        }
      },
      list(): DebugBlockSummary[] {
        return listInternal().map((detail) => toDebugBlockSummary(detail));
      },
      listBySession(sessionUrl: string | null): DebugBlockSummary[] {
        if (!sessionUrl) return [];
        return listInternal()
          .filter((detail) => detail.sessionUrl === sessionUrl)
          .map((detail) => toDebugBlockSummary(detail));
      },
      get(id: string): DebugBlockDetails | null {
        if (!id) return null;
        const detail = buckets.get(id);
        if (!detail) return null;
        return cloneDebugBlockDetail(detail);
      },
    };
  };

  const debugStore = createDebugStore();

  const resolveDebugSessionUrl = (): string | null => {
    try {
      const sessionFromStream =
        typeof messageStream.getSessionUrl === 'function' ? messageStream.getSessionUrl() : null;
      if (sessionFromStream) return sessionFromStream;
    } catch {
      // ignore errors when reading session from messageStream
    }
    if (typeof blockBuilder.getSessionUrl === 'function') {
      try {
        return blockBuilder.getSessionUrl();
      } catch {
        return null;
      }
    }
    return null;
  };

  const debugApi: DebugNamespace = {
    listBlocks() {
      return debugStore.list();
    },
    getSessionBlocks() {
      return debugStore.listBySession(resolveDebugSessionUrl());
    },
    getBlockDetails(id: string) {
      return debugStore.get(id);
    },
  };

  // HTML Export PoC functions
  const htmlExportApi = {
    /**
     * Test image capture capability
     * Usage: GMH.Debug.testImageCapture() or GMH.Debug.testImageCapture('https://...')
     */
    async testImageCapture(imageUrl?: string) {
      return testImageCapture(imageUrl, document);
    },

    /**
     * Capture a single image as base64
     */
    async captureImage(imageUrl: string, maxWidth = 800) {
      return captureImageAsBase64(imageUrl, { maxWidth });
    },

    /**
     * Export conversation as HTML
     * Usage: GMH.Debug.exportHtml() or GMH.Debug.exportHtml({ title: 'My Chat' })
     */
    async exportHtml(options: { title?: string; includeImages?: boolean } = {}) {
      const result = await exportAsHtml(
        {
          documentRef: document,
          getActiveAdapter: () => getActiveAdapter(),
          logger: ENV.console,
        },
        {
          title: options.title ?? document.title ?? 'Conversation Export',
          includeImages: options.includeImages ?? true,
          inlineStyles: true,
        },
      );

      if (result.success && result.html) {
        ENV.console?.log?.('[GMH] HTML export ready:', result.stats);
        return result;
      } else {
        ENV.console?.error?.('[GMH] HTML export failed:', result.error);
        return result;
      }
    },

    /**
     * Export and download HTML file (DOM-based, for non-virtual-scroll sites)
     * Usage: GMH.Debug.downloadHtmlFile() or GMH.Debug.downloadHtmlFile('my-chat.html')
     */
    async downloadHtmlFile(filename?: string) {
      const result = await this.exportHtml();
      if (result.success && result.html) {
        const name = filename ?? `conversation-${Date.now()}.html`;
        downloadHtml(result.html, name);
        ENV.console?.log?.(`[GMH] Downloaded: ${name}`);
        return { success: true, filename: name, stats: result.stats };
      }
      return { success: false, error: result.error };
    },

    /**
     * Export HTML from structured data (for virtual scrolling sites like babechat)
     * This uses the parsed message data instead of DOM cloning
     * Usage: GMH.Debug.exportStructuredHtml() or GMH.Debug.exportStructuredHtml({ title: 'My Chat' })
     */
    async exportStructuredHtml(options: { title?: string; includeImages?: boolean } = {}) {
      // captureStructuredSnapshot will be available after composition
      const captureSnapshot = (GMH.Core as Record<string, unknown>).captureStructuredSnapshot as
        | (() => { messages: unknown[]; legacyLines?: string[]; generatedAt?: number })
        | undefined;

      if (typeof captureSnapshot !== 'function') {
        return { success: false, error: 'captureStructuredSnapshot not available' };
      }

      try {
        const snapshot = captureSnapshot();
        ENV.console?.log?.(`[GMH] Captured ${snapshot.messages?.length || 0} messages`);

        const result = await exportFromStructuredData(snapshot as Parameters<typeof exportFromStructuredData>[0], {
          title: options.title ?? document.title ?? 'Conversation Export',
          includeImages: options.includeImages ?? true,
          logger: ENV.console,
        });

        if (result.success) {
          ENV.console?.log?.('[GMH] Structured HTML export ready:', result.stats);
        } else {
          ENV.console?.error?.('[GMH] Structured HTML export failed:', result.error);
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ENV.console?.error?.('[GMH] Structured HTML export error:', msg);
        return { success: false, error: msg };
      }
    },

    /**
     * Export and download HTML from structured data
     * Usage: GMH.Debug.downloadStructuredHtml() or GMH.Debug.downloadStructuredHtml('my-chat.html')
     */
    async downloadStructuredHtml(filename?: string) {
      const result = await this.exportStructuredHtml();
      if (result.success && result.html) {
        const name = filename ?? `conversation-${Date.now()}.html`;
        downloadHtml(result.html, name);
        ENV.console?.log?.(`[GMH] Downloaded: ${name}`);
        return { success: true, filename: name, stats: result.stats };
      }
      return { success: false, error: result.error };
    },
  };

  GMH.Debug = { ...debugApi, ...htmlExportApi };

  messageStream.subscribeBlocks((block) => {
    debugStore.capture(block);
  });

  const memoryIndexEnabled = Boolean(GMH.Experimental?.MemoryIndex?.enabled);

  const memoryStatus = createMemoryStatus({
    documentRef: document,
    windowRef: PAGE_WINDOW,
    messageStream,
    blockStorage: blockStoragePromise,
    getSessionUrl: () => {
      try {
        return PAGE_WINDOW?.location?.href ?? null;
      } catch (err) {
        return null;
      }
    },
    experimentalEnabled: memoryIndexEnabled,
    console: ENV.console,
  });

  if (memoryIndexEnabled) {
    void memoryStatus.forceRefresh();
  }

  GMH.Core.BlockBuilder = blockBuilder;
  GMH.Core.MessageStream = messageStream;
  GMH.UI.MemoryStatus = memoryStatus;

  if (memoryIndexEnabled) {
    try {
      messageStream.start();
    } catch (err) {
      const level = errorHandler.LEVELS?.WARN || 'warn';
      errorHandler.handle?.(err, 'message-stream/start', level);
    }
  }

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
  });

  GMH.UI.StateView = stateView;

  const blockViewer = createBlockViewer({
    documentRef: document,
    windowRef: PAGE_WINDOW,
    modal,
    blockStorage: blockStoragePromise,
    getSessionUrl: () => {
      try {
        return PAGE_WINDOW?.location?.href ?? null;
      } catch {
        return null;
      }
    },
    getDebugApi: () => GMH.Debug ?? null,
    logger: ENV.console,
  });

  (GMH.UI as Record<string, unknown>).BlockViewer = blockViewer;
  memoryStatus.setBlockViewerResolver(() => blockViewer);

  const { describeNode, downloadDomSnapshot } = createSnapshotFeature({
    getActiveAdapter: () => getActiveAdapter(),
    triggerDownload,
    setPanelStatus,
    errorHandler,
    documentRef: document,
    locationRef: location,
  });

  // Mutable reference for progressive messages (set after autoLoader is created)
  let progressiveMessagesGetter: (() => StructuredSnapshotMessage[] | null) | null = null;

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
    // Wrap in callback to allow late binding
    getProgressiveMessages: () => progressiveMessagesGetter?.() ?? null,
  });

  getSnapshotEntryOrigin = structuredGetEntryOrigin;

  GMH.Core.getEntryOrigin = () => (getSnapshotEntryOrigin ? getSnapshotEntryOrigin() : []);
  GMH.Core.captureStructuredSnapshot = captureStructuredSnapshot;

  const {
    autoLoader,
    autoState: AUTO_STATE,
    startTurnMeter,
    subscribeProfileChange,
    getProfile: getAutoProfile,
    getProgressiveMessages,
    clearProgressiveMessages,
    hasProgressiveMessages,
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

  // Wire up progressive messages getter after autoLoader is created
  progressiveMessagesGetter = getProgressiveMessages;

  const { ensureAutoLoadControlsModern, mountStatusActionsModern } = createAutoLoaderControls({
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

  const { confirm: confirmPrivacyGateModern } = createModernPrivacyGate({
    documentRef: document,
    formatRedactionCounts,
    privacyProfiles: PRIVACY_PROFILES,
    ensureDesignSystemStyles,
    modal,
    previewLimit: CONFIG.LIMITS.PREVIEW_TURN_LIMIT,
  });

  const confirmPrivacyGate = confirmPrivacyGateModern;

  const {
    parseAll,
    prepareShare,
    performExport,
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
    toStructuredMarkdown: toStructuredMarkdownDefault,
    toStructuredJSON: toStructuredJSONDefault,
    toStructuredTXT: toStructuredTXTDefault,
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
    mountStatusActionsModern,
    mountMemoryStatusModern: (panel) => memoryStatus.mount(panel),
    bindRangeControls,
    bindShortcuts,
    bindGuideControls,
    prepareShare,
    performExport,
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

  const { boot, mountPanel } = setupBootstrap({
    documentRef: document,
    windowRef: PAGE_WINDOW,
    mountPanelModern,
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
    toJSONExport: toJSONExportDefault,
    toTXTExport,
    toMarkdownExport,
    toStructuredJSON: toStructuredJSONDefault,
    toStructuredMarkdown: toStructuredMarkdownDefault,
    toStructuredTXT: toStructuredTXTDefault,
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
    getProgressiveMessages,
    hasProgressiveMessages,
    clearProgressiveMessages,
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
