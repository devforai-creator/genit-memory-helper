import { adapterRegistry, getAdapterConfig } from './registry.js';
import { clone } from '../core/utils.ts';
import {
  normNL,
  stripTicks,
  collapseSpaces,
  stripQuotes,
  stripBrackets,
  sanitizeText,
  parseListInput,
} from '../utils/text.ts';
import { isScrollable } from '../utils/dom.ts';
import { looksLikeName } from '../utils/validation.ts';

/**
 * @typedef {import('../types').AdapterConfig} AdapterConfig
 * @typedef {import('../types').AdapterRegistry} AdapterRegistry
 * @typedef {import('../types').AdapterSelectors} AdapterSelectors
 * @typedef {import('../types').GenitAdapter} GenitAdapter
 * @typedef {import('../types').GenitAdapterOptions} GenitAdapterOptions
 * @typedef {import('../types').StructuredSnapshotMessage} StructuredSnapshotMessage
 * @typedef {import('../types').StructuredSnapshotMessagePart} StructuredSnapshotMessagePart
 * @typedef {import('../types').StructuredCollector} StructuredCollector
 * @typedef {import('../types').StructuredCollectorMeta} StructuredCollectorMeta
 * @typedef {import('../types').ErrorHandler} ErrorHandler
 */

/** @typedef {string[] | null | undefined} SelectorList */
/** @typedef {{ role?: string; content?: string }} AdapterReactMessage */
/** @typedef {'player' | 'npc' | 'narration' | 'unknown'} GenitRole */

const DEFAULT_PLAYER_MARK = '⟦PLAYER⟧ ';

/**
 * Builds the primary adapter used to interpret genit.ai DOM transcripts.
 * @param {GenitAdapterOptions} [options] - Optional adapter overrides.
 * @returns {GenitAdapter}
 */
export const createGenitAdapter = ({
  registry = adapterRegistry,
  playerMark = DEFAULT_PLAYER_MARK,
  getPlayerNames = () => [],
  isPrologueBlock = () => false,
  errorHandler,
} = {}) => {
  /** @type {WeakSet<Node>} */
  let infoNodeRegistry = new WeakSet();
  /** @type {() => string[]} */
  let playerNameAccessor = typeof getPlayerNames === 'function' ? getPlayerNames : () => [];

  /**
   * Emits adapter warnings through the shared error handler.
   * @param {unknown} err - Error or payload to log.
   * @param {string} context - Context label for the error handler.
   * @param {string} fallbackMessage - Console message when no handler exists.
   */
  const warnWithHandler = (err, context, fallbackMessage) => {
    if (errorHandler?.handle) {
      const level = errorHandler.LEVELS?.WARN || 'warn';
      errorHandler.handle(err, context, level);
    } else if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(fallbackMessage, err);
    }
  };

  /**
   * Resolves player names from the injected accessor.
   * @returns {string[]}
   */
  const resolvePlayerNames = () => {
    const names = playerNameAccessor();
    return Array.isArray(names) ? names : [];
  };

  /**
   * Retrieves the primary (first) player name.
   * @returns {string}
   */
  const primaryPlayerName = () => resolvePlayerNames()[0] || '플레이어';

  /** @type {(name: string) => AdapterConfig} */
  const registryGet = registry?.get ? registry.get.bind(registry) : getAdapterConfig;
  const adapterConfig = registryGet('genit');
  /** @type {AdapterSelectors} */
  const selectors = adapterConfig.selectors || {};

  const playerScopeSelector = (selectors.playerScopes || []).filter(Boolean).join(',');
  const npcScopeSelector = (selectors.npcGroups || []).filter(Boolean).join(',');
  const isPrologueBlockFn = typeof isPrologueBlock === 'function' ? isPrologueBlock : () => false;

  /**
   * Collects DOM nodes that match any selector in the provided list.
   * @param {SelectorList} selList - Selector tokens from adapter config.
   * @param {Document | Element} [root=document] - Search root.
   * @returns {Element[]}
   */
  const collectAll = (selList, root = document) => {
    const out = [];
    const seen = new Set();
    if (!selList?.length) return out;
    for (const sel of selList) {
      if (!sel) continue;
      if (root instanceof Element && root.matches(sel) && !seen.has(root)) {
        seen.add(root);
        out.push(root);
      }
      let nodes;
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

  /**
   * Finds the first DOM node matching the provided selectors.
   * @param {SelectorList} selList - Selector tokens.
   * @param {Document | Element} [root=document] - Search root.
   * @returns {Element | null}
   */
  const firstMatch = (selList, root = document) => {
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

  /**
   * Checks if a node matches at least one selector.
   * @param {Element | null} node - Target element.
   * @param {SelectorList} selList - Selector tokens.
   * @returns {boolean}
   */
  const matchesSelectorList = (node, selList) => {
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

  /**
   * Resolves the nearest ancestor matching one of the selectors.
   * @param {Element | null} node - Starting element.
   * @param {SelectorList} selList - Selector tokens.
   * @returns {Element | null}
   */
  const closestMatchInList = (node, selList) => {
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

  /**
   * Determines whether the root contains any match for provided selectors.
   * @param {Element | null} root - Root element.
   * @param {SelectorList} selList - Selector tokens.
   * @returns {boolean}
   */
  const containsSelector = (root, selList) => {
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

  /**
   * Normalizes a node's textual content into trimmed segments.
   * @param {Element | Node | null} node - DOM node to normalize.
   * @returns {string[]}
   */
  const textSegmentsFromNode = (node) => {
    if (!node) return [];
    const text = node.innerText ?? node.textContent ?? '';
    if (!text) return [];
    return text
      .split(/\r?\n+/)
      .map((seg) => seg.trim())
      .filter(Boolean);
  };

  /**
   * Locates the first scrollable ancestor near the provided node.
   * @param {Element | null | undefined} node - Starting element.
   * @returns {Element | null}
   */
  const findScrollableAncestor = (node) => {
    let current = node instanceof Element ? node : null;
    for (let depth = 0; depth < 6 && current; depth += 1) {
      if (isScrollable(current)) return current;
      current = current.parentElement;
    }
    return null;
  };

  /**
   * Attempts to locate a chat container using ARIA role attributes.
   * @param {Document | Element} [root=document] - Search root.
   * @returns {Element | null}
   */
  const findByRole = (root = document) => {
    const roleNodes = collectAll(['[role]'], root);
    return roleNodes.find((node) => {
      const role = node.getAttribute('role') || '';
      return /log|list|main|region/i.test(role) && isScrollable(node);
    });
  };

  /**
   * Finds containers whose text content hints at a chat transcript.
   * @param {Document | Element} [root=document] - Root to search.
   * @returns {Element | null}
   */
  const findByTextHint = (root = document) => {
    const hints = selectors.textHints || [];
    if (!hints.length) return null;
    const nodes = collectAll(['main', 'section', 'article'], root).filter((node) => {
      if (!node || node.childElementCount < 3) return false;
      const text = (node.textContent || '').trim();
      if (!text || text.length > 400) return false;
      return hints.some((hint) => text.includes(hint));
    });
    return nodes.find((node) => isScrollable(node));
  };

  /**
   * Returns the primary scrollable chat container element.
   * @param {Document} [doc=document] - Document context.
   * @returns {Element | null}
   */
  const getChatContainer = (doc = document) => {
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

  /**
   * Collects message block elements from the specified container.
   * @param {Document | Element | null | undefined} root - Root node to search.
   * @returns {Element[]}
   */
  const getMessageBlocks = (root) => {
    const targetRoot = root || document;
    const blocks = collectAll(selectors.messageRoot, targetRoot);
    if (blocks.length) return blocks;
    if (targetRoot !== document) {
      const fallback = collectAll(selectors.messageRoot, document);
      if (fallback.length) return fallback;
    }
    return [];
  };

  /**
   * Extracts React message props from a DOM element via Fiber traversal.
   * @param {Element} block - The message block element.
   * @returns {AdapterReactMessage | null} Message object with role/content metadata.
   */
  const getReactMessage = (block) => {
    if (!block || typeof block !== 'object') return null;

    // Try common React Fiber property patterns
    // Use getOwnPropertyNames to catch non-enumerable properties (React Fiber is enumerable: false)
    try {
      const allKeys = Object.getOwnPropertyNames(block);
      const fiberKeys = allKeys.filter(k => k.startsWith('__reactFiber'));
      if (!fiberKeys.length) return null;

      let fiber = block[fiberKeys[0]];
      // Traverse up to 10 levels to find message props
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

  /**
   * Determines the conversational role for the supplied block node.
   * @param {Element | null | undefined} block - Message container under test.
   * @returns {GenitRole}
   */
  const detectRole = (block) => {
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
  const resolvePartType = (node) => {
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

  /**
   * Attempts to infer the programming language from code block metadata.
   * @param {Element | null} node - Code element.
   * @returns {string | null}
   */
  const detectCodeLanguage = (node) => {
    if (!(node instanceof Element)) return null;
    const target =
      node.matches?.('code') && !node.matches('pre code') ? node : node.querySelector?.('code');
    const classList = (target || node).classList || [];
    for (const cls of classList) {
      if (cls.startsWith('language-')) return cls.slice('language-'.length) || null;
    }
    const dataLang = target?.getAttribute?.('data-language') || node.getAttribute?.('data-language');
    if (dataLang) return dataLang;
    return null;
  };

  /**
   * Converts a DOM node into a structured snapshot message part summary.
   * @param {Element | Node | null} node - DOM segment to normalize.
   * @param {Record<string, unknown>} [context={}] - Rendering context.
   * @param {{
   *   type?: string;
   *   flavor?: string;
   *   role?: string;
   *   speaker?: string;
   *   lines?: string[];
   *   legacyLines?: string[];
   *   legacyFormat?: string;
   * }} [options={}] - Overrides for the generated part.
   * @returns {StructuredSnapshotMessagePart}
   */
  const buildStructuredPart = (node, context = {}, options = {}) => {
    const baseLines = Array.isArray(options.lines) ? options.lines.slice() : [];
    const partType = options.type || resolvePartType(node);
    const part = {
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
      const codeNode =
        node instanceof Element && node.matches('pre') ? node.querySelector('code') || node : node;
      const raw = (codeNode?.textContent ?? node?.textContent ?? '').replace(/\r\n/g, '\n');
      part.text = raw;
      part.language = detectCodeLanguage(codeNode || node);
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
    } else if (partType === 'image') {
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

  /**
   * Produces a positional path array for a node for ordering heuristics.
   * @param {Node | null} node - Target node.
   * @param {Node | null} root - Root boundary for traversal.
   * @returns {number[] | null}
   */
  const getOrderPath = (node, root) => {
    if (!(node instanceof Node) || !(root instanceof Node)) return null;
    const path = [];
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
  const compareOrderPaths = (a, b) => {
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
  const createStructuredCollector = (defaults = {}, context = {}) => {
    const parts = [];
    const snapshotDefaults = {
      playerName: defaults.playerName || '플레이어',
    };
    const infoLineSet = new Set();
    const normalizeLine = (line) => (typeof line === 'string' ? line.trim() : '');
    const filterInfoLines = (lines = []) =>
      lines
        .map((line) => normalizeLine(line))
        .filter((line) => line.length)
        .filter((line) => !infoLineSet.has(line));
    const rootNode = context?.rootNode instanceof Node ? context.rootNode : null;
    let fallbackCounter = 0;
    return {
      push(part, meta = {}) {
        if (!part) return;
        const next = { ...part };
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
  const markInfoNodeTree = (node) => {
    if (!node) return;
    try {
      const markSubtree = (element) => {
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
  const isInfoRelatedNode = (node) => {
    if (!node) return false;
    if (infoNodeRegistry.has(node)) return true;
    if (closestMatchInList(node, selectors.infoCode)) return true;
    return false;
  };

  /**
   * Emits special INFO lines from the current block.
   * @param {Element} block - Message block wrapper.
   * @param {(line: string) => void} pushLine - Accumulator for transcript text.
   * @param {StructuredCollector | null} [collector=null] - Structured collector sink.
   */
  const emitInfo = (block, pushLine, collector = null) => {
    const infoNode = firstMatch(selectors.infoCode, block);
    if (!infoNode) return;

    const infoLinesOut = [];
    const infoSeen = new Set();

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
        infoNode instanceof Element
          ? infoNode.closest('.bg-card, .info-card, .info-block') ||
            infoNode.closest('pre') ||
            infoNode
          : infoNode.parentElement || block;
      collector.push({
        type: 'info',
        flavor: 'meta',
        role: 'system',
        speaker: 'INFO',
        lines: infoLinesOut,
        legacyLines: ['INFO', ...infoLinesOut],
        legacyFormat: 'meta',
      }, { node: infoCardWrapper });
    }
  };

  /**
   * Emits transcript and structured parts for detected player turns.
   * @param {Element} block - Message block wrapper.
   * @param {(line: string) => void} pushLine - Transcript accumulator callback.
   * @param {StructuredCollector | null} [collector=null] - Structured collector sink.
   */
  const emitPlayerLines = (block, pushLine, collector = null) => {
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
    const textNodes = [];
    const nodeSeen = new Set();
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
    const seenSegments = new Set();
    effectiveTargets.forEach((node) => {
      if (isInfoRelatedNode(node)) return;
      const partLines = [];
      textSegmentsFromNode(node).forEach((seg) => {
        if (!seg) return;
        if (seenSegments.has(seg)) return;
        seenSegments.add(seg);
        pushLine(playerMark + seg);
        partLines.push(seg);
      });
      if (collector && partLines.length) {
        const playerName = collector.defaults?.playerName || '플레이어';
        const part = buildStructuredPart(node, {
          flavor: 'speech',
          role: 'player',
          speaker: playerName,
          legacyFormat: 'player',
        }, {
          lines: partLines,
          legacyFormat: 'player',
        });
        collector.push(part, { node });
      }
    });
  };

  const extractNameFromGroup = (group) => {
    const nameNode = firstMatch(selectors.npcName, group);
    let name = nameNode?.getAttribute?.('data-author-name') || nameNode?.textContent;
    if (!name) {
      name =
        group.getAttribute('data-author') ||
        group.getAttribute('data-username') ||
        group.getAttribute('data-name');
    }
    return stripQuotes(collapseSpaces(name || '')).slice(0, 40);
  };

  /**
   * Emits transcript lines for NPC/dialogue bubbles.
   * @param {Element} block - Message block wrapper.
   * @param {(line: string) => void} pushLine - Transcript accumulator callback.
   * @param {StructuredCollector | null} [collector=null] - Structured collector sink.
   */
  const emitNpcLines = (block, pushLine, collector = null) => {
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
        const partLines = [];
        textSegmentsFromNode(node).forEach((seg) => {
          if (!seg) return;
          if (seg && seg === name) return;
          pushLine(`@${name}@ "${seg}"`);
          partLines.push(seg);
        });
        if (collector && partLines.length) {
          const part = buildStructuredPart(node, {
            flavor: 'speech',
            role: 'npc',
            speaker: name,
            legacyFormat: 'npc',
          }, {
            lines: partLines,
            legacyFormat: 'npc',
          });
          collector.push(part, { node });
        }
      });
    });
  };

  /**
   * Emits narration/description transcript lines from a block.
   * @param {Element} block - Message block wrapper.
   * @param {(line: string) => void} pushLine - Transcript accumulator callback.
   * @param {StructuredCollector | null} [collector=null] - Structured collector sink.
   */
  const emitNarrationLines = (block, pushLine, collector = null) => {
    const blockRole = block?.getAttribute?.('data-gmh-message-role') || detectRole(block);

    if (blockRole === 'player') {
      return;
    }

    const targets = [];
    const seenNodes = new Set();
    const queueNode = (node, loose = false) => {
      if (!node || seenNodes.has(node)) return;
      seenNodes.add(node);
      targets.push({ node, loose });
    };

    const collected = collectAll(selectors.narrationBlocks, block);
    collected.forEach((node, i) => {
      queueNode(node, false);
    });

    const playerNames = resolvePlayerNames();
    const knownLabels = new Set(
      [collector?.defaults?.playerName]
        .concat(playerNames)
        .filter(Boolean)
        .map((name) => name.trim()),
    );
    const shouldSkipNarrationLine = (text, element) => {
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
      const nodePreview = node.textContent?.substring(0, 30);

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
        const partLines = [];
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
        const part = buildStructuredPart(node, {
          flavor: 'narration',
          role: 'narration',
          speaker: '내레이션',
          legacyFormat: 'plain',
        }, {
          lines: partLines,
          legacyFormat: 'plain',
        });
        collector.push(part, { node });
      }
    });
  };

  /**
   * Emits all transcript flavors (info, player, npc, narration) for a block.
   * @param {Element} block - Message block wrapper.
   * @param {(line: string) => void} pushLine - Transcript accumulator callback.
   * @param {StructuredCollector | null} [collector=null] - Structured collector sink.
   */
  const emitTranscriptLines = (block, pushLine, collector = null) => {
    emitInfo(block, pushLine, collector);
    emitPlayerLines(block, pushLine, collector);
    emitNpcLines(block, pushLine, collector);
    emitNarrationLines(block, pushLine, collector);
  };

  /**
   * Generates a structured snapshot entry for a message block.
   * @param {Element} block - Message block wrapper.
   * @returns {StructuredSnapshotMessage | null}
   */
  const collectStructuredMessage = (block) => {
    if (!block) return null;
    const playerGuess = guessPlayerNames()[0] || '플레이어';
    /** @type {StructuredCollector} */
    const collector = createStructuredCollector({ playerName: playerGuess }, { rootNode: block });
    /** @type {string[]} */
    const localLines = [];
    /**
     * Adds a normalized transcript line to the local cache.
     * @param {string} line
     */
    const pushLine = (line) => {
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
    const speaker =
      firstSpeakerPart?.speaker ||
      (role === 'player'
        ? collector.defaults.playerName
        : role === 'narration'
        ? '내레이션'
        : role === 'npc'
        ? 'NPC'
        : null);
    /** @type {StructuredSnapshotMessage} */
    const message = {
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

  /**
   * Attempts to detect player display names from DOM hints.
   * @returns {string[]}
   */
  const guessPlayerNames = () => {
    const results = new Set();
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

  /**
   * Resolves the anchor element used to mount the GMH panel.
   * @param {Document} [doc=document] - Document context.
   * @returns {Element | null}
   */
  const getPanelAnchor = (doc = document) => {
    const anchor = firstMatch(selectors.panelAnchor, doc);
    return anchor || doc.body;
  };

  /**
   * Tests whether the adapter applies to the provided location.
   * @param {Location | import('../types').AdapterMatchLocation} loc - Page location metadata.
   * @returns {boolean}
   */
  const match = (loc) => /genit\.ai/i.test(loc.hostname);

  /** @type {GenitAdapter} */
  const genitAdapter = {
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
