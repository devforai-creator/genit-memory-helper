const fallbackClipboard = (text) => {
  if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
};

const detectWindow = () => {
  if (typeof unsafeWindow !== 'undefined') return unsafeWindow;
  if (typeof window !== 'undefined') return window;
  return undefined;
};

const detectGMInfo = () => {
  if (typeof GM_info !== 'undefined' && GM_info?.script) {
    return GM_info;
  }
  return { script: { version: '0.0.0-dev' } };
};

export const ENV = {
  window: detectWindow(),
  GM_setClipboard:
    typeof GM_setClipboard === 'function' ? GM_setClipboard : fallbackClipboard,
  GM_info: detectGMInfo(),
  console: typeof console !== 'undefined' ? console : { log() {}, warn() {}, error() {} },
  localStorage:
    typeof localStorage !== 'undefined' ? localStorage : undefined,
};

export const getPageWindow = () => ENV.window;
