import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { createMessageIndexer } from '../../src/core/message-indexer';
import createBlockBuilder from '../../src/features/block-builder';
import createMessageStream from '../../src/features/message-stream';
import createBlockStorage from '../../src/storage/block-storage';
import type {
  MessageIndexer,
  StructuredSnapshotMessage,
  MemoryBlockInit,
} from '../../src/types';

const buildAdapter = (
  container: Element,
): {
  findContainer: () => Element;
  listMessageBlocks: () => NodeListOf<Element>;
  detectRole: (block: Element) => string;
  collectStructuredMessage: (block: Element) => StructuredSnapshotMessage | null;
} => ({
  findContainer: () => container,
  listMessageBlocks: () => container.querySelectorAll('.message'),
  detectRole: (block: Element) => block.getAttribute('data-role') || 'npc',
  collectStructuredMessage: (block: Element) => {
    const textContent = block.textContent?.trim() ?? '';
    if (!textContent) return null;
    const roleAttr = block.getAttribute('data-gmh-message-role') || block.getAttribute('data-role') || 'npc';
    const channelAttr = block.getAttribute('data-gmh-channel') || (roleAttr === 'player' ? 'user' : 'llm');
    return {
      id:
        block.getAttribute('data-gmh-message-id') ||
        block.getAttribute('data-message-id') ||
        block.getAttribute('data-id') ||
        null,
      ordinal: Number(block.getAttribute('data-gmh-message-ordinal')) || null,
      index: Number(block.getAttribute('data-gmh-message-index')) || null,
      role: roleAttr,
      channel: channelAttr,
      speaker: roleAttr === 'player' ? 'Player' : roleAttr === 'narration' ? 'Narrator' : 'NPC',
      parts: [
        {
          text: textContent,
          lines: [textContent],
          flavor: roleAttr === 'narration' ? 'narration' : 'speech',
          role: roleAttr,
        },
      ],
    };
  },
});

describe('message stream integration', () => {
  let dom: JSDOM;
  let documentRef: Document;
  let container: HTMLElement;
  let messageIndexer: MessageIndexer;

  beforeEach(() => {
    dom = new JSDOM('<div id="root"><div id="chat"></div></div>', {
      url: 'https://genit.ai/chat',
      pretendToBeVisual: true,
    });
    (globalThis as Record<string, unknown>).Element = dom.window.Element;
    documentRef = dom.window.document;
    const chat = documentRef.getElementById('chat');
    if (!chat) throw new Error('chat container missing');
    container = chat;
    const adapter = buildAdapter(container);
    messageIndexer = createMessageIndexer({
      document: documentRef,
      MutationObserver: dom.window.MutationObserver,
      exportRange: null,
      getActiveAdapter: () => adapter,
      getEntryOrigin: () => [],
    });
  });

  const appendMessage = (id: string, text: string, role: string = 'npc'): void => {
    const block = documentRef.createElement('div');
    block.className = 'message';
    block.setAttribute('data-id', id);
    block.setAttribute('data-role', role);
    block.textContent = text;
    container.appendChild(block);
  };

  it('streams new messages into block storage', async () => {
    const blockBuilder = createBlockBuilder({
      blockSize: 2,
      overlap: 1,
      sessionUrl: 'https://genit.ai/chat/test',
      console: dom.window.console,
    });
    const blockStorage = await createBlockStorage({
      indexedDB: null,
      console: dom.window.console,
    });
    const streamedMessages: StructuredSnapshotMessage[] = [];
    const persistedBlocks: MemoryBlockInit[] = [];

    const adapter = buildAdapter(container);

    const messageStream = createMessageStream({
      messageIndexer,
      blockBuilder,
      blockStorage,
      collectStructuredMessage: (element) => adapter.collectStructuredMessage(element),
      getSessionUrl: () => 'https://genit.ai/chat/test',
      console: dom.window.console,
    });

    messageStream.subscribeMessages((message) => {
      streamedMessages.push(message);
    });
    messageStream.subscribeBlocks((block) => {
      persistedBlocks.push(block);
    });

    messageStream.start();

    appendMessage('m1', 'Hello there', 'player');
    messageIndexer.refresh({ immediate: true });
    await messageStream.flush({ includePartial: false });
    expect(persistedBlocks).toHaveLength(0);

    appendMessage('m2', 'Greetings back', 'npc');
    messageIndexer.refresh({ immediate: true });
    await messageStream.flush({ includePartial: false });

    expect(streamedMessages.length).toBeGreaterThanOrEqual(2);
    expect(persistedBlocks).toHaveLength(1);
    const [block] = persistedBlocks;
    expect(block.messages).toHaveLength(2);
    expect(block.sessionUrl).toBe('https://genit.ai/chat/test');
    const stats = await blockStorage.getStats();
    expect(stats.totalBlocks).toBe(1);
    expect(stats.totalMessages).toBe(2);
  });
});
