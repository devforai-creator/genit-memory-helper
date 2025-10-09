import { stripLegacySpeechLine, DEFAULT_PLAYER_MARK } from './writers-classic';
import type {
  StructuredJSONOptions,
  StructuredMarkdownOptions,
  StructuredSelectionRangeInfo,
  StructuredSelectionResult,
  StructuredSnapshotMessage,
  StructuredSnapshotMessagePart,
  StructuredTXTOptions,
} from '../types';

type MarkdownPartOptions = { playerMark?: string };

const coerceLines = (input: unknown): string[] =>
  Array.isArray(input) ? input.filter((line): line is string => typeof line === 'string') : [];

const renderStructuredMarkdownPart = (
  part: StructuredSnapshotMessagePart | null | undefined,
  message: StructuredSnapshotMessage | null | undefined,
  { playerMark = DEFAULT_PLAYER_MARK }: MarkdownPartOptions = {},
): string[] => {
  const out: string[] = [];
  const fallbackLines = coerceLines(part?.legacyLines);
  const baseLines = coerceLines(part?.lines);
  const normalizedLines =
    baseLines.length > 0
      ? baseLines
      : fallbackLines.map((line: string) =>
          stripLegacySpeechLine(line, part?.role || message?.role, { playerMark }),
        );
  const safeLines = normalizedLines.filter((line) => line.trim().length > 0);
  const flavor = part?.flavor || 'speech';

  switch (part?.type) {
    case 'info': {
      out.push('> **INFO**');
      safeLines.forEach((line) => out.push(`> ${line}`));
      break;
    }
    case 'code': {
      const language = part?.language || '';
      const codeText =
        typeof part?.text === 'string' && part.text.trim()
          ? part.text
          : safeLines.join('\n');
      out.push('```' + language);
      out.push(codeText);
      out.push('```');
      break;
    }
    case 'list': {
      const ordered = Boolean(part?.ordered);
      safeLines.forEach((line, idx) => {
        out.push(ordered ? `${idx + 1}. ${line}` : `- ${line}`);
      });
      break;
    }
    case 'blockquote': {
      safeLines.forEach((line) => out.push(`> ${line}`));
      break;
    }
    case 'image': {
      const alt = part?.alt || '이미지';
      const src = part?.src || '';
      out.push(`![${alt}](${src})`);
      break;
    }
    case 'heading': {
      const level = Math.min(6, Math.max(3, Number(part?.level) || 3));
      const text = safeLines.join(' ');
      out.push(`${'#'.repeat(level)} ${text}`.trim());
      break;
    }
    case 'horizontal-rule': {
      out.push('---');
      break;
    }
    case 'table': {
      safeLines.forEach((line) => out.push(line));
      break;
    }
    case 'paragraph':
    default: {
      if (flavor === 'narration') {
        safeLines.forEach((line) => out.push(`> ${line}`));
      } else if (flavor === 'speech' && (part?.role || message?.role) === 'npc') {
        const speaker = part?.speaker || message?.speaker || 'NPC';
        safeLines.forEach((line) => out.push(`> ${speaker}: ${line}`));
      } else {
        safeLines.forEach((line) => out.push(line));
      }
      break;
    }
  }

  if (!out.length && fallbackLines.length) {
    fallbackLines.forEach((line) => out.push(line));
  }

  return out;
};

export const toStructuredMarkdown = (options: StructuredMarkdownOptions = {}): string => {
  const {
    messages = [],
    session,
    profile,
    rangeInfo,
    playerNames = [],
    playerMark = DEFAULT_PLAYER_MARK,
  } = options;

  const lines: string[] = ['# 구조 보존 대화 로그'];
  const meta = session?.meta || {};
  if (meta.title) lines.push(`**제목:** ${meta.title}`);
  if (meta.date) lines.push(`**날짜:** ${meta.date}`);
  if (meta.place) lines.push(`**장소:** ${meta.place}`);
  if (Array.isArray(meta.actors) && meta.actors.length) {
    lines.push(`**참여자:** ${meta.actors.join(', ')}`);
  }
  if (profile) lines.push(`**레다크션 프로파일:** ${profile.toUpperCase()}`);
  if (rangeInfo && (rangeInfo as StructuredSelectionRangeInfo)?.active) {
    const totalMessagesForRange =
      rangeInfo.total || rangeInfo.messageTotal || messages.length || 0;
    lines.push(
      `**선택 범위:** 메시지 ${rangeInfo.start}-${rangeInfo.end} · ${rangeInfo.count}/${totalMessagesForRange}`,
    );
  }
  if (playerNames.length) {
    lines.push(`**플레이어 이름:** ${playerNames.join(', ')}`);
  }
  if (lines[lines.length - 1] !== '') lines.push('');

  messages.forEach((message, idx) => {
    const ordinal = Number.isFinite(message?.ordinal) ? `[#${message.ordinal}] ` : '';
    const speakerLabel =
      message?.role === 'narration' ? '내레이션' : message?.speaker || '메시지';
    const roleLabel = message?.role && message.role !== 'narration' ? ` (${message.role})` : '';
    lines.push(`## ${ordinal}${speakerLabel}${roleLabel}`.trim());
    const parts: StructuredSnapshotMessagePart[] =
      Array.isArray(message?.parts) && message.parts.length
        ? message.parts
        : [
            {
              type: 'paragraph',
              flavor: message?.role === 'narration' ? 'narration' : 'speech',
              role: message?.role,
              speaker: message?.speaker,
              lines: coerceLines(message?.legacyLines).map((line: string) =>
                stripLegacySpeechLine(line, message?.role, { playerMark }),
              ),
            },
          ];
    parts.forEach((part) => {
      const rendered = renderStructuredMarkdownPart(part, message, { playerMark }).filter(
        (line) => typeof line === 'string',
      );
      if (rendered.length) {
        lines.push(...rendered);
        if (rendered[rendered.length - 1] !== '') lines.push('');
      }
    });
    if (idx !== messages.length - 1) lines.push('');
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
};

export const toStructuredJSON = (options: StructuredJSONOptions = {}): string => {
  const {
    session,
    structuredSelection,
    structuredSnapshot,
    profile,
    playerNames = [],
    rangeInfo,
    normalizedRaw,
  } = options;
  const generatedAt = new Date().toISOString();
  const messages = Array.isArray(structuredSelection?.messages)
    ? structuredSelection.messages
    : Array.isArray(structuredSnapshot?.messages)
    ? structuredSnapshot.messages
    : [];
  const structuredMeta = {
    total_messages:
      structuredSelection?.sourceTotal ??
      structuredSnapshot?.messages?.length ??
      messages.length,
    exported_messages: messages.length,
    selection: structuredSelection?.range || rangeInfo || null,
    errors: structuredSnapshot?.errors || [],
  };
  const metaBase = session?.meta || {};
  const payload = {
    version: '2.0-structured',
    generated_at: generatedAt,
    source: session?.source || 'genit-memory-helper',
    profile: profile || 'safe',
    player_names: playerNames,
    meta: {
      ...metaBase,
      structured: structuredMeta,
    },
    messages,
    warnings: session?.warnings || [],
    classic_fallback: {
      version: '1.0',
      turns: session?.turns || [],
      raw_excerpt: (normalizedRaw || '').slice(0, 2000),
    },
  };
  return JSON.stringify(payload, null, 2);
};

export const toStructuredTXT = (options: StructuredTXTOptions = {}): string => {
  const { messages = [], session, profile, rangeInfo, playerNames = [] } = options;

  const lines: string[] = [];
  lines.push('=== Conversation Export ===');
  const meta = session?.meta || {};
  if (meta.title) lines.push(`Title: ${meta.title}`);
  if (meta.date) lines.push(`Date: ${meta.date}`);
  if (meta.place) lines.push(`Place: ${meta.place}`);
  if (profile) lines.push(`Profile: ${profile.toUpperCase()}`);
  if (playerNames.length) lines.push(`Players: ${playerNames.join(', ')}`);
  if (rangeInfo && (rangeInfo as StructuredSelectionRangeInfo)?.active) {
    lines.push(
      `Range: messages ${rangeInfo.start}-${rangeInfo.end} / ${
        rangeInfo.total || rangeInfo.messageTotal || messages.length || 0
      }`,
    );
  }
  lines.push('');

  const formatSpeakerTag = (message: StructuredSnapshotMessage | null | undefined): string => {
    const ordinalLabel = Number.isFinite(message?.ordinal) ? `#${message?.ordinal}` : '#?';
    const speaker =
      message?.role === 'narration' ? '내레이션' : message?.speaker || message?.role || '메시지';
    const roleLabel = message?.role || message?.channel || 'message';
    return `[${ordinalLabel}][${speaker}][${roleLabel}]`;
  };

  const appendPartLines = (
    part: StructuredSnapshotMessagePart | null | undefined,
    messageSpeaker: string,
  ): void => {
    const partLines = coerceLines(part?.lines);
    const fallback = coerceLines(part?.legacyLines);
    const resolvedLines = partLines.length ? partLines : fallback;
    const speakerName = part?.speaker || messageSpeaker || '화자';
    switch (part?.type) {
      case 'info': {
        resolvedLines.forEach((line) => {
          lines.push(`[INFO] ${line}`);
        });
        break;
      }
      case 'blockquote': {
        resolvedLines.forEach((line) => lines.push(`> ${line}`));
        break;
      }
      case 'list': {
        const ordered = Boolean(part?.ordered);
        resolvedLines.forEach((line, idx) => {
          lines.push(`${ordered ? idx + 1 : '-'} ${line}`);
        });
        break;
      }
      case 'code': {
        lines.push('```' + (part?.language || ''));
        const text =
          typeof part?.text === 'string' && part.text.trim()
            ? part.text
            : resolvedLines.join('\n');
        lines.push(text);
        lines.push('```');
        break;
      }
      case 'image': {
        const alt = part?.alt || '이미지';
        const src = part?.src || '';
        lines.push(`[IMAGE] ${alt}${src ? ` <${src}>` : ''}`);
        break;
      }
      case 'heading': {
        resolvedLines.forEach((line) => lines.push(`== ${line} ==`));
        break;
      }
      case 'paragraph':
      default: {
        const isSpeech = part?.flavor === 'speech';
        resolvedLines.forEach((line) => {
          if (isSpeech) lines.push(`- ${speakerName}: ${line}`);
          else lines.push(`- ${line}`);
        });
        break;
      }
    }
  };

  messages.forEach((message, idx) => {
    const header = formatSpeakerTag(message);
    lines.push(header);
    const messageSpeaker =
      message?.role === 'narration' ? '내레이션' : message?.speaker || '화자';
    const parts: StructuredSnapshotMessagePart[] =
      Array.isArray(message?.parts) && message.parts.length
        ? message.parts
        : [
            {
              type: 'paragraph',
              flavor: message?.role === 'narration' ? 'narration' : 'speech',
              speaker: messageSpeaker,
              lines: coerceLines(message?.legacyLines),
            },
          ];
    parts.forEach((part) => appendPartLines(part, messageSpeaker));
    if (idx !== messages.length - 1) lines.push('');
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
