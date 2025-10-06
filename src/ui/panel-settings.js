const PANEL_SETTINGS_STORAGE_KEY = 'gmh_panel_settings_v1';

/**
 * Creates the panel settings store with persistence, change notifications, and defaults.
 */
export function createPanelSettings({
  clone,
  deepMerge,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  logger = typeof console !== 'undefined' ? console : null,
} = {}) {
  if (typeof clone !== 'function' || typeof deepMerge !== 'function') {
    throw new Error('createPanelSettings requires clone and deepMerge helpers');
  }

  const DEFAULTS = {
    layout: {
      anchor: 'right',
      offset: 16,
      bottom: 16,
      width: null,
      height: null,
    },
    behavior: {
      autoHideEnabled: true,
      autoHideDelayMs: 10000,
      collapseOnOutside: false,
      collapseOnFocus: false,
      allowDrag: true,
      allowResize: true,
    },
  };

  const log = logger || { warn: () => {} };
  const settingsStore = storage;

  let settings = clone(DEFAULTS);

  if (settingsStore) {
    try {
      const raw = settingsStore.getItem(PANEL_SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        settings = deepMerge(clone(DEFAULTS), parsed);
      }
    } catch (err) {
      log?.warn?.('[GMH] failed to load panel settings', err);
      settings = clone(DEFAULTS);
    }
  }

  const listeners = new Set();

  const persist = () => {
    if (!settingsStore) return;
    try {
      settingsStore.setItem(PANEL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      log?.warn?.('[GMH] failed to persist panel settings', err);
    }
  };

  const notify = () => {
    const snapshot = clone(settings);
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        log?.warn?.('[GMH] panel settings listener failed', err);
      }
    });
  };

  return {
    STORAGE_KEY: PANEL_SETTINGS_STORAGE_KEY,
    defaults: clone(DEFAULTS),
    get() {
      return clone(settings);
    },
    update(patch) {
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
    reset() {
      const before = JSON.stringify(settings);
      const defaultsString = JSON.stringify(DEFAULTS);
      if (before === defaultsString) {
        settings = clone(DEFAULTS);
        return clone(settings);
      }
      settings = clone(DEFAULTS);
      persist();
      notify();
      return clone(settings);
    },
    onChange(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export { PANEL_SETTINGS_STORAGE_KEY };
