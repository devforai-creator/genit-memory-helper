import { describe, it, beforeEach, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');

const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');

const sampleTurns = [
  { role: 'npc', speaker: '조력자', text: '안녕', id: 'npc-0' },
  { role: 'player', speaker: '플레이어', text: '도와줘', id: 'plr-1' },
  { role: 'narration', text: '긴장감이 흐른다', id: 'nar-2' },
  { role: 'player', speaker: '플레이어', text: '준비됐다', id: 'plr-3' },
  { role: 'npc', speaker: '조력자', text: '좋아', id: 'npc-4' },
];

sampleTurns.forEach((turn, idx) => {
  Object.defineProperty(turn, '__gmhEntries', {
    value: [idx],
    enumerable: false,
    configurable: true,
  });
});

const createGMH = () => {
  const script = readFileSync(distPath, 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://genit.ai/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.GM_setClipboard = () => {};
  window.alert = () => {};
  window.confirm = () => true;
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.unsafeWindow = window;
  if (!window.MutationObserver) {
    window.MutationObserver = class {
      observe() {}
      disconnect() {}
    };
  }
  window.eval(script);
  return window.GMH;
};

describe('GMH.Core.ExportRange', () => {
  let ExportRange;

  beforeEach(() => {
    const GMH = createGMH();
    ExportRange = GMH.Core.ExportRange;
    ExportRange.clear();
    const userCount = sampleTurns.filter((turn) => turn.role === 'player').length;
    const llmCount = sampleTurns.length - userCount;
    ExportRange.setTotals({
      message: sampleTurns.length,
      user: userCount,
      llm: llmCount,
      entry: sampleTurns.length,
    });
  });

  it('describes empty state when totals are zero', () => {
    ExportRange.clear();
    ExportRange.setTotals({ message: 0, user: 0, llm: 0, entry: 0 });
    const snapshot = ExportRange.describe();
    expect(snapshot).toMatchObject({
      axis: 'message',
      active: false,
      start: null,
      end: null,
      count: 0,
      total: 0,
      messageTotal: 0,
      userTotal: 0,
      llmTotal: 0,
    });
    expect(snapshot.all).toBe(0);
  });

  it('applies full conversation when no range is set', () => {
    const selection = ExportRange.apply(sampleTurns);
    expect(selection.info).toMatchObject({
      axis: 'message',
      active: false,
      total: sampleTurns.length,
      messageTotal: sampleTurns.length,
    });
    expect(selection.turns).toHaveLength(sampleTurns.length);
    expect(selection.indices).toEqual([0, 1, 2, 3, 4]);
    expect(selection.ordinals).toEqual([5, 4, 3, 2, 1]);
  });

  it('returns only the latest message when range is 1-1', () => {
    ExportRange.setRange(1, 1);
    const selection = ExportRange.apply(sampleTurns);

    expect(selection.info).toMatchObject({
      axis: 'message',
      active: true,
      start: 1,
      end: 1,
      count: 1,
      total: sampleTurns.length,
    });
    expect(selection.info.startIndex).toBe(4);
    expect(selection.info.endIndex).toBe(4);
    expect(selection.indices).toEqual([4]);
    expect(selection.ordinals).toEqual([1]);
    expect(selection.turns.map((t) => t.text)).toEqual(['좋아']);
  });

  it('selects oldest message when range is highest ordinal', () => {
    ExportRange.setRange(sampleTurns.length, sampleTurns.length);
    const selection = ExportRange.apply(sampleTurns);
    expect(selection.info.startIndex).toBe(0);
    expect(selection.info.endIndex).toBe(0);
    expect(selection.indices).toEqual([0]);
    expect(selection.ordinals).toEqual([sampleTurns.length]);
  });

  it('respects explicit start/end selections when totals are unchanged', () => {
    ExportRange.setTotals({
      message: 7,
      user: 4,
      llm: 3,
      entry: 7,
    });
    ExportRange.setStart(1);
    ExportRange.setEnd(7);
    const snapshot = ExportRange.describe();
    expect(snapshot).toMatchObject({
      axis: 'message',
      start: 1,
      end: 7,
      total: 7,
      active: true,
    });
  });

  it('clears custom range when totals reset to zero', () => {
    ExportRange.setRange(1, 1);
    ExportRange.setTotals({ message: 0, user: 0, llm: 0, entry: 0 });
    const snapshot = ExportRange.describe();
    expect(snapshot).toMatchObject({
      axis: 'message',
      active: false,
      start: null,
      end: null,
      count: 0,
      total: 0,
      messageTotal: 0,
    });
  });

  it('records ordinals from newest message backwards', () => {
    const selection = ExportRange.apply(sampleTurns);
    expect(selection.ordinals[0]).toBe(sampleTurns.length);
    expect(selection.ordinals[selection.ordinals.length - 1]).toBe(1);
  });
});
