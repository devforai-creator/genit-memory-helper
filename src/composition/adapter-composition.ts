import type {
  AdapterConfig,
  AdapterMatchLocation,
  AdapterMetadata,
  AdapterSelectors,
  AdapterRegistry,
  ErrorHandler,
  GenitAdapter,
  GenitAdapterOptions,
  GMHNamespace,
} from '../types';

type RegisterAdapterConfig = (name: string, config?: AdapterConfig) => void;
type GetAdapterSelectors = (name: string) => AdapterSelectors;
type GetAdapterMetadata = (name: string) => AdapterMetadata;
type ListAdapterNames = () => string[];
type CreateGenitAdapter = (options?: GenitAdapterOptions) => GenitAdapter;
type GetPlayerNames = () => string[];
type SetPlayerNames = (names: string[]) => void;

type GMHAdapterNamespace = {
  Registry?: AdapterRegistry | null;
  register?: RegisterAdapterConfig;
  getSelectors?: GetAdapterSelectors;
  getMetadata?: GetAdapterMetadata;
  list?: ListAdapterNames;
  genit?: GenitAdapter;
  [key: string]: unknown;
};

type GMHCoreNamespace = {
  adapters?: GenitAdapter[];
  pickAdapter?: (loc?: Location | AdapterMatchLocation, doc?: Document) => GenitAdapter;
  getActiveAdapter?: () => GenitAdapter;
  ErrorHandler?: ErrorHandler | null;
  [key: string]: unknown;
};

const ensureAdaptersNamespace = (GMH: GMHNamespace): GMHAdapterNamespace => {
  if (!GMH.Adapters || typeof GMH.Adapters !== 'object') {
    GMH.Adapters = {};
  }
  return GMH.Adapters as GMHAdapterNamespace;
};

const ensureCoreNamespace = (GMH: GMHNamespace): GMHCoreNamespace => {
  if (!GMH.Core || typeof GMH.Core !== 'object') {
    GMH.Core = {};
  }
  return GMH.Core as GMHCoreNamespace;
};

const registerGenitConfig = (registerAdapterConfig: RegisterAdapterConfig): void => {
  const config: AdapterConfig = {
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
  };

  registerAdapterConfig('genit', config);
};

const isPrologueBlock = (element: Element | null | undefined): boolean => {
  let current: Element | null = element instanceof Element ? element : null;
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
};

interface AdapterAPIOptions {
  GMH: GMHNamespace;
  errorHandler?: ErrorHandler | null;
  PLAYER_NAME_FALLBACKS: string[];
  setPlayerNames: SetPlayerNames;
  getPlayerNames: GetPlayerNames;
  defaultAdapter: GenitAdapter;
}

interface AdapterAPI {
  pickAdapter: (loc?: Location | AdapterMatchLocation, doc?: Document) => GenitAdapter;
  getActiveAdapter: () => GenitAdapter;
  guessPlayerNamesFromDOM: () => string[];
  updatePlayerNames: () => void;
  resetActiveAdapter: () => void;
}

const createAdapterAPI = ({
  GMH,
  errorHandler,
  PLAYER_NAME_FALLBACKS,
  setPlayerNames,
  getPlayerNames,
  defaultAdapter,
}: AdapterAPIOptions): AdapterAPI => {
  const adapters = ensureAdaptersNamespace(GMH);
  const core = ensureCoreNamespace(GMH);

  adapters.Registry = adapters.Registry ?? null;
  adapters.register =
    adapters.register ?? ((_name: string, _config?: AdapterConfig) => undefined);
  adapters.getSelectors =
    adapters.getSelectors ??
    ((_name: string) => {
      return {} as AdapterSelectors;
    });
  adapters.getMetadata =
    adapters.getMetadata ??
    ((_name: string) => {
      return {} as AdapterMetadata;
    });
  adapters.list = adapters.list ?? (() => [] as string[]);

  const warnDetectFailure = (err: unknown): void => {
    const level = errorHandler?.LEVELS?.WARN || 'warn';
    errorHandler?.handle?.(err, 'adapter/detect', level);
  };

  const pickAdapter = (
    loc: Location | AdapterMatchLocation = location,
    doc: Document = document,
  ): GenitAdapter => {
    const candidates = Array.isArray(core.adapters) ? core.adapters : [];
    for (const adapter of candidates) {
      try {
        if (adapter?.match?.(loc, doc)) return adapter;
      } catch (err) {
        warnDetectFailure(err);
      }
    }
    return adapters.genit ?? defaultAdapter;
  };

  core.pickAdapter = pickAdapter;

  let activeAdapter: GenitAdapter | null = null;
  const getActiveAdapter = (): GenitAdapter => {
    if (!activeAdapter) {
      activeAdapter = pickAdapter(location, document);
    }
    return activeAdapter;
  };

  core.getActiveAdapter = getActiveAdapter;

  const guessPlayerNamesFromDOM = (): string[] => {
    const adapter = getActiveAdapter();
    return adapter?.guessPlayerNames?.() || [];
  };

  const updatePlayerNames = (): void => {
    const uniqueNames = new Set(
      [...PLAYER_NAME_FALLBACKS, ...guessPlayerNamesFromDOM()].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ),
    );
    const names = Array.from(uniqueNames);
    setPlayerNames(names);
    adapters.genit?.setPlayerNameAccessor?.(() => getPlayerNames());
  };

  return {
    pickAdapter,
    getActiveAdapter,
    guessPlayerNamesFromDOM,
    updatePlayerNames,
    resetActiveAdapter: () => {
      activeAdapter = null;
    },
  };
};

interface ComposeAdaptersOptions {
  GMH: GMHNamespace;
  adapterRegistry: AdapterRegistry;
  registerAdapterConfig: RegisterAdapterConfig;
  getAdapterSelectors: GetAdapterSelectors;
  getAdapterMetadata: GetAdapterMetadata;
  listAdapterNames: ListAdapterNames;
  createGenitAdapter: CreateGenitAdapter;
  errorHandler?: ErrorHandler | null;
  getPlayerNames: GetPlayerNames;
  setPlayerNames: SetPlayerNames;
  PLAYER_NAME_FALLBACKS: string[];
}

type ComposeAdaptersResult = AdapterAPI & {
  genitAdapter: GenitAdapter;
};

/**
 * Registers available DOM adapters and exposes helper APIs for adapter selection.
 *
 * @param options Injection container.
 * @returns Adapter utilities bound to the GMH namespace.
 */
export const composeAdapters = ({
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
}: ComposeAdaptersOptions): ComposeAdaptersResult => {
  const adapters = ensureAdaptersNamespace(GMH);
  const core = ensureCoreNamespace(GMH);

  adapters.Registry = adapterRegistry;
  adapters.register = (name, config) => registerAdapterConfig(name, config);
  adapters.getSelectors = (name) => getAdapterSelectors(name);
  adapters.getMetadata = (name) => getAdapterMetadata(name);
  adapters.list = () => listAdapterNames();

  registerGenitConfig(registerAdapterConfig);

  const genitAdapter = createGenitAdapter({
    registry: adapterRegistry,
    getPlayerNames,
    isPrologueBlock,
    errorHandler,
  });

  adapters.genit = genitAdapter;
  core.adapters = [genitAdapter];

  const api = createAdapterAPI({
    GMH,
    errorHandler,
    PLAYER_NAME_FALLBACKS,
    setPlayerNames,
    getPlayerNames,
    defaultAdapter: genitAdapter,
  });
  api.updatePlayerNames();

  return {
    genitAdapter,
    ...api,
  };
};
