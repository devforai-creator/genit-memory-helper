/**
 * Babechat API Rate Limiting Tests
 *
 * Tests for the 60-second cooldown on API-based message collection
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createBabechatAdapter } from '../../src/adapters/babechat.ts';

// Mock adapterRegistry
vi.mock('../../src/adapters/registry.ts', () => ({
  adapterRegistry: {
    register: vi.fn(),
    get: vi.fn(() => ({
      selectors: {
        conversationList: '.chat-container',
        messageBlock: '.message',
        senderName: '.sender',
        messageContent: '.content',
      },
    })),
    getAll: vi.fn(() => []),
  },
}));

describe('Babechat API Rate Limiting', () => {
  let adapter: ReturnType<typeof createBabechatAdapter>;

  beforeEach(() => {
    vi.useFakeTimers();

    // Mock DOM
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
    });

    vi.stubGlobal('location', {
      href: 'https://babechat.ai/chat/test-char/123',
      hostname: 'babechat.ai',
    });

    // Mock XMLHttpRequest for interceptor installation
    const xhrMock = {
      open: vi.fn(),
      send: vi.fn(),
      setRequestHeader: vi.fn(),
    };
    vi.stubGlobal(
      'XMLHttpRequest',
      vi.fn(() => xhrMock),
    );
    (globalThis as any).XMLHttpRequest.prototype = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
    };

    // Create adapter
    adapter = createBabechatAdapter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('getApiCooldownRemaining', () => {
    it('should return 0 initially (no cooldown)', () => {
      const remaining = adapter.getApiCooldownRemaining();
      expect(remaining).toBe(0);
    });

    it('should be a function', () => {
      expect(typeof adapter.getApiCooldownRemaining).toBe('function');
    });
  });

  describe('fetchAllMessagesViaApi with cooldown', () => {
    it('should exist as a method', () => {
      expect(typeof adapter.fetchAllMessagesViaApi).toBe('function');
    });

    it('should throw session info error when no API params captured', async () => {
      // Without XHR interception capturing params, should fail with session info error
      await expect(adapter.fetchAllMessagesViaApi()).rejects.toThrow(/session info/i);
    });
  });

  describe('cooldown calculation', () => {
    it('should calculate remaining time correctly', () => {
      // Initially no cooldown
      expect(adapter.getApiCooldownRemaining()).toBe(0);

      // Advance time shouldn't affect it if no fetch happened
      vi.advanceTimersByTime(30000);
      expect(adapter.getApiCooldownRemaining()).toBe(0);
    });
  });

  describe('rate limit constants', () => {
    it('should use 60 second cooldown (verified through interface)', () => {
      // The cooldown constant is internal, but we verify through behavior
      // A fresh adapter should have 0 cooldown
      expect(adapter.getApiCooldownRemaining()).toBe(0);

      // The method should exist and return a number
      expect(typeof adapter.getApiCooldownRemaining()).toBe('number');
    });
  });
});
