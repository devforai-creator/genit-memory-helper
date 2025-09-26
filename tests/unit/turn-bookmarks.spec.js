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

describe('TurnBookmarks history', () => {
  it('stores recent unique entries and enforces a limit', () => {
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

    const bookmarks = GMH.Core.TurnBookmarks;
    bookmarks.clear();

    for (let i = 0; i < 7; i += 1) {
      bookmarks.record(i, i + 1, `msg-${i}`);
    }

    const list = bookmarks.list();
    expect(list.length).toBe(5);
    expect(list[0].messageId).toBe('msg-6');
    expect(list[list.length - 1].messageId).toBe('msg-2');

    bookmarks.record(42, 3, 'msg-3');
    const updated = bookmarks.list();
    expect(updated[0].messageId).toBe('msg-3');
    expect(updated.filter((entry) => entry.messageId === 'msg-3').length).toBe(
      1,
    );
  });
});
