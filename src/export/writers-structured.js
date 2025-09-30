import { stripLegacySpeechLine } from './writers-classic.js';

const DEFAULT_PLAYER_MARK = '⟦PLAYER⟧ ';

const renderStructuredMarkdownPart = (part, message, { playerMark = DEFAULT_PLAYER_MARK } = {}) => {
  const out = [];
  const fallbackLines = Array.isArray(part?.legacyLines) ? part.legacyLines : [];
  const baseLines = Array.isArray(part?.lines) && part.lines.length
    ? part.lines
    : fallbackLines.map((line) =>
        stripLegacySpeechLine(line, part?.role || message?.role, { playerMark }),
      );
  const safeLines = baseLines.filter((line) => typeof line === 'string' && line.trim().length);
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
      out.push(`\u0060\u0060\u0060${language}`);
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

export const toStructuredMarkdown = (options = {}) => {
  const {
    messages = [],
    session,
    profile,
    rangeInfo,
    playerNames = [],
    playerMark = DEFAULT_PLAYER_MARK,
  } = options;

  const lines = ['# 구조 보존 대화 로그'];
  const meta = session?.meta || {};
  if (meta.title) lines.push(`**제목:** ${meta.title}`);
  if (meta.date) lines.push(`**날짜:** ${meta.date}`);
  if (meta.place) lines.push(`**장소:** ${meta.place}`);
  if (Array.isArray(meta.actors) && meta.actors.length) {
    lines.push(`**참여자:** ${meta.actors.join(', ')}`);
  }
  if (profile) lines.push(`**레다크션 프로파일:** ${profile.toUpperCase()}`);
  if (rangeInfo?.active) {
    const totalMessagesForRange = rangeInfo.total || rangeInfo.messageTotal || messages.length || 0;
    lines.push(
      `**선택 범위:** 메시지 ${rangeInfo.start}-${rangeInfo.end} · ${rangeInfo.count}/${totalMessagesForRange}`,
    );
  }
  if (playerNames?.length) {
    lines.push(`**플레이어 이름:** ${playerNames.join(', ')}`);
  }
  if (lines[lines.length - 1] !== '') lines.push('');

  messages.forEach((message, idx) => {
    const ordinal = Number.isFinite(message?.ordinal) ? `[#${message.ordinal}] ` : '';
    const speakerLabel =
      message?.role === 'narration' ? '내레이션' : message?.speaker || '메시지';
    const roleLabel = message?.role && message.role !== 'narration' ? ` (${message.role})` : '';
    lines.push(`## ${ordinal}${speakerLabel}${roleLabel}`.trim());
    const parts = Array.isArray(message?.parts) && message.parts.length
      ? message.parts
      : [
          {
            type: 'paragraph',
            flavor: message?.role === 'narration' ? 'narration' : 'speech',
            role: message?.role,
            speaker: message?.speaker,
            lines: Array.isArray(message?.legacyLines)
              ? message.legacyLines.map((line) =>
                  stripLegacySpeechLine(line, message?.role, { playerMark }),
                )
              : [],
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

export const toStructuredJSON = (options = {}) => {
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
  const messages = structuredSelection?.messages || structuredSnapshot?.messages || [];
  const structuredMeta = {
    total_messages:
      structuredSelection?.sourceTotal ?? structuredSnapshot?.messages?.length ?? messages.length,
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

export const toStructuredTXT = (options = {}) => {
  const {
    messages = [],
    session,
    profile,
    rangeInfo,
    playerNames = [],
  } = options;

  const lines = [];
  lines.push('=== Conversation Export ===');
  const meta = session?.meta || {};
  if (meta.title) lines.push(`Title: ${meta.title}`);
  if (meta.date) lines.push(`Date: ${meta.date}`);
  if (meta.place) lines.push(`Place: ${meta.place}`);
  if (profile) lines.push(`Profile: ${profile.toUpperCase()}`);
  if (playerNames?.length) lines.push(`Players: ${playerNames.join(', ')}`);
  if (rangeInfo?.active) {
    lines.push(
      `Range: messages ${rangeInfo.start}-${rangeInfo.end} / ${
        rangeInfo.total || rangeInfo.messageTotal || messages.length || 0
      }`,
    );
  }
  lines.push('');

  const formatSpeakerTag = (message) => {
    const ordinalLabel = Number.isFinite(message?.ordinal) ? `#${message.ordinal}` : '#?';
    const speaker =
      message?.role === 'narration' ? '내레이션' : message?.speaker || message?.role || '메시지';
    const roleLabel = message?.role || message?.channel || 'message';
    return `[${ordinalLabel}][${speaker}][${roleLabel}]`;
  };

  const appendPartLines = (part, messageSpeaker) => {
    const partLines = Array.isArray(part?.lines) && part.lines.length
      ? part.lines
      : Array.isArray(part?.legacyLines)
      ? part.legacyLines
      : [];
    const speakerName = part?.speaker || messageSpeaker || '화자';
    switch (part?.type) {
      case 'info': {
        partLines.forEach((line) => {
          lines.push(`[INFO] ${line}`);
        });
        break;
      }
      case 'blockquote': {
        partLines.forEach((line) => lines.push(`> ${line}`));
        break;
      }
      case 'list': {
        const ordered = Boolean(part?.ordered);
        partLines.forEach((line, idx) => {
          lines.push(`${ordered ? idx + 1 : '-'} ${line}`);
        });
        break;
      }
      case 'code': {
        lines.push('```' + (part?.language || ''));
        const text =
          typeof part?.text === 'string' && part.text.trim()
            ? part.text
            : partLines.join('\n');
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
        partLines.forEach((line) => lines.push(`== ${line} ==`));
        break;
      }
      case 'paragraph':
      default: {
        const isSpeech = part?.flavor === 'speech';
        partLines.forEach((line) => {
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
    const parts = Array.isArray(message?.parts) && message.parts.length
      ? message.parts
      : [
          {
            type: 'paragraph',
            flavor: message?.role === 'narration' ? 'narration' : 'speech',
            speaker: messageSpeaker,
            lines: Array.isArray(message?.legacyLines) ? message.legacyLines : [],
          },
        ];
    parts.forEach((part) => appendPartLines(part, messageSpeaker));
    if (idx !== messages.length - 1) lines.push('');
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
