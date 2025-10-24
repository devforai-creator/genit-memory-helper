import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import type {
  ExportRangeController,
  ExportRangeSnapshot,
  TurnBookmarks,
  MessageIndexer,
  ExportRangeInfo,
  ExportRangeTotals,
  ExportRangeSelection,
} from '../../src/types';
import { createRangeControls } from '../../src/ui/range-controls';

interface ExportRangeMockOptions {
  includeSetStart?: boolean;
  includeSetEnd?: boolean;
}

const buildRangeSnapshot = (): ExportRangeSnapshot => {
  const bounds: ExportRangeInfo = {
    axis: 'message',
    active: false,
    start: 1,
    end: 10,
    count: 10,
    total: 10,
    messageTotal: 10,
    userTotal: 0,
    llmTotal: 0,
    entryTotal: 10,
    all: 10,
    requestedStart: null,
    requestedEnd: null,
    desiredStart: 1,
    desiredEnd: 10,
    intersectionStart: 1,
    intersectionEnd: 10,
    reason: 'all',
  };
  const totals: ExportRangeTotals = {
    message: 10,
    user: 0,
    llm: 0,
    entry: 10,
  };
  return {
    range: { start: null, end: null },
    totals,
    bounds,
  };
};

const buildExportRangeMock = (
  options: ExportRangeMockOptions = {},
): {
  exportRange: ExportRangeController;
  setStartSpy: ReturnType<typeof vi.fn> | undefined;
  setEndSpy: ReturnType<typeof vi.fn> | undefined;
} => {
  const { includeSetStart = true, includeSetEnd = true } = options;
  const snapshot = buildRangeSnapshot();
  const setStartSpy = includeSetStart ? vi.fn(() => snapshot) : undefined;
  const setEndSpy = includeSetEnd ? vi.fn(() => snapshot) : undefined;

  const exportRange = {
    getRange: () => ({ ...snapshot.range }),
    getTotals: () => ({ ...snapshot.totals }),
    describe: () => ({ ...snapshot.bounds }),
    apply: vi.fn(
      () =>
        ({
          indices: [],
          ordinals: [],
          turns: [],
          info: null,
          rangeDetails: null,
        }) as ExportRangeSelection,
    ),
    setRange: vi.fn(() => ({ ...snapshot })),
    clear: vi.fn(() => ({ ...snapshot })),
    setTotals: vi.fn(() => ({ ...snapshot })),
    subscribe: (listener: (value: ExportRangeSnapshot) => void) => {
      listener({
        range: { ...snapshot.range },
        totals: { ...snapshot.totals },
        bounds: { ...snapshot.bounds },
      });
      return () => {};
    },
    snapshot: () => ({
      range: { ...snapshot.range },
      totals: { ...snapshot.totals },
      bounds: { ...snapshot.bounds },
    }),
  } as Partial<ExportRangeController>;

  if (includeSetStart && setStartSpy) {
    (exportRange as ExportRangeController).setStart = setStartSpy;
  }
  if (includeSetEnd && setEndSpy) {
    (exportRange as ExportRangeController).setEnd = setEndSpy;
  }

  return {
    exportRange: exportRange as ExportRangeController,
    setStartSpy,
    setEndSpy,
  };
};

const buildTurnBookmarksMock = (): TurnBookmarks => {
  return {
    record: vi.fn(() => null),
    clear: vi.fn(),
    remove: vi.fn(),
    get: vi.fn(() => null),
    latest: vi.fn(() => null),
    pick: vi.fn(() => null),
    list: vi.fn(() => []),
    subscribe: vi.fn((listener?: (entries: []) => void) => {
      if (typeof listener === 'function') listener([]);
      return () => {};
    }),
  } as unknown as TurnBookmarks;
};

const buildMessageIndexerMock = (): MessageIndexer => {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    refresh: vi.fn(() => ({ totalMessages: 0, userMessages: 0 })),
    getSummary: vi.fn(() => ({ totalMessages: 0, userMessages: 0 })),
    lookupOrdinalByIndex: vi.fn(() => null),
    lookupOrdinalByMessageId: vi.fn(() => null),
    subscribe: vi.fn(() => () => {}),
  } as unknown as MessageIndexer;
};

const setupRangeControls = (options: ExportRangeMockOptions = {}) => {
  const dom = new JSDOM(
    `
      <div id="panel">
        <input id="gmh-range-start" />
        <input id="gmh-range-end" />
        <button id="gmh-range-clear"></button>
        <button id="gmh-range-mark-start"></button>
        <button id="gmh-range-mark-end"></button>
        <div id="gmh-range-summary"></div>
        <select id="gmh-range-bookmark-select"></select>
      </div>
    `,
    { url: 'https://genit.ai/chat' },
  );

  const { exportRange, setStartSpy, setEndSpy } = buildExportRangeMock(options);
  const rangeControls = createRangeControls({
    documentRef: dom.window.document,
    windowRef: dom.window,
    exportRange,
    turnBookmarks: buildTurnBookmarksMock(),
    messageIndexer: buildMessageIndexerMock(),
  });
  const panel = dom.window.document.querySelector('#panel');
  rangeControls.bindRangeControls(panel);

  const rangeStartInput = panel?.querySelector<HTMLInputElement>('#gmh-range-start') ?? null;
  const rangeEndInput = panel?.querySelector<HTMLInputElement>('#gmh-range-end') ?? null;

  return {
    window: dom.window,
    document: dom.window.document,
    exportRange,
    rangeStartInput,
    rangeEndInput,
    setStartSpy,
    setEndSpy,
  };
};

describe('range controls input handlers', () => {
  it('invokes exportRange.setStart when start input changes', () => {
    const { window, rangeStartInput, setStartSpy } = setupRangeControls();
    expect(rangeStartInput).not.toBeNull();
    rangeStartInput!.value = '5';
    rangeStartInput!.dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(setStartSpy).toHaveBeenCalledTimes(1);
    expect(setStartSpy).toHaveBeenCalledWith(5);
  });

  it('invokes exportRange.setEnd when end input changes', () => {
    const { window, rangeEndInput, setEndSpy } = setupRangeControls();
    expect(rangeEndInput).not.toBeNull();
    rangeEndInput!.value = '7';
    rangeEndInput!.dispatchEvent(new window.Event('blur', { bubbles: true }));

    expect(setEndSpy).toHaveBeenCalledTimes(1);
    expect(setEndSpy).toHaveBeenCalledWith(7);
  });

  it('logs a warning when exportRange.setStart is missing', () => {
    const { window, rangeStartInput } = setupRangeControls({ includeSetStart: false });
    expect(rangeStartInput).not.toBeNull();

    const warnSpy = vi.spyOn(window.console, 'warn').mockImplementation(() => {});

    rangeStartInput!.value = '3';
    rangeStartInput!.dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(warnSpy).toHaveBeenCalledWith('[GMH] exportRange.setStart is not available');
    warnSpy.mockRestore();
  });
});
