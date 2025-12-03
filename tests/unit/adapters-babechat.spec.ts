import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const initialGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  Document: globalThis.Document,
  Node: globalThis.Node,
  Element: globalThis.Element,
  HTMLElement: globalThis.HTMLElement,
  fetch: globalThis.fetch,
  XMLHttpRequest: globalThis.XMLHttpRequest,
};

let originalXhrOpen: any;
let originalXhrSetRequestHeader: any;
let currentDom: JSDOM | null = null;

const setupDom = (): JSDOM => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://babechat.ai/chat/room',
    pretendToBeVisual: true,
  });
  currentDom = dom;
  originalXhrOpen = dom.window.XMLHttpRequest.prototype.open;
  originalXhrSetRequestHeader = dom.window.XMLHttpRequest.prototype.setRequestHeader;
  // @ts-expect-error assign jsdom globals for adapter helpers
  globalThis.window = dom.window;
  // @ts-expect-error assign jsdom globals for adapter helpers
  globalThis.document = dom.window.document;
  // @ts-expect-error Document constructor passthrough
  globalThis.Document = dom.window.Document;
  // @ts-expect-error jsdom Node/Element passthrough
  globalThis.Node = dom.window.Node;
  // @ts-expect-error jsdom Node/Element passthrough
  globalThis.Element = dom.window.Element;
  // @ts-expect-error HTMLElement passthrough
  globalThis.HTMLElement = dom.window.HTMLElement;
  // @ts-expect-error XMLHttpRequest stub from jsdom
  globalThis.XMLHttpRequest = dom.window.XMLHttpRequest;
  return dom;
};

const buildChatBlocks = () => {
  const chatContainer = document.createElement('div');
  const form = document.createElement('form');
  const overflow = document.createElement('div');
  overflow.className = 'overflow-hidden';
  const inner = document.createElement('div');
  inner.appendChild(chatContainer);
  overflow.appendChild(inner);
  form.appendChild(overflow);
  document.body.appendChild(form);

  const systemBlock = document.createElement('div');
  systemBlock.className = 'px-5';
  const sysWrapper = document.createElement('div');
  const disclaimer = document.createElement('div');
  disclaimer.className = 'mx-auto';
  disclaimer.textContent = 'AI 기술로 생성된 메시지';
  const opening = document.createElement('div');
  opening.className = 'justify-start';
  const sysDialogue = document.createElement('div');
  sysDialogue.className = '262727';
  sysDialogue.textContent = 'NPC | 오프닝';
  const sysNarration = document.createElement('div');
  sysNarration.className = '363636';
  sysNarration.textContent = '무대 설명';
  const sysImg = document.createElement('img');
  sysImg.setAttribute('src', 'https://example.com/system.png');
  sysImg.setAttribute('width', '120');
  sysImg.setAttribute('height', '120');
  opening.append(sysDialogue, sysNarration, sysImg);
  sysWrapper.append(disclaimer, opening);
  systemBlock.appendChild(sysWrapper);
  chatContainer.appendChild(systemBlock);

  const playerBlock = document.createElement('div');
  playerBlock.className = 'turn flex flex-col';
  playerBlock.setAttribute('data-gmh-message-role', 'player');
  playerBlock.setAttribute('data-gmh-message-ordinal', '2');
  const playerWrap = document.createElement('div');
  playerWrap.className = 'justify-end';
  const playerBubble = document.createElement('div');
  playerBubble.className = 'B56576';
  playerBubble.textContent = '안녕 플레이어';
  const playerImg = document.createElement('img');
  playerImg.setAttribute('src', 'https://example.com/player.png');
  playerImg.setAttribute('width', '120');
  playerImg.setAttribute('height', '120');
  playerWrap.appendChild(playerBubble);
  playerBlock.append(playerWrap, playerImg);
  chatContainer.appendChild(playerBlock);

  const npcBlock = document.createElement('div');
  npcBlock.className = 'turn flex flex-col';
  const avatar = document.createElement('a');
  avatar.setAttribute('href', '/character/abc/NPC이름');
  const npcDialogue = document.createElement('div');
  npcDialogue.className = '262727';
  npcDialogue.textContent = 'NPC이름 | 대사';
  const npcNarration = document.createElement('div');
  npcNarration.className = '363636';
  npcNarration.textContent = '상황 설명';
  const npcImg = document.createElement('img');
  npcImg.setAttribute('src', 'https://example.com/npc.png');
  npcImg.setAttribute('width', '100');
  npcImg.setAttribute('height', '100');
  npcBlock.append(avatar, npcDialogue, npcNarration, npcImg);
  chatContainer.appendChild(npcBlock);

  return { systemBlock, playerBlock, npcBlock };
};

describe('adapters/babechat', () => {
  beforeEach(() => {
    vi.resetModules();
    setupDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (globalThis.XMLHttpRequest && originalXhrOpen) {
      globalThis.XMLHttpRequest.prototype.open = originalXhrOpen;
    }
    if (globalThis.XMLHttpRequest && originalXhrSetRequestHeader) {
      globalThis.XMLHttpRequest.prototype.setRequestHeader = originalXhrSetRequestHeader;
    }
    if (currentDom?.window) {
      currentDom.window.close();
    }
    currentDom = null;
    const resetGlobal = (key: keyof typeof initialGlobals) => {
      const value = initialGlobals[key];
      if (value === undefined) {
        // @ts-expect-error clear global
        delete (globalThis as any)[key];
        return;
      }
      // @ts-expect-error restore global
      (globalThis as any)[key] = value;
    };
    (Object.keys(initialGlobals) as Array<keyof typeof initialGlobals>).forEach(resetGlobal);
  });

  it('collects blocks and emits structured messages for system, player, and NPC turns', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ count: 0, messages: [] }),
    }));
    // @ts-expect-error jsdom window
    window.fetch = fetchMock;
    // @ts-expect-error bind global fetch for adapter internals
    globalThis.fetch = fetchMock;

    const { default: createBabechatAdapter } = await import('../../src/adapters/babechat');

    const adapter = createBabechatAdapter({
      registry: {
        get: () => ({ selectors: { messageRoot: ['.turn'], panelAnchor: ['#panel'] }, metadata: {} }),
      } as any,
      playerMark: '[P] ',
      getPlayerNames: () => ['용자'],
    });

    const { systemBlock, playerBlock, npcBlock } = buildChatBlocks();

    const blocks = adapter.listMessageBlocks(document);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toBe(systemBlock);
    expect(adapter.detectRole(systemBlock)).toBe('system');
    expect(adapter.detectRole(playerBlock)).toBe('player');
    expect(adapter.detectRole(npcBlock)).toBe('npc');

    const npcMessage = adapter.collectStructuredMessage(npcBlock);
    expect(npcMessage?.role).toBe('npc');
    expect(npcMessage?.speaker).toBe('NPC이름');
    expect(npcMessage?.parts.some((part) => part.type === 'image')).toBe(true);

    const systemMessage = adapter.collectStructuredMessage(systemBlock);
    expect(systemMessage?.parts.some((part) => part.role === 'system')).toBe(true);
    expect(systemMessage?.parts.some((part) => part.role === 'npc')).toBe(true);

    const playerMessage = adapter.collectStructuredMessage(playerBlock);
    expect(playerMessage?.speaker).toBe('용자');
    expect(playerMessage?.parts[0]?.legacyFormat).toBe('player');
  });

  it('captures API metadata and fetches full history via API with cooldown', async () => {
    const dom = setupDom();

    const fetchPayloads = [
      {
        count: 2,
        messages: [
          { id: 10, content: 'Hello', createdAt: '', role: 'user' },
          { id: 11, content: 'Hi there', createdAt: '', role: 'assistant' },
        ],
      },
    ];

    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => fetchPayloads.shift() || { count: 0, messages: [] },
      init,
    }));

    // @ts-expect-error jsdom window
    dom.window.fetch = fetchMock;
    // @ts-expect-error bind global fetch used by adapter
    globalThis.fetch = fetchMock;

    const {
      default: createBabechatAdapter,
      installFetchInterceptor,
      getCapturedApiParams,
      getCapturedAuthHeaders,
      getCapturedCharacterData,
      clearCapturedApiParams,
    } = await import('../../src/adapters/babechat');

    installFetchInterceptor();

    const adapter = createBabechatAdapter({
      registry: { get: () => ({ selectors: {}, metadata: {} }) } as any,
      getPlayerNames: () => ['용자'],
    });

    const xhr = new XMLHttpRequest();
    xhr.open(
      'GET',
      'https://api.babechatapi.com/ko/api/messages/123e4567-e89b-12d3-a456-426614174000/false/42',
    );
    xhr.setRequestHeader('Authorization', 'Bearer token');

    expect(getCapturedApiParams()).toEqual({
      characterId: '123e4567-e89b-12d3-a456-426614174000',
      isUGC: 'false',
      roomId: '42',
    });
    expect(getCapturedAuthHeaders()).toEqual(
      expect.objectContaining({ Authorization: 'Bearer token' }),
    );

    const charXhr = new XMLHttpRequest();
    charXhr.open('GET', 'https://api.babechatapi.com/ko/api/characters/character-1');
    Object.defineProperty(charXhr, 'responseText', {
      value: JSON.stringify({
        name: 'NPC',
        initialAction: '무대 설명',
        initialMessage: '처음 인사',
      }),
      configurable: true,
    });
    Object.defineProperty(charXhr, 'readyState', { value: 4, configurable: true });
    Object.defineProperty(charXhr, 'status', { value: 200, configurable: true });
    if (typeof charXhr.onreadystatechange === 'function') {
      charXhr.onreadystatechange(new dom.window.Event('readystatechange'));
    }

    expect(getCapturedCharacterData()).toEqual(
      expect.objectContaining({
        name: 'NPC',
        initialAction: '무대 설명',
        initialMessage: '처음 인사',
      }),
    );

    const messages = await adapter.fetchAllMessagesViaApi();
    expect(messages[0].id).toBe('initial-action');
    expect(messages[1].id).toBe('initial-message');
    expect(messages[2].speaker).toBe('용자');
    expect(adapter.canUseApiCollection()).toBe(true);
    expect(adapter.getApiCooldownRemaining()).toBeGreaterThan(0);
    await expect(adapter.fetchAllMessagesViaApi()).rejects.toThrow('쿨다운');
    clearCapturedApiParams();
  });
});
