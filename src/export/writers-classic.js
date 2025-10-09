/**
 * @typedef {import('../types').TranscriptSession} TranscriptSession
 * @typedef {import('../types').TranscriptTurn} TranscriptTurn
 * @typedef {import('../types').ClassicJSONExportOptions} ClassicJSONExportOptions
 * @typedef {import('../types').ClassicTXTExportOptions} ClassicTXTExportOptions
 * @typedef {import('../types').ClassicMarkdownExportOptions} ClassicMarkdownExportOptions
 * @typedef {import('../types').StripLegacySpeechOptions} StripLegacySpeechOptions
 */

const DEFAULT_PLAYER_MARK = '⟦PLAYER⟧ ';

/**
 * Removes helper prefixes from legacy transcript lines.
 *
 * @param {string | null | undefined} line
 * @param {string | null | undefined} role
 * @param {StripLegacySpeechOptions} [options]
 * @returns {string}
 */
export const stripLegacySpeechLine = (line, role, { playerMark = DEFAULT_PLAYER_MARK } = {}) => {
  if (!line) return '';
  let text = line;
  if (role === 'player' && text.startsWith(playerMark)) {
    text = text.slice(playerMark.length);
  }
  const npcMatch = text.match(/^@([^@]+)@\s+"(.+)"$/);
  if (npcMatch) {
    return npcMatch[2].trim();
  }
  return text.trim();
};

/**
 * Serializes a transcript session into a classic JSON payload.
 *
 * @param {TranscriptSession} session
 * @param {string} normalizedRaw
 * @param {ClassicJSONExportOptions} [options]
 * @returns {string}
 */
export const toJSONExport = (session, normalizedRaw, { playerNames = [] } = {}) => {
  const payload = {
    version: '1.0',
    generated_at: new Date().toISOString(),
    source: session?.source,
    player_names: session?.player_names || playerNames,
    meta: session?.meta,
    turns: session?.turns,
    warnings: session?.warnings,
    raw_excerpt: (normalizedRaw || '').slice(0, 2000),
  };
  return JSON.stringify(payload, null, 2);
};

/**
 * Formats a transcript session into a readable plain-text export.
 *
 * @param {TranscriptSession} session
 * @param {ClassicTXTExportOptions} [opts]
 * @returns {string}
 */
export const toTXTExport = (session, opts = {}) => {
  const { turns = session?.turns || [], includeMeta = true } = opts;
  const lines = [];
  if (includeMeta) {
    const actors = Array.isArray(session?.meta?.actors) ? session.meta.actors : [];
    if (session?.meta?.title) lines.push(`# TITLE: ${session.meta.title}`);
    if (session?.meta?.date) lines.push(`# DATE: ${session.meta.date}`);
    if (session?.meta?.place) lines.push(`# PLACE: ${session.meta.place}`);
    if (actors.length) lines.push(`# ACTORS: ${actors.join(', ')}`);
    lines.push('');
  }
  turns.forEach((turn) => {
    const speaker = turn?.role === 'narration' ? '내레이션' : turn?.speaker;
    lines.push(`@${speaker}@ ${turn?.text}`);
  });
  return lines.join('\n').trim();
};

/**
 * Produces a Markdown export for the provided transcript session.
 *
 * @param {TranscriptSession} session
 * @param {ClassicMarkdownExportOptions} [opts]
 * @returns {string}
 */
export const toMarkdownExport = (session, opts = {}) => {
  const {
    turns = session?.turns || [],
    heading = '# 대화 로그',
    includeMeta = true,
  } = opts;

  const lines = [heading];
  if (includeMeta) {
    const actors = Array.isArray(session?.meta?.actors) ? session.meta.actors : [];
    const metaLines = [];
    if (session?.meta?.date) metaLines.push(`- 날짜: ${session.meta.date}`);
    if (session?.meta?.place) metaLines.push(`- 장소: ${session.meta.place}`);
    if (session?.meta?.mode) metaLines.push(`- 모드: ${session.meta.mode}`);
    if (actors.length) metaLines.push(`- 참여자: ${actors.join(', ')}`);
    if (metaLines.length) {
      lines.push(metaLines.join('\n'));
      lines.push('');
    }
  } else {
    lines.push('');
  }

  turns.forEach((turn) => {
    if (turn?.role === 'narration') {
      lines.push(`> **내레이션**: ${turn?.text}`);
    } else {
      lines.push(`- **${turn?.speaker}**: ${turn?.text}`);
    }
  });

  return lines.join('\n').trim();
};
