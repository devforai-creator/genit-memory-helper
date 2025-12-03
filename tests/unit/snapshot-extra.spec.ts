import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createSnapshotFeature, createStructuredSnapshotReader } from '../../src/features/snapshot';

describe('snapshot feature guards and helpers', () => {
  it('throws when required snapshot dependencies are missing', () => {
    expect(() => createSnapshotFeature({} as any)).toThrow(/missing required dependencies/);
    expect(() =>
      createStructuredSnapshotReader({ getActiveAdapter: null as any, setEntryOriginProvider: vi.fn() }),
    ).toThrow(/requires getActiveAdapter/);
    expect(() =>
      createStructuredSnapshotReader({
        getActiveAdapter: vi.fn(),
        setEntryOriginProvider: vi.fn(),
        documentRef: null as any,
      }),
    ).toThrow(/document reference/);
  });

  it('describes DOM nodes and downloads snapshot JSON', async () => {
    const dom = new JSDOM('<div id="container"><div class="block a b">hello</div></div>', {
      url: 'https://genit.ai/chat/123',
    });
    const downloadSpy = vi.fn();
    const setPanelStatus = vi.fn();
    const adapter = {
      findContainer: () => dom.window.document.getElementById('container'),
      listMessageBlocks: (root: Document | Element) => root.querySelectorAll('.block'),
      dumpSelectors: () => ({ messageRoot: ['.block'] }),
    };

    const feature = createSnapshotFeature({
      getActiveAdapter: () => adapter as any,
      triggerDownload: downloadSpy,
      setPanelStatus,
      errorHandler: { handle: vi.fn((_err: unknown, _ctx?: string) => 'boom'), LEVELS: { ERROR: 'error' } } as any,
      documentRef: dom.window.document,
      locationRef: dom.window.location,
    });

    feature.downloadDomSnapshot();

    expect(downloadSpy).toHaveBeenCalled();
    const blob = downloadSpy.mock.calls[0][0] as Blob;
    const json = JSON.parse(new TextDecoder().decode(Buffer.from(await blob.arrayBuffer())));
    expect(json.container_path).toContain('div#container');
    expect(json.block_count).toBe(1);
    expect(setPanelStatus).toHaveBeenCalledWith(expect.stringContaining('저장되었습니다'), 'success');
  });

  it('falls back to error message when snapshot fails', () => {
    const dom = new JSDOM('<div></div>');
    const setPanelStatus = vi.fn();
    const feature = createSnapshotFeature({
      getActiveAdapter: () => {
        throw new Error('adapter missing');
      },
      triggerDownload: vi.fn(),
      setPanelStatus,
      errorHandler: {
        handle: vi.fn((err: unknown) => (err as Error).message),
        LEVELS: { ERROR: 'error' },
      } as any,
      documentRef: dom.window.document,
      locationRef: dom.window.location,
    });

    feature.downloadDomSnapshot();
    expect(setPanelStatus).toHaveBeenCalledWith(expect.stringContaining('adapter missing'), 'error');
  });
});

describe('structured snapshot reader', () => {
  it('prefers progressive messages over DOM query', () => {
    const dom = new JSDOM('<div></div>');
    const progressive = [
      { id: 'p1', parts: [{ lines: ['Hello'] }], legacyLines: ['Hello'], ordinal: 1, index: 1, role: 'player' },
      { id: 'p2', parts: [{ lines: ['Hi'] }], legacyLines: ['Hi'], ordinal: 2, index: 2, role: 'npc' },
    ];
    const reader = createStructuredSnapshotReader({
      getActiveAdapter: vi.fn(),
      setEntryOriginProvider: vi.fn(),
      getProgressiveMessages: () => progressive as any,
      documentRef: dom.window.document,
    });

    const snapshot = reader.captureStructuredSnapshot();
    expect(snapshot.legacyLines).toEqual(['Hello', 'Hi']);
    expect(snapshot.entryOrigin).toEqual([1, 2]);
    expect(reader.readStructuredMessages()).toHaveLength(2);
  });

  it('captures from DOM blocks and projects ranges', () => {
    const dom = new JSDOM('<div><div class="block" data-gmh-message-ordinal="3">Line A</div></div>');
    const block = dom.window.document.querySelector('.block') as Element;
    const adapter = {
      findContainer: () => dom.window.document.body,
      listMessageBlocks: () => [block],
      resetInfoRegistry: vi.fn(),
      collectStructuredMessage: vi.fn(() => ({
        id: 'm1',
        role: 'player',
        channel: 'user',
        parts: [{ lines: ['Line A'] }],
        legacyLines: ['Line A'],
      })),
      emitTranscriptLines: vi.fn(),
    };

    const entryOrigins: Array<number | null> = [];
    const reader = createStructuredSnapshotReader({
      getActiveAdapter: () => adapter as any,
      setEntryOriginProvider: (fn: () => Array<number | null>) => {
        entryOrigins.push(...fn());
      },
      documentRef: dom.window.document,
    });

    const snapshot = reader.captureStructuredSnapshot();
    expect(snapshot.messages[0].ordinal).toBe(3);
    expect(snapshot.legacyLines).toEqual(['Line A']);

    const projected = reader.projectStructuredMessages(snapshot, {
      active: true,
      start: 3,
      end: 3,
      messageStartIndex: null,
      messageEndIndex: null,
      messageTotal: null,
      total: null,
      count: null,
    });
    expect(projected.messages).toHaveLength(1);
    expect(projected.range.active).toBe(true);
  });

  it('throws when no container or blocks are found', () => {
    const dom = new JSDOM('<div></div>');
    const adapter = {
      findContainer: () => null,
      listMessageBlocks: () => [],
      resetInfoRegistry: vi.fn(),
      emitTranscriptLines: vi.fn(),
    };

    const reader = createStructuredSnapshotReader({
      getActiveAdapter: () => adapter as any,
      setEntryOriginProvider: vi.fn(),
      documentRef: dom.window.document,
    });

    expect(() => reader.captureStructuredSnapshot()).toThrow(/컨테이너를 찾을 수 없습니다/);
  });
});
