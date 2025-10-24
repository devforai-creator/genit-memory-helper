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
});
