import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import createMemoryStatus from '../../src/ui/memory-status';
import type {
  BlockStorageController,
  MemoryBlockInit,
  MemoryStatusController,
  MessageStreamController,
  StructuredSnapshotMessage,
} from '../../src/types';

const buildMessage = (ordinal: number): StructuredSnapshotMessage => ({
  id: `msg-${ordinal}`,
  ordinal,
  userOrdinal: null,
  role: ordinal % 2 === 0 ? 'npc' : 'player',
  channel: ordinal % 2 === 0 ? 'llm' : 'user',
  speaker: ordinal % 2 === 0 ? 'NPC' : 'Player',
  parts: [
    {
      text: `Line ${ordinal}`,
      lines: [`Line ${ordinal}`],
      flavor: 'speech',
      role: ordinal % 2 === 0 ? 'npc' : 'player',
    },
  ],
});

const buildBlock = (
  id: string,
  sessionUrl: string,
  messageCount: number,
  timestamp: number,
): MemoryBlockInit => ({
  id,
  sessionUrl,
  raw: `Block ${id}`,
  messages: Array.from({ length: messageCount }, (_, index) => buildMessage(index + 1)),
  ordinalRange: [1, messageCount],
  timestamp,
});

const createBlockStorageStub = (initial: Record<string, MemoryBlockInit[]> = {}) => {
  const store = new Map<string, MemoryBlockInit[]>();
  Object.entries(initial).forEach(([sessionUrl, blocks]) => {
    store.set(sessionUrl, blocks.map((block) => ({ ...block, messages: block.messages.map((msg) => ({ ...msg })) })));
  });

  const controller: BlockStorageController = {
    async save(block) {
      const list = store.get(block.sessionUrl) ?? [];
      list.push(block);
      store.set(block.sessionUrl, list);
    },
    async get() {
      return null;
    },
    async getBySession(sessionUrl) {
      return (store.get(sessionUrl) ?? []).map((block) => ({
        ...block,
        messages: block.messages.map((msg) => ({ ...msg })),
      }));
    },
    async delete(id) {
      let removed = false;
      store.forEach((blocks, sessionUrl) => {
        const next = blocks.filter((block) => block.id !== id);
        if (next.length !== blocks.length) {
          store.set(sessionUrl, next);
          removed = true;
        }
      });
      return removed;
    },
    async clear(sessionUrl) {
      if (!sessionUrl) {
        const size = Array.from(store.values()).reduce((acc, blocks) => acc + blocks.length, 0);
        store.clear();
        return size;
      }
      const blocks = store.get(sessionUrl);
      if (!blocks) return 0;
      store.delete(sessionUrl);
      return blocks.length;
    },
    async getStats() {
      let totalBlocks = 0;
      let totalMessages = 0;
      store.forEach((blocks) => {
        totalBlocks += blocks.length;
        blocks.forEach((block) => {
          totalMessages += block.messages.length;
        });
      });
      return {
        totalBlocks,
        totalMessages,
        sessions: store.size,
      };
    },
    close() {},
  };

  const registerBlock = (block: MemoryBlockInit) => {
    const list = store.get(block.sessionUrl) ?? [];
    list.push(block);
    store.set(block.sessionUrl, list);
  };

  return { controller, registerBlock, store };
};

const createMessageStreamStub = (sessionUrl: string) => {
  let currentUrl = sessionUrl;
  let blockListeners: Array<(block: MemoryBlockInit) => void> = [];

  const controller: MessageStreamController = {
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: vi.fn(() => true),
    flush: vi.fn(async () => 0),
    getBuffer: vi.fn(() => []),
    getSessionUrl: vi.fn(() => currentUrl),
    setSessionUrl: vi.fn((next: string | null) => {
      if (typeof next === 'string') {
        currentUrl = next;
      }
    }),
    subscribeBlocks: vi.fn((listener) => {
      blockListeners.push(listener);
      return () => {
        blockListeners = blockListeners.filter((registered) => registered !== listener);
      };
    }),
    subscribeMessages: vi.fn(() => () => {}),
  };

  const emitBlock = (block: MemoryBlockInit) => {
    blockListeners.forEach((listener) => listener(block));
  };

  return { controller, emitBlock };
};

describe('memory status UI', () => {
  const SESSION_URL = 'https://genit.ai/chat/test-session';
  let dom: JSDOM;
  let memoryStatus: MemoryStatusController | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    dom = new JSDOM(
      `
        <div id="panel">
          <section id="gmh-section-privacy"></section>
          <section id="gmh-section-autoload"></section>
          <section id="gmh-section-export"></section>
        </div>
      `,
      { url: SESSION_URL, pretendToBeVisual: true },
    );
    dom.window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      callback(performance.now());
      return 0;
    };
  });

  afterEach(() => {
    memoryStatus?.destroy();
    memoryStatus = null;
    vi.useRealTimers();
  });

  it('mounts and displays stats when enabled', async () => {
    const initialBlocks = [
      buildBlock('block-1', SESSION_URL, 3, Date.now() - 60_000),
      buildBlock('block-2', SESSION_URL, 2, Date.now() - 30_000),
    ];
    const blockStorageStub = createBlockStorageStub({
      [SESSION_URL]: initialBlocks,
    });
    const messageStreamStub = createMessageStreamStub(SESSION_URL);
    const panel = dom.window.document.getElementById('panel');
    expect(panel).not.toBeNull();

    memoryStatus = createMemoryStatus({
      documentRef: dom.window.document,
      windowRef: dom.window,
      messageStream: messageStreamStub.controller,
      blockStorage: blockStorageStub.controller,
      getSessionUrl: () => SESSION_URL,
      experimentalEnabled: true,
      console: dom.window.console,
    });

    memoryStatus.mount(panel);
    await memoryStatus.forceRefresh();

    const section = panel!.querySelector<HTMLElement>('#gmh-section-memory');
    expect(section).not.toBeNull();
    expect(section?.hidden).toBe(false);

    const totalsLine = section!.querySelector<HTMLElement>('[data-field="totals"]');
    const sessionLine = section!.querySelector<HTMLElement>('[data-field="session"]');
    const lastLine = section!.querySelector<HTMLElement>('[data-field="last"]');

    expect(totalsLine?.textContent).toContain('저장된 블록: 2개 (5 메시지)');
    expect(sessionLine?.textContent).toContain('2개 (5 메시지)');
    expect(lastLine?.textContent).toContain('기록 없음');

    const newBlock = buildBlock('block-3', SESSION_URL, 4, Date.now());
    blockStorageStub.registerBlock(newBlock);
    messageStreamStub.emitBlock(newBlock);

    await Promise.resolve();

    expect(totalsLine?.textContent).toContain('저장된 블록: 3개 (9 메시지)');
    expect(sessionLine?.textContent).toContain('3개 (9 메시지)');
    expect(lastLine?.textContent).toContain('방금 전');

    vi.advanceTimersByTime(5_000);
    vi.setSystemTime(new Date('2024-01-01T00:00:05Z'));
    await Promise.resolve();

    expect(lastLine?.textContent).toContain('5초 전');
  });

  it('hides section when feature flag disabled', async () => {
    const blockStorageStub = createBlockStorageStub();
    const messageStreamStub = createMessageStreamStub(SESSION_URL);
    const panel = dom.window.document.getElementById('panel');

    memoryStatus = createMemoryStatus({
      documentRef: dom.window.document,
      windowRef: dom.window,
      messageStream: messageStreamStub.controller,
      blockStorage: blockStorageStub.controller,
      getSessionUrl: () => SESSION_URL,
      experimentalEnabled: false,
      console: dom.window.console,
    });

    memoryStatus.mount(panel);
    await memoryStatus.forceRefresh();

    const section = panel!.querySelector<HTMLElement>('#gmh-section-memory');
    expect(section).not.toBeNull();
    expect(section?.hidden).toBe(true);
    expect(messageStreamStub.controller.subscribeBlocks).not.toHaveBeenCalled();
  });
});
