import {
  normNL,
  stripTicks,
  collapseSpaces,
  stripQuotes,
  stripBrackets,
  sanitizeText,
} from '../utils/text.js';
import { looksLikeName } from '../utils/validation.js';

export const PLAYER_NAME_FALLBACKS = ['플레이어', '소중한코알라5299'];
export const PLAYER_MARK = '⟦PLAYER⟧ ';
const HEADER_RE =
  /^(\d+월\s*\d+일.*?\d{1,2}:\d{2})\s*\|\s*([^|]+?)\s*\|\s*📍\s*([^|]+)\s*\|?(.*)$/;
const CODE_RE = /^([A-J])\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/i;
const META_KEYWORDS = ['지도', '등장', 'Actors', '배우', '기록코드', 'Codes', 'SCENE'];
const SYSTEM_ALIASES = ['player', '플레이어', '유저', '나'];

const buildAliasSet = (names) => new Set(names.map((n) => n.toLowerCase()).concat(SYSTEM_ALIASES));

let playerNames = [...PLAYER_NAME_FALLBACKS];
let playerAliases = buildAliasSet(playerNames);
let entryOriginProvider = () => [];

export const setPlayerNames = (names = []) => {
  const next = Array.from(
    new Set(
      [...PLAYER_NAME_FALLBACKS, ...names]
        .map((name) => (typeof name === 'string' ? name.trim() : ''))
        .filter(Boolean),
    ),
  );
  playerNames = next.length ? next : [...PLAYER_NAME_FALLBACKS];
  playerAliases = buildAliasSet(playerNames);
};

export const getPlayerNames = () => playerNames.slice();

export const setEntryOriginProvider = (provider) => {
  entryOriginProvider = typeof provider === 'function' ? provider : () => [];
};

const getEntryOrigin = () => {
  const origin = entryOriginProvider();
  return Array.isArray(origin) ? origin.slice() : [];
};

const primaryPlayerName = () => getPlayerNames()[0] || PLAYER_NAME_FALLBACKS[0];

const normalizeSpeakerName = (name) => {
  const stripped = collapseSpaces(String(name || '')).replace(/[\[\]{}()]+/g, '').replace(/^[-•]+/, '').trim();
  if (!stripped) return '내레이션';
  const lower = stripped.toLowerCase();
  if (playerAliases.has(lower)) return primaryPlayerName();
  if (/^(system|시스템|내레이션|narration)$/i.test(lower)) return '내레이션';
  return stripped;
};

const roleForSpeaker = (name) => {
  if (name === '내레이션') return 'narration';
  if (getPlayerNames().includes(name)) return 'player';
  return 'npc';
};

export const normalizeTranscript = (raw) =>
  stripTicks(normNL(String(raw ?? ''))).replace(/[\t\u00a0\u200b]/g, ' ');

const looksNarrative = (line) => {
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
};

const isActorStatsLine = (line) => /\|/.test(line) && /❤️|💗|💦|🪣/.test(line);

const isMetaLine = (line) => {
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
};

export const parseTurns = (raw) => {
  const lines = normalizeTranscript(raw).split('\n');
  const originLines = getEntryOrigin();
  const turns = [];
  const warnings = [];
  const metaHints = { header: null, codes: [], titles: [] };

  let currentSceneId = 1;
  let pendingSpeaker = null;

  const addEntriesToTurn = (turn, lineIndexes = []) => {
    if (!turn) return;
    const normalized = Array.from(
      new Set(
        (Array.isArray(lineIndexes) ? lineIndexes : [])
          .filter((idx) => Number.isInteger(idx) && idx >= 0)
          .sort((a, b) => a - b),
      ),
    );
    if (!normalized.length) return;
    const existing = Array.isArray(turn.__gmhEntries) ? turn.__gmhEntries.slice() : [];
    const merged = Array.from(new Set(existing.concat(normalized))).sort((a, b) => a - b);
    Object.defineProperty(turn, '__gmhEntries', {
      value: merged,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    const sourceBlocks = merged
      .map((lineIdx) => originLines[lineIdx])
      .filter((idx) => Number.isInteger(idx));
    if (sourceBlocks.length) {
      Object.defineProperty(turn, '__gmhSourceBlocks', {
        value: Array.from(new Set(sourceBlocks)).sort((a, b) => a - b),
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
  };

  const pushTurn = (speaker, text, roleOverride, lineIndexes = []) => {
    const textClean = sanitizeText(text);
    if (!textClean) return;
    const speakerName = normalizeSpeakerName(speaker || '내레이션');
    const role = roleOverride || roleForSpeaker(speakerName);
    if (role === 'player' && turns.length) {
      currentSceneId += 1;
    }
    const last = turns[turns.length - 1];
    if (last && last.speaker === speakerName && last.role === role && role !== 'narration') {
      last.text = `${last.text} ${textClean}`.trim();
      addEntriesToTurn(last, lineIndexes);
      return;
    }
    const nextTurn = {
      speaker: speakerName,
      role,
      text: textClean,
      sceneId: currentSceneId,
      channel: role === 'player' ? 'user' : 'llm',
    };
    addEntriesToTurn(nextTurn, lineIndexes);
    turns.push(nextTurn);
  };

  for (let i = 0; i < lines.length; i += 1) {
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

    let match = line.match(/^@([^@]{1,40})@\s*["“]?([\s\S]+?)["”]?\s*$/);
    if (match) {
      const speaker = normalizeSpeakerName(match[1]);
      pushTurn(speaker, match[2], roleForSpeaker(speaker), [i]);
      pendingSpeaker = speaker;
      continue;
    }

    if (forcedPlayer) {
      const speaker = primaryPlayerName();
      pushTurn(speaker, stripQuotes(line), 'player', [i]);
      pendingSpeaker = speaker;
      continue;
    }

    match = line.match(/^([^:@—\-]{1,40})\s*[:\-—]\s*(.+)$/);
    if (match && looksLikeName(match[1])) {
      const speaker = normalizeSpeakerName(match[1]);
      pushTurn(speaker, stripQuotes(match[2]), roleForSpeaker(speaker), [i]);
      pendingSpeaker = speaker;
      continue;
    }

    if (looksNarrative(line) || /^".+"$/.test(line) || /^“.+”$/.test(line)) {
      pushTurn('내레이션', stripQuotes(line), 'narration', [i]);
      pendingSpeaker = null;
      continue;
    }

    if (looksLikeName(line)) {
      const speaker = normalizeSpeakerName(line);
      const textBuf = [];
      const bufLines = [i];
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
        bufLines.push(j);
        j += 1;
        if (!/["”]$/.test(peek)) break;
      }
      if (textBuf.length) {
        pushTurn(speaker, stripQuotes(textBuf.join(' ')), roleForSpeaker(speaker), bufLines);
        pendingSpeaker = speaker;
        i = j - 1;
        continue;
      }
      pendingSpeaker = speaker;
      continue;
    }

    if (pendingSpeaker) {
      pushTurn(pendingSpeaker, stripQuotes(line), roleForSpeaker(pendingSpeaker), [i]);
      continue;
    }

    if (line.length <= 30 && /[!?…]$/.test(line) && turns.length) {
      const last = turns[turns.length - 1];
      last.text = `${last.text} ${line}`.trim();
      addEntriesToTurn(last, [i]);
      continue;
    }

    pushTurn('내레이션', line, 'narration', [i]);
    pendingSpeaker = null;
  }

  return { turns, warnings, metaHints };
};

export const deriveMeta = (metaHints, turns) => {
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
  let userCount = 0;
  let llmCount = 0;
  for (const turn of turns) {
    if (turn.role === 'player' || turn.role === 'npc') actorSet.add(turn.speaker);
    if (turn.channel === 'user') userCount += 1;
    else if (turn.channel === 'llm') llmCount += 1;
  }
  meta.actors = Array.from(actorSet);
  if (!meta.title && meta.place) meta.title = `${meta.place} 세션`;
  meta.player = primaryPlayerName();
  meta.turn_count = userCount;
  meta.message_count = turns.length;
  meta.channel_counts = { user: userCount, llm: llmCount };
  return meta;
};

export const buildSession = (raw) => {
  const { turns, warnings, metaHints } = parseTurns(raw);
  const meta = deriveMeta(metaHints, turns);
  return {
    meta,
    turns,
    warnings,
    source: 'genit-memory-helper',
  };
};

export { normalizeSpeakerName, roleForSpeaker };
