import type { PanelStateManager, StateManagerOptions } from '../types';

const noop = (): void => {};

export const GMH_STATE = {
  IDLE: 'idle',
  SCANNING: 'scanning',
  REDACTING: 'redacting',
  PREVIEW: 'preview',
  EXPORTING: 'exporting',
  DONE: 'done',
  ERROR: 'error',
} as const;

type GMHStateValue = (typeof GMH_STATE)[keyof typeof GMH_STATE];

export const STATE_TRANSITIONS: Record<GMHStateValue, GMHStateValue[]> = {
  idle: ['idle', 'scanning', 'redacting', 'error'],
  scanning: ['scanning', 'redacting', 'preview', 'done', 'error', 'idle'],
  redacting: ['redacting', 'preview', 'exporting', 'done', 'error', 'idle'],
  preview: ['preview', 'exporting', 'idle', 'done', 'error'],
  exporting: ['exporting', 'done', 'error', 'idle'],
  done: ['done', 'idle', 'scanning', 'redacting'],
  error: ['error', 'idle', 'scanning', 'redacting'],
};

const normalizeState = (value: unknown): GMHStateValue | null => {
  if (!value) return null;
  const next = String(value).toLowerCase();
  return Object.values(GMH_STATE).includes(next as GMHStateValue) ? (next as GMHStateValue) : null;
};

type StateMeta = Record<string, unknown> & { previous: string | null; payload: unknown };

type StateSubscriber = (state: GMHStateValue, meta?: StateMeta) => void;

export const createStateManager = ({ console: consoleLike, debug }: StateManagerOptions = {}): PanelStateManager => {
  const defaultConsole = typeof console !== 'undefined' ? console : null;
  const logger = consoleLike ?? defaultConsole ?? { warn: noop, error: noop };
  const warn: (...args: unknown[]) => void =
    typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop;
  const error: (...args: unknown[]) => void =
    typeof logger.error === 'function' ? logger.error.bind(logger) : noop;
  const debugLog = typeof debug === 'function' ? debug : noop;

  const subscribers = new Set<StateSubscriber>();

  const state: PanelStateManager = {
    current: GMH_STATE.IDLE,
    previous: null,
    payload: null,
    getState() {
      return this.current;
    },
    subscribe(listener: StateSubscriber) {
      if (typeof listener !== 'function') return noop;
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    setState(this: PanelStateManager, nextState: string, payload?: unknown) {
      const next = normalizeState(nextState);
      if (!next) {
        warn('[GMH] unknown state requested', nextState);
        return false;
      }
      const allowed = STATE_TRANSITIONS[this.current as GMHStateValue]?.includes(next);
      if (!allowed) {
        warn('[GMH] invalid state transition', this.current, '→', next);
        return false;
      }
      this.previous = this.current as GMHStateValue;
      this.current = next;
      this.payload = payload ?? null;
      try {
        debugLog('state →', this.current, this.payload);
      } catch {
        // swallow debug errors
      }
      subscribers.forEach((listener) => {
        try {
          const meta: StateMeta = {
            previous: this.previous,
            payload: this.payload,
          };
          listener(this.current as GMHStateValue, meta);
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
