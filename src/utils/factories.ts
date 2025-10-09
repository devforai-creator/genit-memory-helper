/**
 * Wraps export functions so they always receive the latest player name context.
 *
 * @template Session - Export session payload type.
 * @template Raw - Raw transcript type.
 * @template Options - Additional export options.
 * @template Result - Export function result type.
 * @param getPlayerNames Retrieves the current player name list.
 * @param exportFn Export implementation that accepts player-aware options.
 * @returns Export function that injects `playerNames` automatically.
 */
export const withPlayerNames = <
  Session,
  Raw,
  Options extends Record<string, unknown> = Record<string, unknown>,
  Result = unknown,
>(
  getPlayerNames: () => string[],
  exportFn: (
    session: Session,
    raw: Raw,
    options?: Options & {
      playerNames?: string[];
    },
  ) => Result,
): ((session: Session, raw: Raw, options?: Options) => Result) => {
  return (session, raw, options) =>
    exportFn(session, raw, {
      playerNames: getPlayerNames(),
      ...(options ?? ({} as Options)),
    });
};

export default {
  withPlayerNames,
};
