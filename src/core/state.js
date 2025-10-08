/**
 * @typedef {import('../../types/api').PanelStateManager} PanelStateManager
 * @typedef {import('../../types/api').StateManagerOptions} StateManagerOptions
 */

/**
 * @returns {void}
 */
const noop = () => {};

/** @type {Record<string, string>} */
export const GMH_STATE = {
  IDLE: 'idle',
  SCANNING: 'scanning',
  REDACTING: 'redacting',
  PREVIEW: 'preview',
  EXPORTING: 'exporting',
  DONE: 'done',
  ERROR: 'error',
};

/** @type {Record<string, string[]>} */
export const STATE_TRANSITIONS = {
  idle: ['idle', 'scanning', 'redacting', 'error'],
  scanning: ['scanning', 'redacting', 'preview', 'done', 'error', 'idle'],
  redacting: ['redacting', 'preview', 'exporting', 'done', 'error', 'idle'],
  preview: ['preview', 'exporting', 'idle', 'done', 'error'],
  exporting: ['exporting', 'done', 'error', 'idle'],
  done: ['done', 'idle', 'scanning', 'redacting'],
  error: ['error', 'idle', 'scanning', 'redacting'],
};

/**
 * @param {unknown} value
 * @returns {string | null}
 */
const normalizeState = (value) => {
  if (!value) return null;
  const next = String(value).toLowerCase();
  return Object.values(GMH_STATE).includes(next) ? next : null;
};

/**
 * @param {StateManagerOptions} [options]
 * @returns {PanelStateManager}
 */
export const createStateManager = ({ console: consoleLike, debug } = {}) => {
  const logger = consoleLike || (typeof console !== 'undefined' ? console : { warn: noop, error: noop });
  const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop;
  const error = typeof logger.error === 'function' ? logger.error.bind(logger) : noop;
  const debugLog = typeof debug === 'function' ? debug : noop;

  /** @type {Set<(state: string, meta: { previous: string | null; payload: unknown }) => void>} */
  const subscribers = new Set();

  /** @type {PanelStateManager} */
  const state = {
    current: GMH_STATE.IDLE,
    previous: null,
    payload: null,
    getState() {
      return this.current;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return noop;
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    setState(nextState, payload) {
      const next = normalizeState(nextState);
      if (!next) {
        warn('[GMH] unknown state requested', nextState);
        return false;
      }
      const allowed = STATE_TRANSITIONS[this.current]?.includes(next);
      if (!allowed) {
        warn('[GMH] invalid state transition', this.current, '→', next);
        return false;
      }
      this.previous = this.current;
      this.current = next;
      this.payload = payload ?? null;
      try {
        debugLog('state →', this.current, this.payload);
      } catch (err) {
        // swallow debug errors
      }
      subscribers.forEach((listener) => {
        try {
          listener(this.current, {
            previous: this.previous,
            payload: this.payload,
          });
        } catch (err) {
          error('[GMH] state listener failed', err);
        }
      });
      return true;
    },
    reset() {
      this.setState(GMH_STATE.IDLE, null);
    },
  };

  return state;
};

export default createStateManager;
