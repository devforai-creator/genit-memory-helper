export const GMH = {
  VERSION: '0.0.0-dev',
  Util: {},
  Privacy: {},
  Export: {},
  UI: {},
  Core: {},
  Adapters: {},
};

export const setNamespaceVersion = (version) => {
  if (typeof version === 'string' && version.trim()) {
    GMH.VERSION = version.trim();
  }
  return GMH.VERSION;
};

export default GMH;
