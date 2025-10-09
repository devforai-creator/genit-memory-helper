import type { TurnBookmarkEntry, TurnBookmarks, TurnBookmarksOptions } from '../types';

type ConsoleWithWarn =
  | Console
  | {
      warn?: (...args: unknown[]) => void;
    };

type BookmarkListener = (entries: TurnBookmarkEntry[]) => void;

const noop = (): void => {};

const HISTORY_LIMIT = 5;

const cloneEntry = (entry: TurnBookmarkEntry | null | undefined): TurnBookmarkEntry | null =>
  entry ? { ...entry } : null;

const makeKey = (index: number, messageId: string | null): string => {
  if (typeof messageId === 'string' && messageId) return `id:${messageId}`;
  if (Number.isFinite(index)) return `idx:${index}`;
  return `tmp:${Date.now()}`;
};

export const createTurnBookmarks = ({ console: consoleLike }: TurnBookmarksOptions = {}): TurnBookmarks => {
  const logger: ConsoleWithWarn =
    (consoleLike as ConsoleWithWarn | null | undefined) ??
    (typeof console !== 'undefined' ? console : {});
  const warn =
    typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop;

  const history: TurnBookmarkEntry[] = [];
  const listeners = new Set<BookmarkListener>();

  const snapshotHistory = (): TurnBookmarkEntry[] =>
    history.map((item) => ({ ...item }));

  const emit = (): void => {
    const snapshot = snapshotHistory();
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        warn('[GMH] bookmark listener failed', err);
      }
    });
  };

  const api: TurnBookmarks = {
    record(index, ordinal, messageId, axis) {
      const numericIndex = Number(index);
      if (!Number.isFinite(numericIndex)) return null;

      let normalizedOrdinal: number | null = null;
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
          index: numericIndex,
          ordinal: normalizedOrdinal,
          messageId: normalizedId,
        });
      }

      const key = makeKey(numericIndex, normalizedId);
      const entry: TurnBookmarkEntry = {
        key,
        index: numericIndex,
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
      return cloneEntry(history[0]);
    },
    latest() {
      return cloneEntry(history[0]);
    },
    pick(key) {
      if (!key) return null;
      const found = history.find((item) => item.key === key);
      return cloneEntry(found);
    },
    list() {
      return snapshotHistory();
    },
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

  return api;
};

export default createTurnBookmarks;
