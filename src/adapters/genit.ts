import { adapterRegistry, getAdapterConfig } from './registry';
import { clone } from '../core/utils';
import {
  normNL,
  stripTicks,
  collapseSpaces,
  stripQuotes,
  stripBrackets,
  sanitizeText,
  parseListInput,
} from '../utils/text';
import { isScrollable } from '../utils/dom';
import { looksLikeName } from '../utils/validation';

import type {
  AdapterConfig,
  AdapterRegistry,
  AdapterSelectors,
  GenitAdapter,
  GenitAdapterOptions,
  StructuredSnapshotMessage,
  StructuredSnapshotMessagePart,
  StructuredCollector,
  StructuredCollectorMeta,
  ErrorHandler,
  AdapterMatchLocation,
} from '../types';

type SelectorList = string[] | null | undefined;

interface AdapterReactMessage {
  role?: string;
  content?: string;
}

type GenitRole = 'player' | 'npc' | 'narration' | 'unknown';

interface CollectorEntry {
  part: StructuredSnapshotMessagePart;
  orderPath: number[];
  fallback: number;
}

interface NarrationTarget {
  node: Element;
  loose: boolean;
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

export const createGenitAdapter = ({
  registry = adapterRegistry,
  playerMark = DEFAULT_PLAYER_MARK,
  getPlayerNames = () => [],
  isPrologueBlock = () => false,
  errorHandler,
}: GenitAdapterOptions = {}): GenitAdapter => {
  let infoNodeRegistry = new WeakSet<Node>();
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
  const adapterConfig = registryGet('genit');
  const selectors: AdapterSelectors = adapterConfig.selectors || {};

  const playerScopeSelector = (selectors.playerScopes || []).filter(Boolean).join(',');
  const npcScopeSelector = (selectors.npcGroups || []).filter(Boolean).join(',');
  const isPrologueBlockFn = typeof isPrologueBlock === 'function' ? isPrologueBlock : () => false;

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

  const matchesSelectorList = (node: Element | null | undefined, selList: SelectorList): boolean => {
    if (!(node instanceof Element)) return false;
    if (!selList?.length) return false;
    return selList.some((sel) => {
      if (!sel) return false;
      try {
        return node.matches(sel);
      } catch (err) {
        return false;
      }
    });
  };

  const closestMatchInList = (node: Element | null | undefined, selList: SelectorList): Element | null => {
    if (!(node instanceof Element)) return null;
    if (!selList?.length) return null;
    for (const sel of selList) {
      if (!sel) continue;
      try {
        const match = node.closest(sel);
        if (match) return match;
      } catch (err) {
        continue;
      }
    }
    return null;
  };

  const containsSelector = (root: Element | null | undefined, selList: SelectorList): boolean => {
    if (!(root instanceof Element)) return false;
    if (!selList?.length) return false;
    return selList.some((sel) => {
      if (!sel) return false;
      try {
        return Boolean(root.querySelector(sel));
      } catch (err) {
        return false;
      }
    });
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
    for (let depth = 0; depth < 6 && current; depth += 1) {
      if (isScrollable(current)) return current;
      current = current.parentElement;
    }
    return null;
  };

  const findByRole = (root: Document | Element = document): Element | null => {
    const roleNodes = collectAll(['[role]'], root);
    return roleNodes.find((node) => {
      const role = node.getAttribute('role') || '';
      return /log|list|main|region/i.test(role) && isScrollable(node);
    }) ?? null;
  };

  const findByTextHint = (root: Document | Element = document): Element | null => {
    const hints = selectors.textHints || [];
    if (!hints.length) return null;
    const nodes = collectAll(['main', 'section', 'article'], root).filter((node) => {
      if (!node || node.childElementCount < 3) return false;
      const text = (node.textContent || '').trim();
      if (!text || text.length > 400) return false;
      return hints.some((hint) => text.includes(hint));
    });
    return nodes.find((node) => isScrollable(node)) ?? null;
  };

  const getChatContainer = (doc: Document = document): Element | null => {
    const direct = firstMatch(selectors.chatContainers, doc);
    if (direct && isScrollable(direct)) return direct;

    const roleMatch = findByRole(doc);
    if (roleMatch) return roleMatch;

    const block = firstMatch(selectors.messageRoot, doc);
    if (block) {
      const scrollable = findScrollableAncestor(block.parentElement);
      if (scrollable) return scrollable;
    }

    const hintMatch = findByTextHint(doc);
    if (hintMatch) return hintMatch;

    return null;
  };

  const getMessageBlocks = (root: Document | Element | null | undefined): Element[] => {
    const targetRoot = root || document;
    const blocks = collectAll(selectors.messageRoot, targetRoot);
    if (blocks.length) return blocks;
    if (targetRoot !== document) {
      const fallback = collectAll(selectors.messageRoot, document);
      if (fallback.length) return fallback;
    }
    return [];
  };

  const getReactMessage = (block: Element | null | undefined): AdapterReactMessage | null => {
    if (!block || typeof block !== 'object') return null;

    try {
      const allKeys = Object.getOwnPropertyNames(block);
      const fiberKeys = allKeys.filter((k) => k.startsWith('__reactFiber'));
      if (!fiberKeys.length) return null;

      const fiberKey = fiberKeys[0];
      const fiberHost = block as unknown as Record<string, unknown>;
      let fiber: any = fiberHost[fiberKey];
      for (let depth = 0; depth < 10 && fiber; depth++) {
        const props = fiber.memoizedProps;
        if (props && props.message && typeof props.message === 'object') {
          return props.message;
        }
        fiber = fiber.return;
      }
    } catch (err) {
      // Silently fail if property access throws
    }
    return null;
  };

  const detectRole = (block: Element | null | undefined): GenitRole => {
    if (!block) return 'unknown';

    // Phase 1: Most reliable CSS check - justify-end indicates normal player dialogue
    // This catches 99% of player messages quickly
    const hasJustifyEnd = block.querySelector('.justify-end') !== null;
    if (hasJustifyEnd) return 'player';

    // Phase 1.5: Check for NPC markers BEFORE Phase 2
    // This prevents NPC messages from being misclassified by React content comparison
    const hasNpc = collectAll(selectors.npcGroups, block).length > 0;
    if (hasNpc) return 'npc';

    // Phase 2: Detect player thought/action inputs via content mismatch
    // genit.ai transforms user thought/action into AI-narrated 3rd person,
    // but DOM still renders original user input while React has transformed version
    try {
      const reactMessage = getReactMessage(block);
      if (reactMessage && reactMessage.role === 'assistant') {
        const domText = collapseSpaces(block.textContent || '');
        const reactText = collapseSpaces(reactMessage.content || '');

        // If texts differ and DOM is shorter (user input vs AI expansion),
        // this is a player thought/action input
        if (domText && reactText &&
            domText !== reactText &&
            domText.length > 0 &&
            domText.length < reactText.length * 0.95) { // DOM significantly shorter
          return 'player';
        }
      }

      // Normal user dialogue (React role="user")
      if (reactMessage && reactMessage.role === 'user') {
        return 'player';
      }
    } catch (err) {
      // Silently fall back to CSS detection if React traversal fails
    }

    // Phase 3: CSS-based detection (fallback)
    const hasPlayer = collectAll(selectors.playerScopes, block).length > 0;
    if (hasPlayer) return 'player';

    return 'narration';
  };

  /**
   * Determines the structured snapshot part type for a DOM node.
   * @param {Element | null} node - Node under evaluation.
   * @returns {string}
   */
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
    if (tag === 'table') return 'table';
    return 'paragraph';
  };

  const detectCodeLanguage = (node: Element | null): string | null => {
    if (!(node instanceof Element)) return null;
    const target =
      node.matches?.('code') && !node.matches('pre code') ? node : node.querySelector?.('code');
    const classSource = target instanceof Element ? target : node;
    const classList = classSource instanceof Element ? Array.from(classSource.classList) : [];
    for (const cls of classList) {
      if (cls.startsWith('language-')) return cls.slice('language-'.length) || null;
    }
    const dataLang = target?.getAttribute?.('data-language') || node.getAttribute?.('data-language');
    if (dataLang) return dataLang;
    return null;
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
    if (partType === 'code') {
      const elementNode = node instanceof Element ? node : null;
      const codeCandidate =
        elementNode && elementNode.matches('pre') ? elementNode.querySelector('code') : null;
      const codeTarget = codeCandidate instanceof Element ? codeCandidate : elementNode;
      const rawSource = (codeCandidate ?? node) as Node | null;
      const raw = (rawSource?.textContent ?? '').replace(/\r\n/g, '\n');
      part.text = raw;
      part.language = detectCodeLanguage(codeTarget ?? null);
      if (!part.lines.length) {
        part.lines = raw
          .split(/\n/)
          .map((line) => line.replace(/\s+$/g, '').trim())
          .filter(Boolean);
      }
    } else if (partType === 'list' && node instanceof Element) {
      const ordered = node.tagName?.toLowerCase() === 'ol';
      const items = Array.from(node.querySelectorAll('li'))
        .map((li) => collapseSpaces(li.textContent || ''))
        .filter(Boolean);
      part.ordered = ordered;
      part.items = items;
      if (!part.lines.length) {
        part.lines = items.slice();
      }
    } else if (partType === 'image' && node instanceof Element) {
      const imgEl =
        node instanceof HTMLImageElement ? node : node.querySelector?.('img') || null;
      if (imgEl) {
        part.src = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
        part.alt = imgEl.getAttribute('alt') || '';
        part.title = imgEl.getAttribute('title') || '';
      }
      if (!part.lines.length && part.alt) {
        part.lines = [part.alt];
      }
    } else if (partType === 'heading' && node instanceof Element) {
      const levelMatch = node.tagName?.match(/h(\d)/i);
      part.level = levelMatch ? Number(levelMatch[1]) : null;
      const headingText = collapseSpaces(node.textContent || '');
      part.text = headingText;
      if (!part.lines.length && headingText) {
        part.lines = [headingText];
      }
    } else if (partType === 'horizontal-rule') {
      if (!part.lines.length) part.lines = [];
    } else if (!part.lines.length) {
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

  /**
   * Comparator used to keep structured parts in DOM order.
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number}
   */
  const compareOrderPaths = (a: number[], b: number[]): number => {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
      const valA = Number.isFinite(a[i]) ? a[i] : -1;
      const valB = Number.isFinite(b[i]) ? b[i] : -1;
      if (valA !== valB) return valA - valB;
    }
    return 0;
  };

  /**
   * Creates a collector to manage structured message parts with ordering.
   * @param {{ playerName?: string }} [defaults={}] - Default speaker metadata.
   * @param {{ rootNode?: Node | null }} [context={}] - Context for ordering.
   * @returns {StructuredCollector}
   */
  const createStructuredCollector = (
    defaults: { playerName?: string } = {},
    context: { rootNode?: Node | null } = {},
  ): StructuredCollector => {
    const parts: CollectorEntry[] = [];
    const snapshotDefaults = {
      playerName: defaults.playerName || '플레이어',
    };
    const infoLineSet = new Set<string>();
    const normalizeLine = (line: unknown): string =>
      typeof line === 'string' ? line.trim() : '';
    const filterInfoLines = (lines: string[] = []) =>
      lines
        .map((line) => normalizeLine(line))
        .filter((line) => line.length)
        .filter((line) => !infoLineSet.has(line));
    const rootNode = context?.rootNode instanceof Node ? context.rootNode : null;
    let fallbackCounter = 0;
    return {
      push(part, meta: StructuredCollectorMeta = {}) {
        if (!part) return;
        const next: StructuredSnapshotMessagePart = { ...part };
        if (!Array.isArray(next.lines)) next.lines = [];
        if (!next.role && next.flavor === 'speech') next.role = 'unknown';
        if (!next.speaker && next.role === 'player') next.speaker = snapshotDefaults.playerName;
        if (next.type === 'info') {
          next.lines = next.lines.map((line) => normalizeLine(line)).filter(Boolean);
          next.legacyLines = Array.isArray(next.legacyLines)
            ? next.legacyLines.map((line) => normalizeLine(line)).filter(Boolean)
            : [];
          next.lines.forEach((line) => infoLineSet.add(line));
          next.legacyLines.forEach((line) => infoLineSet.add(line));
        } else if (infoLineSet.size) {
          next.lines = filterInfoLines(next.lines);
          if (Array.isArray(next.legacyLines)) {
            next.legacyLines = filterInfoLines(next.legacyLines);
            if (!next.lines.length && !next.legacyLines.length) return;
          } else if (!next.lines.length) {
            return;
          }
        }
        if (next.type !== 'info' && !Array.isArray(next.legacyLines)) {
          delete next.legacyLines;
        } else if (next.type !== 'info' && Array.isArray(next.legacyLines) && !next.legacyLines.length) {
          delete next.legacyLines;
        }
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

  /**
   * Memoizes info nodes to prevent duplicate narration emission.
   * @param {Node | null | undefined} node - Entry node for the info subtree.
   */
  const markInfoNodeTree = (node: Node | null | undefined): void => {
    if (!node) return;
    try {
      const markSubtree = (element: Node | null | undefined) => {
        if (!element) return;
        infoNodeRegistry.add(element);
        if (element instanceof Element) {
          element.querySelectorAll('*').forEach((child) => infoNodeRegistry.add(child));
        }
      };
      markSubtree(node);
      if (node instanceof Element) {
        const infoContainer =
          node.closest?.('.info-card, .info-block, .gmh-info') || null;
        if (infoContainer) markSubtree(infoContainer);
        const preContainer = node.closest?.('pre, code');
        if (preContainer) markSubtree(preContainer);
      }
    } catch (err) {
      /* noop */
    }
  };

  /**
   * Checks if a node belongs to a cached info subtree.
   * @param {Node | null | undefined} node - Node to test.
   * @returns {boolean}
   */
  const isInfoRelatedNode = (node: Node | null | undefined): boolean => {
    if (!node) return false;
    if (infoNodeRegistry.has(node)) return true;
    if (node instanceof Element && closestMatchInList(node, selectors.infoCode)) return true;
    return false;
  };

  const emitInfo = (
    block: Element,
    pushLine: (line: string) => void,
    collector: StructuredCollector | null = null,
  ): void => {
    const infoNode = firstMatch(selectors.infoCode, block);
    if (!infoNode) return;

    const infoLinesOut: string[] = [];
    const infoSeen = new Set<string>();

    pushLine('INFO');

    const infoLines = textSegmentsFromNode(infoNode);
    infoLines.forEach((seg) => {
      const trimmed = (seg || '').trim();
      if (!trimmed) return;
      if (infoSeen.has(trimmed)) return;
      infoSeen.add(trimmed);
      infoLinesOut.push(trimmed);
      pushLine(trimmed);
    });

    markInfoNodeTree(infoNode);
    if (collector) {
      const infoCardWrapper =
        infoNode.closest('.bg-card, .info-card, .info-block') ||
        infoNode.closest('pre') ||
        infoNode;
      collector.push(
        {
          type: 'info',
          flavor: 'meta',
          role: 'system',
          speaker: 'INFO',
          lines: infoLinesOut,
          legacyLines: ['INFO', ...infoLinesOut],
          legacyFormat: 'meta',
        },
        { node: infoCardWrapper },
      );
    }
  };

  const emitPlayerLines = (
    block: Element,
    pushLine: (line: string) => void,
    collector: StructuredCollector | null = null,
  ): void => {
    const blockRole = block?.getAttribute?.('data-gmh-message-role') || detectRole(block);
    if (blockRole !== 'player') return;
    const scopes = collectAll(selectors.playerScopes, block);
    const scopeList = scopes.length ? [...scopes] : [];
    if (playerScopeSelector && block.matches?.(playerScopeSelector)) {
      if (!scopeList.includes(block)) scopeList.unshift(block);
    }
    if (!scopeList.length) {
      scopeList.push(block);
    } else if (scopeList.length > 1) {
      const rootIndex = scopeList.indexOf(block);
      if (rootIndex >= 0) scopeList.splice(rootIndex, 1);
    }
    const textNodes: Element[] = [];
    const nodeSeen = new Set<Element>();
    for (const scope of scopeList) {
      collectAll(selectors.playerText, scope).forEach((node) => {
        if (!nodeSeen.has(node)) {
          nodeSeen.add(node);
          textNodes.push(node);
        }
      });
    }
    const targets = textNodes.length ? textNodes : scopeList;
    const filteredTargets = targets.filter((node) => {
      if (!(node instanceof Element)) return true;
      const playerScope =
        closestMatchInList(node, selectors.playerScopes) ||
        (playerScopeSelector && node.closest?.(playerScopeSelector));
      const withinPlayer = Boolean(playerScope || scopeList.includes(node));
      if (!withinPlayer && scopeList.length) return false;
      if (
        matchesSelectorList(node, selectors.narrationBlocks) ||
        closestMatchInList(node, selectors.narrationBlocks)
      ) {
        if (!withinPlayer) return false;
      }
      if (matchesSelectorList(node, selectors.npcGroups)) return false;
      if (closestMatchInList(node, selectors.npcGroups)) return false;
      if (matchesSelectorList(node, selectors.infoCode)) return false;
      if (containsSelector(node, selectors.infoCode)) return false;
      return true;
    });
    const effectiveTargets = filteredTargets.length ? filteredTargets : targets;
    const seenSegments = new Set<string>();
    effectiveTargets.forEach((node) => {
      if (isInfoRelatedNode(node)) return;
      const partLines: string[] = [];
      textSegmentsFromNode(node).forEach((seg) => {
        if (!seg) return;
        if (seenSegments.has(seg)) return;
        seenSegments.add(seg);
        pushLine(playerMark + seg);
        partLines.push(seg);
      });
      if (collector && partLines.length) {
        const playerName = collector.defaults?.playerName || '플레이어';
        const part = buildStructuredPart(
          node,
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
        collector.push(part, { node });
      }
    });
  };

  const extractNameFromGroup = (group: Element): string => {
    const nameNode = firstMatch(selectors.npcName, group);
    let name: string | null =
      nameNode?.getAttribute?.('data-author-name') ?? nameNode?.textContent ?? null;
    if (!name) {
      name =
        group.getAttribute('data-author') ??
        group.getAttribute('data-username') ??
        group.getAttribute('data-name') ??
        null;
    }
    return stripQuotes(collapseSpaces(name || '')).slice(0, 40);
  };

  const emitNpcLines = (
    block: Element,
    pushLine: (line: string) => void,
    collector: StructuredCollector | null = null,
  ): void => {
    const blockRole = block?.getAttribute?.('data-gmh-message-role') || detectRole(block);
    if (blockRole !== 'npc') return;
    const groups = collectAll(selectors.npcGroups, block);
    if (!groups.length) return;
    groups.forEach((group) => {
      if (playerScopeSelector && group.closest(playerScopeSelector)) return;
      const nameRaw = extractNameFromGroup(group);
      const name = nameRaw || 'NPC';
      const bubbleNodes = collectAll(selectors.npcBubble, group);
      const targets = bubbleNodes.length ? bubbleNodes : [group];
      targets.forEach((node) => {
        if (isInfoRelatedNode(node)) return;
        const partLines: string[] = [];
        textSegmentsFromNode(node).forEach((seg) => {
          if (!seg) return;
          if (seg && seg === name) return;
          pushLine(`@${name}@ "${seg}"`);
          partLines.push(seg);
        });
        if (collector && partLines.length) {
          const part = buildStructuredPart(
            node,
            {
              flavor: 'speech',
              role: 'npc',
              speaker: name,
              legacyFormat: 'npc',
            },
            {
              lines: partLines,
              legacyFormat: 'npc',
            },
          );
          collector.push(part, { node });
        }
      });
    });
  };

  const emitNarrationLines = (
    block: Element,
    pushLine: (line: string) => void,
    collector: StructuredCollector | null = null,
  ): void => {
    const blockRole = block?.getAttribute?.('data-gmh-message-role') || detectRole(block);

    if (blockRole === 'player') {
      return;
    }

    const targets: NarrationTarget[] = [];
    const seenNodes = new Set<Element>();
    const queueNode = (node: Element | null | undefined, loose = false) => {
      if (!(node instanceof Element) || seenNodes.has(node)) return;
      seenNodes.add(node);
      targets.push({ node, loose });
    };

    const collected = collectAll(selectors.narrationBlocks, block);
    collected.forEach((node) => {
      queueNode(node, false);
    });

    const playerNames = resolvePlayerNames();
    const knownLabels = new Set(
      [collector?.defaults?.playerName, ...playerNames]
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
        .map((name) => name.trim()),
    );
    const shouldSkipNarrationLine = (text: string, element?: Element | null) => {
      const clean = text.trim();
      if (!clean) return true;
      if (/^INFO$/i.test(clean)) return true;
      if (knownLabels.has(clean)) return true;
      const wordCount = clean.split(/\s+/).length;
      const mutedContext =
        element?.classList?.contains('text-muted-foreground') ||
        element?.closest?.('.text-muted-foreground, .markdown-content.text-muted-foreground');
      if (wordCount === 1) {
        if (knownLabels.has(clean)) return true;
        if (/^[A-Za-z][A-Za-z .,'’]{0,24}$/.test(clean)) {
          return !mutedContext;
        }
        return false;
      }
      if (wordCount <= 3 && looksLikeName(clean) && !/[.!?…:,]/.test(clean)) {
        return !mutedContext;
      }
      return false;
    };

    if (!targets.length) {
      const fallbackParagraphs = Array.from(block.querySelectorAll('p'));
      fallbackParagraphs.forEach((node) => {
        if (seenNodes.has(node)) return;
        if (isInfoRelatedNode(node)) return;
        if (node.closest('code, pre')) return;
        if (playerScopeSelector && node.closest(playerScopeSelector)) return;
        if (npcScopeSelector) {
          const npcContainer = node.closest(npcScopeSelector);
          if (npcContainer) {
            const withinNpcBubble =
              matchesSelectorList(node, selectors.npcBubble) ||
              closestMatchInList(node, selectors.npcBubble) ||
              containsSelector(node, selectors.npcBubble);
            if (withinNpcBubble) return;
          }
        }
        const text = node.textContent?.trim();
        if (!text || text.length < 6) return;
        queueNode(node, true);
      });

      const npcGroups = collectAll(selectors.npcGroups, block);
      npcGroups.forEach((group) => {
        let sibling = group?.nextElementSibling || null;
        let steps = 0;
        while (sibling && steps < 4) {
          steps += 1;
          if (!(sibling instanceof Element)) break;
          if (seenNodes.has(sibling)) {
            sibling = sibling.nextElementSibling;
            continue;
          }
          if (isInfoRelatedNode(sibling)) {
            sibling = sibling.nextElementSibling;
            continue;
          }
          if (playerScopeSelector && sibling.closest(playerScopeSelector)) break;
          const text = sibling.textContent?.trim();
          if (!text || text.length < 6) break;
          queueNode(sibling, true);
          sibling = sibling.nextElementSibling;
        }
      });
    }

    if (!targets.length) {
      return;
    }

    targets.forEach(({ node, loose }) => {
      if (npcScopeSelector) {
        const npcContainer = node.closest(npcScopeSelector);
        if (npcContainer) {
          const withinNpcBubble =
            matchesSelectorList(node, selectors.npcBubble) ||
            closestMatchInList(node, selectors.npcBubble) ||
            containsSelector(node, selectors.npcBubble);
          const mutedNarration =
            node instanceof Element && node.classList?.contains('text-muted-foreground');
          if (withinNpcBubble && !mutedNarration) {
            const hostBlock = node.closest('[data-gmh-message-index]') || block;
            if (!isPrologueBlockFn(hostBlock)) {
              return;
            }
          }
        }
      }
      if (isInfoRelatedNode(node)) {
        return;
      }
      const partLines: string[] = [];
      const segments = textSegmentsFromNode(node);
      segments.forEach((seg) => {
        if (!seg) return;
        const clean = seg.trim();
        if (!clean) return;
        if (!loose && shouldSkipNarrationLine(clean, node)) {
          return;
        }
        pushLine(clean);
        partLines.push(clean);
      });
      if (collector && partLines.length) {
        const part = buildStructuredPart(
          node,
          {
            flavor: 'narration',
            role: 'narration',
            speaker: '내레이션',
            legacyFormat: 'plain',
          },
          {
            lines: partLines,
            legacyFormat: 'plain',
          },
        );
        collector.push(part, { node });
      }
    });
  };

  const emitTranscriptLines = (
    block: Element,
    pushLine: (line: string) => void,
    collector: StructuredCollector | null = null,
  ): void => {
    emitInfo(block, pushLine, collector);
    emitPlayerLines(block, pushLine, collector);
    emitNpcLines(block, pushLine, collector);
    emitNarrationLines(block, pushLine, collector);
  };

  const collectStructuredMessage = (block: Element): StructuredSnapshotMessage | null => {
    if (!block) return null;
    const playerGuess = guessPlayerNames()[0] || '플레이어';
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
      warnWithHandler(err, 'adapter', '[GMH] structured emit failed');
      emitTranscriptLines(block, pushLine);
    }
    const parts = collector.list();
    const role = block?.getAttribute?.('data-gmh-message-role') || detectRole(block) || 'unknown';
    const ordinalAttr = Number(block?.getAttribute?.('data-gmh-message-ordinal'));
    const indexAttr = Number(block?.getAttribute?.('data-gmh-message-index'));
    const userOrdinalAttr = Number(block?.getAttribute?.('data-gmh-user-ordinal'));
    const channelAttr = block?.getAttribute?.('data-gmh-channel') || null;
    const idAttr =
      block?.getAttribute?.('data-gmh-message-id') ||
      block?.getAttribute?.('data-message-id') ||
      block?.getAttribute?.('data-id') ||
      null;
    const firstSpeakerPart = parts.find((part) => part?.speaker);
    const collectorPlayerName = collector?.defaults?.playerName ?? playerGuess;
    const speaker =
      firstSpeakerPart?.speaker ||
      (role === 'player'
        ? collectorPlayerName
        : role === 'narration'
        ? '내레이션'
        : role === 'npc'
        ? 'NPC'
        : null);
    const message: StructuredSnapshotMessage = {
      id: idAttr,
      index: Number.isFinite(indexAttr) ? indexAttr : null,
      ordinal: Number.isFinite(ordinalAttr) ? ordinalAttr : null,
      userOrdinal: Number.isFinite(userOrdinalAttr) ? userOrdinalAttr : null,
      role,
      channel:
        channelAttr || (role === 'player' ? 'user' : role === 'npc' ? 'llm' : 'system'),
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
    const results = new Set<string>();
    collectAll(selectors.playerNameHints).forEach((node) => {
      const text = node?.textContent?.trim();
      if (text) results.add(stripQuotes(text));
      const attrNames = ['data-username', 'data-user-name', 'data-display-name'];
      for (const attr of attrNames) {
        const val = node.getAttribute?.(attr);
        if (val) results.add(stripQuotes(val));
      }
    });
    collectAll(selectors.playerScopes).forEach((scope) => {
      const attrNames = ['data-username', 'data-user-name', 'data-author'];
      for (const attr of attrNames) {
        const val = scope.getAttribute?.(attr);
        if (val) results.add(stripQuotes(val));
      }
    });
    return Array.from(results)
      .map((name) => collapseSpaces(name || ''))
      .filter((name) => name && /^[\w가-힣][\w가-힣 _.-]{1,20}$/.test(name));
  };

  const getPanelAnchor = (doc: Document = document): Element | null => {
    const anchor = firstMatch(selectors.panelAnchor, doc);
    return anchor || doc.body;
  };

  const match = (loc: Location | AdapterMatchLocation): boolean => /genit\.ai/i.test(loc.hostname ?? '');

  const genitAdapter: GenitAdapter = {
    id: 'genit',
    label: 'Genit',
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
      infoNodeRegistry = new WeakSet();
    },
    setPlayerNameAccessor(fn) {
      if (typeof fn === 'function') {
        playerNameAccessor = fn;
      }
    },
  };

  return genitAdapter;
};

export default createGenitAdapter;
