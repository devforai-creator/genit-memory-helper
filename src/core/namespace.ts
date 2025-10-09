import type { GMHNamespace } from '../types';

const createModuleBucket = (): Record<string, unknown> => ({});

export const GMH: GMHNamespace = {
  VERSION: '0.0.0-dev',
  Util: createModuleBucket(),
  Privacy: createModuleBucket(),
  Export: createModuleBucket(),
  UI: createModuleBucket(),
  Core: createModuleBucket(),
  Adapters: createModuleBucket(),
  Settings: createModuleBucket(),
  Flags: createModuleBucket(),
};

export const setNamespaceVersion = (version: unknown): string => {
  if (typeof version === 'string' && version.trim()) {
    GMH.VERSION = version.trim();
  }
  return GMH.VERSION;
};

export default GMH;
