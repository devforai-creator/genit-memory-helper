import { describe, it, expect, vi } from 'vitest';
import { createPrivacyPipeline } from '../../src/privacy/pipeline';
import { DEFAULT_PRIVACY_PROFILE } from '../../src/privacy/constants';
import type { StructuredSnapshot, TranscriptSession, TranscriptTurn } from '../../src/types';

const buildTurn = (text: string, speaker: string): TranscriptTurn => {
  const turn: TranscriptTurn = {
    text,
    speaker,
    role: 'player',
    channel: 'user',
  };
  Object.defineProperty(turn, '__gmhEntries', {
    value: [1, 2],
    enumerable: false,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(turn, '__gmhSourceBlocks', {
    value: ['b1'],
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return turn;
};

describe('privacy pipeline', () => {
  it('redacts session, meta, player names, and structured snapshot content', () => {
    const redactCalls: Array<{ value: string; profile: string }> = [];
    const redactText = vi.fn((value: string, profile: string, counts: Record<string, number>) => {
      redactCalls.push({ value, profile });
      counts[profile] = (counts[profile] ?? 0) + 1;
      return `${profile}:${value}:cfg`;
    });

    const pipeline = createPrivacyPipeline({
      profiles: { strict: { label: 'Strict' } },
      getConfig: () => ({ tag: 'cfg' }),
      redactText,
      hasMinorSexualContext: () => false,
      getPlayerNames: () => ['Alice', 'Bob'],
      logger: null,
      storage: null,
    });

    const session: TranscriptSession = {
      meta: { title: 'My Chat', tags: ['tag1', 'tag2'], size: 3 },
      turns: [buildTurn('Hello user', 'Hero')],
      warnings: ['be careful'],
      source: 'origin',
    };

    const structured: StructuredSnapshot = {
      messages: [
        {
          id: 'm1',
          index: 0,
          ordinal: 1,
          role: 'player',
          channel: 'user',
          speaker: 'Hero',
          parts: [
            {
              text: 'Line one',
              lines: ['Line one', 'Line two'],
              legacyLines: ['Legacy one'],
              items: ['Item one'],
              speaker: 'Hero',
              type: 'paragraph',
              flavor: 'speech',
              role: 'player',
            },
          ],
          legacyLines: ['Legacy root'],
        },
      ],
      legacyLines: ['Snapshot legacy'],
      entryOrigin: [0],
      errors: [],
      generatedAt: 123,
    };

    const result = pipeline.applyPrivacyPipeline(session, 'raw text', 'strict', structured);

    expect(result.profile).toBe('strict');
    expect(result.sanitizedSession.turns[0]?.text).toBe('strict:Hello user:cfg');
    expect(result.sanitizedSession.turns[0]?.speaker).toBe('strict:Hero:cfg');
    expect(result.sanitizedSession.player_names).toEqual(['strict:Alice:cfg', 'strict:Bob:cfg']);
    expect(result.sanitizedSession.meta.title).toBe('strict:My Chat:cfg');
    expect(result.sanitizedSession.meta.tags).toEqual(['strict:tag1:cfg', 'strict:tag2:cfg']);
    expect(result.sanitizedSession.warnings[0]).toBe('strict:be careful:cfg');

    const part = result.structured?.messages[0]?.parts[0];
    expect(part?.lines).toEqual(['strict:Line one:cfg', 'strict:Line two:cfg']);
    expect(part?.legacyLines).toEqual(['strict:Legacy one:cfg']);
    expect(part?.items).toEqual(['strict:Item one:cfg']);
    const legacyDesc = Object.getOwnPropertyDescriptor(result.structured?.messages?.[0] ?? {}, 'legacyLines');
    expect(legacyDesc?.enumerable).toBe(false);
    expect(legacyDesc?.value).toEqual(['strict:Legacy root:cfg']);

    const turnEntriesDesc = Object.getOwnPropertyDescriptor(result.sanitizedSession.turns[0], '__gmhEntries');
    expect(turnEntriesDesc?.enumerable).toBe(false);
    expect(turnEntriesDesc?.value).toEqual([1, 2]);

    expect(result.counts.strict).toBeGreaterThan(0);
    expect(result.totalRedactions).toBeGreaterThan(0);
    expect(redactCalls.some((call) => call.value === 'raw text')).toBe(true);
  });

  it('falls back to default profile and logs when blocked', () => {
    const logger = { log: vi.fn() };
    const pipeline = createPrivacyPipeline({
      redactText: (value, profile, counts) => {
        counts[profile] = (counts[profile] ?? 0) + 1;
        return `redacted:${value}`;
      },
      hasMinorSexualContext: () => true,
      logger,
    });

    const result = pipeline.applyPrivacyPipeline(
      { meta: {}, turns: [], warnings: [], source: 's' },
      'sensitive text',
      'unknown-profile',
      null,
    );

    expect(result.profile).toBe(DEFAULT_PRIVACY_PROFILE);
    expect(result.blocked).toBe(true);
    expect(logger.log).toHaveBeenCalledWith(
      '[GMH Privacy] Blocking decision:',
      expect.objectContaining({ blocked: true }),
    );
  });

  it('logs when debug flag is enabled even if not blocked', () => {
    const logger = { log: vi.fn() };
    const storage = { getItem: vi.fn(() => '1') };
    const pipeline = createPrivacyPipeline({
      redactText: (value) => value,
      hasMinorSexualContext: () => false,
      logger,
      storage,
    });

    pipeline.applyPrivacyPipeline({ meta: {}, turns: [], warnings: [], source: 's' }, 'text', 'default', null);
    expect(logger.log).toHaveBeenCalled();
  });

  it('throws when redactText is missing', () => {
    expect(() =>
      // @ts-expect-error testing runtime guard
      createPrivacyPipeline({ redactText: null, hasMinorSexualContext: () => false }),
    ).toThrow(/redactText function is required/);
  });
});
