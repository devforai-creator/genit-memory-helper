import type {
  ClassicJSONExportOptions,
  ClassicMarkdownExportOptions,
  ClassicTXTExportOptions,
  StripLegacySpeechOptions,
  TranscriptSession,
  TranscriptTurn,
} from '../types';

export const DEFAULT_PLAYER_MARK = '⟦PLAYER⟧ ';

export const stripLegacySpeechLine = (
  line: string | null | undefined,
  role: string | null | undefined,
  { playerMark = DEFAULT_PLAYER_MARK }: StripLegacySpeechOptions = {},
): string => {
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

export const toJSONExport = (
  session: TranscriptSession,
  normalizedRaw: string,
  { playerNames = [] }: ClassicJSONExportOptions = {},
): string => {
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

export const toTXTExport = (
  session: TranscriptSession,
  opts: ClassicTXTExportOptions = {},
): string => {
  const { includeMeta = true } = opts;
  const turns: TranscriptTurn[] = Array.isArray(opts.turns)
    ? opts.turns
    : Array.isArray(session?.turns)
    ? session.turns
    : [];
  const lines: string[] = [];
  if (includeMeta) {
    const actors = Array.isArray(session?.meta?.actors) ? session.meta.actors : [];
    if (session?.meta?.title) lines.push(`# TITLE: ${session.meta.title}`);
    if (session?.meta?.date) lines.push(`# DATE: ${session.meta.date}`);
    if (session?.meta?.place) lines.push(`# PLACE: ${session.meta.place}`);
    if (actors.length) lines.push(`# ACTORS: ${actors.join(', ')}`);
    lines.push('');
  }
  turns.forEach((turn) => {
    const speaker = turn?.role === 'narration' ? '내레이션' : turn?.speaker || '메시지';
    lines.push(`@${speaker}@ ${turn?.text ?? ''}`);
  });
  return lines.join('\n').trim();
};

export const toMarkdownExport = (
  session: TranscriptSession,
  opts: ClassicMarkdownExportOptions = {},
): string => {
  const {
    includeMeta = true,
    heading = '# 대화 로그',
  } = opts;
  const turns: TranscriptTurn[] = Array.isArray(opts.turns)
    ? opts.turns
    : Array.isArray(session?.turns)
    ? session.turns
    : [];

  const lines: string[] = [heading];
  if (includeMeta) {
    const actors = Array.isArray(session?.meta?.actors) ? session.meta.actors : [];
    const metaLines: string[] = [];
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
      lines.push(`> **내레이션**: ${turn?.text ?? ''}`);
    } else {
      lines.push(`- **${turn?.speaker ?? '발화자'}**: ${turn?.text ?? ''}`);
    }
  });

  return lines.join('\n').trim();
};
