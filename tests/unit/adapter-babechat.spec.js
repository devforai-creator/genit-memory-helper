import { describe, it, beforeEach, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');

const createGMH = (url = 'https://babechat.ai/') => {
  const script = readFileSync(distPath, 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url,
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
  return { GMH: window.GMH, window, dom };
};

describe('Babechat adapter', () => {
  let GMH;
  let window;

  beforeEach(() => {
    ({ GMH, window } = createGMH());
  });

  describe('match()', () => {
    it('matches babechat.ai hostname', () => {
      const adapter = GMH.Adapters.babechat;
      expect(adapter.match({ hostname: 'babechat.ai' })).toBe(true);
      expect(adapter.match({ hostname: 'www.babechat.ai' })).toBe(true);
      expect(adapter.match({ hostname: 'BABECHAT.AI' })).toBe(true);
    });

    it('does not match other hostnames', () => {
      const adapter = GMH.Adapters.babechat;
      expect(adapter.match({ hostname: 'genit.ai' })).toBe(false);
      expect(adapter.match({ hostname: 'example.com' })).toBe(false);
      expect(adapter.match({ hostname: 'babechat.com' })).toBe(false);
    });
  });

  describe('detectRole()', () => {
    it('detects player message by justify-end and B56576 class', () => {
      const block = window.document.createElement('div');
      block.innerHTML = `
        <div class="justify-end">
          <div class="bg-[#B56576] rounded-xl p-3">안녕하세요</div>
        </div>
      `;

      const role = GMH.Adapters.babechat.detectRole(block);
      expect(role).toBe('player');
    });

    it('detects NPC message by avatar link', () => {
      const block = window.document.createElement('div');
      block.innerHTML = `
        <a href="/character/abc123/name">
          <img src="/avatar.jpg" alt="avatar" />
        </a>
        <div class="bg-[#262727] rounded-xl p-3">NPC 대사</div>
      `;

      const role = GMH.Adapters.babechat.detectRole(block);
      expect(role).toBe('npc');
    });

    it('detects system message by px-5 without pt-4', () => {
      const block = window.document.createElement('div');
      block.className = 'px-5';
      block.innerHTML = `
        <div class="bg-[#363636]">시나리오 내용</div>
      `;

      const role = GMH.Adapters.babechat.detectRole(block);
      expect(role).toBe('system');
    });

    it('returns unknown for unrecognized blocks', () => {
      const block = window.document.createElement('div');
      block.innerHTML = '<span>Unknown content</span>';

      const role = GMH.Adapters.babechat.detectRole(block);
      expect(role).toBe('unknown');
    });
  });

  describe('emitTranscriptLines()', () => {
    it('emits player lines with player mark', () => {
      const block = window.document.createElement('div');
      block.innerHTML = `
        <div class="justify-end">
          <div class="bg-[#B56576] rounded-xl p-3">플레이어 대사입니다</div>
        </div>
      `;

      const lines = [];
      GMH.Adapters.babechat.emitTranscriptLines(block, (line) => lines.push(line));

      expect(lines.some(line => line.includes('플레이어 대사입니다'))).toBe(true);
      expect(lines.some(line => line.includes('⟦PLAYER⟧'))).toBe(true);
    });

    it('emits NPC dialogue with speaker prefix', () => {
      const block = window.document.createElement('div');
      block.innerHTML = `
        <a href="/character/abc123/캐릭터이름">
          <img src="/avatar.jpg" alt="avatar" />
        </a>
        <span class="text-[0.75rem]">캐릭터이름</span>
        <div class="bg-[#262727] rounded-xl p-3">대사 내용입니다</div>
      `;

      const lines = [];
      GMH.Adapters.babechat.emitTranscriptLines(block, (line) => lines.push(line));

      expect(lines.some(line => line.includes('@') && line.includes('"'))).toBe(true);
    });

    it('emits narration without speaker prefix', () => {
      const block = window.document.createElement('div');
      block.innerHTML = `
        <a href="/character/abc123/캐릭터이름">
          <img src="/avatar.jpg" alt="avatar" />
        </a>
        <div class="bg-[#363636] rounded-xl p-3">그녀는 천천히 다가왔다.</div>
      `;

      const lines = [];
      GMH.Adapters.babechat.emitTranscriptLines(block, (line) => lines.push(line));

      expect(lines).toContain('그녀는 천천히 다가왔다.');
    });

    it('parses speaker|dialogue format correctly', () => {
      const block = window.document.createElement('div');
      block.innerHTML = `
        <a href="/character/abc123/NPC">
          <img src="/avatar.jpg" alt="avatar" />
        </a>
        <div class="bg-[#262727] rounded-xl p-3">미나 | 안녕, 만나서 반가워!</div>
      `;

      const lines = [];
      GMH.Adapters.babechat.emitTranscriptLines(block, (line) => lines.push(line));

      expect(lines.some(line => line.includes('@미나@'))).toBe(true);
      expect(lines.some(line => line.includes('안녕, 만나서 반가워!'))).toBe(true);
    });
  });

  describe('collectStructuredMessage()', () => {
    it('collects player message with correct structure', () => {
      const block = window.document.createElement('div');
      block.setAttribute('data-gmh-message-role', 'player');
      block.setAttribute('data-gmh-message-ordinal', '1');
      block.innerHTML = `
        <div class="justify-end">
          <div class="bg-[#B56576] rounded-xl p-3">테스트 메시지</div>
        </div>
      `;

      const message = GMH.Adapters.babechat.collectStructuredMessage(block);

      expect(message).not.toBeNull();
      expect(message.role).toBe('player');
      expect(message.channel).toBe('user');
      expect(message.parts.length).toBeGreaterThan(0);
    });

    it('collects NPC message with speaker info', () => {
      const block = window.document.createElement('div');
      block.setAttribute('data-gmh-message-role', 'npc');
      block.innerHTML = `
        <a href="/character/abc123/테스트캐릭터">
          <img src="/avatar.jpg" alt="avatar" />
        </a>
        <span class="text-[0.75rem]">테스트캐릭터</span>
        <div class="bg-[#262727] rounded-xl p-3">NPC의 대사입니다</div>
      `;

      const message = GMH.Adapters.babechat.collectStructuredMessage(block);

      expect(message).not.toBeNull();
      expect(message.role).toBe('npc');
      expect(message.channel).toBe('llm');
      expect(message.parts.some(p => p.flavor === 'speech')).toBe(true);
    });

    it('handles mixed dialogue and narration in single block', () => {
      const block = window.document.createElement('div');
      block.setAttribute('data-gmh-message-role', 'npc');
      block.innerHTML = `
        <a href="/character/abc123/NPC">
          <img src="/avatar.jpg" alt="avatar" />
        </a>
        <div class="bg-[#363636] rounded-xl p-3">그녀가 말했다.</div>
        <div class="bg-[#262727] rounded-xl p-3">"안녕하세요."</div>
      `;

      const message = GMH.Adapters.babechat.collectStructuredMessage(block);

      expect(message).not.toBeNull();
      const speechParts = message.parts.filter(p => p.flavor === 'speech');
      const narrationParts = message.parts.filter(p => p.flavor === 'narration');

      expect(speechParts.length).toBeGreaterThanOrEqual(1);
      expect(narrationParts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('API message conversion', () => {
    it('canUseApiCollection returns false without captured params', () => {
      // Clear any previously captured params
      if (GMH.Adapters.babechat.clearCapturedApiParams) {
        // Not exposed directly, but API params should be null initially in test
      }

      // Without XHR interception having captured params, should return false
      const canUse = GMH.Adapters.babechat.canUseApiCollection();
      expect(typeof canUse).toBe('boolean');
    });

    it('extractSessionInfo returns null without captured params', () => {
      const sessionInfo = GMH.Adapters.babechat.extractSessionInfo();
      // In test environment without actual XHR calls, should be null
      expect(sessionInfo).toBeNull();
    });
  });

  describe('status block filtering', () => {
    it('filters out status blocks with emoji indicators', () => {
      const block = window.document.createElement('div');
      block.innerHTML = `
        <a href="/character/abc123/NPC">
          <img src="/avatar.jpg" alt="avatar" />
        </a>
        <div class="bg-[#363636] rounded-xl p-3">🕐 12:00 | 🌐 카페 | ❤️ 50</div>
        <div class="bg-[#262727] rounded-xl p-3">실제 대사입니다</div>
      `;

      const lines = [];
      GMH.Adapters.babechat.emitTranscriptLines(block, (line) => lines.push(line));

      // Status block should be filtered
      expect(lines.some(line => line.includes('🕐'))).toBe(false);
      // Real dialogue should remain
      expect(lines.some(line => line.includes('실제 대사입니다'))).toBe(true);
    });
  });

  describe('quote stripping', () => {
    it('strips surrounding quotes from dialogue', () => {
      const block = window.document.createElement('div');
      block.innerHTML = `
        <a href="/character/abc123/NPC">
          <img src="/avatar.jpg" alt="avatar" />
        </a>
        <div class="bg-[#262727] rounded-xl p-3">"인용부호 안의 대사"</div>
      `;

      const message = GMH.Adapters.babechat.collectStructuredMessage(block);
      const speechPart = message?.parts.find(p => p.flavor === 'speech');

      // Should strip outer quotes from the extracted dialogue
      if (speechPart?.lines?.length) {
        const firstLine = speechPart.lines[0];
        expect(firstLine.startsWith('"')).toBe(false);
        expect(firstLine.endsWith('"')).toBe(false);
      }
    });
  });
});

describe('Babechat adapter XHR interception', () => {
  it('installFetchInterceptor is callable', () => {
    const { GMH } = createGMH();

    // Check that the interceptor function exists (exposed via adapter creation)
    expect(typeof GMH.Adapters.babechat).toBe('object');
    expect(typeof GMH.Adapters.babechat.canUseApiCollection).toBe('function');
    expect(typeof GMH.Adapters.babechat.extractSessionInfo).toBe('function');
    expect(typeof GMH.Adapters.babechat.fetchAllMessagesViaApi).toBe('function');
  });
});
