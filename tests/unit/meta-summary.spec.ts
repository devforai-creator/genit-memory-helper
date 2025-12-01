/**
 * Meta Summary Unit Tests (v3.1.0)
 *
 * Tests for hierarchical meta summary feature:
 * - block-storage meta summary CRUD operations
 * - memory-prompts meta summary prompt generation
 * - groupChunksForMeta chunking logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBlockStorage } from '../../src/storage/block-storage';
import {
  buildMetaSummaryPrompt,
  groupChunksForMeta,
  DEFAULT_META_SUMMARY_PROMPT,
} from '../../src/features/memory-prompts';
import type { BlockStorageController, MetaSummaryInit } from '../../src/types';

describe('Meta Summary (v3.1.0)', () => {
  describe('memory-prompts: groupChunksForMeta', () => {
    it('should return empty array when less than 10 chunks have summaries', () => {
      const chunks = Array.from({ length: 8 }, (_, i) => ({
        id: `chunk-${i}`,
        index: i,
        summary: `Summary ${i}`,
      }));

      const groups = groupChunksForMeta(chunks, 10);
      expect(groups).toHaveLength(0);
    });

    it('should group 10 chunks with summaries into 1 meta group', () => {
      const chunks = Array.from({ length: 10 }, (_, i) => ({
        id: `chunk-${i}`,
        index: i,
        summary: `Summary ${i}`,
      }));

      const groups = groupChunksForMeta(chunks, 10);
      expect(groups).toHaveLength(1);
      expect(groups[0].chunkIds).toHaveLength(10);
      expect(groups[0].chunkRange).toEqual([0, 9]);
      expect(groups[0].summaries).toHaveLength(10);
    });

    it('should create multiple groups for 25 chunks (2 complete groups)', () => {
      const chunks = Array.from({ length: 25 }, (_, i) => ({
        id: `chunk-${i}`,
        index: i,
        summary: `Summary ${i}`,
      }));

      const groups = groupChunksForMeta(chunks, 10);
      expect(groups).toHaveLength(2);
      expect(groups[0].chunkRange).toEqual([0, 9]);
      expect(groups[1].chunkRange).toEqual([10, 19]);
    });

    it('should filter out chunks without summaries', () => {
      const chunks = Array.from({ length: 15 }, (_, i) => ({
        id: `chunk-${i}`,
        index: i,
        summary: i < 10 ? `Summary ${i}` : undefined, // Only first 10 have summaries
      }));

      const groups = groupChunksForMeta(chunks, 10);
      expect(groups).toHaveLength(1);
      expect(groups[0].chunkRange).toEqual([0, 9]);
    });

    it('should use custom group size', () => {
      const chunks = Array.from({ length: 6 }, (_, i) => ({
        id: `chunk-${i}`,
        index: i,
        summary: `Summary ${i}`,
      }));

      const groups = groupChunksForMeta(chunks, 3);
      expect(groups).toHaveLength(2);
      expect(groups[0].chunkRange).toEqual([0, 2]);
      expect(groups[1].chunkRange).toEqual([3, 5]);
    });
  });

  describe('memory-prompts: buildMetaSummaryPrompt', () => {
    it('should generate prompt with numbered chunk summaries', () => {
      const input = {
        chunkIds: ['c1', 'c2', 'c3'],
        summaries: ['First summary', 'Second summary', 'Third summary'],
        chunkRange: [0, 2] as [number, number],
      };

      const prompt = buildMetaSummaryPrompt(input);

      expect(prompt).toContain('[청크 요약들]');
      expect(prompt).toContain('[1] First summary');
      expect(prompt).toContain('[2] Second summary');
      expect(prompt).toContain('[3] Third summary');
    });

    it('should respect custom template', () => {
      const input = {
        chunkIds: ['c1'],
        summaries: ['Test summary'],
        chunkRange: [0, 0] as [number, number],
      };

      const customTemplate = 'Custom: {summaries}';
      const prompt = buildMetaSummaryPrompt(input, customTemplate);

      expect(prompt).toBe('Custom: [1] Test summary');
    });

    it('should number summaries based on chunkRange start', () => {
      const input = {
        chunkIds: ['c10', 'c11'],
        summaries: ['Summary A', 'Summary B'],
        chunkRange: [10, 11] as [number, number],
      };

      const prompt = buildMetaSummaryPrompt(input);

      // chunkRange[0] + i + 1 = 10 + 0 + 1 = 11 for first summary
      expect(prompt).toContain('[11] Summary A');
      expect(prompt).toContain('[12] Summary B');
    });
  });

  describe('memory-prompts: DEFAULT_META_SUMMARY_PROMPT', () => {
    it('should contain required instructions', () => {
      expect(DEFAULT_META_SUMMARY_PROMPT).toContain('500자 이내');
      expect(DEFAULT_META_SUMMARY_PROMPT).toContain('{summaries}');
    });
  });

  describe('block-storage: meta summary CRUD', () => {
    let storage: BlockStorageController;
    let consoleStub: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      consoleStub = {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      storage = await createBlockStorage({
        indexedDB: null, // Use memory fallback for tests
        dbName: `test-meta-${Date.now()}-${Math.random()}`,
        console: consoleStub,
      });
    });

    afterEach(async () => {
      storage.close();
    });

    it('should save and retrieve meta summary', async () => {
      const metaInit: MetaSummaryInit = {
        id: 'meta-test-1',
        sessionUrl: 'https://test.com/session1',
        chunkIds: ['c1', 'c2', 'c3'],
        chunkRange: [0, 2],
        summary: 'Test meta summary content',
        timestamp: Date.now(),
      };

      await storage.saveMeta(metaInit);
      const retrieved = await storage.getMeta('meta-test-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('meta-test-1');
      expect(retrieved?.summary).toBe('Test meta summary content');
      expect(retrieved?.chunkIds).toEqual(['c1', 'c2', 'c3']);
      expect(retrieved?.chunkRange).toEqual([0, 2]);
      expect(retrieved?.chunkCount).toBe(3);
    });

    it('should get meta summaries by session', async () => {
      const sessionUrl = 'https://test.com/session2';
      const metas: MetaSummaryInit[] = [
        {
          id: 'meta-1',
          sessionUrl,
          chunkIds: ['c1', 'c2'],
          chunkRange: [0, 1],
          summary: 'Meta 1',
          timestamp: Date.now(),
        },
        {
          id: 'meta-2',
          sessionUrl,
          chunkIds: ['c3', 'c4'],
          chunkRange: [2, 3],
          summary: 'Meta 2',
          timestamp: Date.now() + 100,
        },
      ];

      for (const meta of metas) {
        await storage.saveMeta(meta);
      }

      const results = await storage.getMetaBySession(sessionUrl);
      expect(results).toHaveLength(2);
      // Should be sorted by chunkRange[0]
      expect(results[0].chunkRange[0]).toBeLessThanOrEqual(results[1].chunkRange[0]);
    });

    it('should delete meta summary', async () => {
      const metaInit: MetaSummaryInit = {
        id: 'meta-delete-test',
        sessionUrl: 'https://test.com/session3',
        chunkIds: ['c1'],
        chunkRange: [0, 0],
        summary: 'To be deleted',
        timestamp: Date.now(),
      };

      await storage.saveMeta(metaInit);
      expect(await storage.getMeta('meta-delete-test')).not.toBeNull();

      const deleted = await storage.deleteMeta('meta-delete-test');
      expect(deleted).toBe(true);
      expect(await storage.getMeta('meta-delete-test')).toBeNull();
    });

    it('should return false when deleting non-existent meta', async () => {
      const deleted = await storage.deleteMeta('non-existent-meta');
      expect(deleted).toBe(false);
    });

    it('should clear meta summaries by session', async () => {
      const session1 = 'https://test.com/session-clear-1';
      const session2 = 'https://test.com/session-clear-2';

      await storage.saveMeta({
        id: 'meta-s1-1',
        sessionUrl: session1,
        chunkIds: ['c1'],
        chunkRange: [0, 0],
        summary: 'S1 Meta 1',
        timestamp: Date.now(),
      });

      await storage.saveMeta({
        id: 'meta-s2-1',
        sessionUrl: session2,
        chunkIds: ['c1'],
        chunkRange: [0, 0],
        summary: 'S2 Meta 1',
        timestamp: Date.now(),
      });

      const cleared = await storage.clearMeta(session1);
      expect(cleared).toBe(1);

      const s1Results = await storage.getMetaBySession(session1);
      expect(s1Results).toHaveLength(0);

      const s2Results = await storage.getMetaBySession(session2);
      expect(s2Results).toHaveLength(1);
    });

    it('should clear all meta summaries when no session specified', async () => {
      await storage.saveMeta({
        id: 'meta-all-1',
        sessionUrl: 'https://test.com/s1',
        chunkIds: ['c1'],
        chunkRange: [0, 0],
        summary: 'Meta 1',
        timestamp: Date.now(),
      });

      await storage.saveMeta({
        id: 'meta-all-2',
        sessionUrl: 'https://test.com/s2',
        chunkIds: ['c1'],
        chunkRange: [0, 0],
        summary: 'Meta 2',
        timestamp: Date.now(),
      });

      const cleared = await storage.clearMeta();
      expect(cleared).toBe(2);

      expect(await storage.getMetaBySession('https://test.com/s1')).toHaveLength(0);
      expect(await storage.getMetaBySession('https://test.com/s2')).toHaveLength(0);
    });

    it('should reject meta summary with empty summary', async () => {
      await expect(
        storage.saveMeta({
          id: 'invalid-meta',
          sessionUrl: 'https://test.com/session',
          chunkIds: ['c1'],
          chunkRange: [0, 0],
          summary: '   ', // Empty after trim
          timestamp: Date.now(),
        }),
      ).rejects.toThrow(/requires summary text/i);
    });

    it('should reject meta summary with empty chunkIds', async () => {
      await expect(
        storage.saveMeta({
          id: 'invalid-meta',
          sessionUrl: 'https://test.com/session',
          chunkIds: [],
          chunkRange: [0, 0],
          summary: 'Valid summary',
          timestamp: Date.now(),
        }),
      ).rejects.toThrow(/requires at least one chunkId/i);
    });

    it('should clone records to prevent external mutation', async () => {
      await storage.saveMeta({
        id: 'immutable-meta',
        sessionUrl: 'https://test.com/session',
        chunkIds: ['c1', 'c2'],
        chunkRange: [0, 1],
        summary: 'Original summary',
        timestamp: Date.now(),
      });

      const first = await storage.getMeta('immutable-meta');
      if (first) {
        first.chunkIds.push('mutated');
        first.chunkRange[0] = 999;
      }

      const second = await storage.getMeta('immutable-meta');
      expect(second?.chunkIds).toEqual(['c1', 'c2']);
      expect(second?.chunkRange[0]).toBe(0);
    });
  });
});
