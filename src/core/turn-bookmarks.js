const noop = () => {};

export const createTurnBookmarks = ({ console: consoleLike } = {}) => {
  const logger = consoleLike || (typeof console !== 'undefined' ? console : {});
  const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop;

  const HISTORY_LIMIT = 5;
  const history = [];
  const listeners = new Set();

  const sanitizeEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const { axis, ...rest } = entry;
    if (axis && axis !== 'message') {
      warn('[GMH] entry-axis bookmark detected; forcing message ordinals', {
        axis,
        key: entry?.key,
      });
    }
    return rest;
  };

  const cloneEntry = (entry) => {
    const sanitized = sanitizeEntry(entry);
    return sanitized ? { ...sanitized } : null;
  };

  const makeKey = (index, messageId) => {
    if (typeof messageId === 'string' && messageId) return `id:${messageId}`;
    if (Number.isFinite(Number(index))) return `idx:${Number(index)}`;
    return `tmp:${Date.now()}`;
  };

  const emit = () => {
    const snapshot = history.map(cloneEntry).filter(Boolean);
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        warn('[GMH] bookmark listener failed', err);
      }
    });
  };

  return {
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
    clear() {
      if (!history.length) return;
      history.length = 0;
      emit();
    },
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
    pick(key) {
      if (!key) return null;
      const found = history.find((item) => item.key === key);
      return found ? cloneEntry(found) : null;
    },
    list() {
      return history.map(cloneEntry).filter(Boolean);
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return noop;
      listeners.add(listener);
      try {
        listener(history.map(cloneEntry).filter(Boolean));
      } catch (err) {
        warn('[GMH] bookmark subscriber failed', err);
      }
      return () => listeners.delete(listener);
    },
  };
};

export default createTurnBookmarks;
