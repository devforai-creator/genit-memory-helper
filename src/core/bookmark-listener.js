const noop = () => {};

export const createBookmarkListener = ({
  document: documentLike,
  ElementClass,
  messageIndexer,
  turnBookmarks,
  console: consoleLike,
} = {}) => {
  const doc = documentLike || (typeof document !== 'undefined' ? document : undefined);
  if (!doc) {
    throw new Error('createBookmarkListener requires a document reference');
  }
  const ElementRef = ElementClass || (typeof Element !== 'undefined' ? Element : undefined);
  const bookmarks = turnBookmarks;
  const indexer = messageIndexer;
  const logger = consoleLike || (typeof console !== 'undefined' ? console : {});
  const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop;

  let active = false;

  const handleBookmarkCandidate = (event) => {
    const target = event.target;
    if (!ElementRef || !(target instanceof ElementRef)) return;
    const message = target.closest('[data-gmh-message-index], [data-turn-index]');
    if (!message) return;
    const indexAttr =
      message.getAttribute('data-gmh-message-index') || message.getAttribute('data-turn-index');
    if (indexAttr === null) return;
    const ordinalAttr =
      message.getAttribute('data-gmh-message-ordinal') || message.getAttribute('data-message-ordinal');
    const messageIdAttr =
      message.getAttribute('data-gmh-message-id') || message.getAttribute('data-message-id');
    const index = Number(indexAttr);

    const lookupOrdinalByIndex = indexer?.lookupOrdinalByIndex;
    const lookupOrdinalByMessageId = indexer?.lookupOrdinalByMessageId;

    const resolvedOrdinal = [
      Number.isFinite(index) && typeof lookupOrdinalByIndex === 'function'
        ? lookupOrdinalByIndex(index)
        : null,
      messageIdAttr && typeof lookupOrdinalByMessageId === 'function'
        ? lookupOrdinalByMessageId(messageIdAttr)
        : null,
      ordinalAttr !== null ? Number(ordinalAttr) : null,
    ].find((value) => Number.isFinite(value) && value > 0);

    if (!Number.isFinite(index)) return;
    if (!bookmarks || typeof bookmarks.record !== 'function') {
      warn('[GMH] bookmark listener missing turnBookmarks.record');
      return;
    }
    bookmarks.record(
      index,
      Number.isFinite(resolvedOrdinal) ? resolvedOrdinal : null,
      messageIdAttr || null,
      'message',
    );
  };

  return {
    start() {
      if (active) return;
      doc.addEventListener('click', handleBookmarkCandidate, true);
      active = true;
    },
    stop() {
      if (!active) return;
      doc.removeEventListener('click', handleBookmarkCandidate, true);
      active = false;
    },
    isActive() {
      return active;
    },
  };
};

export default createBookmarkListener;
