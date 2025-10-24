import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBlockBuilder } from '../../src/features/block-builder';
import type { StructuredSnapshotMessage } from '../../src/types';

const buildMessage = (
  ordinal: number | null,
  options: Partial<StructuredSnapshotMessage> = {},
): StructuredSnapshotMessage => {
  const base: StructuredSnapshotMessage = {
    id: options.id ?? `msg-${ordinal ?? Math.random()}`,
    ordinal,
    userOrdinal: null,
    role: options.role ?? 'player',
    channel: options.channel ?? 'user',
    speaker: options.speaker ?? 'Player',
    parts: [
      {
        text: `Line ${ordinal ?? 'X'}`,
        lines: [`Line ${ordinal ?? 'X'}`],
        flavor: 'speech',
        role: options.role ?? 'player',
      },
    ],
  };
  return { ...base, ...options };
};

describe('block builder', () => {
  let now: number;
  let clock: () => number;

  beforeEach(() => {
    now = 1_700_000_000_000;
    clock = () => {
      now += 1000;
      return now;
    };
  });

  it('builds blocks after reaching configured size', () => {
    const onBlockReady = vi.fn();
    const builder = createBlockBuilder({
      blockSize: 3,
      overlap: 1,
      clock,
      onBlockReady,
      sessionUrl: 'https://genit.ai/chat/test',
    });

    const result: string[] = [];
    [1, 2, 3].forEach((ordinal) => {
      const blocks = builder.append(buildMessage(ordinal));
      blocks.forEach((block) => {
        result.push(block.id);
        expect(block.ordinalRange).toEqual([1, 3]);
        expect(block.messages).toHaveLength(3);
        expect(block.raw).toContain('Player: Line 1');
        expect(block.raw).toContain('Player: Line 3');
        expect(block.sessionUrl).toBe('https://genit.ai/chat/test');
      });
    });

    expect(result).toHaveLength(1);
    expect(onBlockReady).toHaveBeenCalledTimes(1);
  });

  it('maintains overlap between subsequent blocks', () => {
    const builder = createBlockBuilder({
      blockSize: 3,
      overlap: 2,
      clock,
      sessionUrl: 'https://genit.ai/chat/test',
    });

    [1, 2, 3, 4].forEach((ordinal) => {
      builder.append(buildMessage(ordinal));
    });

    const blocks = builder.append(buildMessage(5));
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block.ordinalRange).toEqual([3, 5]);
    expect(block.meta?.sourceOrdinals).toEqual([3, 4, 5]);
    expect(block.messages.map((msg) => msg.ordinal)).toEqual([3, 4, 5]);
  });

  it('omits narration content when removeNarration is true', () => {
    const narrationMessage = buildMessage(2, {
      role: 'narration',
      channel: 'system',
      speaker: 'Narrator',
      parts: [
        {
          text: 'Narration line',
          flavor: 'narration',
          role: 'narration',
        },
      ],
    });

    const builder = createBlockBuilder({
      blockSize: 2,
      overlap: 0,
      clock,
      removeNarration: true,
      sessionUrl: 'https://genit.ai/chat/test',
    });

    builder.append(buildMessage(1));
    const blocks = builder.append(narrationMessage);

    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block.raw).toContain('Player: Line 1');
    expect(block.raw).not.toContain('Narration line');
  });

  it('flushes remaining messages when includePartial is true', () => {
    const builder = createBlockBuilder({
      blockSize: 4,
      overlap: 1,
      clock,
      sessionUrl: 'https://genit.ai/chat/test',
    });

    [1, 2].forEach((ordinal) => builder.append(buildMessage(ordinal)));

    const blocks = builder.flush({ includePartial: true });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].messages).toHaveLength(2);
    expect(blocks[0].ordinalRange).toEqual([1, 2]);
    expect(builder.getBuffer()).toHaveLength(0);
  });

  it('resets state when session URL changes', () => {
    const builder = createBlockBuilder({
      blockSize: 2,
      overlap: 1,
      clock,
      sessionUrl: 'https://genit.ai/chat/first',
    });

    builder.append(buildMessage(1));
    expect(builder.getBuffer()).toHaveLength(1);

    builder.setSessionUrl('https://genit.ai/chat/second');
    expect(builder.getBuffer()).toHaveLength(0);

    builder.append(buildMessage(1));
    const blocks = builder.append(buildMessage(2));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].sessionUrl).toBe('https://genit.ai/chat/second');
  });

  it('skips duplicate message IDs', () => {
    const builder = createBlockBuilder({
      blockSize: 2,
      overlap: 0,
      clock,
      sessionUrl: 'https://genit.ai/chat/test',
    });

    const message = buildMessage(1, { id: 'shared-id' });
    const duplicate = buildMessage(2, { id: 'shared-id', ordinal: 2 });

    const first = builder.append(message);
    expect(first).toHaveLength(0);

    const second = builder.append(duplicate);
    expect(second).toHaveLength(0);
    expect(builder.getBuffer()).toHaveLength(1);
  });
});
