import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');

const scriptSource = readFileSync(distPath, 'utf8');

function bootstrapDom() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://genit.ai/chat',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.GM_setClipboard = () => {};
  window.alert = () => {};
  window.confirm = () => true;
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  if (!window.MutationObserver) {
    window.MutationObserver = class {
      constructor() {}
      observe() {}
      disconnect() {}
    };
  }
  window.unsafeWindow = window;
  window.eval(scriptSource);
  return {
    window,
    cleanup() {
      try {
        dom.window.close();
      } catch (err) {
        // ignore
      }
    },
  };
}

describe('panel settings', () => {
  it('exposes default behavior flags', () => {
    const { window, cleanup } = bootstrapDom();
    const settings = window.GMH.Settings.panel.get();
    expect(settings.behavior.autoHideEnabled).toBe(true);
    expect(settings.behavior.allowDrag).toBe(true);
    expect(settings.behavior.allowResize).toBe(true);
    expect(settings.layout.anchor).toMatch(/left|right/);
    cleanup();
  });

  it('persists updates to localStorage', () => {
    const { window, cleanup } = bootstrapDom();
    const storageKey = window.GMH.Settings.panel.STORAGE_KEY;
    window.GMH.Settings.panel.update({
      behavior: {
        autoHideEnabled: false,
        autoHideDelayMs: 15000,
        collapseOnOutside: false,
      },
    });
    const next = window.GMH.Settings.panel.get();
    expect(next.behavior.autoHideEnabled).toBe(false);
    expect(next.behavior.autoHideDelayMs).toBe(15000);
    expect(next.behavior.collapseOnOutside).toBe(false);
    const raw = window.localStorage.getItem(storageKey);
    expect(raw).toContain('15000');
    cleanup();
  });
});
