import { toJSONExport, toTXTExport, toMarkdownExport } from './writers-classic.js';
import {
  toStructuredMarkdown,
  toStructuredJSON,
  toStructuredTXT,
} from './writers-structured.js';

const defaultStamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export const buildExportBundle = (
  session,
  normalizedRaw,
  format,
  stamp,
  options = {},
) => {
  const stampToken = stamp || defaultStamp();
  const {
    structuredSelection,
    structuredSnapshot,
    profile,
    playerNames = [],
    rangeInfo,
    playerMark,
  } = options;

  const base = `genit_turns_${stampToken}`;

  if (format === 'structured-md') {
    const markdown = toStructuredMarkdown({
      messages: structuredSelection?.messages || [],
      session,
      profile,
      playerNames,
      rangeInfo,
      playerMark,
    });
    return {
      filename: `${base}_structured.md`,
      mime: 'text/markdown',
      content: markdown,
      stamp: stampToken,
      format,
    };
  }

  if (format === 'structured-json') {
    const jsonPayload = toStructuredJSON({
      session,
      structuredSelection,
      structuredSnapshot,
      profile,
      playerNames,
      rangeInfo,
      normalizedRaw,
    });
    return {
      filename: `${base}_structured.json`,
      mime: 'application/json',
      content: jsonPayload,
      stamp: stampToken,
      format,
    };
  }

  if (format === 'structured-txt') {
    const txtPayload = toStructuredTXT({
      messages: structuredSelection?.messages || [],
      session,
      profile,
      rangeInfo,
      playerNames,
    });
    return {
      filename: `${base}_structured.txt`,
      mime: 'text/plain',
      content: txtPayload,
      stamp: stampToken,
      format,
    };
  }

  if (format === 'md') {
    return {
      filename: `${base}.md`,
      mime: 'text/markdown',
      content: toMarkdownExport(session),
      stamp: stampToken,
      format,
    };
  }

  if (format === 'txt') {
    return {
      filename: `${base}.txt`,
      mime: 'text/plain',
      content: toTXTExport(session),
      stamp: stampToken,
      format,
    };
  }

  return {
    filename: `${base}.json`,
    mime: 'application/json',
    content: toJSONExport(session, normalizedRaw, { playerNames }),
    stamp: stampToken,
    format,
  };
};

export const buildExportManifest = ({
  profile,
  counts,
  stats,
  overallStats,
  format,
  warnings,
  source,
  range,
  version,
}) => ({
  tool: 'Genit Memory Helper',
  version,
  generated_at: new Date().toISOString(),
  profile,
  counts,
  stats,
  overall_stats: overallStats,
  range,
  format,
  warnings,
  source,
});
