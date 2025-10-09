import type {
  PanelSettingsController,
  PanelSettingsValue,
  PanelSettingsLayout,
  PanelSettingsBehavior,
} from '../types';

const PANEL_SETTINGS_STORAGE_KEY = 'gmh_panel_settings_v1';

type PanelSettingsOptions = {
  clone<T>(value: T): T;
  deepMerge(target: PanelSettingsValue, patch: unknown): PanelSettingsValue;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  logger?: Console | { warn?: (...args: unknown[]) => void } | null;
};

type PanelSettingsControllerInternal = PanelSettingsController & {
  STORAGE_KEY: string;
  defaults: PanelSettingsValue;
};

const DEFAULTS: PanelSettingsValue = {
  layout: {
    anchor: 'right',
    offset: 16,
    bottom: 16,
    width: null,
    height: null,
  } satisfies PanelSettingsLayout,
  behavior: {
    autoHideEnabled: true,
    autoHideDelayMs: 10000,
    collapseOnOutside: false,
    collapseOnFocus: false,
    allowDrag: true,
    allowResize: true,
  } satisfies PanelSettingsBehavior,
};

/**
 * Creates the panel settings store with persistence, change notifications, and defaults.
 */
export function createPanelSettings({
  clone,
  deepMerge,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  logger = typeof console !== 'undefined' ? console : null,
}: PanelSettingsOptions): PanelSettingsControllerInternal {
  if (typeof clone !== 'function' || typeof deepMerge !== 'function') {
    throw new Error('createPanelSettings requires clone and deepMerge helpers');
  }

  let settings: PanelSettingsValue = clone(DEFAULTS);

  const log = logger ?? { warn: () => {} };
  const settingsStore = storage ?? null;

  if (settingsStore) {
    try {
      const raw = settingsStore.getItem(PANEL_SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        settings = deepMerge(clone(DEFAULTS), parsed);
      }
    } catch (error) {
      log?.warn?.('[GMH] failed to load panel settings', error);
      settings = clone(DEFAULTS);
    }
  }

  const listeners = new Set<(value: PanelSettingsValue) => void>();

  const persist = (): void => {
    if (!settingsStore) return;
    try {
      settingsStore.setItem(PANEL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      log?.warn?.('[GMH] failed to persist panel settings', error);
    }
  };

  const notify = (): void => {
    const snapshot = clone(settings);
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        log?.warn?.('[GMH] panel settings listener failed', error);
      }
    });
  };

  const controller: PanelSettingsControllerInternal = {
    STORAGE_KEY: PANEL_SETTINGS_STORAGE_KEY,
    defaults: clone(DEFAULTS),
    get(): PanelSettingsValue {
      return clone(settings);
    },
    update(patch: Partial<PanelSettingsValue>): PanelSettingsValue {
      if (!patch || typeof patch !== 'object') return clone(settings);
      const nextSettings = deepMerge(settings, patch);
      const before = JSON.stringify(settings);
      const after = JSON.stringify(nextSettings);
      if (after === before) return clone(settings);
      settings = nextSettings;
      persist();
      notify();
      return clone(settings);
    },
    reset(): PanelSettingsValue {
      const current = JSON.stringify(settings);
      const defaultsString = JSON.stringify(DEFAULTS);
      if (current === defaultsString) {
        settings = clone(DEFAULTS);
        return clone(settings);
      }
      settings = clone(DEFAULTS);
      persist();
      notify();
      return clone(settings);
    },
    onChange(listener: (value: PanelSettingsValue) => void): () => void {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return controller;
}

export { PANEL_SETTINGS_STORAGE_KEY };
