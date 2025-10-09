function registerGenitConfig(registerAdapterConfig) {
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
      npcBubble: ['.p-4.rounded-xl.bg-background', '.p-3.rounded-lg.bg-muted\\/50'],
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
}

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

function createAdapterAPI({ GMH, errorHandler, PLAYER_NAME_FALLBACKS, setPlayerNames, getPlayerNames }) {
  GMH.Adapters = GMH.Adapters || {};
  GMH.Core = GMH.Core || {};

  GMH.Adapters.Registry = GMH.Adapters.Registry ?? null;
  GMH.Adapters.register = GMH.Adapters.register ?? (() => {});
  GMH.Adapters.getSelectors = GMH.Adapters.getSelectors ?? (() => null);
  GMH.Adapters.getMetadata = GMH.Adapters.getMetadata ?? (() => null);
  GMH.Adapters.list = GMH.Adapters.list ?? (() => []);

  const warnDetectFailure = (err) => {
    const level = errorHandler?.LEVELS?.WARN || 'warn';
    errorHandler?.handle?.(err, 'adapter/detect', level);
  };

  const pickAdapter = (loc = location, doc = document) => {
    const candidates = Array.isArray(GMH.Core.adapters) ? GMH.Core.adapters : [];
    for (const adapter of candidates) {
      try {
        if (adapter?.match?.(loc, doc)) return adapter;
      } catch (err) {
        warnDetectFailure(err);
      }
    }
    return GMH.Adapters.genit;
  };

  GMH.Core.pickAdapter = pickAdapter;

  let activeAdapter = null;
  const getActiveAdapter = () => {
    if (!activeAdapter) {
      activeAdapter = pickAdapter(location, document);
    }
    return activeAdapter;
  };

  GMH.Core.getActiveAdapter = getActiveAdapter;

  const guessPlayerNamesFromDOM = () => {
    const adapter = getActiveAdapter();
    return adapter?.guessPlayerNames?.() || [];
  };

  const updatePlayerNames = () => {
    const names = Array.from(
      new Set([...PLAYER_NAME_FALLBACKS, ...guessPlayerNamesFromDOM()].filter(Boolean)),
    );
    setPlayerNames(names);
    GMH.Adapters.genit?.setPlayerNameAccessor?.(() => getPlayerNames());
  };

  return {
    pickAdapter,
    getActiveAdapter,
    guessPlayerNamesFromDOM,
    updatePlayerNames,
    resetActiveAdapter() {
      activeAdapter = null;
    },
  };
}

/**
 * Registers available DOM adapters and exposes helper APIs for adapter selection.
 *
 * @param {object} options - Injection container.
 * @param {typeof import('../core/namespace.ts').GMH} options.GMH - Global namespace handle.
 * @param {Map} options.adapterRegistry - Registry backing store.
 * @param {Function} options.registerAdapterConfig - Adapter registration helper.
 * @param {Function} options.getAdapterSelectors - Accessor for adapter selectors.
 * @param {Function} options.getAdapterMetadata - Accessor for adapter metadata.
 * @param {Function} options.listAdapterNames - Lists registered adapter identifiers.
 * @param {Function} options.createGenitAdapter - Factory for Genit adapter.
 * @param {object} [options.errorHandler] - Optional error handler for logging.
 * @param {Function} options.getPlayerNames - Retrieves configured player names.
 * @param {Function} options.setPlayerNames - Persists player names.
 * @param {Array<string>} options.PLAYER_NAME_FALLBACKS - Default player name list.
 * @returns {object} Adapter utilities bound to the GMH namespace.
 */
export function composeAdapters({
  GMH,
  adapterRegistry,
  registerAdapterConfig,
  getAdapterSelectors,
  getAdapterMetadata,
  listAdapterNames,
  createGenitAdapter,
  errorHandler,
  getPlayerNames,
  setPlayerNames,
  PLAYER_NAME_FALLBACKS,
}) {
  GMH.Adapters = GMH.Adapters || {};
  GMH.Core = GMH.Core || {};

  GMH.Adapters.Registry = adapterRegistry;
  GMH.Adapters.register = (name, config) => registerAdapterConfig(name, config);
  GMH.Adapters.getSelectors = (name) => getAdapterSelectors(name);
  GMH.Adapters.getMetadata = (name) => getAdapterMetadata(name);
  GMH.Adapters.list = () => listAdapterNames();

  registerGenitConfig(registerAdapterConfig);

  const genitAdapter = createGenitAdapter({
    registry: adapterRegistry,
    getPlayerNames,
    isPrologueBlock,
    errorHandler,
  });

  GMH.Adapters.genit = genitAdapter;
  GMH.Core.adapters = [genitAdapter];

  const api = createAdapterAPI({
    GMH,
    errorHandler,
    PLAYER_NAME_FALLBACKS,
    setPlayerNames,
    getPlayerNames,
  });
  api.updatePlayerNames();

  return {
    genitAdapter,
    ...api,
  };
}
