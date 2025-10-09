type ClipboardInfo = string | { type?: string; mimetype?: string };
type ClipboardSetter = (data: string, info?: ClipboardInfo) => void;

interface TampermonkeyInfo {
  script: {
    name: string;
    version: string;
    [key: string]: unknown;
  };
  platform?: string;
  [key: string]: unknown;
}

interface TampermonkeyGlobals {
  GM_setClipboard?: ClipboardSetter;
  GM_info?: TampermonkeyInfo;
  unsafeWindow?: Window & typeof globalThis;
}

type ConsoleLike =
  | Console
  | {
      log: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
    };

interface Environment {
  window?: (Window & typeof globalThis) | undefined;
  GM_setClipboard: ClipboardSetter;
  GM_info: TampermonkeyInfo;
  console: ConsoleLike;
  localStorage?: Storage;
}

const noop = (): void => {};

const fallbackClipboard: ClipboardSetter = (text) => {
  if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(noop);
  }
};

const detectWindow = (
  globals: typeof globalThis & TampermonkeyGlobals,
): (Window & typeof globalThis) | undefined => {
  if (globals.unsafeWindow) return globals.unsafeWindow;
  if (typeof window !== 'undefined') return window as Window & typeof globalThis;
  return undefined;
};

const detectGMInfo = (globals: typeof globalThis & TampermonkeyGlobals): TampermonkeyInfo => {
  if (globals.GM_info?.script) {
    return globals.GM_info;
  }
  return {
    script: {
      name: 'genit-memory-helper',
      version: '0.0.0-dev',
    },
  };
};

const detectClipboard = (globals: typeof globalThis & TampermonkeyGlobals): ClipboardSetter => {
  if (typeof globals.GM_setClipboard === 'function') {
    return globals.GM_setClipboard.bind(globals);
  }
  return fallbackClipboard;
};

const detectConsole = (): ConsoleLike => {
  if (typeof console !== 'undefined') return console;
  return {
    log: noop,
    warn: noop,
    error: noop,
  };
};

const detectStorage = (): Storage | undefined => {
  if (typeof localStorage !== 'undefined') return localStorage;
  return undefined;
};

const globals = globalThis as typeof globalThis & TampermonkeyGlobals;

export const ENV: Environment = {
  window: detectWindow(globals),
  GM_setClipboard: detectClipboard(globals),
  GM_info: detectGMInfo(globals),
  console: detectConsole(),
  localStorage: detectStorage(),
};

export const getPageWindow = (): Environment['window'] => ENV.window;
