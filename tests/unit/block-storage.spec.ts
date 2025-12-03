import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBlockStorage } from '../../src/storage/block-storage';
import type { BlockStorageController, MemoryBlockInit } from '../../src/types';

const buildMessage = (ordinal: number, overrides: Record<string, unknown> = {}) => ({
  id: `msg-${ordinal}`,
  ordinal,
  userOrdinal: null,
  role: 'player',
  speaker: 'Player',
  parts: [],
  ...overrides,
});

const buildBlock = (
  overrides: Partial<MemoryBlockInit> = {},
  options: { ordinalStart?: number; ordinalEnd?: number } = {},
): MemoryBlockInit => {
  const start = options.ordinalStart ?? 1;
  const end = options.ordinalEnd ?? start + 4;
  return {
    id: `block-${start}-${Date.now()}-${Math.random()}`,
    sessionUrl: 'https://genit.ai/chat/test-session',
    raw: `Sample transcript block ${start}`,
    messages: [buildMessage(start), buildMessage(start + 1)],
    ordinalRange: [start, end],
    timestamp: Date.now(),
    ...overrides,
  };
};

describe('block storage (memory fallback)', () => {
  let storage: BlockStorageController;
  let consoleStub: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    consoleStub = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    storage = await createBlockStorage({
      indexedDB: null,
      dbName: `test-gmh-${Date.now()}-${Math.random()}`,
      console: consoleStub,
    });
  });

  afterEach(async () => {
    storage.close();
  });

  it('stores and retrieves blocks', async () => {
    const block = buildBlock();
    await storage.save(block);

    const result = await storage.get(block.id);

    expect(consoleStub.warn).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.id).toBe(block.id);
    expect(result?.sessionUrl).toBe(block.sessionUrl);
    expect(result?.ordinalRange).toEqual(block.ordinalRange);
    expect(result?.messageCount).toBe(block.messages.length);
    expect(result?.embedding).toBeNull();
  });

  it('serializes embeddings to ArrayBuffer when saving', async () => {
    const vector = new Float32Array([1.5, 2.5, 3.5]);
    const block = buildBlock({ id: 'embedding-block', embedding: vector });

    await storage.save(block);
    vector[0] = 9.9;

    const stored = await storage.get('embedding-block');
    expect(stored).not.toBeNull();
    expect(stored?.embedding).toBeInstanceOf(ArrayBuffer);

    const restored = new Float32Array(stored!.embedding as ArrayBuffer);
    expect(Array.from(restored)).toEqual([1.5, 2.5, 3.5]);
  });

  it('returns blocks ordered by ordinal when retrieving by session', async () => {
    const sessionUrl = 'https://genit.ai/chat/ordered';
    const blockA = buildBlock(
      { id: 'ordered-10', sessionUrl },
      { ordinalStart: 10, ordinalEnd: 14 },
    );
    const blockB = buildBlock(
      { id: 'ordered-2', sessionUrl },
      { ordinalStart: 2, ordinalEnd: 6 },
    );
    await storage.save(blockA);
    await storage.save(blockB);

    const blocks = await storage.getBySession(sessionUrl);
    expect(blocks.map((item) => item.id)).toEqual(['ordered-2', 'ordered-10']);
  });

  it('deletes blocks and reports removal status', async () => {
    const block = buildBlock({ id: 'delete-me' });
    await storage.save(block);

    expect(await storage.delete('delete-me')).toBe(true);
    expect(await storage.delete('delete-me')).toBe(false);
    expect(await storage.get('delete-me')).toBeNull();
  });

  it('clears blocks by session or entirely', async () => {
    const sessionA = 'https://genit.ai/chat/session-a';
    const sessionB = 'https://genit.ai/chat/session-b';
    await storage.save(buildBlock({ id: 'session-a-1', sessionUrl: sessionA }));
    await storage.save(buildBlock({ id: 'session-a-2', sessionUrl: sessionA }));
    await storage.save(buildBlock({ id: 'session-b-1', sessionUrl: sessionB }));

    const removedSession = await storage.clear(sessionA);
    expect(removedSession).toBe(2);

    const statsAfter = await storage.getStats();
    expect(statsAfter.totalBlocks).toBe(1);
    expect(statsAfter.sessions).toBe(1);
    expect(statsAfter.totalMessages).toBe(2);

    const removedAll = await storage.clear();
    expect(removedAll).toBe(1);

    const statsFinal = await storage.getStats();
    expect(statsFinal.totalBlocks).toBe(0);
    expect(statsFinal.sessions).toBe(0);
    expect(statsFinal.totalMessages).toBe(0);
  });

  it('rejects invalid block payloads', async () => {
    await expect(
      storage.save({
        ...buildBlock(),
        id: '',
      }),
    ).rejects.toThrow(/requires a stable id/i);

    await expect(
      storage.save({
        ...buildBlock(),
        sessionUrl: '',
      }),
    ).rejects.toThrow(/requires sessionUrl/i);

    await expect(
      storage.save({
        ...buildBlock(),
        ordinalRange: [1, Number.NaN],
      }),
    ).rejects.toThrow(/requires a finite ordinalRange/i);
  });

  it('returns cloned records to prevent external mutation', async () => {
    const block = buildBlock({ id: 'immutable-block' });
    await storage.save(block);

    const first = await storage.get('immutable-block');
    expect(first).not.toBeNull();
    if (first) {
      first.messages[0].speaker = 'mutated';
      first.ordinalRange[0] = 999;
    }

    const second = await storage.get('immutable-block');
    expect(second?.messages[0].speaker).toBe('Player');
    expect(second?.ordinalRange[0]).toBe(block.ordinalRange[0]);
  });

  describe('summary/facts fields (Dual Memory Phase 2)', () => {
    it('stores and retrieves summary field', async () => {
      const block = buildBlock({
        id: 'summary-block',
        summary: 'This is a test summary of the conversation.',
      });
      await storage.save(block);

      const result = await storage.get('summary-block');
      expect(result?.summary).toBe('This is a test summary of the conversation.');
    });

    it('stores and retrieves facts field', async () => {
      const block = buildBlock({
        id: 'facts-block',
        facts: '- Fact 1: User likes coffee\n- Fact 2: Meeting scheduled for Friday',
      });
      await storage.save(block);

      const result = await storage.get('facts-block');
      expect(result?.facts).toBe('- Fact 1: User likes coffee\n- Fact 2: Meeting scheduled for Friday');
    });

    it('stores both summary and facts together', async () => {
      const block = buildBlock({
        id: 'dual-memory-block',
        summary: 'User discussed their morning routine.',
        facts: '- Wakes up at 6am\n- Drinks green tea',
      });
      await storage.save(block);

      const result = await storage.get('dual-memory-block');
      expect(result?.summary).toBe('User discussed their morning routine.');
      expect(result?.facts).toBe('- Wakes up at 6am\n- Drinks green tea');
    });

    it('preserves summary/facts in getBySession results', async () => {
      const sessionUrl = 'https://genit.ai/chat/dual-test';
      const block1 = buildBlock({
        id: 'session-block-1',
        sessionUrl,
        summary: 'Summary 1',
        facts: 'Facts 1',
      });
      const block2 = buildBlock({
        id: 'session-block-2',
        sessionUrl,
        summary: 'Summary 2',
      });
      await storage.save(block1);
      await storage.save(block2);

      const blocks = await storage.getBySession(sessionUrl);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].summary).toBe('Summary 1');
      expect(blocks[0].facts).toBe('Facts 1');
      expect(blocks[1].summary).toBe('Summary 2');
      expect(blocks[1].facts).toBeUndefined();
    });

    it('trims whitespace from summary and facts', async () => {
      const block = buildBlock({
        id: 'whitespace-block',
        summary: '  Padded summary  ',
        facts: '  \n  Padded facts  \n  ',
      });
      await storage.save(block);

      const result = await storage.get('whitespace-block');
      expect(result?.summary).toBe('Padded summary');
      expect(result?.facts).toBe('Padded facts');
    });

    it('ignores empty summary and facts', async () => {
      const block = buildBlock({
        id: 'empty-fields-block',
        summary: '   ',
        facts: '',
      });
      await storage.save(block);

      const result = await storage.get('empty-fields-block');
      expect(result?.summary).toBeUndefined();
      expect(result?.facts).toBeUndefined();
    });

    it('updates summary/facts on re-save', async () => {
      const block = buildBlock({
        id: 'update-block',
        summary: 'Initial summary',
      });
      await storage.save(block);

      // Update with new summary and add facts
      await storage.save({
        ...block,
        summary: 'Updated summary',
        facts: 'New facts added',
      });

      const result = await storage.get('update-block');
      expect(result?.summary).toBe('Updated summary');
      expect(result?.facts).toBe('New facts added');
    });

    it('clones summary/facts to prevent mutation', async () => {
      const block = buildBlock({
        id: 'clone-test-block',
        summary: 'Original summary',
        facts: 'Original facts',
      });
      await storage.save(block);

      const first = await storage.get('clone-test-block');
      if (first) {
        (first as { summary: string }).summary = 'Mutated';
      }

      const second = await storage.get('clone-test-block');
      expect(second?.summary).toBe('Original summary');
    });
  });

  describe('validation and cloning helpers', () => {
    it('covers cloneArrayBuffer fallback when slice is missing', async () => {
      const buffer = new ArrayBuffer(8);
      // Force fallback branch without slice
      // @ts-expect-error remove slice to hit fallback path
      buffer.slice = undefined;
      const view = new Uint8Array(buffer);
      view[0] = 7;

      await storage.save({
        ...buildBlock({ id: 'noslice-buffer', embedding: buffer }),
      });

      const stored = await storage.get('noslice-buffer');
      expect(stored?.embedding).toBeInstanceOf(ArrayBuffer);
      const restored = new Uint8Array(stored!.embedding as ArrayBuffer);
      expect(restored[0]).toBe(7);
    });

    it('rejects invalid embeddings and timestamps', async () => {
      await expect(
        storage.save({
          ...buildBlock({ id: 'bad-embedding' }),
          // @ts-expect-error intentionally invalid embedding type
          embedding: 'not-a-buffer',
        }),
      ).rejects.toThrow(/embedding must be an ArrayBuffer/);

      await expect(
        storage.save({
          ...buildBlock({ id: 'bad-timestamp' }),
          timestamp: Number.NaN,
        }),
      ).rejects.toThrow(/numeric timestamp/);
    });

    it('sorts by timestamp and id when startOrdinal is equal', async () => {
      const sessionUrl = 'https://genit.ai/chat/sort-by-timestamp';
      const base = buildBlock({ sessionUrl }, { ordinalStart: 5, ordinalEnd: 9 });
      const early = { ...base, id: 'block-early', timestamp: 10 };
      const late = { ...base, id: 'block-late', timestamp: 20 };
      const tie = { ...base, id: 'block-mid', timestamp: 20 };

      await storage.save(late);
      await storage.save(tie);
      await storage.save(early);

      const blocks = await storage.getBySession(sessionUrl);
      expect(blocks.map((b) => b.id)).toEqual(['block-early', 'block-late', 'block-mid']);
    });

    it('validates meta summary payloads', async () => {
      await expect(
        storage.saveMeta({
          // @ts-expect-error missing fields on purpose
        }),
      ).rejects.toThrow(/stable id/i);

      await expect(
        storage.saveMeta({
          id: 'meta-1',
          sessionUrl: 'https://genit.ai/chat/meta',
          chunkIds: [],
          chunkRange: [0, 1],
          summary: 'text',
          timestamp: Date.now(),
        }),
      ).rejects.toThrow(/at least one chunkId/);
    });

    it('falls back to JSON clone when structuredClone throws', async () => {
      const originalClone = globalThis.structuredClone;
      // @ts-expect-error override structuredClone to throw
      globalThis.structuredClone = () => {
        throw new Error('no clone');
      };

      try {
        await storage.save({
          ...buildBlock({ id: 'clone-fallback' }),
          meta: { complex: true },
        });
        const first = await storage.get('clone-fallback');
        if (first?.meta && typeof first.meta === 'object') {
          (first.meta as any).complex = false;
        }
        const second = await storage.get('clone-fallback');
        expect((second?.meta as any).complex).toBe(true);
      } finally {
        // @ts-expect-error restore structuredClone
        globalThis.structuredClone = originalClone;
      }
    });
  });
});
