import { STORAGE_KEYS, PRIVACY_PROFILES, DEFAULT_PRIVACY_PROFILE } from './constants.js';

const noop = () => {};
const MAX_CUSTOM_LIST_ITEMS = 1000;
const MAX_CUSTOM_ITEM_LENGTH = 200;

const sanitizeList = (items = [], collapseSpaces = (value) => value) => {
  if (!Array.isArray(items)) {
    return {
      list: [],
      invalidType: Boolean(items),
      truncated: false,
      clipped: false,
    };
  }

  const list = [];
  let invalidType = false;
  let truncated = false;
  let clipped = false;

  for (let i = 0; i < items.length; i += 1) {
    if (list.length >= MAX_CUSTOM_LIST_ITEMS) {
      truncated = true;
      break;
    }
    const raw = items[i];
    if (typeof raw !== 'string') {
      if (raw !== undefined && raw !== null) invalidType = true;
      continue;
    }
    const collapsed = collapseSpaces(raw);
    const collapsedString = typeof collapsed === 'string' ? collapsed : String(collapsed || '');
    const trimmed = collapsedString.trim();
    if (!trimmed) {
      if (raw.trim?.()) invalidType = true;
      continue;
    }
    let entry = trimmed;
    if (entry.length > MAX_CUSTOM_ITEM_LENGTH) {
      entry = entry.slice(0, MAX_CUSTOM_ITEM_LENGTH);
      clipped = true;
    }
    list.push(entry);
  }

  if (items.length > MAX_CUSTOM_LIST_ITEMS) truncated = true;

  return { list, invalidType, truncated, clipped };
};

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

  const warnListIssue = (type, reason, context) => {
    const message = `[GMH] ${type} ${reason}`;
    safeHandle(new Error(message), context, errorHandler?.LEVELS?.WARN);
  };

  const applySanitizedList = (items, type, context) => {
    const { list, invalidType, truncated, clipped } = sanitizeList(items, collapseSpaces);
    if (invalidType) warnListIssue(type, 'contains invalid entries; dropping invalid values.', context);
    if (truncated) warnListIssue(type, `exceeded ${MAX_CUSTOM_LIST_ITEMS} entries; extra values dropped.`, context);
    if (clipped) warnListIssue(type, `entries trimmed to ${MAX_CUSTOM_ITEM_LENGTH} characters.`, context);
    return list;
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

    const rawBlacklist = readItem(STORAGE_KEYS.privacyBlacklist);
    const blacklist = (() => {
      if (!rawBlacklist) return [];
      try {
        const parsed = JSON.parse(rawBlacklist);
        return applySanitizedList(parsed, 'privacy blacklist', 'privacy/load');
      } catch (err) {
        safeHandle(err, 'privacy/load');
        return [];
      }
    })();

    const rawWhitelist = readItem(STORAGE_KEYS.privacyWhitelist);
    const whitelist = (() => {
      if (!rawWhitelist) return [];
      try {
        const parsed = JSON.parse(rawWhitelist);
        return applySanitizedList(parsed, 'privacy whitelist', 'privacy/load');
      } catch (err) {
        safeHandle(err, 'privacy/load');
        return [];
      }
    })();

    config.profile = profiles[profileKey] ? profileKey : defaultProfile;
    config.blacklist = blacklist;
    config.whitelist = whitelist;
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
    if (type === 'blacklist') config.blacklist = applySanitizedList(items, 'privacy blacklist', 'privacy/save');
    if (type === 'whitelist') config.whitelist = applySanitizedList(items, 'privacy whitelist', 'privacy/save');
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
