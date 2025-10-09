const PANEL_SETTINGS_STORAGE_KEY = 'gmh_panel_settings_v1';

/**
 * @typedef {import('../types').PanelSettingsController} PanelSettingsController
 * @typedef {import('../types').PanelSettingsValue} PanelSettingsValue
 * @typedef {import('../types').PanelSettingsLayout} PanelSettingsLayout
 * @typedef {import('../types').PanelSettingsBehavior} PanelSettingsBehavior
 */

/**
 * @typedef {object} PanelSettingsOptions
 * @property {<T>(value: T) => T} clone
 * @property {(target: PanelSettingsValue, patch: unknown) => PanelSettingsValue} deepMerge
 * @property {Pick<Storage, 'getItem' | 'setItem'> | null} [storage]
 * @property {Console | { warn?: (...args: unknown[]) => void } | null} [logger]
 */

/**
 * Creates the panel settings store with persistence, change notifications, and defaults.
 *
 * @param {PanelSettingsOptions} [options]
 * @returns {PanelSettingsController}
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

  /** @type {PanelSettingsValue} */
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

  /** @type {Set<(value: PanelSettingsValue) => void>} */
  const listeners = new Set();

  /**
   * @returns {void}
   */
  const persist = () => {
    if (!settingsStore) return;
    try {
      settingsStore.setItem(PANEL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      log?.warn?.('[GMH] failed to persist panel settings', err);
    }
  };

  /**
   * @returns {void}
   */
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
    /**
     * @returns {PanelSettingsValue}
     */
    get() {
      return clone(settings);
    },
    /**
     * @param {Partial<PanelSettingsValue>} patch
     * @returns {PanelSettingsValue}
     */
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
    /**
     * @returns {PanelSettingsValue}
     */
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
    /**
     * @param {(value: PanelSettingsValue) => void} listener
     * @returns {() => void}
     */
    onChange(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export { PANEL_SETTINGS_STORAGE_KEY };
