import type {
  BookmarkListener,
  BookmarkListenerOptions,
  MessageIndexer,
  TurnBookmarks,
} from '../types';

type ConsoleWithWarn =
  | Console
  | {
      warn?: (...args: unknown[]) => void;
    };

const noop = (): void => {};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const resolveDocument = (doc?: Document | null): Document | undefined =>
  doc ?? (typeof document !== 'undefined' ? document : undefined);

const resolveElementClass = (ElementClass?: typeof Element): typeof Element | undefined =>
  ElementClass ?? (typeof Element !== 'undefined' ? Element : undefined);

const resolveConsole = (consoleLike?: ConsoleWithWarn | null): ConsoleWithWarn =>
  consoleLike ?? (typeof console !== 'undefined' ? console : {});

const resolveMessageIndexer = (indexer?: MessageIndexer | null): MessageIndexer | null =>
  indexer ?? null;

const resolveTurnBookmarks = (bookmarks?: TurnBookmarks | null): TurnBookmarks | null =>
  bookmarks ?? null;

const ensureWarn = (logger: ConsoleWithWarn): ((...args: unknown[]) => void) =>
  typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop;

const toElement = (target: EventTarget | null, ElementRef?: typeof Element): Element | null => {
  if (!ElementRef || !target || !(target instanceof ElementRef)) return null;
  return target;
};

const lookupOrdinal = (
  index: number,
  messageId: string | null,
  indexer: MessageIndexer | null,
  ordinalAttr: string | null,
): number | null => {
  const byIndex = Number.isFinite(index) && indexer?.lookupOrdinalByIndex
    ? indexer.lookupOrdinalByIndex(index)
    : null;
  const byMessageId =
    messageId && indexer?.lookupOrdinalByMessageId
      ? indexer.lookupOrdinalByMessageId(messageId)
      : null;
  const byAttribute =
    ordinalAttr !== null && ordinalAttr !== undefined ? Number(ordinalAttr) : null;

  const resolved = [byIndex, byMessageId, byAttribute].find(
    (value) => typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
  return typeof resolved === 'number' ? resolved : null;
};

export const createBookmarkListener = ({
  document: documentLike,
  ElementClass,
  messageIndexer,
  turnBookmarks,
  console: consoleLike,
}: BookmarkListenerOptions = {}): BookmarkListener => {
  const doc = resolveDocument(documentLike);
  if (!doc) {
    throw new Error('createBookmarkListener requires a document reference');
  }

  const ElementRef = resolveElementClass(ElementClass);
  const bookmarks = resolveTurnBookmarks(turnBookmarks);
  const indexer = resolveMessageIndexer(messageIndexer);
  const logger = resolveConsole(consoleLike);
  const warn = ensureWarn(logger);

  let active = false;

  const handleBookmarkCandidate = (event: MouseEvent): void => {
    const target = toElement(event.target, ElementRef);
    if (!target) return;

    const message = target.closest<HTMLElement>('[data-gmh-message-index], [data-turn-index]');
    if (!message) return;

    const indexAttr =
      message.getAttribute('data-gmh-message-index') ?? message.getAttribute('data-turn-index');
    if (indexAttr === null) return;

    const index = Number(indexAttr);
    if (!Number.isFinite(index)) return;

    const ordinalAttr =
      message.getAttribute('data-gmh-message-ordinal') ?? message.getAttribute('data-message-ordinal');
    const messageIdAttr =
      message.getAttribute('data-gmh-message-id') ?? message.getAttribute('data-message-id');

    const resolvedOrdinal = lookupOrdinal(
      index,
      messageIdAttr,
      indexer,
      ordinalAttr,
    );

    if (!bookmarks || typeof bookmarks.record !== 'function') {
      warn('[GMH] bookmark listener missing turnBookmarks.record');
      return;
    }

    bookmarks.record(
      index,
      resolvedOrdinal,
      messageIdAttr ?? null,
      'message',
    );
  };

  const api: BookmarkListener = {
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

  return api;
};

export default createBookmarkListener;
