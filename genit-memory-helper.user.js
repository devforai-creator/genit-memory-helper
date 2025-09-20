// ==UserScript==
// @name         Genit Memory Helper
// @namespace    local.dev
// @version      0.9
// @description  Genit 대화로그 JSON/TXT/MD 추출 + 요약/재요약 프롬프트 복사 기능
// @author       devforai-creator
// @match        https://genit.ai/*
// @match        https://www.genit.ai/*
// @grant        GM_setClipboard
// @run-at       document-idle
// @updateURL    https://github.com/devforai-creator/genit-memory-helper/raw/main/genit-memory-helper.user.js
// @downloadURL  https://github.com/devforai-creator/genit-memory-helper/raw/main/genit-memory-helper.user.js
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // -------------------------------
  // 0) Constants & utils
  // -------------------------------
  const PLAYER_MARK = '⟦PLAYER⟧ ';
  const HEADER_RE =
    /^(\d+월\s*\d+일.*?\d{1,2}:\d{2})\s*\|\s*([^|]+?)\s*\|\s*📍\s*([^|]+)\s*\|?(.*)$/;
  const CODE_RE = /^([A-J])\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/i;
  const META_KEYWORDS = ['지도', '등장', 'Actors', '배우', '기록코드', 'Codes', 'SCENE'];
  const PLAYER_NAME_FALLBACKS = ['플레이어', '소중한코알라5299'];

  function normNL(s) {
    return String(s ?? '').replace(/\r\n?|\u2028|\u2029/g, '\n');
  }

  function stripTicks(s) {
    return String(s ?? '').replace(/```+/g, '');
  }

  function collapseSpaces(s) {
    return String(s ?? '')
      .replace(/\s+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function stripQuotes(s) {
    return String(s ?? '')
      .replace(/^['"“”『「《【]+/, '')
      .replace(/['"“”』」》】]+$/, '')
      .trim();
  }

  function stripBrackets(v) {
    return String(v ?? '').replace(/^\[|\]$/g, '').trim();
  }

  function sanitizeText(s) {
    return collapseSpaces(normNL(s).replace(/[\t\v\f\u00a0\u200b]/g, ' '));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isScrollable(el) {
    if (!el) return false;
    if (el === document.body || el === document.documentElement) {
      const target = el === document.body ? document.documentElement : el;
      return target.scrollHeight > target.clientHeight + 4;
    }
    if (!(el instanceof Element)) return false;
    const cs = getComputedStyle(el);
    const oy = cs.overflowY;
    const scrollableStyle = oy === 'auto' || oy === 'scroll' || oy === 'overlay';
    return scrollableStyle && el.scrollHeight > el.clientHeight + 4;
  }

  function looksLikeName(raw) {
    const s = String(raw ?? '')
      .replace(/^[\-•\s]+/, '')
      .trim();
    if (!s) return false;
    if (/^(INFO|메시지 이미지)$/i.test(s)) return false;
    return /^[가-힣A-Za-z][\w가-힣 .,'’]{0,24}$/.test(s);
  }

  function looksNarrative(line) {
    const s = line.trim();
    if (!s) return false;
    if (/^[\[\(].*[\]\)]$/.test(s)) return true;
    if (/^(...|···|…)/.test(s)) return true;
    if (/^(당신|너는|그는|그녀는)\s/.test(s)) return true;
    if (/[.!?"']$/.test(s)) return true;
    if (/[가-힣]{2,}(은|는|이|가|을|를|으로|로|에게|에서|하며|면서|라고)\s/.test(s)) return true;
    if (s.includes(' ')) {
      const words = s.split(/\s+/);
      if (words.length >= 4) return true;
    }
    return false;
  }

  function isActorStatsLine(line) {
    return /\|/.test(line) && /❤️|💗|💦|🪣/.test(line);
  }

  function isMetaLine(line) {
    const stripped = stripBrackets(line);
    if (!stripped) return true;
    if (/^INFO$/i.test(stripped)) return true;
    if (isActorStatsLine(stripped)) return true;
    if (/^메시지 이미지$/i.test(stripped)) return true;
    if (CODE_RE.test(stripped.replace(/\s+/g, ''))) return true;
    for (const keyword of META_KEYWORDS) {
      if (stripped.startsWith(keyword)) return true;
    }
    if (/^[-=]{3,}$/.test(stripped)) return true;
    return false;
  }

  const DOM_ADAPTER = (() => {
    const selectors = {
      chatContainers: [
        '[data-testid="chat-scroll-region"]',
        '[data-testid="conversation-scroll"]',
        '[role="log"]',
        '[data-overlayscrollbars]',
        '.flex-1.min-h-0.overflow-y-auto',
        'main [class*="overflow-y"]',
      ],
      messageRoot: ['[data-message-id]', '[role="listitem"][data-id]', '[data-testid="message-wrapper"]'],
      infoCode: ['code.language-INFO', 'pre code.language-INFO'],
      playerScopes: [
        '[data-role="user"]',
        '[data-from-user="true"]',
        '[data-author-role="user"]',
        '.flex.w-full.justify-end',
        '.flex.flex-col.items-end',
      ],
      playerText: [
        '[data-role="user"] .markdown-content',
        '.markdown-content.text-right',
        '.p-4.rounded-xl.bg-background p',
      ],
      npcGroups: ['[data-role="assistant"]', '.flex.flex-col.w-full.group'],
      npcName: [
        '[data-author-name]',
        '[data-author]',
        '[data-username]',
        '.text-sm.text-muted-foreground.mb-1.ml-1',
      ],
      npcBubble: ['.p-4.rounded-xl.bg-background p', '.markdown-content:not(.text-right)'],
      narrationBlocks: ['.markdown-content.text-muted-foreground', '.text-muted-foreground.text-sm'],
      panelAnchor: ['[data-testid="app-root"]', '#__next', '#root', 'main'],
      playerNameHints: [
        '[data-role="user"] [data-username]',
        '[data-profile-name]',
        '[data-user-name]',
        '[data-testid="profile-name"]',
        'header [data-username]'
      ],
    };

    const playerScopeSelector = selectors.playerScopes.filter(Boolean).join(',');
    const npcScopeSelector = selectors.npcGroups.filter(Boolean).join(',');

    const collectAll = (selList, root = document) => {
      const out = [];
      const seen = new Set();
      if (!selList?.length) return out;
      for (const sel of selList) {
        if (!sel) continue;
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

    const textSegmentsFromNode = (node) => {
      if (!node) return [];
      const text = node.innerText ?? node.textContent ?? '';
      if (!text) return [];
      return text
        .split(/\r?\n+/)
        .map((seg) => seg.trim())
        .filter(Boolean);
    };

    const findScrollableAncestor = (node) => {
      let current = node instanceof Element ? node : null;
      for (let depth = 0; depth < 6 && current; depth += 1) {
        if (isScrollable(current)) return current;
        current = current.parentElement;
      }
      return null;
    };

    const getChatContainer = () => {
      const direct = firstMatch(selectors.chatContainers);
      if (direct && isScrollable(direct)) return direct;
      const block = firstMatch(selectors.messageRoot);
      if (block) {
        const scrollable = findScrollableAncestor(block.parentElement);
        if (scrollable) return scrollable;
      }
      return null;
    };

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

    const emitInfo = (block, pushLine) => {
      const infoNode = firstMatch(selectors.infoCode, block);
      if (!infoNode) return;
      pushLine('INFO');
      textSegmentsFromNode(infoNode).forEach((seg) => pushLine(seg));
    };

    const emitPlayerLines = (block, pushLine) => {
      const scopes = collectAll(selectors.playerScopes, block);
      if (!scopes.length) return;
      const textNodes = [];
      const nodeSeen = new Set();
      for (const scope of scopes) {
        collectAll(selectors.playerText, scope).forEach((node) => {
          if (!nodeSeen.has(node)) {
            nodeSeen.add(node);
            textNodes.push(node);
          }
        });
      }
      const targets = textNodes.length ? textNodes : scopes;
      const seenSegments = new Set();
      targets.forEach((node) => {
        textSegmentsFromNode(node).forEach((seg) => {
          if (!seg) return;
          if (seenSegments.has(seg)) return;
          seenSegments.add(seg);
          pushLine(PLAYER_MARK + seg);
        });
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

    const emitNpcLines = (block, pushLine) => {
      const groups = collectAll(selectors.npcGroups, block);
      if (!groups.length) return;
      groups.forEach((group) => {
        if (playerScopeSelector && group.closest(playerScopeSelector)) return;
        const nameRaw = extractNameFromGroup(group);
        const name = nameRaw || 'NPC';
        const bubbleNodes = collectAll(selectors.npcBubble, group);
        const targets = bubbleNodes.length ? bubbleNodes : [group];
        targets.forEach((node) => {
          textSegmentsFromNode(node).forEach((seg) => {
            if (!seg) return;
            pushLine(`@${name}@ "${seg}"`);
          });
        });
      });
    };

    const emitNarrationLines = (block, pushLine) => {
      const nodes = collectAll(selectors.narrationBlocks, block);
      if (!nodes.length) return;
      nodes.forEach((node) => {
        if (playerScopeSelector && node.closest(playerScopeSelector)) return;
        if (npcScopeSelector && node.closest(npcScopeSelector)) return;
        textSegmentsFromNode(node).forEach((seg) => {
          if (!seg) return;
          pushLine(seg);
        });
      });
    };

    const emitTranscriptLines = (block, pushLine) => {
      emitInfo(block, pushLine);
      emitPlayerLines(block, pushLine);
      emitNpcLines(block, pushLine);
      emitNarrationLines(block, pushLine);
    };

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

    const getPanelAnchor = () => {
      const anchor = firstMatch(selectors.panelAnchor);
      return anchor || document.body;
    };

    return {
      getChatContainer,
      getMessageBlocks,
      emitTranscriptLines,
      guessPlayerNames,
      getPanelAnchor,
    };
  })();

  function guessPlayerNamesFromDOM() {
    return DOM_ADAPTER.guessPlayerNames();
  }

  const PLAYER_NAMES = Array.from(
    new Set([...PLAYER_NAME_FALLBACKS, ...guessPlayerNamesFromDOM()].filter(Boolean))
  );

  const PLAYER_ALIASES = new Set(
    PLAYER_NAMES.map((n) => n.toLowerCase()).concat(['player', '플레이어', '유저', '나'])
  );

  function normalizeSpeakerName(name) {
    const stripped = collapseSpaces(name)
      .replace(/[\[\]{}()]+/g, '')
      .replace(/^[-•]+/, '')
      .trim();
    if (!stripped) return '내레이션';
    const lower = stripped.toLowerCase();
    if (PLAYER_ALIASES.has(lower)) return PLAYER_NAMES[0] || '플레이어';
    if (/^(system|시스템|내레이션|narration)$/i.test(lower)) return '내레이션';
    return stripped;
  }

  function roleForSpeaker(name) {
    if (name === '내레이션') return 'narration';
    if (PLAYER_NAMES.includes(name)) return 'player';
    return 'npc';
  }

  function normalizeTranscript(raw) {
    return stripTicks(normNL(raw)).replace(/[\t\u00a0\u200b]/g, ' ');
  }

  // -------------------------------
  // 1) Turns-first parser
  // -------------------------------
  function parseTurns(raw) {
    const lines = normalizeTranscript(raw).split('\n');
    const turns = [];
    const warnings = [];
    const metaHints = { header: null, codes: [], titles: [] };

    let currentSceneId = 1;
    let pendingSpeaker = null;

    const pushTurn = (speaker, text, roleOverride) => {
      const textClean = sanitizeText(text);
      if (!textClean) return;
      const speakerName = normalizeSpeakerName(speaker || '내레이션');
      const role = roleOverride || roleForSpeaker(speakerName);
      if (role === 'player' && turns.length) {
        currentSceneId += 1;
      }
      const last = turns[turns.length - 1];
      if (last && last.speaker === speakerName && last.role === role) {
        last.text = `${last.text} ${textClean}`.trim();
        return;
      }
      turns.push({
        speaker: speakerName,
        role,
        text: textClean,
        sceneId: currentSceneId,
      });
    };

    for (let i = 0; i < lines.length; i++) {
      let original = lines[i] ?? '';
      if (!original) continue;
      let line = original.trim();
      if (!line) continue;

      const headerMatch = HEADER_RE.exec(line);
      if (headerMatch) {
        if (!metaHints.header) metaHints.header = headerMatch;
        currentSceneId += 1;
        pendingSpeaker = null;
        continue;
      }

      if (/^#/.test(line) && line.length <= 80) {
        metaHints.titles.push(stripQuotes(line.replace(/^#+/, '').trim()));
        pendingSpeaker = null;
        continue;
      }

      if (CODE_RE.test(line.replace(/\s+/g, ''))) {
        metaHints.codes.push(line.trim());
        pendingSpeaker = null;
        continue;
      }

      if (stripBrackets(line).toUpperCase() === 'INFO') {
        currentSceneId += 1;
        pendingSpeaker = null;
        continue;
      }

      let forcedPlayer = false;
      if (line.startsWith(PLAYER_MARK)) {
        forcedPlayer = true;
        line = line.slice(PLAYER_MARK.length).trim();
      }
      if (!line) continue;

      if (isMetaLine(line)) {
        pendingSpeaker = null;
        continue;
      }

      let m = line.match(/^@([^@]{1,40})@\s*["“]?([\s\S]+?)["”]?\s*$/);
      if (m) {
        const speaker = normalizeSpeakerName(m[1]);
        pushTurn(speaker, m[2], roleForSpeaker(speaker));
        pendingSpeaker = speaker;
        continue;
      }

      if (forcedPlayer) {
        const speaker = PLAYER_NAMES[0] || '플레이어';
        pushTurn(speaker, stripQuotes(line), 'player');
        pendingSpeaker = speaker;
        continue;
      }

      m = line.match(/^([^:@—\-]{1,40})\s*[:\-—]\s*(.+)$/);
      if (m && looksLikeName(m[1])) {
        const speaker = normalizeSpeakerName(m[1]);
        pushTurn(speaker, stripQuotes(m[2]), roleForSpeaker(speaker));
        pendingSpeaker = speaker;
        continue;
      }

      if (looksNarrative(line) || /^".+"$/.test(line) || /^“.+”$/.test(line)) {
        pushTurn('내레이션', stripQuotes(line), 'narration');
        pendingSpeaker = null;
        continue;
      }

      if (looksLikeName(line)) {
        const speaker = normalizeSpeakerName(line);
        let textBuf = [];
        let j = i + 1;
        while (j < lines.length) {
          let peek = (lines[j] || '').trim();
          if (!peek) {
            j += 1;
            break;
          }
          let peekForced = false;
          if (peek.startsWith(PLAYER_MARK)) {
            peekForced = true;
            peek = peek.slice(PLAYER_MARK.length).trim();
          }
          if (!peek) {
            j += 1;
            continue;
          }
          if (HEADER_RE.test(peek) || stripBrackets(peek).toUpperCase() === 'INFO') break;
          if (isMetaLine(peek)) break;
          if (peekForced) break;
          if (looksLikeName(peek) || /^@[^@]+@/.test(peek)) break;
          textBuf.push(peek);
          j += 1;
          if (!/["”]$/.test(peek)) break;
        }
        if (textBuf.length) {
          pushTurn(speaker, stripQuotes(textBuf.join(' ')), roleForSpeaker(speaker));
          pendingSpeaker = speaker;
          i = j - 1;
          continue;
        }
        pendingSpeaker = speaker;
        continue;
      }

      if (pendingSpeaker) {
        pushTurn(pendingSpeaker, stripQuotes(line), roleForSpeaker(pendingSpeaker));
        continue;
      }

      if (line.length <= 30 && /[!?…]$/.test(line) && turns.length) {
        const last = turns[turns.length - 1];
        last.text = `${last.text} ${line}`.trim();
        continue;
      }

      pushTurn('내레이션', line, 'narration');
      pendingSpeaker = null;
    }

    return { turns, warnings, metaHints };
  }

  function deriveMeta(metaHints, turns) {
    const meta = {};
    if (metaHints.header) {
      const [, time, modeRaw, placeRaw] = metaHints.header;
      if (time) meta.date = time.trim();
      if (modeRaw) meta.mode = modeRaw.trim();
      if (placeRaw) meta.place = placeRaw.trim();
    }
    const title = metaHints.titles.find(Boolean);
    if (title) meta.title = title;

    const actorSet = new Set();
    for (const t of turns) {
      if (t.role === 'player' || t.role === 'npc') actorSet.add(t.speaker);
    }
    meta.actors = Array.from(actorSet);
    if (!meta.title && meta.place) meta.title = `${meta.place} 세션`;
    meta.player = PLAYER_NAMES[0] || '플레이어';
    meta.turn_count = turns.filter((t) => t.role === 'player').length;
    return meta;
  }

  function buildSession(raw) {
    const { turns, warnings, metaHints } = parseTurns(raw);
    const meta = deriveMeta(metaHints, turns);
    return {
      meta,
      turns,
      warnings,
      source: 'genit-memory-helper',
    };
  }

  // -------------------------------
  // 2) Writers (JSON / TXT / Markdown)
  // -------------------------------
  function toJSONExport(session, normalizedRaw) {
    const payload = {
      version: '1.0',
      generated_at: new Date().toISOString(),
      source: session.source,
      player_names: PLAYER_NAMES,
      meta: session.meta,
      turns: session.turns,
      warnings: session.warnings,
      raw_excerpt: (normalizedRaw || '').slice(0, 2000),
    };
    return JSON.stringify(payload, null, 2);
  }

  function toTXTExport(session, opts = {}) {
    const turns = opts.turns || session.turns;
    const includeMeta = opts.includeMeta !== false;
    const lines = [];
    if (includeMeta) {
      if (session.meta.title) lines.push(`# TITLE: ${session.meta.title}`);
      if (session.meta.date) lines.push(`# DATE: ${session.meta.date}`);
      if (session.meta.place) lines.push(`# PLACE: ${session.meta.place}`);
      if (session.meta.actors?.length) lines.push(`# ACTORS: ${session.meta.actors.join(', ')}`);
      lines.push('');
    }
    for (const t of turns) {
      const speaker = t.role === 'narration' ? '내레이션' : t.speaker;
      lines.push(`@${speaker}@ ${t.text}`);
    }
    return lines.join('\n').trim();
  }

  function toMarkdownExport(session, opts = {}) {
    const turns = opts.turns || session.turns;
    const heading = opts.heading || '# 대화 로그';
    const includeMeta = opts.includeMeta !== false;
    const lines = [heading];
    if (includeMeta) {
      const metaLines = [];
      if (session.meta.date) metaLines.push(`- 날짜: ${session.meta.date}`);
      if (session.meta.place) metaLines.push(`- 장소: ${session.meta.place}`);
      if (session.meta.mode) metaLines.push(`- 모드: ${session.meta.mode}`);
      if (session.meta.actors?.length)
        metaLines.push(`- 참여자: ${session.meta.actors.join(', ')}`);
      if (metaLines.length) {
        lines.push(metaLines.join('\n'));
        lines.push('');
      }
    } else {
      lines.push('');
    }
    for (const t of turns) {
      if (t.role === 'narration') {
        lines.push(`> **내레이션**: ${t.text}`);
      } else {
        lines.push(`- **${t.speaker}**: ${t.text}`);
      }
    }
    return lines.join('\n').trim();
  }

  function buildExportBundle(session, normalizedRaw, format) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `genit_turns_${stamp}`;
    if (format === 'md') {
      return {
        filename: `${base}.md`,
        mime: 'text/markdown',
        content: toMarkdownExport(session),
      };
    }
    if (format === 'txt') {
      return {
        filename: `${base}.txt`,
        mime: 'text/plain',
        content: toTXTExport(session),
      };
    }
    return {
      filename: `${base}.json`,
      mime: 'application/json',
      content: toJSONExport(session, normalizedRaw),
    };
  }

  // -------------------------------
  // 3) DOM Reader
  // -------------------------------
  function readTranscriptText() {
    const container = DOM_ADAPTER.getChatContainer();
    const blocks = DOM_ADAPTER.getMessageBlocks(container || document);
    if (!container && !blocks.length)
      throw new Error('채팅 컨테이너를 찾을 수 없습니다.');
    if (!blocks.length) return '';

    const seenLine = new Set();
    const out = [];

    const pushLine = (line) => {
      const s = (line || '').trim();
      if (!s) return;
      if (seenLine.has(s)) return;
      seenLine.add(s);
      out.push(s);
    };

    for (const block of blocks) {
      DOM_ADAPTER.emitTranscriptLines(block, pushLine);
    }

    return out.join('\n');
  }

  // -------------------------------
  // 3.5) Scroll auto loader & turn stats
  // -------------------------------
  const AUTO_CFG = {
    cycleDelayMs: 700,
    settleTimeoutMs: 2000,
    maxStableRounds: 3,
    guardLimit: 6,
  };

  const AUTO_STATE = {
    running: false,
    container: null,
    meterTimer: null,
  };

  function ensureScrollContainer() {
    const adapterContainer = DOM_ADAPTER.getChatContainer();
    if (adapterContainer) {
      if (isScrollable(adapterContainer)) return adapterContainer;
      if (adapterContainer instanceof Element) {
        let ancestor = adapterContainer.parentElement;
        for (let depth = 0; depth < 6 && ancestor; depth += 1) {
          if (isScrollable(ancestor)) return ancestor;
          ancestor = ancestor.parentElement;
        }
      }
      return adapterContainer;
    }
    const messageBlocks = DOM_ADAPTER.getMessageBlocks(document);
    if (messageBlocks.length) {
      let ancestor = messageBlocks[0]?.parentElement || null;
      for (let depth = 0; depth < 6 && ancestor; depth += 1) {
        if (isScrollable(ancestor)) return ancestor;
        ancestor = ancestor.parentElement;
      }
    }
    return document.scrollingElement || document.documentElement || document.body;
  }

  function waitForGrowth(el, startHeight, timeout = AUTO_CFG.settleTimeoutMs) {
    return new Promise((resolve) => {
      let finished = false;
      const obs = new MutationObserver(() => {
        if (el.scrollHeight > startHeight + 4) {
          finished = true;
          obs.disconnect();
          resolve(true);
        }
      });
      obs.observe(el, { childList: true, subtree: true });
      setTimeout(() => {
        if (!finished) {
          obs.disconnect();
          resolve(false);
        }
      }, timeout);
    });
  }

  async function scrollUpCycle(container) {
    if (!container) return { grew: false, before: 0, after: 0 };
    const before = container.scrollHeight;
    container.scrollTop = 0;
    const grew = await waitForGrowth(container, before);
    return { grew, before, after: container.scrollHeight };
  }

  function collectTurnStats() {
    try {
      const raw = readTranscriptText();
      const normalized = normalizeTranscript(raw);
      const session = buildSession(normalized);
      const playerTurns = session.turns.filter((t) => t.role === 'player').length;
      return {
        session,
        playerTurns,
        totalTurns: session.turns.length,
      };
    } catch (error) {
      return { session: null, playerTurns: 0, totalTurns: 0, error };
    }
  }

  async function autoLoadAll(setStatus) {
    const container = ensureScrollContainer();
    AUTO_STATE.running = true;
    AUTO_STATE.container = container;
    let stableRounds = 0;

    while (AUTO_STATE.running) {
      const { grew, before, after } = await scrollUpCycle(container);
      if (!AUTO_STATE.running) break;
      const delta = after - before;
      if (!grew || delta < 6) stableRounds += 1;
      else stableRounds = 0;
      if (stableRounds >= AUTO_CFG.maxStableRounds) break;
      await sleep(AUTO_CFG.cycleDelayMs);
    }

    AUTO_STATE.running = false;
    const stats = collectTurnStats();
    if (setStatus && !stats.error) {
      setStatus(`🔁 스크롤 완료. 플레이어 턴 ${stats.playerTurns}개 확보.`, '#a7f3d0');
    }
    if (stats.error && setStatus) setStatus('스크롤 후 파싱 실패', '#fecaca');
    return stats;
  }

  async function autoLoadUntilPlayerTurns(target, setStatus) {
    const container = ensureScrollContainer();
    AUTO_STATE.running = true;
    AUTO_STATE.container = container;
    let stableRounds = 0;
    let guard = 0;
    let prevPlayerTurns = -1;

    while (AUTO_STATE.running) {
      const stats = collectTurnStats();
      if (stats.error) {
        if (setStatus) setStatus('파싱 실패 - DOM 변화를 감지하지 못했습니다.', '#fecaca');
        break;
      }
      if (stats.playerTurns >= target) {
        if (setStatus)
          setStatus(`✅ 목표 달성: 플레이어 턴 ${stats.playerTurns}개 확보.`, '#c4b5fd');
        break;
      }

      if (setStatus)
        setStatus(
          `위로 불러오는 중... 현재 플레이어 턴 ${stats.playerTurns}/${target}.`,
          '#fef3c7'
        );

      const { grew, before, after } = await scrollUpCycle(container);
      if (!AUTO_STATE.running) break;
      const delta = after - before;
      if (!grew || delta < 6) stableRounds += 1;
      else stableRounds = 0;

      guard = stats.playerTurns === prevPlayerTurns ? guard + 1 : 0;
      prevPlayerTurns = stats.playerTurns;

      if (stableRounds >= AUTO_CFG.maxStableRounds || guard >= AUTO_CFG.guardLimit) {
        if (setStatus)
          setStatus('추가 데이터를 불러오지 못했습니다. 더 이상 기록이 없거나 막혀있습니다.', '#fca5a5');
        break;
      }
      await sleep(AUTO_CFG.cycleDelayMs);
    }

    AUTO_STATE.running = false;
    return collectTurnStats();
  }

  function stopAutoLoad() {
    if (!AUTO_STATE.running) return;
    AUTO_STATE.running = false;
  }

  function startTurnMeter(meter) {
    if (!meter) return;
    const render = () => {
      const stats = collectTurnStats();
      if (stats.error) {
        meter.textContent = '턴 측정 실패: DOM을 읽을 수 없습니다.';
        return;
      }
      meter.textContent = `턴 현황 · 플레이어 ${stats.playerTurns}턴`;
    };
    render();
    if (AUTO_STATE.meterTimer) return;
    AUTO_STATE.meterTimer = window.setInterval(() => {
      if (!meter.isConnected) {
        clearInterval(AUTO_STATE.meterTimer);
        AUTO_STATE.meterTimer = null;
        return;
      }
      render();
    }, 1500);
  }

  function ensureAutoLoadControls(panel, setStatus) {
    if (!panel || panel.querySelector('#gmh-autoload-controls')) return;

    const wrap = document.createElement('div');
    wrap.id = 'gmh-autoload-controls';
    wrap.style.cssText = 'display:grid; gap:6px; border-top:1px solid #1f2937; padding-top:6px;';
    wrap.innerHTML = `
      <div style="display:flex; gap:8px;">
        <button id="gmh-autoload-all" style="flex:1; background:#38bdf8; border:0; color:#041; border-radius:8px; padding:6px; cursor:pointer;">위로 끝까지 로딩</button>
        <button id="gmh-autoload-stop" style="width:88px; background:#ef4444; border:0; color:#fff; border-radius:8px; padding:6px; cursor:pointer;">정지</button>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <input id="gmh-autoload-turns" type="number" min="1" step="1" placeholder="최근 플레이어 턴 N" style="flex:1; background:#111827; color:#f1f5f9; border:1px solid #1f2937; border-radius:8px; padding:6px;" />
        <button id="gmh-autoload-turns-btn" style="width:96px; background:#34d399; border:0; color:#041; border-radius:8px; padding:6px; cursor:pointer;">턴 확보</button>
      </div>
      <div id="gmh-turn-meter" style="opacity:.7; font-size:11px;"></div>
    `;

    panel.appendChild(wrap);

    const btnAll = wrap.querySelector('#gmh-autoload-all');
    const btnStop = wrap.querySelector('#gmh-autoload-stop');
    const btnTurns = wrap.querySelector('#gmh-autoload-turns-btn');
    const inputTurns = wrap.querySelector('#gmh-autoload-turns');
    const meter = wrap.querySelector('#gmh-turn-meter');

    const toggleControls = (disabled) => {
      btnAll.disabled = disabled;
      btnTurns.disabled = disabled;
      if (disabled) {
        btnAll.style.opacity = '0.6';
        btnTurns.style.opacity = '0.6';
      } else {
        btnAll.style.opacity = '1';
        btnTurns.style.opacity = '1';
      }
    };

    btnAll.onclick = async () => {
      if (AUTO_STATE.running) return;
      toggleControls(true);
      setStatus('🔁 위로 불러오는 중...', '#fef3c7');
      try {
        await autoLoadAll(setStatus);
      } finally {
        toggleControls(false);
      }
    };

    btnTurns.onclick = async () => {
      if (AUTO_STATE.running) return;
      const rawVal = inputTurns?.value?.trim();
      const target = Number.parseInt(rawVal || '0', 10);
      if (!Number.isFinite(target) || target <= 0) {
        setStatus('플레이어 턴 수를 입력해주세요.', '#fecaca');
        return;
      }
      toggleControls(true);
      try {
        const stats = await autoLoadUntilPlayerTurns(target, setStatus);
        if (!stats.error) {
          setStatus(`현재 플레이어 턴 ${stats.playerTurns}개 확보.`, '#a7f3d0');
        }
      } finally {
        toggleControls(false);
      }
    };

    btnStop.onclick = () => {
      if (!AUTO_STATE.running) {
        setStatus('자동 로딩이 실행 중이 아닙니다.', '#9ca3af');
        return;
      }
      stopAutoLoad();
      setStatus('⏹️ 자동 로딩 중지를 요청했습니다.', '#fca5a5');
    };

    startTurnMeter(meter);
  }

  // -------------------------------
  // 4) UI Panel
  // -------------------------------
  function mountPanel() {
    if (document.querySelector('#genit-memory-helper-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'genit-memory-helper-panel';
    panel.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 999999;
      background: #0b1020; color: #fff; padding: 10px 12px; border-radius: 10px;
      font: 12px/1.3 ui-sans-serif, system-ui; box-shadow: 0 8px 20px rgba(0,0,0,.4);
      display: grid; gap: 8px; min-width: 260px;
    `;
    panel.innerHTML = `
      <div style="font-weight:600">Genit Memory Helper</div>
      <div style="display:flex; gap:8px;">
        <button id="gmh-copy-recent" style="flex:1; background:#22c55e; border:0; color:#051; border-radius:8px; padding:8px; cursor:pointer;">최근 15턴 복사</button>
        <button id="gmh-copy-all" style="flex:1; background:#60a5fa; border:0; color:#031; border-radius:8px; padding:8px; cursor:pointer;">전체 MD 복사</button>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <select id="gmh-export-format" style="flex:1; background:#111827; color:#f1f5f9; border:1px solid #1f2937; border-radius:8px; padding:8px;">
          <option value="json">JSON (.json)</option>
          <option value="txt">TXT (.txt)</option>
          <option value="md">Markdown (.md)</option>
        </select>
        <button id="gmh-export" style="flex:1; background:#2dd4bf; border:0; color:#052; border-radius:8px; padding:8px; cursor:pointer;">내보내기</button>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="gmh-reparse" style="flex:1; background:#f59e0b; border:0; color:#210; border-radius:8px; padding:8px; cursor:pointer;">재파싱</button>
        <button id="gmh-guide" style="flex:1; background:#a78bfa; border:0; color:#210; border-radius:8px; padding:8px; cursor:pointer;">요약 가이드</button>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="gmh-reguide" style="flex:1; background:#fbbf24; border:0; color:#210; border-radius:8px; padding:8px; cursor:pointer;">재요약 가이드</button>
      </div>
      <div id="gmh-status" style="opacity:.85"></div>
    `;
    const anchor = DOM_ADAPTER.getPanelAnchor() || document.body;
    anchor.appendChild(panel);

    const statusEl = panel.querySelector('#gmh-status');
    const setStatus = (msg, color = '#9ca3af') => {
      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.style.color = color;
      }
    };

    ensureAutoLoadControls(panel, setStatus);

    const parseAll = () => {
      const raw = readTranscriptText();
      const normalized = normalizeTranscript(raw);
      const session = buildSession(normalized);
      if (!session.turns.length) throw new Error('대화 턴을 찾을 수 없습니다.');
      return { session, raw: normalized };
    };

    panel.querySelector('#gmh-copy-recent').onclick = () => {
      try {
        const { session } = parseAll();
        const turns = session.turns.slice(-15);
        const md = toMarkdownExport(session, {
          turns,
          includeMeta: false,
          heading: '## 최근 15턴',
        });
        GM_setClipboard(md, { type: 'text', mimetype: 'text/plain' });
        const turnsTotal = session.meta.turn_count;
        setStatus(`최근 15턴 복사 완료. 플레이어 턴 ${turnsTotal}개.`, '#a7f3d0');
        if (session.warnings.length) console.warn('[GMH] warnings:', session.warnings);
      } catch (e) {
        alert(`오류: ${(e && e.message) || e}`);
        setStatus('복사 실패', '#fecaca');
      }
    };

    panel.querySelector('#gmh-copy-all').onclick = () => {
      try {
        const { session } = parseAll();
        const md = toMarkdownExport(session);
        GM_setClipboard(md, { type: 'text', mimetype: 'text/plain' });
        const turnsTotal = session.meta.turn_count;
        setStatus(`전체 Markdown 복사 완료. 플레이어 턴 ${turnsTotal}개.`, '#bfdbfe');
        if (session.warnings.length) console.warn('[GMH] warnings:', session.warnings);
      } catch (e) {
        alert(`오류: ${(e && e.message) || e}`);
        setStatus('복사 실패', '#fecaca');
      }
    };

    panel.querySelector('#gmh-export').onclick = () => {
      try {
        const { session, raw } = parseAll();
        const select = panel.querySelector('#gmh-export-format');
        const format = select?.value || 'json';
        const bundle = buildExportBundle(session, raw, format);
        const blob = new Blob([bundle.content], { type: bundle.mime });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = bundle.filename;
        a.click();
        URL.revokeObjectURL(a.href);
        const turnsTotal = session.meta.turn_count;
        setStatus(
          `${format.toUpperCase()} 내보내기 완료. 플레이어 턴 ${turnsTotal}개.`,
          '#d1fae5'
        );
        if (session.warnings.length) console.warn('[GMH] warnings:', session.warnings);
      } catch (e) {
        alert(`오류: ${(e && e.message) || e}`);
        setStatus('내보내기 실패', '#fecaca');
      }
    };

    panel.querySelector('#gmh-reparse').onclick = () => {
      try {
        const { session } = parseAll();
        const turnsTotal = session.meta.turn_count;
        setStatus(
          `재파싱 완료: 플레이어 턴 ${turnsTotal}개. 경고 ${session.warnings.length}건.`,
          '#fde68a'
        );
        if (session.warnings.length) console.warn('[GMH] warnings:', session.warnings);
      } catch (e) {
        alert(`오류: ${(e && e.message) || e}`);
        setStatus('재파싱 실패', '#fecaca');
      }
    };

    panel.querySelector('#gmh-guide').onclick = () => {
      const prompt = `
당신은 "장기기억 보관용 사서"입니다.
아래 파일은 캐릭터 채팅 로그를 정형화한 것입니다.
목표는 이 데이터를 2000자 이내로 요약하여, 캐릭터 플랫폼의 "유저노트"에 넣을 수 있는 형식으로 정리하는 것입니다.

조건:
1. 중요도 기준
   - 플레이어와 NPC 관계 변화, 약속, 목표, 갈등, 선호/금기만 포함.
   - 사소한 농담·잡담은 제외.
   - 최근일수록 더 비중 있게 반영.

2. 출력 구조
   - [전체 줄거리 요약]: 주요 사건 흐름을 3~6개 항목으로.
   - [주요 관계 변화]: NPC별 감정/태도 변화를 정리.
   - [핵심 테마]: 반복된 규칙, 세계관 요소, 목표.

3. 형식 규칙
   - 전체 길이는 1200~1800자.
   - 문장은 간결하게.
   - 플레이어 이름은 "플레이어"로 통일.
`;
      GM_setClipboard(prompt, { type: 'text', mimetype: 'text/plain' });
      setStatus('✅ 요약 프롬프트가 클립보드에 복사되었습니다.', '#c4b5fd');
    };

    panel.querySelector('#gmh-reguide').onclick = () => {
      const prompt = `
아래에는 [이전 요약본]과 [새 로그 파일]이 있습니다.
이 둘을 통합하여, 2000자 이내의 "최신 장기기억 요약본"을 만드세요.

규칙:
- 이전 요약본에서 이미 있는 사실은 유지하되, 새 로그 파일에 나온 사건/관계 변화로 업데이트.
- 모순되면 "최근 사건"을 우선.
- 출력 구조는 [전체 줄거리 요약] / [주요 관계 변화] / [핵심 테마].
- 길이는 1200~1800자.
`;
      GM_setClipboard(prompt, { type: 'text', mimetype: 'text/plain' });
      setStatus('✅ 재요약 프롬프트가 클립보드에 복사되었습니다.', '#fcd34d');
    };
  }

  // -------------------------------
  // 5) Boot
  // -------------------------------
  function boot() {
    try {
      mountPanel();
    } catch (e) {
      console.error('[GMH] mount error', e);
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 1200);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1200));
  }

  let moScheduled = false;
  const mo = new MutationObserver(() => {
    if (moScheduled) return;
    moScheduled = true;
    requestAnimationFrame(() => {
      moScheduled = false;
      if (!document.querySelector('#genit-memory-helper-panel')) boot();
    });
  });
  mo.observe(document.documentElement, { subtree: true, childList: true });
})();
