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
  { role: 'npc', speaker: '조력자', text: '안녕' },
  { role: 'player', speaker: '플레이어', text: '도와줘' },
  { role: 'narration', text: '긴장감이 흐른다' },
  { role: 'player', speaker: '플레이어', text: '준비됐다' },
  { role: 'npc', speaker: '조력자', text: '좋아' },
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
    ExportRange.setTotals({ player: 0, all: 0 });
  });

  it('describes empty state when no player turns are recorded', () => {
    const snapshot = ExportRange.describe();
    expect(snapshot).toEqual({
      active: false,
      start: null,
      end: null,
      count: 0,
      total: 0,
      all: 0,
    });
  });

  it('applies full conversation when no range is set', () => {
    ExportRange.setTotals({ player: 2, all: sampleTurns.length });
    const selection = ExportRange.apply(sampleTurns);
    expect(selection.info).toMatchObject({
      active: false,
      total: 2,
      all: sampleTurns.length,
    });
    expect(selection.turns).toHaveLength(sampleTurns.length);
  });

  it('slices using player-turn boundaries while keeping surrounding entries', () => {
    ExportRange.setTotals({ player: 2, all: sampleTurns.length });
    ExportRange.setRange(2, 2);
    const selection = ExportRange.apply(sampleTurns);

    expect(selection.info).toMatchObject({
      active: true,
      start: 2,
      end: 2,
      count: 1,
      total: 2,
      all: sampleTurns.length,
    });
    expect(selection.info.startIndex).toBe(3);
    expect(selection.info.endIndex).toBe(4);

    expect(selection.turns.map((t) => t.text)).toEqual([
      '준비됐다',
      '좋아',
    ]);
  });

  it('clears custom range when totals reset to zero', () => {
    ExportRange.setTotals({ player: 2, all: sampleTurns.length });
    ExportRange.setRange(1, 1);
    ExportRange.setTotals({ player: 0, all: 0 });
    const snapshot = ExportRange.describe();
    expect(snapshot).toEqual({
      active: false,
      start: null,
      end: null,
      count: 0,
      total: 0,
      all: 0,
    });
  });
});
