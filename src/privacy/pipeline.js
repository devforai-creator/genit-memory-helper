import { DEFAULT_PRIVACY_PROFILE, PRIVACY_PROFILES } from './constants.js';

const cloneTurns = (turns = []) =>
  Array.isArray(turns)
    ? turns.map((turn) => {
        const clone = { ...turn };
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

const cloneSession = (session) => {
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

const sanitizeStructuredPart = (part, profileKey, counts, redactText) => {
  if (!part || typeof part !== 'object') return null;
  const sanitized = { ...part };
  const maybeRedact = (value) =>
    typeof value === 'string' ? redactText(value, profileKey, counts) : value;

  sanitized.speaker = maybeRedact(sanitized.speaker);
  if (Array.isArray(part.lines)) sanitized.lines = part.lines.map((line) => maybeRedact(line));
  if (Array.isArray(part.legacyLines))
    sanitized.legacyLines = part.legacyLines.map((line) => maybeRedact(line));
  if (Array.isArray(part.items)) sanitized.items = part.items.map((item) => maybeRedact(item));
  sanitized.text = maybeRedact(part.text);
  sanitized.alt = maybeRedact(part.alt);
  sanitized.title = maybeRedact(part.title);

  return sanitized;
};

const sanitizeStructuredSnapshot = (snapshot, profileKey, counts, redactText) => {
  if (!snapshot) return null;

  const messages = Array.isArray(snapshot.messages)
    ? snapshot.messages.map((message) => {
        const sanitizedMessage = { ...message };
        sanitizedMessage.speaker =
          typeof message.speaker === 'string' ? redactText(message.speaker, profileKey, counts) : message.speaker;
        sanitizedMessage.parts = Array.isArray(message.parts)
          ? message.parts
              .map((part) => sanitizeStructuredPart(part, profileKey, counts, redactText))
              .filter(Boolean)
          : [];
        sanitizedMessage.legacyLines = Array.isArray(message.legacyLines)
          ? message.legacyLines.map((line) => redactText(line, profileKey, counts))
          : [];
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
} = {}) => {
  if (typeof redactText !== 'function') {
    throw new Error('createPrivacyPipeline: redactText function is required');
  }

  const getProfileKey = (profileKey) => (profiles[profileKey] ? profileKey : DEFAULT_PRIVACY_PROFILE);

  const applyPrivacyPipeline = (session, rawText, profileKey, structuredSnapshot = null) => {
    const activeProfile = getProfileKey(profileKey);
    const counts = {};
    const config = typeof getConfig === 'function' ? getConfig() : undefined;

    const boundRedact = (value, targetProfile, targetCounts) =>
      redactText(value, targetProfile, targetCounts, config, profiles);

    const sanitizedSession = cloneSession(session);
    sanitizedSession.turns = sanitizedSession.turns.map((turn) => {
      const next = { ...turn };
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

    const sanitizedMeta = {};
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

    const totalRedactions = Object.values(counts).reduce((sum, value) => sum + (value || 0), 0);
    const blocked = typeof hasMinorSexualContext === 'function' ? hasMinorSexualContext(rawText) : false;

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
