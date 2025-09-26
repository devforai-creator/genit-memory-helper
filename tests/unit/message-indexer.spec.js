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

    GMH.Core.MessageIndexer.refresh({ immediate: true });

    const nodes = window.document.querySelectorAll('[data-gmh-message-index]');
    expect(nodes.length).toBe(3);

    const playerNode = window.document.querySelector(
      '[data-gmh-player-turn="1"]',
    );
    expect(playerNode).not.toBeNull();

    const summary = GMH.Core.MessageIndexer.getSummary();
    expect(summary.playerMessages).toBe(1);
    expect(summary.totalMessages).toBe(3);

    const exportBounds = GMH.Core.ExportRange.describe();
    expect(exportBounds.total).toBe(1);
    expect(exportBounds.all).toBe(3);
  });
});
