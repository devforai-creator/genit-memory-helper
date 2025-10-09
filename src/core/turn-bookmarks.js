/**
 * @typedef {import('../types').TurnBookmarksOptions} TurnBookmarksOptions
 * @typedef {import('../types').TurnBookmarks} TurnBookmarks
 * @typedef {import('../types').TurnBookmarkEntry} TurnBookmarkEntry
 */

/**
 * @returns {void}
 */
const noop = () => {};

/**
 * @param {TurnBookmarksOptions} [options]
 * @returns {TurnBookmarks}
 */
export const createTurnBookmarks = ({ console: consoleLike } = {}) => {
  const logger = consoleLike || (typeof console !== 'undefined' ? console : {});
  const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop;

  const HISTORY_LIMIT = 5;
  /** @type {TurnBookmarkEntry[]} */
  const history = [];
  /** @type {Set<(entries: TurnBookmarkEntry[]) => void>} */
  const listeners = new Set();

  /**
   * @param {unknown} entry
   * @returns {TurnBookmarkEntry | null}
   */
  const sanitizeEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const source = /** @type {Record<string, unknown>} */ (entry);
    const { axis, ...rest } = source;
    const entryKey = typeof rest.key === 'string' ? rest.key : null;
    if (axis && axis !== 'message') {
      warn('[GMH] entry-axis bookmark detected; forcing message ordinals', {
        axis,
        key: entryKey,
      });
    }
    const normalized = {
      key: entryKey || `tmp:${Date.now()}`,
      index: Number(rest.index ?? 0),
      ordinal:
        rest.ordinal !== null && rest.ordinal !== undefined && Number.isFinite(Number(rest.ordinal))
          ? Number(rest.ordinal)
          : null,
      messageId: typeof rest.messageId === 'string' && rest.messageId ? rest.messageId : null,
      timestamp: Number(rest.timestamp ?? Date.now()),
    };
    return normalized;
  };

  /**
   * @param {unknown} entry
   * @returns {TurnBookmarkEntry | null}
   */
  const cloneEntry = (entry) => {
    const sanitized = sanitizeEntry(entry);
    return sanitized ? { ...sanitized } : null;
  };

  /**
   * @param {number} index
   * @param {string | null} messageId
   * @returns {string}
   */
  const makeKey = (index, messageId) => {
    if (typeof messageId === 'string' && messageId) return `id:${messageId}`;
    if (Number.isFinite(Number(index))) return `idx:${Number(index)}`;
    return `tmp:${Date.now()}`;
  };

  /**
   * @returns {TurnBookmarkEntry[]}
   */
  const snapshotHistory = () =>
    /** @type {TurnBookmarkEntry[]} */ (
      history.map((item) => cloneEntry(item)).filter((entry) => entry !== null)
    );

  /**
   * @returns {void}
   */
  const emit = () => {
    const snapshot = snapshotHistory();
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        warn('[GMH] bookmark listener failed', err);
      }
    });
  };

  const api = {
    /**
     * @param {number} index
     * @param {number | null | undefined} ordinal
     * @param {string | null | undefined} messageId
     * @param {string | null | undefined} axis
     * @returns {TurnBookmarkEntry | null}
     */
    record(index, ordinal, messageId, axis) {
      if (!Number.isFinite(Number(index))) return null;
      const normalizedIndex = Number(index);
      let normalizedOrdinal = null;
      if (ordinal !== null && ordinal !== undefined) {
        const numericOrdinal = Number(ordinal);
        if (Number.isFinite(numericOrdinal) && numericOrdinal > 0) {
          normalizedOrdinal = numericOrdinal;
        }
      }
      const normalizedId = typeof messageId === 'string' && messageId ? messageId : null;
      if (axis && axis !== 'message') {
        warn('[GMH] non-message bookmark axis ignored', {
          axis,
          index: normalizedIndex,
          ordinal: normalizedOrdinal,
          messageId: normalizedId,
        });
      }
      const key = makeKey(normalizedIndex, normalizedId);
      const entry = {
        key,
        index: normalizedIndex,
        ordinal: normalizedOrdinal,
        messageId: normalizedId,
        timestamp: Date.now(),
      };
      const existing = history.findIndex((item) => item.key === key);
      if (existing !== -1) history.splice(existing, 1);
      history.unshift(entry);
      if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
      emit();
      return cloneEntry(entry);
    },
    /**
     * @returns {void}
     */
    clear() {
      if (!history.length) return;
      history.length = 0;
      emit();
    },
    /**
     * @param {string} key
     * @returns {void}
     */
    remove(key) {
      if (!key) return;
      const next = history.findIndex((item) => item.key === key);
      if (next === -1) return;
      history.splice(next, 1);
      emit();
    },
    get() {
      return history[0] ? cloneEntry(history[0]) : null;
    },
    latest() {
      return history[0] ? cloneEntry(history[0]) : null;
    },
    /**
     * @param {string} key
     * @returns {TurnBookmarkEntry | null}
     */
    pick(key) {
      if (!key) return null;
      const found = history.find((item) => item.key === key);
      return found ? cloneEntry(found) : null;
    },
    list() {
      return snapshotHistory();
    },
    /**
     * @param {(entries: TurnBookmarkEntry[]) => void} listener
     * @returns {() => void}
     */
    subscribe(listener) {
      if (typeof listener !== 'function') return noop;
      listeners.add(listener);
      try {
        listener(snapshotHistory());
      } catch (err) {
        warn('[GMH] bookmark subscriber failed', err);
      }
      return () => listeners.delete(listener);
    },
  };

  return /** @type {TurnBookmarks} */ (api);
};

export default createTurnBookmarks;
