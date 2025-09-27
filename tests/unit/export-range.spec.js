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
    ExportRange.setAxis('player');
    ExportRange.setTotals({ player: 0, entry: 0 });
  });

  it('describes empty state when no player turns are recorded', () => {
    const snapshot = ExportRange.describe();
    expect(snapshot).toMatchObject({
      axis: 'player',
      active: false,
      start: null,
      end: null,
      count: 0,
      total: 0,
      playerTotal: 0,
      entryTotal: 0,
    });
    expect(snapshot.all).toBe(0);
  });

  it('applies full conversation when no range is set', () => {
    ExportRange.setTotals({ player: 2, entry: sampleTurns.length });
    const selection = ExportRange.apply(sampleTurns);
    expect(selection.info).toMatchObject({
      axis: 'player',
      active: false,
      total: 2,
      playerTotal: 2,
      entryTotal: sampleTurns.length,
    });
    expect(selection.turns).toHaveLength(sampleTurns.length);
    expect(selection.indices).toEqual([0, 1, 2, 3, 4]);
    expect(selection.ordinals).toEqual([null, 2, null, 1, null]);
  });

  it('slices using player-turn boundaries while keeping surrounding entries', () => {
    ExportRange.setTotals({ player: 2, entry: sampleTurns.length });
    ExportRange.setRange(1, 1);
    const selection = ExportRange.apply(sampleTurns);

    expect(selection.info).toMatchObject({
      axis: 'player',
      active: true,
      start: 1,
      end: 1,
      count: 1,
      total: 2,
      playerTotal: 2,
      entryTotal: sampleTurns.length,
    });
    expect(selection.info.startIndex).toBe(2);
    expect(selection.info.endIndex).toBe(4);
    expect(selection.indices).toEqual([2, 3, 4]);
    expect(selection.ordinals).toEqual([null, 1, null]);

    expect(selection.turns.map((t) => t.text)).toEqual([
      '긴장감이 흐른다',
      '준비됐다',
      '좋아',
    ]);
  });

  it('allows opting out of prologue expansion', () => {
    ExportRange.setTotals({ player: 2, entry: sampleTurns.length });
    ExportRange.setRange(1, 1);
    const selection = ExportRange.apply(sampleTurns, {
      prologuePolicy: 'none',
    });

    expect(selection.info.startIndex).toBe(3);
    expect(selection.indices).toEqual([3, 4]);
    expect(selection.ordinals).toEqual([1, null]);
  });

  it('can expand prologue all the way to the first entry', () => {
    ExportRange.setTotals({ player: 2, entry: sampleTurns.length });
    ExportRange.setRange(1, 1);
    const selection = ExportRange.apply(sampleTurns, {
      prologuePolicy: 'toStart',
    });

    expect(selection.info.startIndex).toBe(0);
    expect(selection.indices).toEqual([0, 1, 2, 3, 4]);
  });

  it('respects explicit start/end selections when totals are unchanged', () => {
    ExportRange.setTotals({ player: 7, entry: 10 });
    ExportRange.setStart(1);
    ExportRange.setEnd(7);
    const snapshot = ExportRange.describe();
    expect(snapshot).toMatchObject({
      axis: 'player',
      start: 1,
      end: 7,
      total: 7,
      active: true,
    });
  });

  it('clears custom range when totals reset to zero', () => {
    ExportRange.setTotals({ player: 2, entry: sampleTurns.length });
    ExportRange.setRange(1, 1);
    ExportRange.setTotals({ player: 0, entry: 0 });
    const snapshot = ExportRange.describe();
    expect(snapshot).toMatchObject({
      axis: 'player',
      active: false,
      start: null,
      end: null,
      count: 0,
      total: 0,
      playerTotal: 0,
      entryTotal: 0,
    });
  });

  it('supports selecting by entry axis ordinals', () => {
    ExportRange.setTotals({ player: 2, entry: sampleTurns.length });
    ExportRange.setAxis('entry');
    const entrySnapshot = ExportRange.describe();
    expect(entrySnapshot.axis).toBe('entry');
    ExportRange.setRange(5, 5);
    const selection = ExportRange.apply(sampleTurns);

    expect(selection.info.axis).toBe('entry');
    expect(selection.info.startIndex).toBe(0);
    expect(selection.info.endIndex).toBe(0);
    expect(selection.indices).toEqual([0]);
    expect(selection.turns.map((t) => t.text)).toEqual(['안녕']);
    expect(selection.info.entryTotal).toBe(sampleTurns.length);
    expect(selection.info.playerTotal).toBe(2);
  });
});
