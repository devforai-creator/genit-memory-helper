import { adapterRegistry, getAdapterConfig } from './registry';
import { clone } from '../core/utils';
import { collapseSpaces } from '../utils/text';
import { isScrollable } from '../utils/dom';

import type {
  AdapterConfig,
  AdapterRegistry,
  AdapterSelectors,
  AdapterMatchLocation,
  StructuredSnapshotMessage,
  StructuredSnapshotMessagePart,
  StructuredCollector,
  StructuredCollectorMeta,
  ErrorHandler,
} from '../types';

type SelectorList = string[] | null | undefined;

type BabechatRole = 'player' | 'npc' | 'system' | 'unknown';

interface CollectorEntry {
  part: StructuredSnapshotMessagePart;
  orderPath: number[];
  fallback: number;
}

interface StructuredContext {
  flavor?: string;
  role?: string;
  speaker?: string;
  legacyFormat?: string;
  [key: string]: unknown;
}

interface StructuredPartOptions {
  type?: string;
  flavor?: string;
  role?: string;
  speaker?: string;
  lines?: string[];
  legacyLines?: string[];
  legacyFormat?: string;
}

const DEFAULT_PLAYER_MARK = '⟦PLAYER⟧ ';

export interface BabechatAdapterOptions {
  registry?: AdapterRegistry | null;
  playerMark?: string;
  getPlayerNames?: (() => string[] | null | undefined) | null;
  errorHandler?:
    | ErrorHandler
    | {
        handle?: (error: unknown, context?: string, level?: string) => string | void;
        LEVELS?: Record<string, string>;
      }
    | null;
}

/** API message format from babechat API */
export interface BabechatApiMessage {
  id: number;
  createdAt: string;
  content: string;
  emotion?: string;
  role: 'user' | 'assistant';
  location?: string;
  date?: string;
}

/** API response format */
export interface BabechatApiResponse {
  count: number;
  messages: BabechatApiMessage[];
}

/** Chat session info extracted from URL/page */
export interface BabechatSessionInfo {
  characterId: string;
  isUGC: string;
  roomId: string;
}

/** Captured API parameters from fetch intercept */
let capturedApiParams: BabechatSessionInfo | null = null;
let capturedAuthHeaders: Record<string, string> | null = null;
let capturedCharacterData: {
  name: string;
  initialAction: string | null;
  initialMessage: string | null;
} | null = null;
let fetchInterceptInstalled = false;

/**
 * Install fetch and XHR interceptor to capture babechat API parameters
 * Called automatically on module load if on babechat.ai
 */
export function installFetchInterceptor(): void {
  if (fetchInterceptInstalled || typeof window === 'undefined') return;

  // Helper to extract params from URL
  const extractParamsFromUrl = (url: string): void => {
    if (url.includes('api.babechatapi.com') && url.includes('/api/messages/')) {
      // URL pattern: /api/messages/{characterId}/{isUGC}/{roomId}
      // roomId must be numeric (not the literal word "room")
      const match = url.match(/\/api\/messages\/([a-f0-9-]{36})\/(true|false)\/(\d+)/i);
      if (match) {
        capturedApiParams = {
          characterId: match[1],
          isUGC: match[2],
          roomId: match[3],
        };
        if (typeof console !== 'undefined') {
          console.log('[GMH] Captured babechat API params:', capturedApiParams);
        }
      }
    }
  };

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    extractParamsFromUrl(url);
    return originalFetch.apply(this, [input, init] as [RequestInfo | URL, RequestInit | undefined]);
  };

  // Intercept XMLHttpRequest (babechat uses XHR, not fetch!)
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  // Track headers per XHR instance
  const xhrHeadersMap = new WeakMap<XMLHttpRequest, Record<string, string>>();
  const xhrUrlMap = new WeakMap<XMLHttpRequest, string>();

  XMLHttpRequest.prototype.open = function(
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ): void {
    const urlStr = typeof url === 'string' ? url : url.href;
    xhrUrlMap.set(this, urlStr);
    xhrHeadersMap.set(this, {});
    extractParamsFromUrl(urlStr);

    // Listen for character API response to capture initialAction/initialMessage
    if (urlStr.includes('api.babechatapi.com') && urlStr.includes('/api/characters/') && !urlStr.includes('/messages/')) {
      const xhr = this;
      const originalOnReadyStateChange = xhr.onreadystatechange;
      xhr.onreadystatechange = function(ev) {
        if (xhr.readyState === 4 && xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data && (data.initialAction || data.initialMessage)) {
              capturedCharacterData = {
                name: data.name || 'NPC',
                initialAction: data.initialAction || null,
                initialMessage: data.initialMessage || null,
              };
              if (typeof console !== 'undefined') {
                console.log('[GMH] Captured character initial data:', {
                  name: capturedCharacterData.name,
                  hasAction: !!capturedCharacterData.initialAction,
                  hasMessage: !!capturedCharacterData.initialMessage,
                });
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
        if (originalOnReadyStateChange) {
          return originalOnReadyStateChange.call(this, ev);
        }
      };
    }

    return originalXHROpen.apply(this, [method, url, async ?? true, username, password] as [string, string | URL, boolean, string | null | undefined, string | null | undefined]);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(name: string, value: string): void {
    const headers = xhrHeadersMap.get(this) || {};
    headers[name] = value;
    xhrHeadersMap.set(this, headers);

    // Capture auth headers from messages API calls
    const url = xhrUrlMap.get(this) || '';
    if (url.includes('api.babechatapi.com') && url.includes('/api/messages/')) {
      if (name.toLowerCase() === 'authorization' || name.toLowerCase() === 'x-auth-token') {
        if (!capturedAuthHeaders) capturedAuthHeaders = {};
        capturedAuthHeaders[name] = value;
        if (typeof console !== 'undefined') {
          console.log('[GMH] Captured auth header:', name);
        }
      }
    }

    return originalXHRSetRequestHeader.apply(this, [name, value]);
  };

  fetchInterceptInstalled = true;
  if (typeof console !== 'undefined') {
    console.log('[GMH] Fetch/XHR interceptor installed for babechat');
  }
}

// Auto-install interceptor immediately if on babechat.ai
// This runs at module load time, before any adapter is created
if (typeof window !== 'undefined' && /babechat\.ai/i.test(window.location?.hostname || '')) {
  installFetchInterceptor();
}

/**
 * Get captured API parameters
 */
export function getCapturedApiParams(): BabechatSessionInfo | null {
  return capturedApiParams;
}

/**
 * Get captured auth headers
 */
export function getCapturedAuthHeaders(): Record<string, string> | null {
  return capturedAuthHeaders;
}

/**
 * Get captured character data (initialAction/initialMessage)
 */
export function getCapturedCharacterData(): {
  name: string;
  initialAction: string | null;
  initialMessage: string | null;
} | null {
  return capturedCharacterData;
}

/**
 * Clear captured API parameters
 */
export function clearCapturedApiParams(): void {
  capturedApiParams = null;
  capturedAuthHeaders = null;
  capturedCharacterData = null;
}

export interface BabechatAdapter {
  id: string;
  label: string;
  match(loc: Location | AdapterMatchLocation, doc?: Document): boolean;
  findContainer(doc?: Document): Element | null;
  listMessageBlocks(root?: Document | Element | null): Element[];
  emitTranscriptLines(block: Element, pushLine: (line: string) => void, collector?: StructuredCollector | null): void;
  collectStructuredMessage(block: Element): StructuredSnapshotMessage | null;
  detectRole(block: Element | null | undefined): string;
  guessPlayerNames(root?: Document): string[];
  getPanelAnchor(doc?: Document): Element | null;
  dumpSelectors(): AdapterSelectors;
  resetInfoRegistry(): void;
  setPlayerNameAccessor(accessor: () => string[] | null | undefined): void;
  /** Extract session info from current URL for API calls */
  extractSessionInfo(): BabechatSessionInfo | null;
  /** Fetch all messages via API (bypasses virtual scroll) */
  fetchAllMessagesViaApi(): Promise<StructuredSnapshotMessage[]>;
  /** Check if API-based collection is available */
  canUseApiCollection(): boolean;
}

export const createBabechatAdapter = ({
  registry = adapterRegistry,
  playerMark = DEFAULT_PLAYER_MARK,
  getPlayerNames = () => [],
  errorHandler,
}: BabechatAdapterOptions = {}): BabechatAdapter => {
  // Install fetch interceptor to capture API parameters
  installFetchInterceptor();

  let playerNameAccessor: () => unknown = typeof getPlayerNames === 'function' ? getPlayerNames : () => [];

  const warnWithHandler = (err: unknown, context: string, fallbackMessage: string): void => {
    if (errorHandler?.handle) {
      const level = errorHandler.LEVELS?.WARN || 'warn';
      errorHandler.handle(err, context, level);
    } else if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(fallbackMessage, err);
    }
  };

  const resolvePlayerNames = (): string[] => {
    const names = playerNameAccessor();
    if (Array.isArray(names)) {
      return names.filter((name): name is string => typeof name === 'string');
    }
    return [];
  };

  const primaryPlayerName = (): string => resolvePlayerNames()[0] || '플레이어';

  const registryGet: (name: string) => AdapterConfig =
    registry && typeof registry.get === 'function'
      ? (name: string) => registry.get(name)
      : getAdapterConfig;
  const adapterConfig = registryGet('babechat');
  const selectors: AdapterSelectors = adapterConfig.selectors || {};

  const firstMatch = (selList: SelectorList, root: Document | Element = document): Element | null => {
    if (!selList?.length) return null;
    for (const sel of selList) {
      if (!sel) continue;
      try {
        const node = root.querySelector(sel);
        if (node) return node;
      } catch (e) {
        continue;
      }
    }
    return null;
  };

  const collectAll = (selList: SelectorList, root: Document | Element = document): Element[] => {
    const out: Element[] = [];
    const seen = new Set<Element>();
    if (!selList?.length) return out;
    for (const sel of selList) {
      if (!sel) continue;
      let nodes: NodeListOf<Element> | undefined;
      try {
        nodes = root.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      nodes.forEach((node) => {
        if (!node || seen.has(node)) return;
        seen.add(node);
        out.push(node);
      });
    }
    return out;
  };

  const textFromNode = (node: Element | Node | null | undefined): string => {
    if (!node) return '';
    if (node instanceof HTMLElement) {
      return (node.innerText ?? node.textContent ?? '').trim();
    }
    return (node.textContent ?? '').trim();
  };

  const textSegmentsFromNode = (node: Element | Node | null | undefined): string[] => {
    const text = textFromNode(node);
    if (!text) return [];
    return text
      .split(/\r?\n+/)
      .map((seg) => seg.trim())
      .filter(Boolean);
  };

  const findScrollableAncestor = (node: Element | null | undefined): Element | null => {
    let current = node instanceof Element ? node : null;
    for (let depth = 0; depth < 10 && current; depth += 1) {
      if (isScrollable(current)) return current;
      current = current.parentElement;
    }
    return null;
  };

  const getChatContainer = (doc: Document = document): Element | null => {
    // Try form > div.overflow-hidden > div structure
    const formContainer = doc.querySelector('form > div.overflow-hidden > div');
    if (formContainer) return formContainer;

    const overflowContainer = doc.querySelector('form > div.overflow-hidden');
    if (overflowContainer) return overflowContainer;

    // Fallback to form
    const form = doc.querySelector('form');
    if (form) {
      const scrollable = findScrollableAncestor(form);
      if (scrollable) return scrollable;
      return form;
    }

    return null;
  };

  const getMessageBlocks = (root: Document | Element | null | undefined): Element[] => {
    const targetRoot = root || document;

    // Find the container first
    const container = targetRoot instanceof Document
      ? getChatContainer(targetRoot)
      : targetRoot;

    if (!container) return [];

    const blocks: Element[] = [];
    const seen = new Set<Element>();

    // 1. Find system message area (div.px-5 without pt-4) - usually first
    const systemAreas = container.querySelectorAll('div.px-5:not(.pt-4)');
    systemAreas.forEach((area) => {
      // Verify it's a system area by checking for AI disclaimer or scenario content
      const hasDisclaimer = area.textContent?.includes('AI') || area.textContent?.includes('기술');
      const hasScenario = area.querySelector('[class*="363636"]') !== null;
      if ((hasDisclaimer || hasScenario) && !seen.has(area)) {
        seen.add(area);
        blocks.push(area);
      }
    });

    // 2. Find turn wrappers using selector
    const turns = collectAll(selectors.messageRoot, container);
    turns.forEach((turn) => {
      if (!seen.has(turn)) {
        seen.add(turn);
        blocks.push(turn);
      }
    });

    // 3. Fallback: find any element with user/AI content if no turns found
    if (blocks.length === 0) {
      const userMessages = container.querySelectorAll('.justify-end');
      const aiMessages = container.querySelectorAll('a[href*="/character/"]');

      userMessages.forEach((msg) => {
        const parent = msg.closest('.flex.flex-col') || msg.parentElement;
        if (parent && !seen.has(parent)) {
          seen.add(parent);
          blocks.push(parent);
        }
      });

      aiMessages.forEach((msg) => {
        const parent = msg.closest('.flex.flex-col') || msg.parentElement;
        if (parent && !seen.has(parent)) {
          seen.add(parent);
          blocks.push(parent);
        }
      });
    }

    return blocks;
  };

  const isSystemMessageArea = (block: Element): boolean => {
    // System message area is div.px-5 without pt-4
    return block.classList.contains('px-5') && !block.classList.contains('pt-4');
  };

  const detectRole = (block: Element | null | undefined): BabechatRole => {
    if (!block) return 'unknown';

    // Check for system message area (first child with special structure)
    if (isSystemMessageArea(block)) {
      return 'system';
    }

    // Check for user message (has justify-end child)
    const hasJustifyEnd = block.querySelector('.justify-end') !== null;
    if (hasJustifyEnd) {
      // Make sure it's not a system message disguised
      const hasUserBubble = block.querySelector('[class*="B56576"]') !== null;
      if (hasUserBubble) return 'player';
    }

    // Check for AI message (has avatar link)
    const hasAvatarLink = block.querySelector('a[href*="/character/"]') !== null;
    if (hasAvatarLink) return 'npc';

    // Check for system/narration only message
    const hasNarrationBg = block.querySelector('[class*="363636"]') !== null;
    if (hasNarrationBg && !hasAvatarLink) return 'system';

    return 'unknown';
  };

  const isStatusBlock = (text: string): boolean => {
    // Status blocks contain emoji indicators like 🕐, 🌐, 😶, ❤️, 🎭, 🎒
    return /[🕐🌐😶❤️🎭🎒]/.test(text);
  };

  const extractCharacterName = (block: Element): string => {
    // Try to find character name from the small text element
    const nameNode = block.querySelector('.text-\\[0\\.75rem\\], [class*="text-[0.75rem]"]');
    if (nameNode) {
      const name = nameNode.textContent?.trim();
      if (name && name.length < 50) return name;
    }

    // Fallback: extract from avatar link
    const avatarLink = block.querySelector('a[href*="/character/"]');
    if (avatarLink) {
      const href = avatarLink.getAttribute('href') || '';
      // Try to extract name from URL if possible
      const match = href.match(/\/character\/[^/]+\/([^/]+)/);
      if (match) return decodeURIComponent(match[1]).slice(0, 40);
    }

    return 'NPC';
  };

  const getOrderPath = (node: Node | null, root: Node | null): number[] | null => {
    if (!(node instanceof Node) || !(root instanceof Node)) return null;
    const path: number[] = [];
    let current = node;
    let guard = 0;
    while (current && current !== root && guard < 200) {
      const parent = current.parentNode;
      if (!parent) return null;
      const index = Array.prototype.indexOf.call(parent.childNodes, current);
      path.push(index);
      current = parent;
      guard += 1;
    }
    if (current !== root) return null;
    path.reverse();
    return path;
  };

  const compareOrderPaths = (a: number[], b: number[]): number => {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
      const valA = Number.isFinite(a[i]) ? a[i] : -1;
      const valB = Number.isFinite(b[i]) ? b[i] : -1;
      if (valA !== valB) return valA - valB;
    }
    return 0;
  };

  const createStructuredCollector = (
    defaults: { playerName?: string } = {},
    context: { rootNode?: Node | null } = {},
  ): StructuredCollector => {
    const parts: CollectorEntry[] = [];
    const snapshotDefaults = {
      playerName: defaults.playerName || '플레이어',
    };
    const rootNode = context?.rootNode instanceof Node ? context.rootNode : null;
    let fallbackCounter = 0;
    return {
      push(part, meta: StructuredCollectorMeta = {}) {
        if (!part) return;
        const next: StructuredSnapshotMessagePart = { ...part };
        if (!Array.isArray(next.lines)) next.lines = [];
        if (!next.role && next.flavor === 'speech') next.role = 'unknown';
        if (!next.speaker && next.role === 'player') next.speaker = snapshotDefaults.playerName;
        const orderNode = meta?.node instanceof Node ? meta.node : null;
        const orderPathRaw = orderNode && rootNode ? getOrderPath(orderNode, rootNode) : null;
        const fallbackToken = (fallbackCounter += 1);
        const orderPath = orderPathRaw
          ? orderPathRaw
          : [Number.MAX_SAFE_INTEGER, fallbackToken];
        parts.push({ part: next, orderPath, fallback: fallbackToken });
      },
      list() {
        return parts
          .slice()
          .sort((a, b) => {
            const diff = compareOrderPaths(a.orderPath, b.orderPath);
            if (diff !== 0) return diff;
            return a.fallback - b.fallback;
          })
          .map((entry) => entry.part);
      },
      defaults: snapshotDefaults,
    };
  };

  const buildStructuredPart = (
    node: Element | Node | null,
    context: StructuredContext = {},
    options: StructuredPartOptions = {},
  ): StructuredSnapshotMessagePart => {
    const baseLines = Array.isArray(options.lines) ? options.lines.slice() : [];
    const part: StructuredSnapshotMessagePart & { lines: string[] } = {
      type: options.type || 'paragraph',
      flavor: context.flavor || 'speech',
      role: context.role || null,
      speaker: context.speaker || null,
      lines: baseLines,
      legacyFormat: options.legacyFormat || context.legacyFormat || null,
    };
    if (Array.isArray(options.legacyLines)) {
      part.legacyLines = options.legacyLines.slice();
    }
    if (!part.lines.length) {
      const fallbackLines = textSegmentsFromNode(node);
      part.lines = fallbackLines;
    }
    return part;
  };

  // Collect images from a block and add them to the collector
  const collectImagesFromBlock = (
    block: Element,
    collector: StructuredCollector | null,
    context: { role?: string; speaker?: string } = {},
  ): void => {
    if (!collector) return;

    // Find all img elements in the block
    const images = block.querySelectorAll('img');
    const seenSrcs = new Set<string>();

    images.forEach((img) => {
      // Get source URL - try various attributes
      const src = img.getAttribute('src') ||
                  img.getAttribute('data-src') ||
                  img.getAttribute('data-lazy-src') ||
                  '';

      // Skip empty sources, data URIs (already embedded), and duplicates
      if (!src || src.startsWith('data:') || seenSrcs.has(src)) return;
      seenSrcs.add(src);

      // Skip tiny images (likely icons/avatars)
      const width = img.naturalWidth || parseInt(img.getAttribute('width') || '0', 10);
      const height = img.naturalHeight || parseInt(img.getAttribute('height') || '0', 10);
      if ((width > 0 && width < 50) || (height > 0 && height < 50)) return;

      // Create image part
      const part: StructuredSnapshotMessagePart = {
        type: 'image',
        flavor: 'media',
        role: context.role || null,
        speaker: context.speaker || null,
        src: src,
        alt: img.getAttribute('alt') || '',
        title: img.getAttribute('title') || '',
        lines: [],
      };

      collector.push(part, { node: img });
    });
  };

  const emitPlayerLines = (
    block: Element,
    pushLine: (line: string) => void,
    collector: StructuredCollector | null = null,
  ): void => {
    const role = detectRole(block);
    if (role !== 'player') return;

    // Find all user message bubbles (pink background)
    const userBubbles = block.querySelectorAll('[class*="B56576"]');
    const partLines: string[] = [];
    const seenTexts = new Set<string>();

    userBubbles.forEach((bubble) => {
      const text = textFromNode(bubble);
      if (!text || seenTexts.has(text)) return;
      seenTexts.add(text);
      pushLine(playerMark + text);
      partLines.push(text);
    });

    if (collector && partLines.length) {
      const playerName = collector.defaults?.playerName || '플레이어';
      const part = buildStructuredPart(
        block,
        {
          flavor: 'speech',
          role: 'player',
          speaker: playerName,
          legacyFormat: 'player',
        },
        {
          lines: partLines,
          legacyFormat: 'player',
        },
      );
      collector.push(part, { node: block });
    }

    // Collect images from player message block
    if (collector) {
      const playerName = collector.defaults?.playerName || '플레이어';
      collectImagesFromBlock(block, collector, {
        role: 'player',
        speaker: playerName,
      });
    }
  };

  // Strip surrounding quotes from text
  const stripSurroundingQuotes = (text: string): string => {
    let clean = text.trim();
    // Remove surrounding double quotes
    if (clean.startsWith('"') && clean.endsWith('"') && clean.length > 2) {
      clean = clean.slice(1, -1);
    }
    // Remove surrounding single quotes
    if (clean.startsWith("'") && clean.endsWith("'") && clean.length > 2) {
      clean = clean.slice(1, -1);
    }
    return clean.trim();
  };

  // Strip leading/trailing quote characters from a string
  const stripQuoteChars = (text: string): string => {
    return text.replace(/^["'"'「」『』]+|["'"'「」『』]+$/g, '').trim();
  };

  // Parse speaker prefix pattern: "화자 | 대사" or just "대사"
  const parseSpeakerDialogue = (text: string): { speaker: string | null; dialogue: string } => {
    const clean = stripSurroundingQuotes(text);
    // Match pattern: "화자 | 대사" (speaker before pipe)
    const match = clean.match(/^([^|]+?)\s*\|\s*(.+)$/s);
    if (match) {
      // Strip any quote chars from extracted speaker
      const speaker = stripQuoteChars(match[1].trim());
      let dialogue = match[2].trim();
      // Remove trailing quote if present
      dialogue = stripQuoteChars(dialogue);
      return { speaker: speaker || null, dialogue };
    }
    return { speaker: null, dialogue: clean };
  };

  const emitNpcLines = (
    block: Element,
    pushLine: (line: string) => void,
    collector: StructuredCollector | null = null,
  ): void => {
    const role = detectRole(block);
    if (role !== 'npc') return;

    const characterName = extractCharacterName(block);
    const seenTexts = new Set<string>();
    let primarySpeaker: string | null = null;

    // Find all dialogue and narration elements
    const dialogueSelector = '[class*="262727"]';
    const narrationSelector = '[class*="363636"]';

    // Get all content elements and process in DOM order
    const allElements = block.querySelectorAll(`${dialogueSelector}, ${narrationSelector}`);

    allElements.forEach((element) => {
      const rawText = textFromNode(element);
      if (!rawText || seenTexts.has(rawText) || isStatusBlock(rawText)) return;
      seenTexts.add(rawText);

      const className = element.className || '';
      const isDialogue = className.includes('262727');
      const isNarration = className.includes('363636');

      if (isDialogue) {
        // Parse speaker and dialogue
        const { speaker, dialogue } = parseSpeakerDialogue(rawText);

        if (speaker) {
          // Track the primary speaker for this turn
          if (!primarySpeaker) {
            primarySpeaker = speaker;
          }
          pushLine(`@${speaker}@ "${dialogue}"`);
        } else {
          // No speaker prefix, use character name
          pushLine(`@${characterName}@ "${dialogue}"`);
        }

        // Add dialogue part to collector
        if (collector) {
          const part = buildStructuredPart(
            element,
            {
              flavor: 'speech',
              role: 'npc',
              speaker: speaker || primarySpeaker || characterName,
              legacyFormat: 'npc',
            },
            {
              lines: [dialogue],
              legacyFormat: 'npc',
            },
          );
          collector.push(part, { node: element });
        }
      } else if (isNarration) {
        pushLine(rawText); // Narration without speaker prefix

        // Add narration part to collector
        if (collector) {
          const part = buildStructuredPart(
            element,
            {
              flavor: 'narration',
              role: 'narration',
              speaker: '내레이션',
              legacyFormat: 'plain',
            },
            {
              lines: [rawText],
              legacyFormat: 'plain',
            },
          );
          collector.push(part, { node: element });
        }
      }
    });

    // Collect images from this NPC message block
    collectImagesFromBlock(block, collector, {
      role: 'npc',
      speaker: primarySpeaker || characterName,
    });
  };

  const emitSystemLines = (
    block: Element,
    pushLine: (line: string) => void,
    collector: StructuredCollector | null = null,
  ): void => {
    const role = detectRole(block);
    if (role !== 'system') return;

    const systemLines: string[] = [];
    const scenarioLines: string[] = [];
    const openingDialogueLines: string[] = [];
    const seenTexts = new Set<string>();
    let openingCharacterName: string | null = null;

    // Check if this is the system message area (div.px-5)
    if (isSystemMessageArea(block)) {
      // Parse internal structure
      const wrapper = block.children[0];
      if (wrapper) {
        Array.from(wrapper.children).forEach((child) => {
          const text = textFromNode(child);
          if (!text || seenTexts.has(text)) return;

          const className = (child as Element).className || '';

          // AI disclaimer message
          if (text.includes('AI기술') || text.includes('AI 기술') || className.includes('mx-auto')) {
            seenTexts.add(text);
            pushLine(`[SYSTEM] ${text}`);
            systemLines.push(text);
          }
          // Scenario/Prologue (bg-[#363636])
          else if (className.includes('363636')) {
            seenTexts.add(text);
            pushLine(`[시나리오] ${text}`);
            scenarioLines.push(text);
          }
          // Opening AI message (justify-start with dialogue)
          else if (className.includes('justify-start')) {
            const dialogueEl = (child as Element).querySelector('[class*="262727"]');
            if (dialogueEl) {
              const rawDialogueText = textFromNode(dialogueEl);
              if (rawDialogueText && !seenTexts.has(rawDialogueText)) {
                seenTexts.add(rawDialogueText);
                // Extract character name from the opening message element itself
                const openingCharName = extractCharacterName(child as Element) || 'NPC';

                // Parse speaker and dialogue using the new function
                const { speaker, dialogue } = parseSpeakerDialogue(rawDialogueText);

                if (speaker) {
                  // Use the extracted speaker name
                  if (!openingCharacterName || openingCharacterName === 'NPC') {
                    openingCharacterName = speaker;
                  }
                  pushLine(`@${speaker}@ "${dialogue}"`);
                  openingDialogueLines.push(dialogue);
                } else {
                  // No speaker prefix, use character name
                  if (!openingCharacterName) {
                    openingCharacterName = openingCharName;
                  }
                  pushLine(`@${openingCharName}@ "${dialogue}"`);
                  openingDialogueLines.push(dialogue);
                }
              }
            }
            // Also check for narration in opening
            const narrationEl = (child as Element).querySelector('[class*="363636"]');
            if (narrationEl) {
              const narrationText = textFromNode(narrationEl);
              if (narrationText && !seenTexts.has(narrationText) && !isStatusBlock(narrationText)) {
                seenTexts.add(narrationText);
                pushLine(narrationText);
                scenarioLines.push(narrationText);
              }
            }
          }
        });
      }

      // Add parts to collector
      if (collector && systemLines.length) {
        const part = buildStructuredPart(block, {
          flavor: 'meta',
          role: 'system',
          speaker: 'SYSTEM',
          legacyFormat: 'meta',
        }, { lines: systemLines, legacyFormat: 'meta' });
        collector.push(part, { node: block });
      }

      if (collector && scenarioLines.length) {
        const part = buildStructuredPart(block, {
          flavor: 'narration',
          role: 'narration',
          speaker: '시나리오',
          legacyFormat: 'plain',
        }, { lines: scenarioLines, legacyFormat: 'plain' });
        collector.push(part, { node: block });
      }

      if (collector && openingDialogueLines.length) {
        // Use the character name extracted from opening message, not from system block
        const characterName = openingCharacterName || 'NPC';
        const part = buildStructuredPart(block, {
          flavor: 'speech',
          role: 'npc',
          speaker: characterName,
          legacyFormat: 'npc',
        }, { lines: openingDialogueLines, legacyFormat: 'npc' });
        collector.push(part, { node: block });
      }

      // Collect images from opening system message
      collectImagesFromBlock(block, collector, {
        role: 'npc',
        speaker: openingCharacterName || 'NPC',
      });

      return;
    }

    // Fallback for other system messages (like standalone narration)
    const partLines: string[] = [];
    const text = textFromNode(block);

    if (text && !isStatusBlock(text)) {
      pushLine(`[SYSTEM] ${text}`);
      partLines.push(text);
    }

    if (collector && partLines.length) {
      const part = buildStructuredPart(
        block,
        {
          flavor: 'meta',
          role: 'system',
          speaker: 'SYSTEM',
          legacyFormat: 'meta',
        },
        {
          lines: partLines,
          legacyFormat: 'meta',
        },
      );
      collector.push(part, { node: block });
    }
  };

  const emitTranscriptLines = (
    block: Element,
    pushLine: (line: string) => void,
    collector: StructuredCollector | null = null,
  ): void => {
    emitPlayerLines(block, pushLine, collector);
    emitNpcLines(block, pushLine, collector);
    emitSystemLines(block, pushLine, collector);
  };

  const collectStructuredMessage = (block: Element): StructuredSnapshotMessage | null => {
    if (!block) return null;
    const playerGuess = resolvePlayerNames()[0] || '플레이어';
    const collector = createStructuredCollector({ playerName: playerGuess }, { rootNode: block });
    const localLines: string[] = [];
    const pushLine = (line: string) => {
      const trimmed = (line || '').trim();
      if (!trimmed) return;
      localLines.push(trimmed);
    };

    try {
      emitTranscriptLines(block, pushLine, collector);
    } catch (err) {
      warnWithHandler(err, 'adapter', '[GMH] babechat structured emit failed');
      emitTranscriptLines(block, pushLine);
    }

    const parts = collector.list();
    const role = block?.getAttribute?.('data-gmh-message-role') || detectRole(block) || 'unknown';
    const ordinalAttr = Number(block?.getAttribute?.('data-gmh-message-ordinal'));
    const indexAttr = Number(block?.getAttribute?.('data-gmh-message-index'));
    const idAttr = block?.getAttribute?.('data-gmh-message-id') || null;

    const firstSpeakerPart = parts.find((part) => part?.speaker);
    const collectorPlayerName = collector?.defaults?.playerName ?? playerGuess;
    const speaker =
      firstSpeakerPart?.speaker ||
      (role === 'player'
        ? collectorPlayerName
        : role === 'npc'
        ? extractCharacterName(block)
        : null);

    const message: StructuredSnapshotMessage = {
      id: idAttr,
      index: Number.isFinite(indexAttr) ? indexAttr : null,
      ordinal: Number.isFinite(ordinalAttr) ? ordinalAttr : null,
      role,
      channel: role === 'player' ? 'user' : role === 'npc' ? 'llm' : 'system',
      speaker,
      parts,
    };

    if (localLines.length) {
      Object.defineProperty(message, 'legacyLines', {
        value: localLines.slice(),
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
    return message;
  };

  const guessPlayerNames = (): string[] => {
    // babechat.ai doesn't expose player names in DOM easily
    return [];
  };

  const getPanelAnchor = (doc: Document = document): Element | null => {
    const anchor = firstMatch(selectors.panelAnchor, doc);
    return anchor || doc.body;
  };

  const match = (loc: Location | AdapterMatchLocation): boolean =>
    /babechat\.ai/i.test(loc.hostname ?? '');

  /**
   * Extract session info from captured API parameters
   * Uses fetch interceptor to capture params from babechat's own API calls
   */
  const extractSessionInfo = (): BabechatSessionInfo | null => {
    // Use captured params from fetch interceptor
    const captured = getCapturedApiParams();
    if (captured) {
      return captured;
    }
    return null;
  };

  /**
   * Convert API message to StructuredSnapshotMessage format
   */
  const convertApiMessage = (
    apiMsg: BabechatApiMessage,
    index: number,
    characterName: string,
  ): StructuredSnapshotMessage => {
    const isUser = apiMsg.role === 'user';
    const playerName = primaryPlayerName();

    // Parse content - babechat API returns raw text
    const content = apiMsg.content || '';
    const lines = content.split(/\r?\n/).filter(Boolean);

    const part: StructuredSnapshotMessagePart = {
      type: 'paragraph',
      flavor: 'speech',
      role: isUser ? 'player' : 'npc',
      speaker: isUser ? playerName : characterName,
      lines,
      legacyFormat: isUser ? 'player' : 'npc',
    };

    return {
      id: String(apiMsg.id),
      index,
      ordinal: index,
      role: isUser ? 'player' : 'npc',
      channel: isUser ? 'user' : 'llm',
      speaker: isUser ? playerName : characterName,
      parts: [part],
    };
  };

  /**
   * Fetch all messages via API (bypasses virtual scroll limitation)
   */
  const fetchAllMessagesViaApi = async (): Promise<StructuredSnapshotMessage[]> => {
    const sessionInfo = extractSessionInfo();
    if (!sessionInfo) {
      throw new Error('Could not extract session info - babechat API call not captured yet. Try scrolling first.');
    }

    const { characterId, isUGC, roomId } = sessionInfo;
    const messages: StructuredSnapshotMessage[] = [];
    let offset = 0;
    const limit = 100; // Fetch in batches of 100

    // Try to get character name from page
    const characterNameEl = document.querySelector('a[href*="/character/"] span, [class*="character-name"]');
    const characterName = characterNameEl?.textContent?.trim() || 'NPC';

    if (typeof console !== 'undefined') {
      console.log(`[GMH] Fetching messages: characterId=${characterId}, isUGC=${isUGC}, roomId=${roomId}`);
    }

    // Get captured auth headers
    const authHeaders = getCapturedAuthHeaders();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authHeaders) {
      Object.assign(headers, authHeaders);
    }

    if (typeof console !== 'undefined') {
      console.log('[GMH] Using auth headers:', Object.keys(headers));
    }

    // Paginate through all messages
    while (true) {
      const apiUrl = `https://api.babechatapi.com/ko/api/messages/${characterId}/${isUGC}/${roomId}?offset=${offset}&limit=${limit}`;

      const response = await fetch(apiUrl, {
        credentials: 'include', // Include cookies for auth
        headers,
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data: BabechatApiResponse = await response.json();

      // Convert and add messages
      for (let i = 0; i < data.messages.length; i++) {
        const apiMsg = data.messages[i];
        const globalIndex = offset + i;
        const structuredMsg = convertApiMessage(apiMsg, globalIndex, characterName);
        messages.push(structuredMsg);
      }

      // Check if we've fetched all messages
      if (messages.length >= data.count || data.messages.length < limit) {
        break;
      }

      offset += limit;
    }

    // Sort by ID to ensure correct order (oldest first)
    messages.sort((a, b) => {
      const idA = parseInt(a.id || '0', 10);
      const idB = parseInt(b.id || '0', 10);
      return idA - idB;
    });

    // Prepend initial messages from character data (scenario + first greeting)
    const charData = getCapturedCharacterData();
    const initialMessages: StructuredSnapshotMessage[] = [];

    if (charData) {
      const charName = charData.name || characterName;

      // Add initialAction as narration/scenario
      if (charData.initialAction) {
        const actionPart: StructuredSnapshotMessagePart = {
          type: 'paragraph',
          flavor: 'narration',
          role: 'narration',
          speaker: '시나리오',
          lines: charData.initialAction.split(/\r?\n/).filter(Boolean),
          legacyFormat: 'plain',
        };
        initialMessages.push({
          id: 'initial-action',
          index: -2,
          ordinal: -2,
          role: 'system',
          channel: 'system',
          speaker: '시나리오',
          parts: [actionPart],
        });
      }

      // Add initialMessage as character's first greeting
      if (charData.initialMessage) {
        const msgPart: StructuredSnapshotMessagePart = {
          type: 'paragraph',
          flavor: 'speech',
          role: 'npc',
          speaker: charName,
          lines: charData.initialMessage.split(/\r?\n/).filter(Boolean),
          legacyFormat: 'npc',
        };
        initialMessages.push({
          id: 'initial-message',
          index: -1,
          ordinal: -1,
          role: 'npc',
          channel: 'llm',
          speaker: charName,
          parts: [msgPart],
        });
      }

      if (initialMessages.length > 0 && typeof console !== 'undefined') {
        console.log(`[GMH] Prepending ${initialMessages.length} initial message(s) from character data`);
      }
    }

    // Combine: initial messages first, then API messages
    const allMessages = [...initialMessages, ...messages];

    // Re-assign indices after combining
    allMessages.forEach((msg, idx) => {
      msg.index = idx;
      msg.ordinal = idx;
    });

    return allMessages;
  };

  /**
   * Check if API-based collection is available
   */
  const canUseApiCollection = (): boolean => {
    const sessionInfo = extractSessionInfo();
    return sessionInfo !== null;
  };

  const babechatAdapter: BabechatAdapter = {
    id: 'babechat',
    label: 'BabeChat',
    match,
    findContainer: (doc = document) => getChatContainer(doc),
    listMessageBlocks: (root) => getMessageBlocks(root),
    emitTranscriptLines,
    collectStructuredMessage,
    detectRole,
    guessPlayerNames,
    getPanelAnchor,
    dumpSelectors: () => clone(selectors),
    resetInfoRegistry: () => {
      // No info registry for babechat adapter
    },
    setPlayerNameAccessor(fn) {
      if (typeof fn === 'function') {
        playerNameAccessor = fn;
      }
    },
    extractSessionInfo,
    fetchAllMessagesViaApi,
    canUseApiCollection,
  };

  return babechatAdapter;
};

export default createBabechatAdapter;
