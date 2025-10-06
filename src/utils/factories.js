/**
 * Wraps export functions so they automatically receive current player name context.
 */
export const withPlayerNames = (getPlayerNames, exportFn) =>
  (session, raw, options = {}) =>
    exportFn(session, raw, {
      playerNames: getPlayerNames(),
      ...options,
    });

export default {
  withPlayerNames,
};
