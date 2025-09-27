import { describe, it, beforeEach, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');

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
  return { GMH: window.GMH, window };
};

describe('Genit adapter narration handling', () => {
  let GMH;
  let window;

  beforeEach(() => {
    ({ GMH, window } = createGMH());
  });

  it('keeps narration segments hosted inside NPC groups', () => {
    const block = window.document.createElement('div');
    block.setAttribute('data-message-id', 'npc-1');
    block.setAttribute('data-gmh-message-role', 'npc');
    block.innerHTML = `
      <div data-role="assistant">
        <div class="markdown-content text-muted-foreground">오프닝 내레이션</div>
        <div class="p-4 rounded-xl bg-background">
          <p>NPC 대사입니다.</p>
        </div>
      </div>
    `;

    const lines = [];
    GMH.Adapters.genit.emitTranscriptLines(block, (line) => lines.push(line));

    expect(lines).toContain('오프닝 내레이션');
    expect(lines).toContain('@NPC@ "NPC 대사입니다."');
  });
});

