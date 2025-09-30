import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
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

let GMH;
let testWindow;

beforeAll(() => {
  const env = createGMH();
  GMH = env.GMH;
  testWindow = env.window;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GMH.Core.projectStructuredMessages', () => {
  it('filters structured messages using message indices when available', () => {
    const snapshot = {
      messages: [
        { index: 0, ordinal: 3, role: 'npc', speaker: '조력자', parts: [], legacyLines: [] },
        { index: 1, ordinal: 2, role: 'player', speaker: '플레이어', parts: [], legacyLines: [] },
        { index: 2, ordinal: 1, role: 'narration', speaker: '내레이션', parts: [], legacyLines: [] },
      ],
    };
    const rangeInfo = {
      active: true,
      start: 1,
      end: 2,
      messageStartIndex: 1,
      messageEndIndex: 2,
    };
    const { messages, sourceTotal } = GMH.Core.projectStructuredMessages(snapshot, rangeInfo);
    expect(sourceTotal).toBe(3);
    expect(messages).toHaveLength(2);
    expect(messages.map((msg) => msg.index)).toEqual([1, 2]);
  });

  it('falls back to ordinal filtering when indices are missing', () => {
    const snapshot = {
      messages: [
        { index: null, ordinal: 4, role: 'npc', speaker: '조력자', parts: [], legacyLines: [] },
        { index: null, ordinal: 3, role: 'player', speaker: '플레이어', parts: [], legacyLines: [] },
        { index: null, ordinal: 2, role: 'npc', speaker: '상인', parts: [], legacyLines: [] },
        { index: null, ordinal: 1, role: 'narration', speaker: '내레이션', parts: [], legacyLines: [] },
      ],
    };
    const rangeInfo = { active: true, start: 1, end: 2 };
    const { messages } = GMH.Core.projectStructuredMessages(snapshot, rangeInfo);
    expect(messages).toHaveLength(2);
    expect(messages.map((msg) => msg.ordinal)).toEqual([2, 1]);
  });
});

describe('GMH.Export structured writers', () => {
  const baseSession = {
    source: 'genit-memory-helper',
    meta: { title: '테스트 세션' },
    warnings: [],
    turns: [
      { speaker: '플레이어', role: 'player', text: '안녕', channel: 'user' },
      { speaker: '조력자', role: 'npc', text: '어서 와', channel: 'llm' },
    ],
  };

  const selectionInfo = {
    active: true,
    start: 1,
    end: 2,
    count: 2,
    total: 2,
    startIndex: 0,
    endIndex: 1,
  };

  const structuredMessages = [
    {
      index: 0,
      ordinal: 2,
      role: 'player',
      speaker: '플레이어',
      parts: [
        {
          type: 'paragraph',
          flavor: 'speech',
          role: 'player',
          speaker: '플레이어',
          lines: ['안녕'],
        },
      ],
    },
    {
      index: 1,
      ordinal: 1,
      role: 'npc',
      speaker: '조력자',
      parts: [
        {
          type: 'paragraph',
          flavor: 'speech',
          role: 'npc',
          speaker: '조력자',
          lines: ['어서 와'],
        },
      ],
    },
  ];

  it('serializes structured selection to JSON', () => {
    const json = GMH.Export.toStructuredJSON({
      session: baseSession,
      structuredSelection: { messages: structuredMessages, sourceTotal: 2, range: selectionInfo },
      structuredSnapshot: { messages: structuredMessages, errors: [] },
      profile: 'safe',
      playerNames: ['플레이어'],
      normalizedRaw: '안녕\n어서 와',
      rangeInfo: selectionInfo,
    });
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe('2.0-structured');
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.classic_fallback.turns).toHaveLength(2);
    expect(parsed.meta.structured.exported_messages).toBe(2);
    expect(parsed.meta.structured.selection).toEqual(selectionInfo);
    expect(parsed.meta).not.toHaveProperty('turn_range');
    expect(parsed.meta.structured).not.toHaveProperty('range');
    parsed.messages.forEach((message) => {
      expect(message).not.toHaveProperty('legacyLines');
      message.parts.forEach((part) => {
        if (part.type === 'info') return;
        expect(part).not.toHaveProperty('legacyLines');
      });
    });
  });

  it('renders structured markdown with speech flavors', () => {
    const markdown = GMH.Export.toStructuredMarkdown({
      messages: structuredMessages,
      session: baseSession,
      profile: 'safe',
      playerNames: ['플레이어'],
    });
    expect(markdown).toContain('## [#2] 플레이어 (player)');
    expect(markdown).toContain('## [#1] 조력자 (npc)');
    expect(markdown).toContain('플레이어');
    expect(markdown).toContain('조력자: 어서 와');
  });

  it('renders code blocks using literal backticks', () => {
    const markdown = GMH.Export.toStructuredMarkdown({
      messages: [
        {
          index: 0,
          ordinal: 1,
          role: 'npc',
          speaker: '조력자',
          parts: [
            {
              type: 'code',
              flavor: 'speech',
              role: 'npc',
              speaker: '조력자',
              language: 'javascript',
              text: "console.log('test');",
            },
          ],
        },
      ],
      session: baseSession,
      profile: 'safe',
      playerNames: ['플레이어'],
    });

    expect(markdown).toContain('```javascript');
    expect(markdown).not.toContain('\\u0060');
  });

  it('renders structured txt with lightweight markers', () => {
    const txt = GMH.Export.toStructuredTXT({
      messages: structuredMessages,
      session: baseSession,
      profile: 'safe',
      playerNames: ['플레이어'],
    });
    expect(txt).toContain('=== Conversation Export ===');
    expect(txt).toContain('[#2][플레이어][player]');
    expect(txt).toContain('- 플레이어: 안녕');
  });

  it('includes classic fallback metadata when no structured messages are available', () => {
    const json = GMH.Export.toStructuredJSON({
      session: baseSession,
      structuredSelection: { messages: [], sourceTotal: 0, range: { active: false } },
      structuredSnapshot: null,
      profile: 'safe',
      playerNames: ['플레이어'],
      rangeInfo: { active: false },
      normalizedRaw: '안녕\n어서 와',
    });
    const parsed = JSON.parse(json);
    expect(parsed.messages).toHaveLength(0);
    expect(parsed.meta.structured.exported_messages).toBe(0);
    expect(parsed.classic_fallback.turns).toEqual(baseSession.turns);
    expect(parsed.classic_fallback.raw_excerpt).toBe('안녕\n어서 와');
  });

  it('omits redundant legacyLines while keeping INFO fallbacks', () => {
    const infoMessage = {
      index: 2,
      ordinal: 0,
      role: 'system',
      speaker: 'INFO',
      parts: [
        {
          type: 'info',
          flavor: 'meta',
          role: 'system',
          speaker: 'INFO',
          lines: ['세션 메모'],
          legacyLines: ['INFO', '세션 메모'],
        },
      ],
    };
    const selectionWithInfo = {
      ...selectionInfo,
      end: 3,
      count: 3,
      total: 3,
      endIndex: 2,
    };
    const messages = [...structuredMessages, infoMessage];
    const json = GMH.Export.toStructuredJSON({
      session: baseSession,
      structuredSelection: { messages, sourceTotal: 3, range: selectionWithInfo },
      structuredSnapshot: { messages, errors: [] },
      profile: 'safe',
      playerNames: ['플레이어'],
      rangeInfo: selectionWithInfo,
      normalizedRaw: '안녕\n어서 와',
    });
    const parsed = JSON.parse(json);
    const info = parsed.messages.find((msg) => msg.parts.some((part) => part.type === 'info'));
    expect(info).toBeDefined();

    parsed.messages
      .filter((msg) => msg !== info)
      .forEach((msg) => {
        expect(msg).not.toHaveProperty('legacyLines');
        msg.parts.forEach((part) => expect(part).not.toHaveProperty('legacyLines'));
      });
    const infoPart = info?.parts.find((part) => part.type === 'info');
    expect(infoPart).toBeDefined();
    expect(infoPart.legacyLines).toEqual(['INFO', '세션 메모']);
  });

  it('falls back to classic JSON when structured writer throws', () => {
    const circularMessages = structuredMessages.map((message) => ({ ...message }));
    circularMessages[0].self = circularMessages[0];
    const bundleOptions = {
      structuredSelection: { messages: circularMessages, sourceTotal: 2, range: selectionInfo },
      structuredSnapshot: { messages: circularMessages, errors: [] },
      profile: 'safe',
      playerNames: ['플레이어'],
      rangeInfo: selectionInfo,
    };
    let structuredFallback = false;
    let targetFormat = 'structured-json';
    let bundle;
    let caughtError;

    try {
      bundle = GMH.Export.buildExportBundle(
        baseSession,
        '안녕\n어서 와',
        targetFormat,
        'stamp',
        bundleOptions,
      );
    } catch (error) {
      structuredFallback = true;
      caughtError = error;
      targetFormat = 'json';
      bundle = GMH.Export.buildExportBundle(
        baseSession,
        '안녕\n어서 와',
        targetFormat,
        'stamp',
        bundleOptions,
      );
    }

    expect(structuredFallback).toBe(true);
    expect(bundle.filename.endsWith('.json')).toBe(true);
    expect(caughtError?.message || '').toContain('circular');
    const fallbackPayload = JSON.parse(bundle.content);
    expect(fallbackPayload.version).toBe('1.0');
    expect(fallbackPayload.turns).toEqual(baseSession.turns);
  });

  it('treats parts without type as paragraph content', () => {
    const messages = [
      {
        index: 0,
        ordinal: 1,
        role: 'npc',
        speaker: '조력자',
        parts: [
          {
            lines: ['대사 내용입니다'],
            speaker: '조력자',
            flavor: 'speech',
          },
        ],
        legacyLines: [],
      },
    ];

    const markdown = GMH.Export.toStructuredMarkdown({
      messages,
      session: baseSession,
      profile: 'safe',
      playerNames: ['플레이어'],
    });
    const txt = GMH.Export.toStructuredTXT({
      messages,
      session: baseSession,
      profile: 'safe',
      playerNames: ['플레이어'],
    });

    expect(markdown).toContain('대사 내용입니다');
    expect(txt).toContain('- 조력자: 대사 내용입니다');
  });

  it('skips info descendants when collecting structured parts', () => {
    const block = testWindow.document.createElement('div');
    block.setAttribute('data-gmh-message-role', 'npc');
    block.setAttribute('data-gmh-message-index', '0');
    block.setAttribute('data-gmh-message-ordinal', '1');

    const infoWrapper = testWindow.document.createElement('div');
    infoWrapper.className = 'markdown-content text-muted-foreground';
    const pre = testWindow.document.createElement('pre');
    const code = testWindow.document.createElement('code');
    code.className = 'language-INFO';
    code.textContent = 'INFO\n라벨\n이건 INFO 카드 안에서 반복되는 텍스트';
    pre.appendChild(code);
    infoWrapper.appendChild(pre);
    const duplicated = testWindow.document.createElement('div');
    duplicated.className = 'markdown-content text-muted-foreground';
    duplicated.textContent = '이건 INFO 카드 안에서 반복되는 텍스트';
    infoWrapper.appendChild(duplicated);
    block.appendChild(infoWrapper);

    const adapter = GMH.Core.getAdapter();
    const message = adapter.collectStructuredMessage(block);
    expect(message.parts.some((part) => part.type === 'info')).toBe(true);
    const otherLines = message.parts
      .filter((part) => part.type !== 'info')
      .flatMap((part) => part.lines || []);
    expect(otherLines).not.toContain('이건 INFO 카드 안에서 반복되는 텍스트');
  });
});
