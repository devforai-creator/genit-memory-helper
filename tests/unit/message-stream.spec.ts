import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createMessageIndexer } from '../../src/core/message-indexer';
import createBlockBuilder from '../../src/features/block-builder';
import createMessageStream from '../../src/features/message-stream';
import createBlockStorage from '../../src/storage/block-storage';
import type {
  MessageIndexer,
  MessageIndexerEvent,
  MessageIndexerSummary,
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
    vi.useFakeTimers();
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

  afterEach(() => {
    vi.useRealTimers();
  });

  const settleMessages = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(8000);
  };

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
    await settleMessages();
    await messageStream.flush({ includePartial: false });
    expect(persistedBlocks).toHaveLength(0);

    appendMessage('m2', 'Greetings back', 'npc');
    messageIndexer.refresh({ immediate: true });
    await settleMessages();
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

  it('retries message collection until content is available', async () => {
    const blockBuilder = createBlockBuilder({
      blockSize: 1,
      overlap: 0,
      sessionUrl: 'https://genit.ai/chat/retry',
      console: dom.window.console,
    });

    const summary: MessageIndexerSummary = {
      totalMessages: 0,
      userMessages: 0,
      llmMessages: 0,
      containerPresent: true,
      timestamp: Date.now(),
    };

    let messageListener: ((event: MessageIndexerEvent) => void) | null = null;
    const messageIndexerStub: MessageIndexer = {
      start: vi.fn(),
      stop: vi.fn(),
      refresh: vi.fn(() => summary),
      getSummary: vi.fn(() => summary),
      lookupOrdinalByIndex: vi.fn(() => null),
      lookupOrdinalByMessageId: vi.fn(() => null),
      subscribe: vi.fn(() => () => {}),
      subscribeMessages(listener: (event: MessageIndexerEvent) => void) {
        messageListener = listener;
        return () => {
          if (messageListener === listener) {
            messageListener = null;
          }
        };
      },
    };

    const attempts = new WeakMap<Element, number>();
    const collectStructuredMessage = (element: Element): StructuredSnapshotMessage | null => {
      const count = attempts.get(element) ?? 0;
      attempts.set(element, count + 1);
      if (count === 0) {
        return {
          id: 'retry-msg',
          role: 'narration',
          channel: 'llm',
          parts: [
            {
              type: 'info',
              flavor: 'meta',
              role: 'system',
              speaker: 'INFO',
              lines: ['Loading...'],
              legacyLines: ['INFO', 'Loading...'],
            },
          ],
        };
      }
      return {
        id: 'retry-msg',
        role: 'narration',
        channel: 'llm',
        parts: [
          {
            type: 'info',
            flavor: 'meta',
            role: 'system',
            speaker: 'INFO',
            lines: ['Loading...'],
            legacyLines: ['INFO', 'Loading...'],
          },
          {
            type: 'narration',
            flavor: 'narration',
            role: 'narration',
            speaker: 'Narrator',
            lines: ['Final line draws in.'],
          },
        ],
      };
    };

    const messageStream = createMessageStream({
      messageIndexer: messageIndexerStub,
      blockBuilder,
      blockStorage: null,
      collectStructuredMessage,
      getSessionUrl: () => 'https://genit.ai/chat/retry',
      console: dom.window.console,
    });

    const streamedMessages: StructuredSnapshotMessage[] = [];
    messageStream.subscribeMessages((message) => {
      streamedMessages.push(message);
    });

    messageStream.start();
    await Promise.resolve();

    const targetElement = documentRef.createElement('div');
    container.appendChild(targetElement);
    const event: MessageIndexerEvent = {
      element: targetElement,
      ordinal: 1,
      index: 0,
      messageId: 'retry-msg',
      channel: 'llm',
      timestamp: Date.now(),
    };
    messageListener?.(event);

    await vi.advanceTimersByTimeAsync(8000);
    expect(streamedMessages).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(3000);
    expect(streamedMessages).toHaveLength(1);
    expect(streamedMessages[0]?.parts?.some((part) => part?.type === 'narration')).toBe(true);
  });
});
