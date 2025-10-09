import type { ShareWorkflowApi, ShareWorkflowOptions, TranscriptSession, TranscriptTurn } from '../types';

type SessionInput = TranscriptSession | null | undefined;

type SessionStats = {
  userMessages: number;
  llmMessages: number;
  totalMessages: number;
  warnings: number;
};

type ShareWorkflowWithStats = ShareWorkflowApi & { collectSessionStats: typeof collectSessionStats };

type ComposeShareWorkflowOptions = Omit<ShareWorkflowOptions, 'cloneSession' | 'collectSessionStats'> & {
  createShareWorkflow: (options: ShareWorkflowOptions) => ShareWorkflowApi;
};

const cloneSession = (session: SessionInput): TranscriptSession => {
  const clonedTurns: TranscriptTurn[] = Array.isArray(session?.turns)
    ? session!.turns.map((turn) => {
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

  const clonedSession: TranscriptSession = {
    turns: clonedTurns,
    meta: { ...(session?.meta || {}) },
    warnings: Array.isArray(session?.warnings) ? [...session!.warnings] : [],
    source: session?.source,
  };

  if (Array.isArray(session?.player_names)) {
    clonedSession.player_names = [...session.player_names];
  }

  return clonedSession;
};

const collectSessionStats = (session: SessionInput): SessionStats => {
  if (!session) {
    return { userMessages: 0, llmMessages: 0, totalMessages: 0, warnings: 0 };
  }

  const turns = Array.isArray(session.turns) ? session.turns : [];
  const userMessages = turns.filter((turn) => turn.channel === 'user').length;
  const llmMessages = turns.filter((turn) => turn.channel === 'llm').length;
  const totalMessages = turns.length;
  const warnings = Array.isArray(session.warnings) ? session.warnings.length : 0;

  return { userMessages, llmMessages, totalMessages, warnings };
};

/**
 * Wires the share workflow with grouped dependencies returned from index.
 *
 * @param options Dependency container.
 * @returns Share workflow API with helper statistics.
 */
export const composeShareWorkflow = ({
  createShareWorkflow,
  ...options
}: ComposeShareWorkflowOptions): ShareWorkflowWithStats => {
  const shareApi = createShareWorkflow({
    ...options,
    cloneSession,
    collectSessionStats,
  });

  return {
    ...shareApi,
    collectSessionStats,
  };
};
