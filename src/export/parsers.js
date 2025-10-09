import {
  normNL,
  stripTicks,
  collapseSpaces,
  stripQuotes,
  stripBrackets,
  sanitizeText,
} from '../utils/text.ts';
import { looksLikeName } from '../utils/validation.ts';

/**
 * @typedef {import('../types').TranscriptTurn} TranscriptTurn
 * @typedef {import('../types').TranscriptMetaHints} TranscriptMetaHints
 * @typedef {import('../types').TranscriptMeta} TranscriptMeta
 * @typedef {import('../types').TranscriptParseResult} TranscriptParseResult
 * @typedef {import('../types').TranscriptSession} TranscriptSession
 * @typedef {import('../types').EntryOriginProvider} EntryOriginProvider
 */

/** @type {readonly string[]} */
export const PLAYER_NAME_FALLBACKS = ['플레이어', '소중한코알라5299'];

/** @type {string} */
export const PLAYER_MARK = '⟦PLAYER⟧ ';

/** @type {RegExp} */
const HEADER_RE =
  /^(\d+월\s*\d+일.*?\d{1,2}:\d{2})\s*\|\s*([^|]+?)\s*\|\s*📍\s*([^|]+)\s*\|?(.*)$/;

/** @type {RegExp} */
const CODE_RE = /^([A-J])\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/i;

/** @type {readonly string[]} */
const META_KEYWORDS = ['지도', '등장', 'Actors', '배우', '기록코드', 'Codes', 'SCENE'];

/** @type {readonly string[]} */
const SYSTEM_ALIASES = ['player', '플레이어', '유저', '나'];

/**
 * Builds a lowercase alias set for player comparison.
 *
 * @param {string[]} names
 * @returns {Set<string>}
 */
const buildAliasSet = (names) => new Set(names.map((n) => n.toLowerCase()).concat(SYSTEM_ALIASES));

/** @type {string[]} */
let playerNames = [...PLAYER_NAME_FALLBACKS];

/** @type {Set<string>} */
let playerAliases = buildAliasSet(playerNames);

/** @type {EntryOriginProvider} */
let entryOriginProvider = () => [];

/**
 * Overrides the dynamic player name list while preserving fallbacks.
 *
 * @param {string[]} [names]
 * @returns {void}
 */
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

/**
 * Returns a copy of the currently active player names for downstream logic.
 *
 * @returns {string[]}
 */
export const getPlayerNames = () => playerNames.slice();

/**
 * Registers a function that supplies transcript line origins for range lookup.
 *
 * @param {EntryOriginProvider | null | undefined} provider
 * @returns {void}
 */
export const setEntryOriginProvider = (provider) => {
  entryOriginProvider = typeof provider === 'function' ? provider : () => [];
};

/**
 * Resolves origin indices for normalized transcript lines.
 *
 * @returns {number[]}
 */
const getEntryOrigin = () => {
  const origin = entryOriginProvider();
  return Array.isArray(origin) ? origin.slice() : [];
};

/**
 * Picks the primary (first) player label for role matching.
 *
 * @returns {string}
 */
const primaryPlayerName = () => getPlayerNames()[0] || PLAYER_NAME_FALLBACKS[0];

/**
 * Cleans a raw line label into a normalized speaker name.
 *
 * @param {string} [name]
 * @returns {string}
 */
const normalizeSpeakerName = (name) => {
  const stripped = collapseSpaces(String(name || '')).replace(/[\[\]{}()]+/g, '').replace(/^[-•]+/, '').trim();
  if (!stripped) return '내레이션';
  const lower = stripped.toLowerCase();
  if (playerAliases.has(lower)) return primaryPlayerName();
  if (/^(system|시스템|내레이션|narration)$/i.test(lower)) return '내레이션';
  return stripped;
};

/**
 * Maps a speaker label to a canonical conversation role.
 *
 * @param {string} name
 * @returns {'player' | 'npc' | 'narration'}
 */
const roleForSpeaker = (name) => {
  if (name === '내레이션') return 'narration';
  if (getPlayerNames().includes(name)) return 'player';
  return 'npc';
};

/**
 * Standardizes raw transcript text for downstream parsing routines.
 *
 * @param {string} raw
 * @returns {string}
 */
export const normalizeTranscript = (raw) =>
  stripTicks(normNL(String(raw ?? ''))).replace(/[\t\u00a0\u200b]/g, ' ');

/**
 * Heuristically determines if a line should be treated as narration.
 *
 * @param {string} line
 * @returns {boolean}
 */
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

/**
 * Detects actor stats/metadata rows that should be skipped during parsing.
 *
 * @param {string} line
 * @returns {boolean}
 */
const isActorStatsLine = (line) => /\|/.test(line) && /❤️|💗|💦|🪣/.test(line);

/**
 * Determines whether a normalized line qualifies as metadata.
 *
 * @param {string} line
 * @returns {boolean}
 */
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

/**
 * Parses a normalized transcript into structured turns and metadata hints.
 *
 * @param {string} raw
 * @returns {TranscriptParseResult}
 */
export const parseTurns = (raw) => {
  const lines = normalizeTranscript(raw).split('\n');
  const originLines = getEntryOrigin();
  /** @type {TranscriptTurn[]} */
  const turns = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {TranscriptMetaHints} */
  const metaHints = { header: null, codes: [], titles: [] };

  let currentSceneId = 1;
  let pendingSpeaker = null;

  /**
   * Appends normalized line indexes to a transcript turn.
   *
   * @param {TranscriptTurn | undefined} turn
   * @param {number[]} [lineIndexes]
   * @returns {void}
   */
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

  /**
   * Registers a turn with inferred channels and scene grouping.
   *
   * @param {string | null | undefined} speaker
   * @param {string} text
   * @param {'player' | 'npc' | 'narration' | null | undefined} roleOverride
   * @param {number[]} [lineIndexes]
   * @returns {void}
   */
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

/**
 * Produces derived metadata using meta hints and structured turns.
 *
 * @param {TranscriptMetaHints} metaHints
 * @param {TranscriptTurn[]} turns
 * @returns {TranscriptMeta}
 */
export const deriveMeta = (metaHints, turns) => {
  /** @type {TranscriptMeta} */
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

/**
 * Generates a structured transcript session payload from raw text.
 *
 * @param {string} raw
 * @returns {TranscriptSession}
 */
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
