import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createAutoLoader } from '../../src/features/auto-loader';

const baseStateEnum = { SCANNING: 'SCANNING', DONE: 'DONE', ERROR: 'ERROR', IDLE: 'IDLE' };

const buildDeps = (overrides: Record<string, unknown> = {}) => {
  const dom = new JSDOM('<div id="container"></div>');
  const container = dom.window.document.getElementById('container') as HTMLElement;
  const setState = vi.fn();
  const setPanelStatus = vi.fn();

  const getActiveAdapter = vi.fn(() => ({
    id: 'babechat',
    findContainer: () => container,
    canUseApiCollection: () => true,
    fetchAllMessagesViaApi: vi.fn(async () => [
      { id: 'm1', role: 'player', channel: 'user', parts: [{ lines: ['hello'] }], ordinal: 0, index: 0 },
      { id: 'm2', role: 'npc', channel: 'llm', parts: [{ lines: ['hi'] }], ordinal: 1, index: 1 },
    ]),
  }));

  const errorHandler = { handle: vi.fn(), LEVELS: { WARN: 'warn', ERROR: 'error' } };
  const messageIndexer = {
    refresh: vi.fn(() => ({ totalMessages: 2, userMessages: 1, timestamp: 123 })),
  };
  const exportRange = {
    getTotals: vi.fn(() => ({ message: 0, user: 0, llm: 0, entry: 0 })),
    setTotals: vi.fn(),
    clear: vi.fn(),
    getRange: vi.fn(() => ({ start: null, end: null })),
  };
  const normalizeTranscript = vi.fn((text: string) => text);
  const buildSession = vi.fn((text: string) => ({
    turns: text.split('\n').filter(Boolean).map((line, idx) => ({
      id: `t-${idx}`,
      channel: idx % 2 === 0 ? 'user' : 'llm',
      content: line,
      __gmhSourceBlocks: [idx],
    })),
  }));
  const readTranscriptText = vi.fn(() => 'line1\nline2');

  return {
    stateApi: { setState, getState: vi.fn(() => 'IDLE') },
    stateEnum: baseStateEnum,
    errorHandler,
    messageIndexer,
    exportRange,
    setPanelStatus,
    getActiveAdapter,
    sleep: vi.fn(async () => {}),
    isScrollable: vi.fn(() => true),
    documentRef: dom.window.document,
    windowRef: dom.window,
    normalizeTranscript,
    buildSession,
    readTranscriptText,
    ...overrides,
  };
};

describe('createAutoLoader validation', () => {
  it('throws when required dependencies are missing', () => {
    expect(() => createAutoLoader()).toThrow(/stateApi/);
    expect(() => createAutoLoader({ stateApi: { setState: vi.fn() } } as any)).toThrow(/stateEnum/);
    expect(() =>
      createAutoLoader({ stateApi: { setState: vi.fn() }, stateEnum: baseStateEnum } as any),
    ).toThrow(/errorHandler/);
    expect(() =>
      createAutoLoader({
        stateApi: { setState: vi.fn() },
        stateEnum: baseStateEnum,
        errorHandler: { handle: vi.fn(), LEVELS: { ERROR: 'error' } },
      } as any),
    ).toThrow(/getActiveAdapter/);
    expect(() =>
      createAutoLoader({
        stateApi: { setState: vi.fn() },
        stateEnum: baseStateEnum,
        errorHandler: { handle: vi.fn(), LEVELS: { ERROR: 'error' } },
        getActiveAdapter: vi.fn(),
      } as any),
    ).toThrow(/sleep helper/);
    expect(() =>
      createAutoLoader({
        stateApi: { setState: vi.fn() },
        stateEnum: baseStateEnum,
        errorHandler: { handle: vi.fn(), LEVELS: { ERROR: 'error' } },
        getActiveAdapter: vi.fn(),
        sleep: vi.fn(),
      } as any),
    ).toThrow(/isScrollable/);
    expect(() =>
      createAutoLoader({
        stateApi: { setState: vi.fn() },
        stateEnum: baseStateEnum,
        errorHandler: { handle: vi.fn(), LEVELS: { ERROR: 'error' } },
        getActiveAdapter: vi.fn(),
        sleep: vi.fn(),
        isScrollable: vi.fn(),
      } as any),
    ).toThrow(/transcript helpers/);
    expect(() =>
      createAutoLoader({
        ...buildDeps(),
        documentRef: null,
      } as any),
    ).toThrow(/document reference/);
    expect(() =>
      createAutoLoader({
        ...buildDeps(),
        windowRef: null,
      } as any),
    ).toThrow(/window reference/);
  });

  it('rejects invalid turn target and startCurrent without previous mode', async () => {
    const deps = buildDeps();
    const loader = createAutoLoader(deps);
    const result = await loader.autoLoader.start('turns', 0);
    expect(result).toBeNull();
    expect(deps.setPanelStatus).toHaveBeenCalledWith(expect.stringContaining('목표'), 'error');

    const startAgain = await loader.autoLoader.startCurrent();
    expect(startAgain).toBeNull();
    expect(deps.setPanelStatus).toHaveBeenLastCalledWith(expect.stringContaining('목표'), 'error');
  });
});

describe('createAutoLoader API path', () => {
  it('uses API collection, notifies listeners, and caches progressive messages', async () => {
    const deps = buildDeps();
    const profileListener = vi.fn();
    const loader = createAutoLoader(deps);
    loader.subscribeProfileChange(profileListener);

    const stats = await loader.autoLoader.start('all', null, { profile: 'fast' });

    expect(profileListener).toHaveBeenCalledWith('fast');
    expect(deps.stateApi.setState).toHaveBeenCalledWith('SCANNING', expect.anything());
    expect(deps.stateApi.setState).toHaveBeenCalledWith('DONE', expect.anything());
    expect(stats?.userMessages).toBe(1);
    expect(loader.hasProgressiveMessages()).toBe(true);
    expect(loader.getProgressiveMessages()).toHaveLength(2);
  });

  it('handles API collection failure and falls back to stats', async () => {
    const deps = buildDeps({
      getActiveAdapter: vi.fn(() => ({
        id: 'babechat',
        findContainer: () => (deps as any).documentRef?.body,
        canUseApiCollection: () => true,
        fetchAllMessagesViaApi: vi.fn(async () => {
          throw new Error('network down');
        }),
      })),
    });

    const loader = createAutoLoader(deps);
    const stats = await loader.autoLoader.start('all');

    expect(stats.totalMessages).toBe(2);
    expect(deps.setPanelStatus).not.toHaveBeenCalledWith(expect.stringContaining('목표'), 'error');
    expect(deps.errorHandler.handle).toHaveBeenCalledWith(expect.any(Error), 'autoload', 'warn');
  });
});
