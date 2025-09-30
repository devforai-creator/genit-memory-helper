import { STORAGE_KEYS, PRIVACY_PROFILES, DEFAULT_PRIVACY_PROFILE } from './constants.js';

const noop = () => {};

const normalizeList = (items = [], collapseSpaces = (value) => value) =>
  Array.isArray(items)
    ? items
        .map((item) => collapseSpaces(item))
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : [];

export const createPrivacyStore = ({
  storage,
  errorHandler,
  collapseSpaces,
  defaultProfile = DEFAULT_PRIVACY_PROFILE,
  profiles = PRIVACY_PROFILES,
} = {}) => {
  const config = {
    profile: defaultProfile,
    blacklist: [],
    whitelist: [],
  };

  const safeHandle = (err, context, level) => {
    if (!errorHandler?.handle) return;
    const severity = level || errorHandler.LEVELS?.WARN;
    try {
      errorHandler.handle(err, context, severity);
    } catch (noopErr) {
      noop(noopErr);
    }
  };

  const readItem = (key) => {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      return storage.getItem(key);
    } catch (err) {
      safeHandle(err, 'privacy/load');
      return null;
    }
  };

  const writeItem = (key, value) => {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      storage.setItem(key, value);
    } catch (err) {
      safeHandle(err, 'privacy/save');
    }
  };

  const load = () => {
    const profileKey = readItem(STORAGE_KEYS.privacyProfile) || defaultProfile;

    let blacklist = [];
    const rawBlacklist = readItem(STORAGE_KEYS.privacyBlacklist);
    if (rawBlacklist) {
      try {
        const parsed = JSON.parse(rawBlacklist);
        blacklist = Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        safeHandle(err, 'privacy/load');
      }
    }

    let whitelist = [];
    const rawWhitelist = readItem(STORAGE_KEYS.privacyWhitelist);
    if (rawWhitelist) {
      try {
        const parsed = JSON.parse(rawWhitelist);
        whitelist = Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        safeHandle(err, 'privacy/load');
      }
    }

    config.profile = profiles[profileKey] ? profileKey : defaultProfile;
    config.blacklist = normalizeList(blacklist, collapseSpaces);
    config.whitelist = normalizeList(whitelist, collapseSpaces);
    return config;
  };

  const persist = () => {
    writeItem(STORAGE_KEYS.privacyProfile, config.profile);
    writeItem(STORAGE_KEYS.privacyBlacklist, JSON.stringify(config.blacklist || []));
    writeItem(STORAGE_KEYS.privacyWhitelist, JSON.stringify(config.whitelist || []));
    return config;
  };

  const setProfile = (profileKey) => {
    config.profile = profiles[profileKey] ? profileKey : defaultProfile;
    return persist();
  };

  const setCustomList = (type, items) => {
    const normalized = normalizeList(items, collapseSpaces);
    if (type === 'blacklist') config.blacklist = normalized;
    if (type === 'whitelist') config.whitelist = normalized;
    return persist();
  };

  load();

  return {
    config,
    load,
    persist,
    setProfile,
    setCustomList,
  };
};
