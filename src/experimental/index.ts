import { ENV } from '../env';
import type {
  ExperimentalNamespace,
  ExperimentalFeatureFlag,
  ExperimentalNamespaceOptions,
} from '../types';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type ConsoleLike = Pick<Console, 'log' | 'warn'>;

export const EXPERIMENTAL_STORAGE_PREFIX = 'gmh_experimental_';
export const MEMORY_INDEX_STORAGE_KEY = `${EXPERIMENTAL_STORAGE_PREFIX}memory`;

const selectStorage = (storage?: StorageLike | null): StorageLike | null => {
  if (storage) return storage;
  if (ENV.localStorage) return ENV.localStorage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
};

const selectConsole = (consoleRef?: ConsoleLike | null): ConsoleLike | null => {
  if (consoleRef) return consoleRef;
  if (ENV.console) return ENV.console as ConsoleLike;
  if (typeof console !== 'undefined') return console;
  return null;
};

const createBooleanFlag = (
  key: string,
  label: string,
  storage: StorageLike | null,
  consoleRef: ConsoleLike | null,
): ExperimentalFeatureFlag => {
  const readEnabled = (): boolean => {
    if (!storage) return false;
    try {
      return storage.getItem(key) === '1';
    } catch (err) {
      consoleRef?.warn?.(`[GMH] Failed to read ${label} flag`, err);
      return false;
    }
  };

  const write = (setter: (store: StorageLike) => void): boolean => {
    if (!storage) {
      consoleRef?.warn?.(
        `[GMH] Experimental flag "${label}" requires localStorage support. Operation skipped.`,
      );
      return false;
    }
    try {
      setter(storage);
      return true;
    } catch (err) {
      consoleRef?.warn?.(`[GMH] Failed to update ${label} flag`, err);
      return false;
    }
  };

  return {
    get enabled() {
      return readEnabled();
    },
    enable() {
      const result = write((store) => {
        store.setItem(key, '1');
      });
      if (result) {
        consoleRef?.log?.(`[GMH] ${label} experimental flag enabled. Reload required.`);
      }
      return result;
    },
    disable() {
      const result = write((store) => {
        store.removeItem(key);
      });
      if (result) {
        consoleRef?.log?.(`[GMH] ${label} experimental flag disabled. Reload recommended.`);
      }
      return result;
    },
  };
};

export const createExperimentalNamespace = (
  options: ExperimentalNamespaceOptions = {},
): ExperimentalNamespace => {
  const storage = selectStorage(options.storage ?? null);
  const consoleRef = selectConsole(options.console ?? null);

  return {
    MemoryIndex: createBooleanFlag(MEMORY_INDEX_STORAGE_KEY, 'Memory Index', storage, consoleRef),
  };
};

export const GMHExperimental = createExperimentalNamespace();

export default GMHExperimental;
