const noop = () => {};

export const createExportRange = ({
  console: consoleLike,
  window: windowLike,
  localStorage,
} = {}) => {
  const logger = consoleLike || (typeof console !== 'undefined' ? console : {});
  const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop;
  const table = typeof logger.table === 'function' ? logger.table.bind(logger) : noop;
  const pageWindow = windowLike || (typeof window !== 'undefined' ? window : undefined);
  const storage = localStorage;

  const requested = { start: null, end: null };
  let totals = { message: 0, user: 0, llm: 0, entry: 0 };
  const listeners = new Set();
  let lastWarnTs = 0;

  const toPositiveInt = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Math.floor(num);
  };

  const emitRangeWarning = (message, data) => {
    const now = Date.now();
    if (now - lastWarnTs < 500) return;
    lastWarnTs = now;
    warn('[GMH] export range adjusted:', message, data);
  };

  const isRangeDebugEnabled = () => {
    const flag = pageWindow?.GMH_DEBUG_RANGE;
    if (typeof flag === 'boolean') return flag;
    if (typeof flag === 'string') {
      const trimmed = flag.trim().toLowerCase();
      if (!trimmed) return false;
      return trimmed !== '0' && trimmed !== 'false' && trimmed !== 'off';
    }
    try {
      const stored = storage?.getItem?.('GMH_DEBUG_RANGE');
      if (stored === null || stored === undefined) return false;
      const normalized = stored.trim().toLowerCase();
      return normalized === '1' || normalized === 'true' || normalized === 'on';
    } catch (err) {
      return false;
    }
  };

  const normalizeRequestedOrder = () => {
    if (requested.start !== null && requested.end !== null && requested.start > requested.end) {
      emitRangeWarning('start > end; swapping values', {
        start: requested.start,
        end: requested.end,
      });
      const originalStart = requested.start;
      requested.start = requested.end;
      requested.end = originalStart;
    }
  };

  const clampRequestedToTotal = () => {
    const totalMessages = Number.isFinite(totals.message)
      ? Math.max(0, Math.floor(totals.message))
      : 0;
    if (!totalMessages) {
      if (requested.start !== null || requested.end !== null) {
        emitRangeWarning('clearing range because no messages detected', {
          start: requested.start,
          end: requested.end,
        });
      }
      requested.start = null;
      requested.end = null;
      return;
    }
    normalizeRequestedOrder();
  };

  const resolveBounds = (totalMessages = totals.message) => {
    const total = Number.isFinite(totalMessages) ? Math.max(0, Math.floor(totalMessages)) : 0;

    const rawStart = Number.isFinite(requested.start)
      ? Math.max(1, Math.floor(requested.start))
      : null;
    const rawEnd = Number.isFinite(requested.end) ? Math.max(1, Math.floor(requested.end)) : null;
    const hasStart = rawStart !== null;
    const hasEnd = rawEnd !== null;
    const active = hasStart || hasEnd;

    if (!total) {
      return {
        axis: 'message',
        active,
        start: null,
        end: null,
        count: 0,
        total,
        messageTotal: totalMessages,
        userTotal: totals.user,
        llmTotal: totals.llm,
        entryTotal: totals.entry,
        all: totals.entry,
        requestedStart: rawStart,
        requestedEnd: rawEnd,
        desiredStart: null,
        desiredEnd: null,
        intersectionStart: null,
        intersectionEnd: null,
        reason: active ? 'empty' : 'all',
      };
    }

    const defaultStart = hasStart ? rawStart : 1;
    const defaultEnd = hasEnd ? rawEnd : total;
    const desiredStart = Math.min(defaultStart, defaultEnd);
    const desiredEnd = Math.max(defaultStart, defaultEnd);

    const availableStart = 1;
    const availableEnd = total;
    const intersectionStart = Math.max(desiredStart, availableStart);
    const intersectionEnd = Math.min(desiredEnd, availableEnd);

    let effectiveStart;
    let effectiveEnd;
    let reason = 'exact';

    if (intersectionStart <= intersectionEnd) {
      const clampToAvailable = (value) => Math.min(availableEnd, Math.max(availableStart, value));

      const startCandidate = hasStart ? clampToAvailable(rawStart) : intersectionStart;
      const endCandidate = hasEnd ? clampToAvailable(rawEnd) : intersectionEnd;

      effectiveStart = Math.min(startCandidate, endCandidate);
      effectiveEnd = Math.max(startCandidate, endCandidate);

      if (effectiveStart > intersectionStart) effectiveStart = intersectionStart;
      if (effectiveEnd < intersectionEnd) effectiveEnd = intersectionEnd;

      if (effectiveStart !== desiredStart || effectiveEnd !== desiredEnd) {
        reason = 'intersect';
      }
    } else {
      const wantsOlder = desiredStart > availableEnd;
      const nearest = wantsOlder ? availableEnd : availableStart;
      effectiveStart = nearest;
      effectiveEnd = nearest;
      reason = 'nearest';
    }

    const normalizedStart = Math.min(effectiveStart, effectiveEnd);
    const normalizedEnd = Math.max(effectiveStart, effectiveEnd);
    const count = active ? Math.max(0, normalizedEnd - normalizedStart + 1) : total;

    return {
      axis: 'message',
      active,
      start: active ? normalizedStart : 1,
      end: active ? normalizedEnd : total,
      count,
      total,
      messageTotal: totalMessages,
      userTotal: totals.user,
      llmTotal: totals.llm,
      entryTotal: totals.entry,
      all: totals.entry,
      requestedStart: rawStart,
      requestedEnd: rawEnd,
      desiredStart,
      desiredEnd,
      intersectionStart: intersectionStart <= intersectionEnd ? intersectionStart : null,
      intersectionEnd: intersectionStart <= intersectionEnd ? intersectionEnd : null,
      reason,
    };
  };

  const buildMessageUnits = (turns = []) => {
    const units = [];
    const blockUnitMap = new Map();

    const ensureUnit = (blockIdx, fallbackOrder = null) => {
      if (blockIdx !== null && blockUnitMap.has(blockIdx)) {
        return blockUnitMap.get(blockIdx);
      }
      const unit = {
        blockIdx,
        turnIndices: new Set(),
        order: units.length,
        fallbackOrder,
      };
      units.push(unit);
      if (blockIdx !== null) blockUnitMap.set(blockIdx, unit);
      return unit;
    };

    turns.forEach((turn, idx) => {
      const sourceBlocks = Array.isArray(turn?.__gmhSourceBlocks)
        ? turn.__gmhSourceBlocks.filter((value) => Number.isInteger(value) && value >= 0)
        : [];
      if (sourceBlocks.length) {
        sourceBlocks.forEach((blockIdx) => {
          const unit = ensureUnit(blockIdx);
          unit.turnIndices.add(idx);
        });
      } else {
        const unit = ensureUnit(null, idx);
        unit.turnIndices.add(idx);
      }
    });

    const totalMessages = units.length;
    const ordinalByTurnIndex = new Map();
    const ordinalByBlockIndex = new Map();

    for (let pos = 0; pos < units.length; pos += 1) {
      const unit = units[pos];
      const ordinalFromLatest = totalMessages - pos;
      unit.ordinal = ordinalFromLatest;
      if (unit.blockIdx !== null) {
        ordinalByBlockIndex.set(unit.blockIdx, ordinalFromLatest);
      }
      unit.turnIndices.forEach((turnIdx) => {
        ordinalByTurnIndex.set(turnIdx, ordinalFromLatest);
      });
    }

    return {
      units,
      totalMessages,
      ordinalByTurnIndex,
      ordinalByBlockIndex,
    };
  };

  const snapshot = () => ({
    range: { ...requested },
    totals: { ...totals },
    bounds: resolveBounds(),
  });

  const notify = () => {
    const current = snapshot();
    listeners.forEach((listener) => {
      try {
        listener(current);
      } catch (err) {
        warn('[GMH] range listener failed', err);
      }
    });
  };

  const apply = (turns = [], options = {}) => {
    const list = Array.isArray(turns) ? turns : [];
    const settings = options && typeof options === 'object' ? options : {};
    if (!list.length) {
      return {
        turns: [],
        indices: [],
        ordinals: [],
        info: resolveBounds(0),
      };
    }

    const includeIndices = new Set();
    if (Array.isArray(settings.includeIndices)) {
      settings.includeIndices
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .forEach((value) => includeIndices.add(value));
    }

    const { units, totalMessages, ordinalByTurnIndex } = buildMessageUnits(list);
    const bounds = resolveBounds(totalMessages);

    if ((bounds.reason === 'intersect' || bounds.reason === 'nearest') && isRangeDebugEnabled()) {
      warn('[GMH] range projection', {
        requested: [bounds.requestedStart, bounds.requestedEnd],
        desired: [bounds.desiredStart, bounds.desiredEnd],
        intersection:
          bounds.intersectionStart !== null && bounds.intersectionEnd !== null
            ? [bounds.intersectionStart, bounds.intersectionEnd]
            : null,
        applied: [bounds.start, bounds.end],
        total: totalMessages,
        reason: bounds.reason,
      });
    }

    const collectIndicesInWindow = (startPos, endPos) => {
      const indices = new Set();
      for (let pos = startPos; pos <= endPos; pos += 1) {
        const unit = units[pos];
        unit.turnIndices.forEach((idx) => indices.add(idx));
      }
      includeIndices.forEach((idx) => indices.add(idx));
      return Array.from(indices)
        .filter((idx) => idx >= 0 && idx < list.length)
        .sort((a, b) => a - b);
    };

    const deriveSelection = (startPos, endPos) => {
      const clampedStart = Math.max(0, Math.min(startPos, units.length - 1));
      const clampedEnd = Math.max(clampedStart, Math.min(endPos, units.length - 1));
      const selectedUnits = units.slice(clampedStart, clampedEnd + 1);
      const indices = collectIndicesInWindow(clampedStart, clampedEnd);
      const turnsOut = indices.map((idx) => list[idx] ?? null).filter(Boolean);
      const ordinals = indices.map((idx) => ordinalByTurnIndex.get(idx) || null);
      const startIndex = indices.length ? indices[0] : -1;
      const endIndex = indices.length ? indices[indices.length - 1] : -1;
      const firstUnit = selectedUnits[0] ?? null;
      const lastUnit = selectedUnits[selectedUnits.length - 1] ?? null;
      return {
        turns: turnsOut,
        indices,
        ordinals,
        rangeDetails: {
          startIndex,
          endIndex,
          messageStartIndex: firstUnit?.blockIdx ?? null,
          messageEndIndex: lastUnit?.blockIdx ?? null,
        },
      };
    };

    if (!bounds.count || !bounds.active) {
      const {
        turns: turnsOut,
        indices,
        ordinals,
        rangeDetails,
      } = deriveSelection(0, units.length - 1);
      return {
        turns: turnsOut,
        indices,
        ordinals,
        info: {
          ...bounds,
          startIndex: rangeDetails.startIndex,
          endIndex: rangeDetails.endIndex,
          messageStartIndex: rangeDetails.messageStartIndex,
          messageEndIndex: rangeDetails.messageEndIndex,
        },
      };
    }

    const startPos = Math.max(0, totalMessages - bounds.end);
    const endPos = Math.max(startPos, totalMessages - bounds.start);
    const {
      turns: turnsOut,
      indices,
      ordinals,
      rangeDetails,
    } = deriveSelection(startPos, endPos);

    if (settings.traceRange) {
      table({
        axis: 'message',
        startOrdinal: bounds.start,
        endOrdinal: bounds.end,
        resolvedStartIndex: rangeDetails.startIndex,
        resolvedEndIndex: rangeDetails.endIndex,
        totalMessages,
        includeCount: includeIndices.size,
      });
    }

    return {
      turns: turnsOut,
      indices,
      ordinals,
      info: {
        ...bounds,
        startIndex: rangeDetails.startIndex,
        endIndex: rangeDetails.endIndex,
        messageStartIndex: rangeDetails.messageStartIndex,
        messageEndIndex: rangeDetails.messageEndIndex,
      },
    };
  };

  return {
    getRange() {
      return { ...requested };
    },
    getTotals() {
      return { ...totals };
    },
    describe(totalMessages = totals.message) {
      return resolveBounds(totalMessages);
    },
    apply,
    setStart(value) {
      const next = toPositiveInt(value);
      if (requested.start === next) return snapshot();
      requested.start = next;
      normalizeRequestedOrder();
      notify();
      return snapshot();
    },
    setEnd(value) {
      const next = toPositiveInt(value);
      if (requested.end === next) return snapshot();
      requested.end = next;
      normalizeRequestedOrder();
      notify();
      return snapshot();
    },
    setRange(startValue, endValue) {
      const nextStart = toPositiveInt(startValue);
      const nextEnd = toPositiveInt(endValue);
      if (requested.start === nextStart && requested.end === nextEnd) return snapshot();
      requested.start = nextStart;
      requested.end = nextEnd;
      normalizeRequestedOrder();
      notify();
      return snapshot();
    },
    clear() {
      if (requested.start === null && requested.end === null) return snapshot();
      requested.start = null;
      requested.end = null;
      notify();
      return snapshot();
    },
    setTotals(input = {}) {
      const nextMessage = Number.isFinite(Number(input.message ?? input.entry ?? input.all))
        ? Math.max(0, Math.floor(Number(input.message ?? input.entry ?? input.all)))
        : 0;
      const nextUser = Number.isFinite(Number(input.user ?? input.player))
        ? Math.max(0, Math.floor(Number(input.user ?? input.player)))
        : 0;
      const nextLlm = Number.isFinite(Number(input.llm))
        ? Math.max(0, Math.floor(Number(input.llm)))
        : 0;
      const entrySource = input.entry ?? input.all ?? nextMessage;
      const nextEntry = Number.isFinite(Number(entrySource))
        ? Math.max(0, Math.floor(Number(entrySource)))
        : 0;
      if (
        totals.message === nextMessage &&
        totals.user === nextUser &&
        totals.llm === nextLlm &&
        totals.entry === nextEntry
      ) {
        return snapshot();
      }
      totals = {
        message: nextMessage,
        user: nextUser,
        llm: nextLlm,
        entry: nextEntry,
      };
      clampRequestedToTotal();
      notify();
      return snapshot();
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return noop;
      listeners.add(listener);
      try {
        listener(snapshot());
      } catch (err) {
        warn('[GMH] range subscriber failed', err);
      }
      return () => listeners.delete(listener);
    },
    snapshot,
  };
};

export default createExportRange;
