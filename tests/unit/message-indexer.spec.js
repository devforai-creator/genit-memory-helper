import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { createMessageIndexer } from '../../src/core/message-indexer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');
const fixturePath = path.join(repoRoot, 'tests/fixtures/genit_sample.html');

describe('MessageIndexer', () => {
  it('indexes chat blocks and updates export totals', () => {
    const script = readFileSync(distPath, 'utf8');
    const html = readFileSync(fixturePath, 'utf8');

    const dom = new JSDOM(html, {
      url: 'https://genit.ai/chat',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    });

    const { window } = dom;
    window.GM_setClipboard = () => {};
    window.alert = () => {};
    window.confirm = () => true;
    window.requestAnimationFrame = (cb) => {
      cb();
      return 0;
    };
    window.unsafeWindow = window;
    if (!window.MutationObserver) {
      window.MutationObserver = class {
        observe() {}
        disconnect() {}
      };
    }

    window.eval(script);

    const { GMH } = window;
    expect(GMH).toBeDefined();

    expect(typeof GMH.Core.MessageIndexer.subscribeMessages).toBe('function');

    GMH.Core.MessageIndexer.refresh({ immediate: true });

    const transcript = GMH.Core.readTranscriptText();
    const origin = GMH.Core.getEntryOrigin();
    expect(Array.isArray(origin)).toBe(true);
    expect(origin.length).toBe(transcript.split('\n').length);
    origin.forEach((value) => {
      expect(value === null || Number.isInteger(value)).toBe(true);
    });

    const nodes = window.document.querySelectorAll('[data-gmh-message-index]');
    expect(nodes.length).toBe(3);

    const userNode = window.document.querySelector(
      '[data-gmh-channel="user"]',
    );
    expect(userNode).not.toBeNull();
    expect(userNode?.getAttribute('data-gmh-user-ordinal')).toBe('1');
    expect(userNode?.getAttribute('data-gmh-message-ordinal')).toBe('3');

    const summary = GMH.Core.MessageIndexer.getSummary();
    expect(summary.userMessages).toBe(1);
    expect(summary.totalMessages).toBe(3);

    const exportBounds = GMH.Core.ExportRange.describe();
    expect(exportBounds.axis).toBe('message');
    expect(exportBounds.total).toBe(3);
    expect(exportBounds.messageTotal).toBe(3);
    expect(exportBounds.userTotal).toBe(1);
    expect(exportBounds.llmTotal).toBe(2);
    expect(exportBounds.entryTotal).toBe(3);
    expect(exportBounds.all).toBe(3);
  });
});

describe('createMessageIndexer (unit)', () => {
  let dom;
  let documentRef;
  let container;
  let adapter;

  const addMessage = (id, role = 'player') => {
    const block = documentRef.createElement('div');
    block.className = 'message';
    block.setAttribute('data-id', id);
    block.setAttribute('data-role', role);
    container.appendChild(block);
    return block;
  };

  beforeEach(() => {
    dom = new JSDOM('<div id="chat"></div>', {
      url: 'https://genit.ai/chat',
      pretendToBeVisual: true,
    });
    globalThis.Element = dom.window.Element;
    documentRef = dom.window.document;
    container = documentRef.getElementById('chat');
    adapter = {
      findContainer: () => container,
      listMessageBlocks: () => container.querySelectorAll('.message'),
      detectRole: (block) => block.getAttribute('data-role') || 'unknown',
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips preview nodes, emits events, and caches ordinals', () => {
    const exportRange = { setTotals: vi.fn() };
    const indexer = createMessageIndexer({
      document: documentRef,
      MutationObserver: dom.window.MutationObserver,
      exportRange,
      requestAnimationFrame: null,
      getActiveAdapter: () => adapter,
      getEntryOrigin: () => [0, 1],
    });

    addMessage('m1', 'player');
    const preview = addMessage('preview-xyz', 'npc');
    addMessage('m2', 'npc');

    const events = [];
    indexer.subscribeMessages((event) => events.push(event));

    const summary = indexer.refresh({ immediate: true });

    expect(summary.totalMessages).toBe(2);
    expect(summary.userMessages).toBe(1);
    expect(exportRange.setTotals).toHaveBeenCalledWith({
      message: 2,
      user: 1,
      llm: 1,
      entry: 2,
    });
    expect(preview.getAttribute('data-gmh-message')).toBeNull();
    expect(events.map((event) => event.messageId)).toEqual(['m1', 'm2']);
    expect(indexer.lookupOrdinalByIndex(0)).toBe(2);
    expect(indexer.lookupOrdinalByIndex(1)).toBe(1);
    expect(indexer.lookupOrdinalByMessageId('m1')).toBe(2);
  });

  it('schedules async refresh when not immediate and logs export errors', async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const exportRange = {
      setTotals: vi.fn(() => {
        throw new Error('range failure');
      }),
    };
    const indexer = createMessageIndexer({
      document: documentRef,
      MutationObserver: dom.window.MutationObserver,
      exportRange,
      requestAnimationFrame: null,
      console: { warn },
      getActiveAdapter: () => adapter,
      getEntryOrigin: () => [],
    });

    addMessage('m1', 'player');
    const pending = indexer.refresh();
    expect(pending.totalMessages).toBe(0);

    await vi.advanceTimersByTimeAsync(20);
    const summary = indexer.getSummary();
    expect(summary.totalMessages).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      '[GMH] failed to update export range totals',
      expect.any(Error),
    );
  });

  it('resets when container changes and guards message listeners', () => {
    const warn = vi.fn();
    const secondContainer = documentRef.createElement('div');
    secondContainer.id = 'chat-2';
    documentRef.body.appendChild(secondContainer);

    let activeContainer = container;
    adapter = {
      findContainer: () => activeContainer,
      listMessageBlocks: () => activeContainer.querySelectorAll('.message'),
      detectRole: (block) => block.getAttribute('data-role') || 'unknown',
    };

    const indexer = createMessageIndexer({
      document: documentRef,
      MutationObserver: dom.window.MutationObserver,
      console: { warn },
      getActiveAdapter: () => adapter,
      getEntryOrigin: () => [],
    });

    const events = [];
    indexer.subscribeMessages((event) => events.push(event.messageId));
    indexer.subscribeMessages(() => {
      throw new Error('listener boom');
    });

    const first = addMessage('first', 'player');
    indexer.refresh({ immediate: true });
    expect(events).toEqual(['first']);

    activeContainer = secondContainer;
    secondContainer.appendChild(first);
    indexer.refresh({ immediate: true });
    expect(events).toEqual(['first', 'first']);
    expect(warn).toHaveBeenCalledWith(
      '[GMH] message event listener failed',
      expect.any(Error),
    );
  });
});
