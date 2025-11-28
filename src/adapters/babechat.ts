import { adapterRegistry, getAdapterConfig } from './registry';
import { clone } from '../core/utils';
import {
  collapseSpaces,
  stripQuotes,
} from '../utils/text';
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
}

export const createBabechatAdapter = ({
  registry = adapterRegistry,
  playerMark = DEFAULT_PLAYER_MARK,
  getPlayerNames = () => [],
  errorHandler,
}: BabechatAdapterOptions = {}): BabechatAdapter => {
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

  const collectAll = (selList: SelectorList, root: Document | Element = document): Element[] => {
    const out: Element[] = [];
    const seen = new Set<Element>();
    if (!selList?.length) return out;
    for (const sel of selList) {
      if (!sel) continue;
      if (root instanceof Element && root.matches(sel) && !seen.has(root)) {
        seen.add(root);
        out.push(root);
      }
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

  const textSegmentsFromNode = (node: Element | Node | null | undefined): string[] => {
    if (!node) return [];
    let text = '';
    if (node instanceof HTMLElement) {
      text = node.innerText ?? node.textContent ?? '';
    } else if (node instanceof Element || node instanceof Node) {
      text = node.textContent ?? '';
    }
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
    // Try direct selectors first
    const direct = firstMatch(selectors.chatContainers, doc);
    if (direct && isScrollable(direct)) return direct;

    // Try finding form and its scrollable parent
    const form = doc.querySelector('form');
    if (form) {
      const scrollable = findScrollableAncestor(form);
      if (scrollable) return scrollable;
      // Return form's parent if it looks like a chat container
      const parent = form.parentElement;
      if (parent && parent.classList.contains('overflow-hidden')) {
        return parent;
      }
    }

    // Fallback: find message blocks and trace up
    const block = firstMatch(selectors.messageRoot, doc);
    if (block) {
      const scrollable = findScrollableAncestor(block.parentElement);
      if (scrollable) return scrollable;
    }

    return null;
  };

  const getMessageBlocks = (root: Document | Element | null | undefined): Element[] => {
    const targetRoot = root || document;
    const blocks = collectAll(selectors.messageRoot, targetRoot);
    if (blocks.length) return blocks;

    // Fallback: query form directly
    const form = targetRoot instanceof Document
      ? targetRoot.querySelector('form')
      : targetRoot.querySelector('form') || targetRoot.closest('form');

    if (form) {
      const userMessages = Array.from(form.querySelectorAll('.justify-end.font-normal'));
      const aiMessages = Array.from(form.querySelectorAll('.justify-start.font-normal'));
      return [...userMessages, ...aiMessages].sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return aRect.top - bRect.top;
      });
    }

    return [];
  };

  const detectRole = (block: Element | null | undefined): BabechatRole => {
    if (!block) return 'unknown';

    // Check for user message (justify-end)
    if (block.classList.contains('justify-end')) {
      return 'player';
    }

    // Check for AI message (justify-start with avatar)
    if (block.classList.contains('justify-start')) {
      const hasAvatar = block.querySelector('a[href*="/character/"][href*="/profile"]');
      if (hasAvatar) return 'npc';
    }

    // Check for system message
    const bgClass = Array.from(block.classList).find(c => c.includes('363636'));
    if (bgClass) return 'system';

    // Check parent classes as fallback
    const parent = block.closest('.justify-end, .justify-start');
    if (parent?.classList.contains('justify-end')) return 'player';
    if (parent?.classList.contains('justify-start')) return 'npc';

    return 'unknown';
  };

  const resolvePartType = (node: Element | null): string => {
    if (!(node instanceof Element)) return 'paragraph';
    const tag = node.tagName?.toLowerCase?.() || '';
    if (!tag) return 'paragraph';
    if (tag === 'pre') return 'code';
    if (tag === 'code' && node.closest('pre')) return 'code';
    if (tag === 'blockquote') return 'blockquote';
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (tag === 'img') return 'image';
    if (tag === 'hr') return 'horizontal-rule';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'em' || tag === 'i') return 'narration';
    return 'paragraph';
  };

  const buildStructuredPart = (
    node: Element | Node | null,
    context: StructuredContext = {},
    options: StructuredPartOptions = {},
  ): StructuredSnapshotMessagePart => {
    const baseLines = Array.isArray(options.lines) ? options.lines.slice() : [];
    const partType = options.type || resolvePartType(node as Element | null);
    const part: StructuredSnapshotMessagePart & { lines: string[] } = {
      type: partType,
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

  const extractCharacterName = (block: Element): string => {
    // Try character name selector
    const nameNode = firstMatch(selectors.characterName, block);
    if (nameNode) {
      const name = nameNode.textContent?.trim();
      if (name) return name.slice(0, 40);
    }

    // Fallback: look for small text before message bubble
    const smallText = block.querySelector('.text-\\[0\\.75rem\\], [class*="text-[0.75rem]"]');
    if (smallText) {
      const name = smallText.textContent?.trim();
      if (name) return name.slice(0, 40);
    }

    return 'NPC';
  };

  const emitPlayerLines = (
    block: Element,
    pushLine: (line: string) => void,
    collector: StructuredCollector | null = null,
  ): void => {
    const role = detectRole(block);
    if (role !== 'player') return;

    // Find text content in user message bubble
    const textNode = block.querySelector('[class*="B56576"], [class*="bg-[#B56576]"]')
      || block.querySelector('.rounded-tl-xl')
      || block;

    const partLines: string[] = [];
    textSegmentsFromNode(textNode).forEach((seg) => {
      if (!seg) return;
      pushLine(playerMark + seg);
      partLines.push(seg);
    });

    if (collector && partLines.length) {
      const playerName = collector.defaults?.playerName || '플레이어';
      const part = buildStructuredPart(
        textNode,
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
      collector.push(part, { node: textNode });
    }
  };

  const emitNpcLines = (
    block: Element,
    pushLine: (line: string) => void,
    collector: StructuredCollector | null = null,
  ): void => {
    const role = detectRole(block);
    if (role !== 'npc') return;

    const characterName = extractCharacterName(block);

    // Find text content in AI message bubble
    const textNode = block.querySelector('[class*="262727"], [class*="bg-[#262727]"]')
      || block.querySelector('.rounded-bl-xl')
      || block.querySelector('.relative.max-w-\\[70\\%\\]');

    if (!textNode) return;

    const partLines: string[] = [];

    // Handle italic text as narration, regular text as dialogue
    const children = textNode.querySelectorAll('em, i, p, span');
    if (children.length) {
      children.forEach((child) => {
        const text = child.textContent?.trim();
        if (!text) return;

        const isNarration = child.tagName.toLowerCase() === 'em' || child.tagName.toLowerCase() === 'i';
        if (isNarration) {
          pushLine(text);
        } else {
          pushLine(`@${characterName}@ "${text}"`);
        }
        partLines.push(text);
      });
    } else {
      // No structured children, emit all text
      textSegmentsFromNode(textNode).forEach((seg) => {
        if (!seg) return;
        // Check if line starts with speaker indicator (e.g., "치류 |")
        const speakerMatch = seg.match(/^(.+?)\s*\|\s*(.+)$/);
        if (speakerMatch) {
          pushLine(`@${speakerMatch[1]}@ "${speakerMatch[2]}"`);
        } else {
          pushLine(`@${characterName}@ "${seg}"`);
        }
        partLines.push(seg);
      });
    }

    if (collector && partLines.length) {
      const part = buildStructuredPart(
        textNode,
        {
          flavor: 'speech',
          role: 'npc',
          speaker: characterName,
          legacyFormat: 'npc',
        },
        {
          lines: partLines,
          legacyFormat: 'npc',
        },
      );
      collector.push(part, { node: textNode });
    }
  };

  const emitSystemLines = (
    block: Element,
    pushLine: (line: string) => void,
    collector: StructuredCollector | null = null,
  ): void => {
    const role = detectRole(block);
    if (role !== 'system') return;

    const partLines: string[] = [];
    textSegmentsFromNode(block).forEach((seg) => {
      if (!seg) return;
      pushLine(`[SYSTEM] ${seg}`);
      partLines.push(seg);
    });

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
    // Return empty and rely on fallbacks
    return [];
  };

  const getPanelAnchor = (doc: Document = document): Element | null => {
    const anchor = firstMatch(selectors.panelAnchor, doc);
    return anchor || doc.body;
  };

  const match = (loc: Location | AdapterMatchLocation): boolean =>
    /babechat\.ai/i.test(loc.hostname ?? '');

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
  };

  return babechatAdapter;
};

export default createBabechatAdapter;
