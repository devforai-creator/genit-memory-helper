import { describe, expect, it, beforeEach } from 'vitest';

import { createPrivacyStore } from '../../src/privacy/settings.js';
import { STORAGE_KEYS } from '../../src/privacy/constants.js';

const MAX_ITEMS = 1000;
const MAX_ITEM_LENGTH = 200;

const createStorage = () => {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
    data: store,
  };
};

describe('createPrivacyStore', () => {
  let storage;
  let captured;
  let errorHandler;

  beforeEach(() => {
    storage = createStorage();
    captured = [];
    errorHandler = {
      LEVELS: { WARN: 'warn' },
      handle(err, context, level) {
        captured.push({ err, context, level });
      },
    };
  });

  it('truncates oversized blacklist from storage during load', () => {
    const oversized = Array(MAX_ITEMS + 5).fill('entry');
    storage.setItem(STORAGE_KEYS.privacyBlacklist, JSON.stringify(oversized));

    const store = createPrivacyStore({
      storage,
      errorHandler,
      collapseSpaces: (value) => value,
    });

    expect(store.config.blacklist).toHaveLength(MAX_ITEMS);
    expect(store.config.blacklist.every((item) => item === 'entry')).toBe(true);
    const warnings = captured.filter((entry) => entry.context === 'privacy/load');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('limits item length and drops invalid entries when saving custom lists', () => {
    const longValue = 'x'.repeat(MAX_ITEM_LENGTH + 25);
    const store = createPrivacyStore({
      storage,
      errorHandler,
      collapseSpaces: (value) => value,
    });

    captured.length = 0;

    store.setCustomList('blacklist', [longValue, 123, '  ']);

    expect(store.config.blacklist).toHaveLength(1);
    expect(store.config.blacklist[0]).toHaveLength(MAX_ITEM_LENGTH);

    const persisted = JSON.parse(storage.getItem(STORAGE_KEYS.privacyBlacklist));
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toHaveLength(MAX_ITEM_LENGTH);

    const warnings = captured.filter((entry) => entry.context === 'privacy/save');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('drops entries containing HTML or javascript patterns when loading from storage', () => {
    const malicious = ['<script>alert(1)</script>', 'javascript:alert(1)', ' 정상'];
    storage.setItem(STORAGE_KEYS.privacyWhitelist, JSON.stringify(malicious));

    const store = createPrivacyStore({
      storage,
      errorHandler,
      collapseSpaces: (value) => value,
    });

    expect(store.config.whitelist).toEqual(['정상']);
    const warnings = captured.filter((entry) => entry.context === 'privacy/load');
    expect(warnings.length).toBeGreaterThan(0);
  });
});
