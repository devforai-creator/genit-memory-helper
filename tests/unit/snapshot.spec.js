import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

import { createStructuredSnapshotReader } from '../../src/features/snapshot.ts';

describe('structured snapshot reader (incremental)', () => {
  let dom;
  let documentRef;
  let container;
  let blocks;
  let collectStructuredMessage;
  let emitTranscriptLines;

  const assignMessageAttributes = () => {
    blocks.forEach((block, idx) => {
      block.setAttribute('data-gmh-message-index', String(idx));
      block.setAttribute('data-gmh-message-ordinal', String(blocks.length - idx));
    });
  };

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="chat"></div></body></html>');
    documentRef = dom.window.document;
    container = documentRef.getElementById('chat');
    blocks = [
      documentRef.createElement('section'),
      documentRef.createElement('section'),
    ];
    blocks[0].textContent = '첫 번째 메시지';
    blocks[1].textContent = '두 번째 메시지';
    blocks.forEach((block) => container.appendChild(block));
    assignMessageAttributes();

    collectStructuredMessage = vi.fn((block) => ({
      role: block.textContent.includes('첫') ? 'npc' : 'player',
      speaker: block.textContent.includes('첫') ? '메모링' : '플레이어',
      parts: [],
      legacyLines: [block.textContent || ''],
    }));
    emitTranscriptLines = vi.fn((block, pushLine) => pushLine(block.textContent || ''));
  });

  const getAdapter = () => ({
    findContainer: () => container,
    listMessageBlocks: () => container.querySelectorAll('section'),
    resetInfoRegistry: vi.fn(),
    collectStructuredMessage,
    emitTranscriptLines,
  });

  it('skips re-parsing existing blocks between captures', () => {
    const reader = createStructuredSnapshotReader({
      getActiveAdapter: getAdapter,
      documentRef,
    });

    const firstSnapshot = reader.captureStructuredSnapshot();
    expect(firstSnapshot.legacyLines).toEqual(['첫 번째 메시지', '두 번째 메시지']);
    expect(collectStructuredMessage).toHaveBeenCalledTimes(2);

    const newBlock = documentRef.createElement('section');
    newBlock.textContent = '세 번째 메시지';
    container.insertBefore(newBlock, container.firstChild);
    blocks = [newBlock, ...blocks];
    assignMessageAttributes();

    const secondSnapshot = reader.captureStructuredSnapshot();
    expect(secondSnapshot.legacyLines).toEqual([
      '세 번째 메시지',
      '첫 번째 메시지',
      '두 번째 메시지',
    ]);
    expect(collectStructuredMessage).toHaveBeenCalledTimes(3);
    expect(emitTranscriptLines).not.toHaveBeenCalled();
    expect(secondSnapshot.messages.map((msg) => msg.index)).toEqual([0, 1, 2]);
  });

  it('re-parses all blocks when force flag is set', () => {
    const reader = createStructuredSnapshotReader({
      getActiveAdapter: getAdapter,
      documentRef,
    });

    reader.captureStructuredSnapshot();
    expect(collectStructuredMessage).toHaveBeenCalledTimes(2);

    reader.captureStructuredSnapshot({ force: true });
    expect(collectStructuredMessage).toHaveBeenCalledTimes(4);
  });

  it('detects DOM node reuse and refreshes cached entries', () => {
    const reader = createStructuredSnapshotReader({
      getActiveAdapter: getAdapter,
      documentRef,
    });

    const initialSnapshot = reader.captureStructuredSnapshot();
    expect(initialSnapshot.legacyLines).toEqual(['첫 번째 메시지', '두 번째 메시지']);
    expect(collectStructuredMessage).toHaveBeenCalledTimes(2);

    blocks[1].textContent = '변경된 두 번째 메시지';
    assignMessageAttributes();

    const updatedSnapshot = reader.captureStructuredSnapshot();
    expect(updatedSnapshot.legacyLines).toEqual(['첫 번째 메시지', '변경된 두 번째 메시지']);
    expect(collectStructuredMessage).toHaveBeenCalledTimes(3);
    const lastCallBlock = collectStructuredMessage.mock.calls.at(-1)[0];
    expect(lastCallBlock).toBe(blocks[1]);
  });
});
