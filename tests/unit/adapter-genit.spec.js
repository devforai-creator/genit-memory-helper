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
        <div class="markdown-content text-muted-foreground"><p>오프닝 내레이션</p></div>
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

  it('captures narration paragraphs that appear after NPC bubbles without muted classes', () => {
    const block = window.document.createElement('div');
    block.setAttribute('data-message-id', 'npc-2');
    block.setAttribute('data-gmh-message-role', 'npc');
    block.innerHTML = `
      <div data-role="assistant" class="flex flex-col w-full group">
        <div class="p-4 rounded-xl bg-background border border-border shadow-sm text-foreground">
          <p>NPC 대사 먼저</p>
        </div>
        <p class="last:mb-0 mb-3">NPC 대사 이후에 이어지는 묘사 문장입니다.</p>
        <pre class="overflow-x-auto p-4 bg-background text-foreground">
          <code class="block hljs language-INFO">4월 12일 월요일 14:00 | 행동 |📍 버니홀 입구 |\n\n🍄 1\n\n성아현 | ❤️ 경멸 |💗 0 | 💦 0 | 🪣 50</code>
        </pre>
      </div>
    `;

    const lines = [];
    GMH.Adapters.genit.emitTranscriptLines(block, (line) => lines.push(line));

    expect(lines).toContain('NPC 대사 이후에 이어지는 묘사 문장입니다.');
    expect(lines.filter((line) => line === 'INFO')).toHaveLength(1);

    const structured = GMH.Adapters.genit.collectStructuredMessage(block);
    const narrationPart = structured.parts.find((part) => part?.flavor === 'narration');
    expect(narrationPart?.lines || []).toContain('NPC 대사 이후에 이어지는 묘사 문장입니다.');
  });

  it('preserves duplicate dialogue lines within a single NPC block', () => {
    const block = window.document.createElement('div');
    block.setAttribute('data-message-id', 'npc-duplicate');
    block.setAttribute('data-gmh-message-role', 'npc');
    block.innerHTML = `
      <div data-role="assistant" class="flex flex-col w-full group">
        <div class="p-4 rounded-xl bg-background">
          <p>같습니다</p>
        </div>
        <div class="p-4 rounded-xl bg-background">
          <p>같습니다</p>
        </div>
      </div>
    `;

    const structured = GMH.Adapters.genit.collectStructuredMessage(block);
    const speechParts = structured.parts.filter((part) => part?.flavor === 'speech');
    const speechLines = speechParts.flatMap((part) => part.lines || []);

    expect(speechLines.filter((line) => line === '같습니다')).toHaveLength(2);
  });

  it('deduplicates INFO lines while keeping header in legacy output', () => {
    const block = window.document.createElement('div');
    block.setAttribute('data-message-id', 'info-1');
    block.setAttribute('data-gmh-message-role', 'npc');
    block.innerHTML = `
      <pre class="bg-card">
        <code class="language-INFO">중요\n중요\n경고</code>
      </pre>
    `;

    const structured = GMH.Adapters.genit.collectStructuredMessage(block);
    const infoPart = structured.parts.find((part) => part?.type === 'info');

    expect(infoPart?.lines).toEqual(['중요', '경고']);
    expect(infoPart?.legacyLines).toEqual(['INFO', '중요', '경고']);
  });

  it('does not include INFO header in structured info lines', () => {
    const block = window.document.createElement('div');
    block.setAttribute('data-message-id', 'info-2');
    block.setAttribute('data-gmh-message-role', 'npc');
    block.innerHTML = `
      <pre class="bg-card">
        <code class="language-INFO">내용1\n내용2</code>
      </pre>
    `;

    const structured = GMH.Adapters.genit.collectStructuredMessage(block);
    const infoPart = structured.parts.find((part) => part?.type === 'info');

    expect(infoPart?.lines).toEqual(['내용1', '내용2']);
    expect(infoPart?.lines).not.toContain('INFO');
    expect(infoPart?.legacyLines[0]).toBe('INFO');
  });

  it('retains single-word narration descriptors', () => {
    const block = window.document.createElement('div');
    block.setAttribute('data-message-id', 'narration-1');
    block.setAttribute('data-gmh-message-role', 'npc');
    block.innerHTML = `
      <div class="markdown-content text-muted-foreground">
        <p>정적</p>
      </div>
    `;

    const lines = [];
    GMH.Adapters.genit.emitTranscriptLines(block, (line) => lines.push(line));
    expect(lines).toContain('정적');

    const structured = GMH.Adapters.genit.collectStructuredMessage(block);
    const narrationPart = structured.parts.find((part) => part?.flavor === 'narration');
    expect(narrationPart?.lines || []).toContain('정적');
  });

  it('detects player thought/action input via React props', () => {
    const block = window.document.createElement('div');
    block.setAttribute('data-message-id', 'player-thought-1');
    // Simulate genit.ai structure: role="assistant" in React but player content
    block.innerHTML = `
      <div class="flex w-full">
        <div class="w-full">
          <div class="markdown-content text-muted-foreground text-sm">
            <p>'현재 상황을 분석해보자. 나는 지금...' 나는 빠르게 상황을 파악한다.</p>
          </div>
        </div>
      </div>
    `;

    // Mock React Fiber structure (genit.ai uses role="user" for player input)
    const mockFiber = {
      memoizedProps: {
        message: {
          id: 'player-thought-1',
          role: 'user',
          content: "'현재 상황을 분석해보자. 나는 지금...' 나는 빠르게 상황을 파악한다."
        }
      },
      return: null
    };

    // Simulate React's __reactFiber property
    Object.defineProperty(block, '__reactFiber$test', {
      value: mockFiber,
      enumerable: false,
      configurable: true
    });

    const role = GMH.Adapters.genit.detectRole(block);
    expect(role).toBe('player');
  });

  it('falls back to CSS detection when React props unavailable', () => {
    const block = window.document.createElement('div');
    block.setAttribute('data-message-id', 'player-normal');
    // Standard player message with justify-end class
    block.innerHTML = `
      <div class="flex w-full justify-end">
        <div class="flex flex-col items-end w-full space-y-3">
          <div class="p-4 rounded-xl bg-background border border-border">
            <p>일반 대사입니다.</p>
          </div>
        </div>
      </div>
    `;

    // No React Fiber props
    const role = GMH.Adapters.genit.detectRole(block);
    expect(role).toBe('player');
  });
});
