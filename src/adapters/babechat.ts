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
