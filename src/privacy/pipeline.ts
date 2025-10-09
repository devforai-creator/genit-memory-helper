import { DEFAULT_PRIVACY_PROFILE, PRIVACY_PROFILES } from './constants';
import type {
  PrivacyPipelineApi,
  PrivacyPipelineDependencies,
  PrivacyPipelineResult,
  StructuredSnapshot,
  StructuredSnapshotMessage,
  StructuredSnapshotMessagePart,
  TranscriptSession,
  TranscriptTurn,
} from '../types';

type RedactFn = (
  value: string,
  profile: string,
  counts: Record<string, number>,
  config?: unknown,
  profiles?: unknown,
) => string;

type SanitizeCounts = Record<string, number>;

const cloneTurns = (turns: TranscriptTurn[] = []): TranscriptTurn[] =>
  Array.isArray(turns)
    ? turns.map((turn) => {
        const clone: TranscriptTurn = { ...turn };
        if (Array.isArray(turn.__gmhEntries)) {
          Object.defineProperty(clone, '__gmhEntries', {
            value: turn.__gmhEntries.slice(),
            enumerable: false,
            writable: true,
            configurable: true,
          });
        }
        if (Array.isArray(turn.__gmhSourceBlocks)) {
          Object.defineProperty(clone, '__gmhSourceBlocks', {
            value: turn.__gmhSourceBlocks.slice(),
            enumerable: false,
            writable: true,
            configurable: true,
          });
        }
        return clone;
      })
    : [];

const cloneSession = (session?: TranscriptSession | null): TranscriptSession => {
  if (!session) {
    return {
      meta: {},
      turns: [],
      warnings: [],
      source: undefined,
    };
  }

  return {
    meta: { ...(session.meta || {}) },
    turns: cloneTurns(session.turns),
    warnings: Array.isArray(session.warnings) ? [...session.warnings] : [],
    source: session.source,
  };
};

const sanitizeStructuredPart = (
  part: StructuredSnapshotMessagePart | null | undefined,
  profileKey: string,
  counts: SanitizeCounts,
  redactText: RedactFn,
): StructuredSnapshotMessagePart | null => {
  if (!part || typeof part !== 'object') return null;
  const sanitized: StructuredSnapshotMessagePart = { ...part };
  const maybeRedact = (value: unknown): unknown =>
    typeof value === 'string' ? redactText(value, profileKey, counts) : value;

  sanitized.speaker = maybeRedact(sanitized.speaker) as string | undefined;
  if (Array.isArray(part.lines)) sanitized.lines = part.lines.map((line) => maybeRedact(line) as string);
  if (Array.isArray(part.legacyLines))
    sanitized.legacyLines = part.legacyLines.map((line) => maybeRedact(line) as string);
  if (Array.isArray(part.items))
    sanitized.items = part.items.map((item) => maybeRedact(item)) as StructuredSnapshotMessagePart['items'];
  sanitized.text = maybeRedact(part.text) as string | undefined;
  sanitized.alt = maybeRedact(part.alt) as string | undefined;
  sanitized.title = maybeRedact(part.title) as string | undefined;

  return sanitized;
};

const sanitizeStructuredSnapshot = (
  snapshot: StructuredSnapshot | null | undefined,
  profileKey: string,
  counts: SanitizeCounts,
  redactText: RedactFn,
): StructuredSnapshot | null => {
  if (!snapshot) return null;

  const messages = Array.isArray(snapshot.messages)
    ? snapshot.messages.map((message) => {
        const sanitizedMessage: StructuredSnapshotMessage = { ...message };
        sanitizedMessage.speaker =
          typeof message.speaker === 'string'
            ? redactText(message.speaker, profileKey, counts)
            : message.speaker;
        sanitizedMessage.parts = Array.isArray(message.parts)
          ? message.parts
              .map((part) => sanitizeStructuredPart(part, profileKey, counts, redactText))
              .filter((part): part is StructuredSnapshotMessagePart => Boolean(part))
          : [];
        if (Array.isArray(message.legacyLines) && message.legacyLines.length) {
          Object.defineProperty(sanitizedMessage, 'legacyLines', {
            value: message.legacyLines.map((line) => redactText(line, profileKey, counts)),
            enumerable: false,
            writable: true,
            configurable: true,
          });
        } else {
          delete sanitizedMessage.legacyLines;
        }
        return sanitizedMessage;
      })
    : [];

  const legacyLines = Array.isArray(snapshot.legacyLines)
    ? snapshot.legacyLines.map((line) => redactText(line, profileKey, counts))
    : [];

  return {
    messages,
    legacyLines,
    entryOrigin: Array.isArray(snapshot.entryOrigin) ? snapshot.entryOrigin.slice() : [],
    errors: Array.isArray(snapshot.errors) ? snapshot.errors.slice() : [],
    generatedAt: snapshot.generatedAt || Date.now(),
  };
};

export const createPrivacyPipeline = ({
  profiles = PRIVACY_PROFILES,
  getConfig,
  redactText,
  hasMinorSexualContext,
  getPlayerNames = () => [],
  logger = null,
  storage = null,
}: PrivacyPipelineDependencies): PrivacyPipelineApi => {
  if (typeof redactText !== 'function') {
    throw new Error('createPrivacyPipeline: redactText function is required');
  }

  const getProfileKey = (profileKey: string): string =>
    profiles && profiles[profileKey] ? profileKey : DEFAULT_PRIVACY_PROFILE;

  const applyPrivacyPipeline = (
    session: TranscriptSession,
    rawText: string,
    profileKey: string,
    structuredSnapshot: StructuredSnapshot | null = null,
  ): PrivacyPipelineResult => {
    const activeProfile = getProfileKey(profileKey);
    const counts: SanitizeCounts = {};
    const config = typeof getConfig === 'function' ? getConfig() : undefined;

    const boundRedact: RedactFn = (value, targetProfile, targetCounts) =>
      redactText(value, targetProfile, targetCounts, config, profiles);

    const sanitizedSession = cloneSession(session);
    sanitizedSession.turns = sanitizedSession.turns.map((turn) => {
      const next: TranscriptTurn = { ...turn };
      next.text = boundRedact(turn.text, activeProfile, counts);
      if (next.speaker) next.speaker = boundRedact(next.speaker, activeProfile, counts);
      if (Array.isArray(turn.__gmhEntries)) {
        Object.defineProperty(next, '__gmhEntries', {
          value: turn.__gmhEntries.slice(),
          enumerable: false,
          writable: true,
          configurable: true,
        });
      }
      if (Array.isArray(turn.__gmhSourceBlocks)) {
        Object.defineProperty(next, '__gmhSourceBlocks', {
          value: turn.__gmhSourceBlocks.slice(),
          enumerable: false,
          writable: true,
          configurable: true,
        });
      }
      return next;
    });

    const sanitizedMeta: Record<string, unknown> = {};
    Object.entries(sanitizedSession.meta || {}).forEach(([key, value]) => {
      if (typeof value === 'string') {
        sanitizedMeta[key] = boundRedact(value, activeProfile, counts);
      } else if (Array.isArray(value)) {
        sanitizedMeta[key] = value.map((item) =>
          typeof item === 'string' ? boundRedact(item, activeProfile, counts) : item,
        );
      } else {
        sanitizedMeta[key] = value;
      }
    });
    sanitizedSession.meta = sanitizedMeta;

    sanitizedSession.warnings = sanitizedSession.warnings.map((warning) =>
      typeof warning === 'string' ? boundRedact(warning, activeProfile, counts) : warning,
    );

    const playerNames = getPlayerNames();
    const sanitizedPlayers = playerNames.map((name) => boundRedact(name, activeProfile, counts));
    sanitizedSession.player_names = sanitizedPlayers;

    const sanitizedRaw = boundRedact(rawText, activeProfile, counts);
    const sanitizedStructured = sanitizeStructuredSnapshot(
      structuredSnapshot,
      activeProfile,
      counts,
      boundRedact,
    );

    const totalRedactions = Object.values(counts).reduce(
      (sum, value) => sum + (value || 0),
      0,
    );
    const blocked =
      typeof hasMinorSexualContext === 'function' ? hasMinorSexualContext(rawText) : false;

    const debugEnabled =
      typeof storage?.getItem === 'function' && storage.getItem('gmh_debug_blocking');
    if (logger?.log && (blocked || debugEnabled)) {
      const textLength = typeof rawText === 'string' ? rawText.length : String(rawText ?? '').length;
      logger.log('[GMH Privacy] Blocking decision:', {
        blocked,
        textLength,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      profile: activeProfile,
      sanitizedSession,
      sanitizedRaw,
      structured: sanitizedStructured,
      playerNames: sanitizedPlayers,
      counts,
      totalRedactions,
      blocked,
    };
  };

  return {
    applyPrivacyPipeline,
  };
};
