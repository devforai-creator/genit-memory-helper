import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAutoLoader } from '../../src/features/auto-loader.js';

const MutationObserverStub = class {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  disconnect() {}
};

const createStateApi = () => ({
  setState: () => {},
});

const createErrorHandler = () => ({
  LEVELS: { WARN: 'warn', ERROR: 'error', INFO: 'info' },
  handle: vi.fn(),
});

const noopExportTotals = () => ({ message: 0, user: 0, llm: 0, entry: 0 });

describe('auto-loader stats caching', () => {
  let summaryRef;
  let rawRef;
  let sessionRef;
  let messageIndexer;
  let readTranscriptText;
  let normalizeTranscript;
  let buildSession;
  let exportRange;
  let collectTurnStats;

  beforeEach(() => {
    summaryRef = { totalMessages: 2, userMessages: 1, timestamp: 1111 };
    rawRef = 'first-run';
    sessionRef = {
      turns: [
        { channel: 'user', __gmhSourceBlocks: [0] },
        { channel: 'llm', __gmhSourceBlocks: [1] },
      ],
    };

    messageIndexer = {
      refresh: vi.fn(() => summaryRef),
    };
    readTranscriptText = vi.fn(() => rawRef);
    normalizeTranscript = vi.fn((value) => value);
    buildSession = vi.fn(() => sessionRef);
    exportRange = {
      getTotals: vi.fn(() => noopExportTotals()),
      setTotals: vi.fn(),
    };

    const autoLoaderFactory = createAutoLoader({
      stateApi: createStateApi(),
      stateEnum: { SCANNING: 'scanning', DONE: 'done', ERROR: 'error', IDLE: 'idle' },
      errorHandler: createErrorHandler(),
      messageIndexer,
      exportRange,
      setPanelStatus: () => {},
      getActiveAdapter: () => ({ findContainer: () => null, listMessageBlocks: () => [] }),
      sleep: () => Promise.resolve(),
      isScrollable: () => false,
      documentRef: {
        defaultView: { Element: class {} },
        body: {},
        documentElement: {},
      },
      windowRef: {
        MutationObserver: MutationObserverStub,
        setTimeout: () => 0,
        setInterval: () => 0,
        clearInterval: () => {},
      },
      normalizeTranscript,
      buildSession,
      readTranscriptText,
      logger: { warn: () => {} },
    });

    collectTurnStats = autoLoaderFactory.collectTurnStats;
  });

  it('reuses cached stats when index summary is unchanged', () => {
    collectTurnStats();
    expect(readTranscriptText).toHaveBeenCalledTimes(1);
    expect(exportRange.setTotals).toHaveBeenCalledTimes(1);

    collectTurnStats();
    expect(readTranscriptText).toHaveBeenCalledTimes(1);
    expect(exportRange.setTotals).toHaveBeenCalledTimes(1);
    expect(messageIndexer.refresh).toHaveBeenCalledTimes(2);
  });

  it('rebuilds stats when index summary timestamp changes', () => {
    collectTurnStats();
    expect(readTranscriptText).toHaveBeenCalledTimes(1);

    summaryRef = { totalMessages: 3, userMessages: 2, timestamp: 2222 };
    sessionRef = {
      turns: [
        { channel: 'user', __gmhSourceBlocks: [0] },
        { channel: 'llm', __gmhSourceBlocks: [1] },
        { channel: 'user', __gmhSourceBlocks: [2] },
      ],
    };
    rawRef = 'second-run';

    collectTurnStats();
    expect(readTranscriptText).toHaveBeenCalledTimes(2);
    expect(exportRange.setTotals).toHaveBeenCalledTimes(2);
  });

  it('forces rebuild when force flag is set even if summary is unchanged', () => {
    collectTurnStats();
    expect(readTranscriptText).toHaveBeenCalledTimes(1);

    rawRef = 'forced-run';
    collectTurnStats({ force: true });
    expect(readTranscriptText).toHaveBeenCalledTimes(2);
    expect(exportRange.setTotals).toHaveBeenCalledTimes(2);
  });
});
