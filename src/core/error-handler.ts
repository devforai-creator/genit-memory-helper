import { GMH_STATE } from './state';
import type { ErrorHandler, ErrorHandlerOptions, ErrorLogEntry, PanelStateApi } from '../types';

const noop = (): void => {};

export const ERROR_LEVELS = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal',
} as const;

type ErrorLevel = (typeof ERROR_LEVELS)[keyof typeof ERROR_LEVELS];

export const ERROR_CONTEXT_LABELS: Record<string, string> = {
  'privacy/load': '프라이버시 설정 로드 실패',
  'privacy/save': '프라이버시 설정 저장 실패',
  'privacy/redact': '레다크션 실패',
  'storage/read': '저장소 읽기 실패',
  'storage/write': '저장소 쓰기 실패',
  snapshot: 'DOM 스냅샷 실패',
  parse: '파싱 실패',
  'parse/structured': '구조화 파싱 실패',
  export: '내보내기 실패',
  'export/file': '파일 다운로드 실패',
  'export/clipboard': '클립보드 복사 실패',
  autoload: '자동 로딩 실패',
  'autoload/scroll': '자동 스크롤 실패',
  'ui/panel': '패널 렌더링 실패',
  'ui/modal': '모달 표시 실패',
  adapter: '어댑터 오류',
  'adapter/detect': '어댑터 감지 실패',
  range: '범위 계산 실패',
  bookmark: '북마크 오류',
};

const ERROR_LOG_KEY = 'gmh_error_log';
const ERROR_LOG_MAX = 100;

const normalizeLevel = (level: string): ErrorLevel => {
  const validLevels = Object.values(ERROR_LEVELS);
  return validLevels.includes(level as ErrorLevel) ? (level as ErrorLevel) : ERROR_LEVELS.ERROR;
};

const extractMessage = (error: unknown): string => {
  if (!error) return '알 수 없는 오류';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
};

type ConsoleLike =
  | Console
  | {
      info?: (...args: unknown[]) => void;
      warn?: (...args: unknown[]) => void;
      error?: (...args: unknown[]) => void;
    };

const ensureConsole = (consoleLike?: ConsoleLike | null): ConsoleLike => {
  if (consoleLike) return consoleLike;
  if (typeof console !== 'undefined') return console;
  return { info: noop, warn: noop, error: noop };
};

export const createErrorHandler = ({
  console: consoleLike,
  alert: alertImpl,
  localStorage,
  state,
}: ErrorHandlerOptions = {}): ErrorHandler => {
  const logger = ensureConsole(consoleLike);
  const info = typeof logger.info === 'function' ? logger.info.bind(logger) : noop;
  const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop;
  const error = typeof logger.error === 'function' ? logger.error.bind(logger) : noop;
  const alertFn = typeof alertImpl === 'function' ? alertImpl : noop;
  const storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined =
    localStorage;
  const stateApi: PanelStateApi | undefined = state ?? undefined;

  const logToConsole = (
    context: string | undefined,
    message: string,
    original: unknown,
    level: ErrorLevel,
  ): void => {
    const prefix = `[GMH:${context}]`;
    switch (level) {
      case ERROR_LEVELS.DEBUG:
      case ERROR_LEVELS.INFO:
        return info(prefix, message, original);
      case ERROR_LEVELS.WARN:
        return warn(prefix, message, original);
      case ERROR_LEVELS.ERROR:
      case ERROR_LEVELS.FATAL:
      default:
        return error(prefix, message, original);
    }
  };

  const updateUIState = (context: string | undefined, message: string, level: ErrorLevel): void => {
    if (!stateApi || typeof stateApi.setState !== 'function') return;
    const label = ERROR_CONTEXT_LABELS[context] || '오류 발생';
    try {
      stateApi.setState(GMH_STATE.ERROR, {
        label,
        message,
        tone: level === ERROR_LEVELS.FATAL ? 'error' : 'error',
        progress: { value: 1 },
      });
    } catch (err) {
      error('[GMH] Failed to update UI state', err);
    }
  };

  const alertUser = (context: string | undefined, message: string): void => {
    const label = ERROR_CONTEXT_LABELS[context] || '오류';
    try {
      alertFn(`${label}\n\n${message}`);
    } catch (err) {
      error('[GMH] Failed to show alert', err);
    }
  };

  const persistError = (data: ErrorLogEntry): void => {
    if (!storage || typeof storage.getItem !== 'function') return;
    try {
      const stored = storage.getItem(ERROR_LOG_KEY);
      const errors = stored ? (JSON.parse(stored) as ErrorLogEntry[]) : [];
      errors.push(data);
      if (errors.length > ERROR_LOG_MAX) {
        errors.splice(0, errors.length - ERROR_LOG_MAX);
      }
      storage.setItem(ERROR_LOG_KEY, JSON.stringify(errors));
    } catch (err) {
      warn('[GMH] Failed to persist error log', err);
    }
  };

  const handler = {
    LEVELS: ERROR_LEVELS,
    handle(errorInput: unknown, context?: string, level: string = ERROR_LEVELS.ERROR) {
      const message = extractMessage(errorInput);
      const timestamp = new Date().toISOString();
      const normalizedLevel = normalizeLevel(level);
      let stackValue: string | null = null;
      if (typeof errorInput === 'object' && errorInput) {
        const stackCandidate = (errorInput as { stack?: unknown }).stack;
        if (typeof stackCandidate === 'string') {
          stackValue = stackCandidate;
        }
      }

      logToConsole(context, message, errorInput, normalizedLevel);

      if (normalizedLevel === ERROR_LEVELS.ERROR || normalizedLevel === ERROR_LEVELS.FATAL) {
        updateUIState(context, message, normalizedLevel);
      }

      if (normalizedLevel === ERROR_LEVELS.FATAL) {
        alertUser(context, message);
      }

      persistError({
        timestamp,
        context: context || 'unknown',
        level: normalizedLevel,
        message,
        stack: stackValue,
      });

      return message;
    },
    getErrorLog() {
      if (!storage || typeof storage.getItem !== 'function') return [];
      try {
        const stored = storage.getItem(ERROR_LOG_KEY);
        return stored ? (JSON.parse(stored) as ErrorLogEntry[]) : [];
      } catch (err) {
        warn('[GMH] Failed to read error log', err);
        return [];
      }
    },
    clearErrorLog() {
      if (!storage || typeof storage.removeItem !== 'function') return false;
      try {
        storage.removeItem(ERROR_LOG_KEY);
        return true;
      } catch (err) {
        warn('[GMH] Failed to clear error log', err);
        return false;
      }
    },
  };

  return handler as ErrorHandler;
};

export default createErrorHandler;
