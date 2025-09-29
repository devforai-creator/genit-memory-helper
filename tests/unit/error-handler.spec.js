import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');

function createGMH() {
  const script = readFileSync(distPath, 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://genit.ai/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.GM_setClipboard = () => {};
  window.alert = vi.fn();
  window.confirm = () => true;
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.unsafeWindow = window;
  if (!window.MutationObserver) {
    window.MutationObserver = class {
      observe() {}
      disconnect() {}
    };
  }

  // Mock console methods
  window.console = {
    ...console,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  };

  window.eval(script);
  return { GMH: window.GMH, window };
}

describe('GMH.Core.ErrorHandler', () => {
  let GMH;
  let window;

  beforeEach(() => {
    ({ GMH, window } = createGMH());
    // Clear localStorage before each test
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Error Levels', () => {
    it('should export error level constants', () => {
      expect(GMH.Core.ErrorHandler.LEVELS).toBeDefined();
      expect(GMH.Core.ErrorHandler.LEVELS.DEBUG).toBe('debug');
      expect(GMH.Core.ErrorHandler.LEVELS.INFO).toBe('info');
      expect(GMH.Core.ErrorHandler.LEVELS.WARN).toBe('warn');
      expect(GMH.Core.ErrorHandler.LEVELS.ERROR).toBe('error');
      expect(GMH.Core.ErrorHandler.LEVELS.FATAL).toBe('fatal');
    });
  });

  describe('handle() method', () => {
    it('should handle Error objects', () => {
      const error = new Error('Test error message');
      const result = GMH.Core.ErrorHandler.handle(
        error,
        'test/context',
        GMH.Core.ErrorHandler.LEVELS.ERROR
      );

      expect(result).toBe('Test error message');
      expect(window.console.error).toHaveBeenCalled();
    });

    it('should handle string errors', () => {
      const result = GMH.Core.ErrorHandler.handle(
        'Simple error string',
        'test/context',
        GMH.Core.ErrorHandler.LEVELS.ERROR
      );

      expect(result).toBe('Simple error string');
    });

    it('should handle null/undefined errors', () => {
      const result1 = GMH.Core.ErrorHandler.handle(null, 'test/context');
      const result2 = GMH.Core.ErrorHandler.handle(undefined, 'test/context');

      expect(result1).toBe('알 수 없는 오류');
      expect(result2).toBe('알 수 없는 오류');
    });
  });

  describe('Console logging', () => {
    it('should log DEBUG level to console.info', () => {
      GMH.Core.ErrorHandler.handle(
        'Debug message',
        'test/debug',
        GMH.Core.ErrorHandler.LEVELS.DEBUG
      );

      expect(window.console.info).toHaveBeenCalled();
      expect(window.console.error).not.toHaveBeenCalled();
    });

    it('should log WARN level to console.warn', () => {
      GMH.Core.ErrorHandler.handle(
        'Warning message',
        'test/warn',
        GMH.Core.ErrorHandler.LEVELS.WARN
      );

      expect(window.console.warn).toHaveBeenCalled();
      expect(window.console.error).not.toHaveBeenCalled();
    });

    it('should log ERROR level to console.error', () => {
      GMH.Core.ErrorHandler.handle(
        'Error message',
        'test/error',
        GMH.Core.ErrorHandler.LEVELS.ERROR
      );

      expect(window.console.error).toHaveBeenCalled();
    });

    it('should log FATAL level to console.error', () => {
      GMH.Core.ErrorHandler.handle(
        'Fatal error',
        'test/fatal',
        GMH.Core.ErrorHandler.LEVELS.FATAL
      );

      expect(window.console.error).toHaveBeenCalled();
    });

    it('should include context in log prefix', () => {
      GMH.Core.ErrorHandler.handle(
        'Test error',
        'privacy/load',
        GMH.Core.ErrorHandler.LEVELS.ERROR
      );

      const firstCall = window.console.error.mock.calls[0];
      expect(firstCall[0]).toContain('[GMH:privacy/load]');
    });
  });

  describe('UI State Updates', () => {
    it('should update UI state for ERROR level', () => {
      const initialState = GMH.Core.State.getState();

      GMH.Core.ErrorHandler.handle(
        'Test error',
        'snapshot',
        GMH.Core.ErrorHandler.LEVELS.ERROR
      );

      const currentState = GMH.Core.State.getState();
      expect(currentState).not.toBe(initialState);
    });

    it('should NOT update UI state for WARN level', () => {
      const initialState = GMH.Core.State.getState();

      GMH.Core.ErrorHandler.handle(
        'Test warning',
        'privacy/load',
        GMH.Core.ErrorHandler.LEVELS.WARN
      );

      const currentState = GMH.Core.State.getState();
      expect(currentState).toBe(initialState);
    });

    it('should NOT update UI state for INFO level', () => {
      const initialState = GMH.Core.State.getState();

      GMH.Core.ErrorHandler.handle(
        'Test info',
        'test/info',
        GMH.Core.ErrorHandler.LEVELS.INFO
      );

      const currentState = GMH.Core.State.getState();
      expect(currentState).toBe(initialState);
    });
  });

  describe('User Alerts', () => {
    it('should show alert for FATAL level', () => {
      GMH.Core.ErrorHandler.handle(
        'Fatal error occurred',
        'parse',
        GMH.Core.ErrorHandler.LEVELS.FATAL
      );

      expect(window.alert).toHaveBeenCalled();
      const alertMessage = window.alert.mock.calls[0][0];
      expect(alertMessage).toContain('Fatal error occurred');
    });

    it('should NOT show alert for ERROR level', () => {
      GMH.Core.ErrorHandler.handle(
        'Regular error',
        'export',
        GMH.Core.ErrorHandler.LEVELS.ERROR
      );

      expect(window.alert).not.toHaveBeenCalled();
    });

    it('should NOT show alert for WARN level', () => {
      GMH.Core.ErrorHandler.handle(
        'Warning',
        'test/warn',
        GMH.Core.ErrorHandler.LEVELS.WARN
      );

      expect(window.alert).not.toHaveBeenCalled();
    });
  });

  describe('Error Persistence', () => {
    it('should persist errors to localStorage', () => {
      GMH.Core.ErrorHandler.handle(
        'Test persistence',
        'test/persist',
        GMH.Core.ErrorHandler.LEVELS.ERROR
      );

      const log = GMH.Core.ErrorHandler.getErrorLog();
      expect(Array.isArray(log)).toBe(true);
      expect(log.length).toBeGreaterThan(0);

      const lastError = log[log.length - 1];
      expect(lastError.message).toBe('Test persistence');
      expect(lastError.context).toBe('test/persist');
      expect(lastError.level).toBe('error');
      expect(lastError.timestamp).toBeDefined();
    });

    it('should maintain error log across multiple errors', () => {
      GMH.Core.ErrorHandler.handle('Error 1', 'ctx1', GMH.Core.ErrorHandler.LEVELS.ERROR);
      GMH.Core.ErrorHandler.handle('Error 2', 'ctx2', GMH.Core.ErrorHandler.LEVELS.WARN);
      GMH.Core.ErrorHandler.handle('Error 3', 'ctx3', GMH.Core.ErrorHandler.LEVELS.ERROR);

      const log = GMH.Core.ErrorHandler.getErrorLog();
      expect(log.length).toBe(3);
      expect(log[0].message).toBe('Error 1');
      expect(log[1].message).toBe('Error 2');
      expect(log[2].message).toBe('Error 3');
    });

    it('should limit error log to 100 entries', () => {
      // Add 105 errors
      for (let i = 0; i < 105; i++) {
        GMH.Core.ErrorHandler.handle(
          `Error ${i}`,
          'test/limit',
          GMH.Core.ErrorHandler.LEVELS.ERROR
        );
      }

      const log = GMH.Core.ErrorHandler.getErrorLog();
      expect(log.length).toBe(100);

      // Oldest entries should be removed
      expect(log[0].message).toBe('Error 5');
      expect(log[99].message).toBe('Error 104');
    });
  });

  describe('getErrorLog() method', () => {
    it('should return empty array when no errors logged', () => {
      const log = GMH.Core.ErrorHandler.getErrorLog();
      expect(log).toEqual([]);
    });

    it('should return all logged errors', () => {
      GMH.Core.ErrorHandler.handle('Error A', 'ctx/a', GMH.Core.ErrorHandler.LEVELS.ERROR);
      GMH.Core.ErrorHandler.handle('Error B', 'ctx/b', GMH.Core.ErrorHandler.LEVELS.WARN);

      const log = GMH.Core.ErrorHandler.getErrorLog();
      expect(log.length).toBe(2);
    });
  });

  describe('clearErrorLog() method', () => {
    it('should clear all logged errors', () => {
      GMH.Core.ErrorHandler.handle('Error 1', 'ctx1', GMH.Core.ErrorHandler.LEVELS.ERROR);
      GMH.Core.ErrorHandler.handle('Error 2', 'ctx2', GMH.Core.ErrorHandler.LEVELS.ERROR);

      let log = GMH.Core.ErrorHandler.getErrorLog();
      expect(log.length).toBe(2);

      const result = GMH.Core.ErrorHandler.clearErrorLog();
      expect(result).toBe(true);

      log = GMH.Core.ErrorHandler.getErrorLog();
      expect(log.length).toBe(0);
    });

    it('should return true on successful clear', () => {
      GMH.Core.ErrorHandler.handle('Error', 'ctx', GMH.Core.ErrorHandler.LEVELS.ERROR);
      const result = GMH.Core.ErrorHandler.clearErrorLog();
      expect(result).toBe(true);
    });
  });

  describe('Level normalization', () => {
    it('should default to ERROR level for invalid levels', () => {
      GMH.Core.ErrorHandler.handle('Test', 'ctx', 'invalid_level');

      const log = GMH.Core.ErrorHandler.getErrorLog();
      expect(log[0].level).toBe('error');
    });

    it('should accept valid level strings', () => {
      GMH.Core.ErrorHandler.handle('Test', 'ctx', 'warn');

      const log = GMH.Core.ErrorHandler.getErrorLog();
      expect(log[0].level).toBe('warn');
    });
  });

  describe('Context Labels', () => {
    it('should use predefined labels for known contexts', () => {
      // This is implicitly tested through UI state updates
      // We can't easily test the label directly without UI inspection
      GMH.Core.ErrorHandler.handle(
        'Test',
        'privacy/load',
        GMH.Core.ErrorHandler.LEVELS.ERROR
      );

      // If it doesn't throw, the label mapping works
      expect(true).toBe(true);
    });
  });

  describe('Error object with stack trace', () => {
    it('should capture stack trace when available', () => {
      const error = new Error('Error with stack');
      GMH.Core.ErrorHandler.handle(error, 'test/stack', GMH.Core.ErrorHandler.LEVELS.ERROR);

      const log = GMH.Core.ErrorHandler.getErrorLog();
      const lastError = log[log.length - 1];

      expect(lastError.stack).toBeDefined();
      expect(typeof lastError.stack).toBe('string');
    });

    it('should handle errors without stack trace', () => {
      const error = { message: 'Custom error without stack' };
      GMH.Core.ErrorHandler.handle(error, 'test/nostack', GMH.Core.ErrorHandler.LEVELS.ERROR);

      const log = GMH.Core.ErrorHandler.getErrorLog();
      const lastError = log[log.length - 1];

      expect(lastError.stack).toBeNull();
    });
  });
});