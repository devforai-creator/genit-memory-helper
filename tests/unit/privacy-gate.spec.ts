import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { createModernPrivacyGate } from '../../src/ui/privacy-gate';

describe('Privacy Gate', () => {
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://genit.ai/',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    });
    document = dom.window.document;
  });

  describe('createModernPrivacyGate factory', () => {
    it('throws if documentRef is missing', () => {
      expect(() => {
        createModernPrivacyGate({
          documentRef: null,
          ensureDesignSystemStyles: () => {},
          modal: { open: async () => true },
        });
      }).toThrow();
    });

    it('throws if ensureDesignSystemStyles is missing', () => {
      expect(() => {
        createModernPrivacyGate({
          documentRef: document,
          modal: { open: async () => true },
        } as any);
      }).toThrow('ensureDesignSystemStyles');
    });

    it('throws if modal is missing', () => {
      expect(() => {
        createModernPrivacyGate({
          documentRef: document,
          ensureDesignSystemStyles: () => {},
        } as any);
      }).toThrow('modal');
    });

    it('creates gate with valid options', () => {
      const gate = createModernPrivacyGate({
        documentRef: document,
        ensureDesignSystemStyles: () => {},
        modal: { open: async () => true },
      });

      expect(gate).toBeDefined();
      expect(typeof gate.confirm).toBe('function');
    });
  });

  describe('confirm() method', () => {
    it('throws if profile is missing', async () => {
      const gate = createModernPrivacyGate({
        documentRef: document,
        ensureDesignSystemStyles: () => {},
        modal: { open: async () => true },
      });

      await expect(
        gate.confirm({
          counts: { EMAIL: 1 },
          stats: { userMessages: 5, llmMessages: 10 },
        } as any),
      ).rejects.toThrow('profile');
    });

    it('throws if counts is missing', async () => {
      const gate = createModernPrivacyGate({
        documentRef: document,
        ensureDesignSystemStyles: () => {},
        modal: { open: async () => true },
      });

      await expect(
        gate.confirm({
          profile: 'standard',
          stats: { userMessages: 5, llmMessages: 10 },
        } as any),
      ).rejects.toThrow('counts');
    });

    it('throws if stats is missing', async () => {
      const gate = createModernPrivacyGate({
        documentRef: document,
        ensureDesignSystemStyles: () => {},
        modal: { open: async () => true },
      });

      await expect(
        gate.confirm({
          profile: 'standard',
          counts: { EMAIL: 1 },
        } as any),
      ).rejects.toThrow('stats');
    });

    it('returns true when modal confirms', async () => {
      const mockModal = {
        open: vi.fn().mockResolvedValue(true),
      };

      const gate = createModernPrivacyGate({
        documentRef: document,
        ensureDesignSystemStyles: () => {},
        modal: mockModal,
      });

      const result = await gate.confirm({
        profile: 'standard',
        counts: { EMAIL: 2, PHONE: 1 },
        stats: { userMessages: 5, llmMessages: 10 },
      });

      expect(result).toBe(true);
      expect(mockModal.open).toHaveBeenCalled();
    });

    it('returns false when modal cancels', async () => {
      const mockModal = {
        open: vi.fn().mockResolvedValue(false),
      };

      const gate = createModernPrivacyGate({
        documentRef: document,
        ensureDesignSystemStyles: () => {},
        modal: mockModal,
      });

      const result = await gate.confirm({
        profile: 'standard',
        counts: { EMAIL: 2 },
        stats: { userMessages: 5, llmMessages: 10 },
      });

      expect(result).toBe(false);
    });

    it('calls ensureDesignSystemStyles before opening modal', async () => {
      const ensureStyles = vi.fn();
      const mockModal = {
        open: vi.fn().mockResolvedValue(true),
      };

      const gate = createModernPrivacyGate({
        documentRef: document,
        ensureDesignSystemStyles: ensureStyles,
        modal: mockModal,
      });

      await gate.confirm({
        profile: 'standard',
        counts: {},
        stats: { userMessages: 1, llmMessages: 1 },
      });

      expect(ensureStyles).toHaveBeenCalled();
    });

    it('passes correct modal options', async () => {
      const mockModal = {
        open: vi.fn().mockResolvedValue(true),
      };

      const gate = createModernPrivacyGate({
        documentRef: document,
        ensureDesignSystemStyles: () => {},
        modal: mockModal,
        privacyProfiles: {
          standard: { label: '표준' },
        },
        formatRedactionCounts: (counts: Record<string, number>) =>
          Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(', '),
      });

      await gate.confirm({
        profile: 'standard',
        counts: { EMAIL: 2 },
        stats: { userMessages: 5, llmMessages: 10 },
        heading: '테스트 제목',
        actionLabel: '확인',
      });

      const openCall = mockModal.open.mock.calls[0][0];
      expect(openCall.title).toBe('테스트 제목');
      expect(openCall.content).toBeInstanceOf(dom.window.HTMLElement);
      expect(openCall.actions).toHaveLength(2);
      expect(openCall.actions[1].label).toBe('확인');
    });

    it('handles previewTurns in modal content', async () => {
      const mockModal = {
        open: vi.fn().mockResolvedValue(true),
      };

      const gate = createModernPrivacyGate({
        documentRef: document,
        ensureDesignSystemStyles: () => {},
        modal: mockModal,
      });

      await gate.confirm({
        profile: 'standard',
        counts: {},
        stats: { userMessages: 2, llmMessages: 2 },
        previewTurns: [
          { role: 'player', speaker: '플레이어', text: '안녕하세요' },
          { role: 'npc', speaker: 'NPC', text: '반갑습니다' },
        ],
      });

      const openCall = mockModal.open.mock.calls[0][0];
      const content = openCall.content as HTMLElement;

      // Check that turn list is rendered
      const turnList = content.querySelector('.gmh-turn-list');
      expect(turnList).not.toBeNull();
    });

    it('shows empty message when no preview turns', async () => {
      const mockModal = {
        open: vi.fn().mockResolvedValue(true),
      };

      const gate = createModernPrivacyGate({
        documentRef: document,
        ensureDesignSystemStyles: () => {},
        modal: mockModal,
      });

      await gate.confirm({
        profile: 'standard',
        counts: {},
        stats: { userMessages: 0, llmMessages: 0 },
        previewTurns: [],
      });

      const openCall = mockModal.open.mock.calls[0][0];
      const content = openCall.content as HTMLElement;

      const emptyItem = content.querySelector('.gmh-turn-list__empty');
      expect(emptyItem).not.toBeNull();
    });
  });

  describe('range info display', () => {
    it('displays range info when provided', async () => {
      const mockModal = {
        open: vi.fn().mockResolvedValue(true),
      };

      const gate = createModernPrivacyGate({
        documentRef: document,
        ensureDesignSystemStyles: () => {},
        modal: mockModal,
      });

      await gate.confirm({
        profile: 'standard',
        counts: {},
        stats: { userMessages: 5, llmMessages: 10 },
        rangeInfo: {
          active: true,
          start: 1,
          end: 5,
          count: 5,
          total: 15,
        },
      });

      const openCall = mockModal.open.mock.calls[0][0];
      const content = openCall.content as HTMLElement;
      const summaryText = content.textContent || '';

      // Should contain range information
      expect(summaryText).toContain('범위');
    });
  });
});
