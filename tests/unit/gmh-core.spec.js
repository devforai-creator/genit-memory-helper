import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');

const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');
const fixturePath = path.join(repoRoot, 'tests/fixtures/genit_sample.html');

describe('GMH Core integration', () => {
  it('parses sample DOM into turns', () => {
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
    window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    window.unsafeWindow = window;
    if (!window.MutationObserver) {
      window.MutationObserver = class {
        constructor(callback) {
          this._callback = callback;
        }
        observe() {}
        disconnect() {}
      };
    }

    window.eval(script);

    const GMH = window.GMH;
    expect(GMH).toBeDefined();

    const transcript = GMH.Core.readTranscriptText();
    expect(transcript).toContain('⟦PLAYER⟧');

    const normalized = GMH.Core.normalizeTranscript(transcript);
    const session = GMH.Core.buildSession(normalized);

    expect(session.turns.length).toBeGreaterThan(0);
    expect(session.turns.some((turn) => turn.role === 'player')).toBe(true);
    expect(session.turns.some((turn) => turn.role === 'npc')).toBe(true);
    expect(session.turns.find((turn) => turn.role === 'player')?.speaker).toBe('플레이어');
  });
});
