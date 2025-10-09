import { STORAGE_KEYS, PRIVACY_PROFILES, DEFAULT_PRIVACY_PROFILE } from './constants';
import { CONFIG } from '../config';
import type { ErrorHandler } from '../types';

const noop = (): void => {};
const MAX_CUSTOM_LIST_ITEMS = CONFIG.LIMITS.PRIVACY_LIST_MAX;
const MAX_CUSTOM_ITEM_LENGTH = CONFIG.LIMITS.PRIVACY_ITEM_MAX;
const DISALLOWED_PATTERN = /<|>|javascript:/i;

type CollapseSpaces = (value: string) => string;

type PrivacyProfilesMap = Record<
  string,
  {
    key?: string;
    label?: string;
    maskAddressHints?: boolean;
    maskNarrativeSensitive?: boolean;
    [key: string]: unknown;
  }
>;

type SanitizedListResult = {
  list: string[];
  invalidType: boolean;
  truncated: boolean;
  clipped: boolean;
};

export type PrivacyStoreConfig = {
  profile: string;
  blacklist: string[];
  whitelist: string[];
};

export type PrivacyStore = {
  config: PrivacyStoreConfig;
  load: () => PrivacyStoreConfig;
  persist: () => PrivacyStoreConfig;
  setProfile: (profileKey: string) => PrivacyStoreConfig;
  setCustomList: (type: 'blacklist' | 'whitelist', items: unknown) => PrivacyStoreConfig;
};

type PrivacyStoreOptions = {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  errorHandler?: ErrorHandler | null;
  collapseSpaces?: CollapseSpaces;
  defaultProfile?: string;
  profiles?: PrivacyProfilesMap;
};

const sanitizeList = (items: unknown, collapseSpaces: CollapseSpaces): SanitizedListResult => {
  if (!Array.isArray(items)) {
    return { list: [], invalidType: Boolean(items), truncated: false, clipped: false };
  }

  const list: string[] = [];
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
    const collapsedString = typeof collapsed === 'string' ? collapsed : String(collapsed ?? '');
    const trimmed = collapsedString.trim();
    if (!trimmed) {
      if (raw.trim?.()) invalidType = true;
      continue;
    }
    if (DISALLOWED_PATTERN.test(trimmed)) {
      invalidType = true;
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
  collapseSpaces = (value: string) => value,
  defaultProfile = DEFAULT_PRIVACY_PROFILE,
  profiles = PRIVACY_PROFILES,
}: PrivacyStoreOptions = {}): PrivacyStore => {
  const config: PrivacyStoreConfig = {
    profile: defaultProfile,
    blacklist: [],
    whitelist: [],
  };

  const safeHandle = (err: unknown, context?: string, level?: string): void => {
    if (!errorHandler?.handle) return;
    const severity = level || errorHandler.LEVELS?.WARN;
    try {
      errorHandler.handle(err, context, severity);
    } catch {
      noop();
    }
  };

  const warnListIssue = (type: string, reason: string, context: string): void => {
    const message = `[GMH] ${type} ${reason}`;
    safeHandle(new Error(message), context, errorHandler?.LEVELS?.WARN);
  };

  const applySanitizedList = (
    items: unknown,
    type: string,
    context: string,
  ): string[] => {
    const { list, invalidType, truncated, clipped } = sanitizeList(items, collapseSpaces);
    if (invalidType) warnListIssue(type, 'contains invalid entries; dropping invalid values.', context);
    if (truncated) warnListIssue(type, `exceeded ${MAX_CUSTOM_LIST_ITEMS} entries; extra values dropped.`, context);
    if (clipped) warnListIssue(type, `entries trimmed to ${MAX_CUSTOM_ITEM_LENGTH} characters.`, context);
    return list;
  };

  const readItem = (key: string): string | null => {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      return storage.getItem(key);
    } catch (err) {
      safeHandle(err, 'privacy/load');
      return null;
    }
  };

  const writeItem = (key: string, value: string): void => {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      storage.setItem(key, value);
    } catch (err) {
      safeHandle(err, 'privacy/save');
    }
  };

  const loadLists = (raw: string | null, label: string): string[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return applySanitizedList(parsed, label, 'privacy/load');
    } catch (err) {
      safeHandle(err, 'privacy/load');
      return [];
    }
  };

  const load = (): PrivacyStoreConfig => {
    const profileKey = readItem(STORAGE_KEYS.privacyProfile) || defaultProfile;
    const rawBlacklist = readItem(STORAGE_KEYS.privacyBlacklist);
    const rawWhitelist = readItem(STORAGE_KEYS.privacyWhitelist);

    config.profile = profiles[profileKey] ? profileKey : defaultProfile;
    config.blacklist = loadLists(rawBlacklist, 'privacy blacklist');
    config.whitelist = loadLists(rawWhitelist, 'privacy whitelist');
    return config;
  };

  const persist = (): PrivacyStoreConfig => {
    writeItem(STORAGE_KEYS.privacyProfile, config.profile);
    writeItem(STORAGE_KEYS.privacyBlacklist, JSON.stringify(config.blacklist || []));
    writeItem(STORAGE_KEYS.privacyWhitelist, JSON.stringify(config.whitelist || []));
    return config;
  };

  const setProfile = (profileKey: string): PrivacyStoreConfig => {
    config.profile = profiles[profileKey] ? profileKey : defaultProfile;
    return persist();
  };

  const setCustomList = (type: 'blacklist' | 'whitelist', items: unknown): PrivacyStoreConfig => {
    if (type === 'blacklist') {
      config.blacklist = applySanitizedList(items, 'privacy blacklist', 'privacy/save');
    }
    if (type === 'whitelist') {
      config.whitelist = applySanitizedList(items, 'privacy whitelist', 'privacy/save');
    }
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
