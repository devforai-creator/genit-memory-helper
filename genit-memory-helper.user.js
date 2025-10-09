// ==UserScript==
// @name         Genit Memory Helper
// @namespace    local.dev
// @version      1.11.0
// @description  Genit 대화로그 JSON/TXT/MD 추출 + 요약/재요약 프롬프트 복사 기능
// @author       devforai-creator
// @match        https://genit.ai/*
// @match        https://www.genit.ai/*
// @grant        GM_setClipboard
// @run-at       document-idle
// @updateURL    https://github.com/devforai-creator/genit-memory-helper/raw/main/genit-memory-helper.user.js
// @downloadURL  https://github.com/devforai-creator/genit-memory-helper/raw/main/genit-memory-helper.user.js
// @license      GPL-3.0-or-later
// ==/UserScript==

var GMHBundle = (function (exports) {
    'use strict';

    const createModuleBucket = () => ({});
    const GMH = {
        VERSION: '0.0.0-dev',
        Util: createModuleBucket(),
        Privacy: createModuleBucket(),
        Export: createModuleBucket(),
        UI: createModuleBucket(),
        Core: createModuleBucket(),
        Adapters: createModuleBucket(),
    };

    const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
    const clone = (value) => {
        try {
            return JSON.parse(JSON.stringify(value));
        }
        catch {
            return value;
        }
    };
    const deepMerge = (target, patch) => {
        const base = Array.isArray(target)
            ? [...target]
            : { ...target };
        if (!patch || typeof patch !== 'object')
            return base;
        Object.entries(patch).forEach(([key, value]) => {
            if (isPlainObject(value)) {
                const current = base[key];
                const nextSource = isPlainObject(current) ? current : {};
                base[key] = deepMerge(nextSource, value);
            }
            else {
                base[key] = value;
            }
        });
        return base;
    };

    const fallbackClipboard = (text) => {
      if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
    };

    const detectWindow = () => {
      if (typeof unsafeWindow !== 'undefined') return unsafeWindow;
      if (typeof window !== 'undefined') return window;
      return undefined;
    };

    const detectGMInfo = () => {
      if (typeof GM_info !== 'undefined' && GM_info?.script) {
        return GM_info;
      }
      return { script: { version: '0.0.0-dev' } };
    };

    const ENV = {
      window: detectWindow(),
      GM_setClipboard:
        typeof GM_setClipboard === 'function' ? GM_setClipboard : fallbackClipboard,
      GM_info: detectGMInfo(),
      console: typeof console !== 'undefined' ? console : { log() {}, warn() {}, error() {} },
      localStorage:
        typeof localStorage !== 'undefined' ? localStorage : undefined,
    };

    const noop$5 = () => { };
    const GMH_STATE = {
        IDLE: 'idle',
        SCANNING: 'scanning',
        REDACTING: 'redacting',
        PREVIEW: 'preview',
        EXPORTING: 'exporting',
        DONE: 'done',
        ERROR: 'error',
    };
    const STATE_TRANSITIONS = {
        idle: ['idle', 'scanning', 'redacting', 'error'],
        scanning: ['scanning', 'redacting', 'preview', 'done', 'error', 'idle'],
        redacting: ['redacting', 'preview', 'exporting', 'done', 'error', 'idle'],
        preview: ['preview', 'exporting', 'idle', 'done', 'error'],
        exporting: ['exporting', 'done', 'error', 'idle'],
        done: ['done', 'idle', 'scanning', 'redacting'],
        error: ['error', 'idle', 'scanning', 'redacting'],
    };
    const normalizeState$1 = (value) => {
        if (!value)
            return null;
        const next = String(value).toLowerCase();
        return Object.values(GMH_STATE).includes(next) ? next : null;
    };
    const createStateManager = ({ console: consoleLike, debug } = {}) => {
        const defaultConsole = typeof console !== 'undefined' ? console : null;
        const logger = consoleLike ?? defaultConsole ?? { warn: noop$5, error: noop$5 };
        const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop$5;
        const error = typeof logger.error === 'function' ? logger.error.bind(logger) : noop$5;
        const debugLog = typeof debug === 'function' ? debug : noop$5;
        const subscribers = new Set();
        const state = {
            current: GMH_STATE.IDLE,
            previous: null,
            payload: null,
            getState() {
                return this.current;
            },
            subscribe(listener) {
                if (typeof listener !== 'function')
                    return noop$5;
                subscribers.add(listener);
                return () => {
                    subscribers.delete(listener);
                };
            },
            setState(nextState, payload) {
                const next = normalizeState$1(nextState);
                if (!next) {
                    warn('[GMH] unknown state requested', nextState);
                    return false;
                }
                const allowed = STATE_TRANSITIONS[this.current]?.includes(next);
                if (!allowed) {
                    warn('[GMH] invalid state transition', this.current, '→', next);
                    return false;
                }
                this.previous = this.current;
                this.current = next;
                this.payload = payload ?? null;
                try {
                    debugLog('state →', this.current, this.payload);
                }
                catch {
                    // swallow debug errors
                }
                subscribers.forEach((listener) => {
                    try {
                        const meta = {
                            previous: this.previous,
                            payload: this.payload,
                        };
                        listener(this.current, meta);
                    }
                    catch (err) {
                        error('[GMH] state listener failed', err);
                    }
                });
                return true;
            },
            reset() {
                this.setState(GMH_STATE.IDLE, null);
            },
        };
        return state;
    };

    const noop$4 = () => { };
    const ERROR_LEVELS = {
        DEBUG: 'debug',
        INFO: 'info',
        WARN: 'warn',
        ERROR: 'error',
        FATAL: 'fatal',
    };
    const ERROR_CONTEXT_LABELS = {
        'privacy/load': '프라이버시 설정 로드 실패',
        'privacy/save': '프라이버시 설정 저장 실패',
        'privacy/redact': '레다크션 실패',
        'storage/read': '저장소 읽기 실패',
        'storage/write': '저장소 쓰기 실패',
        snapshot: 'DOM 스냅샷 실패',
        parse: '파싱 실패',
        'parse/structured': '구조화 파싱 실패',
        export: '내보내기 실패',
        'export/file': '파일 다운로드 실패',
        'export/clipboard': '클립보드 복사 실패',
        autoload: '자동 로딩 실패',
        'autoload/scroll': '자동 스크롤 실패',
        'ui/panel': '패널 렌더링 실패',
        'ui/modal': '모달 표시 실패',
        adapter: '어댑터 오류',
        'adapter/detect': '어댑터 감지 실패',
        range: '범위 계산 실패',
        bookmark: '북마크 오류',
    };
    const ERROR_LOG_KEY = 'gmh_error_log';
    const ERROR_LOG_MAX = 100;
    const normalizeLevel = (level) => {
        const validLevels = Object.values(ERROR_LEVELS);
        return validLevels.includes(level) ? level : ERROR_LEVELS.ERROR;
    };
    const extractMessage = (error) => {
        if (!error)
            return '알 수 없는 오류';
        if (typeof error === 'string')
            return error;
        if (typeof error === 'object' && error !== null && 'message' in error) {
            const message = error.message;
            if (typeof message === 'string')
                return message;
        }
        return String(error);
    };
    const ensureConsole = (consoleLike) => {
        if (consoleLike)
            return consoleLike;
        if (typeof console !== 'undefined')
            return console;
        return { info: noop$4, warn: noop$4, error: noop$4 };
    };
    const createErrorHandler = ({ console: consoleLike, alert: alertImpl, localStorage, state, } = {}) => {
        const logger = ensureConsole(consoleLike);
        const info = typeof logger.info === 'function' ? logger.info.bind(logger) : noop$4;
        const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop$4;
        const error = typeof logger.error === 'function' ? logger.error.bind(logger) : noop$4;
        const alertFn = typeof alertImpl === 'function' ? alertImpl : noop$4;
        const storage = localStorage;
        const stateApi = state ?? undefined;
        const logToConsole = (context, message, original, level) => {
            const prefix = `[GMH:${context}]`;
            switch (level) {
                case ERROR_LEVELS.DEBUG:
                case ERROR_LEVELS.INFO:
                    return info(prefix, message, original);
                case ERROR_LEVELS.WARN:
                    return warn(prefix, message, original);
                case ERROR_LEVELS.ERROR:
                case ERROR_LEVELS.FATAL:
                default:
                    return error(prefix, message, original);
            }
        };
        const updateUIState = (context, message, level) => {
            if (!stateApi || typeof stateApi.setState !== 'function')
                return;
            const label = ERROR_CONTEXT_LABELS[context] || '오류 발생';
            try {
                stateApi.setState(GMH_STATE.ERROR, {
                    label,
                    message,
                    tone: level === ERROR_LEVELS.FATAL ? 'error' : 'error',
                    progress: { value: 1 },
                });
            }
            catch (err) {
                error('[GMH] Failed to update UI state', err);
            }
        };
        const alertUser = (context, message) => {
            const label = ERROR_CONTEXT_LABELS[context] || '오류';
            try {
                alertFn(`${label}\n\n${message}`);
            }
            catch (err) {
                error('[GMH] Failed to show alert', err);
            }
        };
        const persistError = (data) => {
            if (!storage || typeof storage.getItem !== 'function')
                return;
            try {
                const stored = storage.getItem(ERROR_LOG_KEY);
                const errors = stored ? JSON.parse(stored) : [];
                errors.push(data);
                if (errors.length > ERROR_LOG_MAX) {
                    errors.splice(0, errors.length - ERROR_LOG_MAX);
                }
                storage.setItem(ERROR_LOG_KEY, JSON.stringify(errors));
            }
            catch (err) {
                warn('[GMH] Failed to persist error log', err);
            }
        };
        const handler = {
            LEVELS: ERROR_LEVELS,
            handle(errorInput, context, level = ERROR_LEVELS.ERROR) {
                const message = extractMessage(errorInput);
                const timestamp = new Date().toISOString();
                const normalizedLevel = normalizeLevel(level);
                let stackValue = null;
                if (typeof errorInput === 'object' && errorInput) {
                    const stackCandidate = errorInput.stack;
                    if (typeof stackCandidate === 'string') {
                        stackValue = stackCandidate;
                    }
                }
                logToConsole(context, message, errorInput, normalizedLevel);
                if (normalizedLevel === ERROR_LEVELS.ERROR || normalizedLevel === ERROR_LEVELS.FATAL) {
                    updateUIState(context, message, normalizedLevel);
                }
                if (normalizedLevel === ERROR_LEVELS.FATAL) {
                    alertUser(context, message);
                }
                persistError({
                    timestamp,
                    context: context || 'unknown',
                    level: normalizedLevel,
                    message,
                    stack: stackValue,
                });
                return message;
            },
            getErrorLog() {
                if (!storage || typeof storage.getItem !== 'function')
                    return [];
                try {
                    const stored = storage.getItem(ERROR_LOG_KEY);
                    return stored ? JSON.parse(stored) : [];
                }
                catch (err) {
                    warn('[GMH] Failed to read error log', err);
                    return [];
                }
            },
            clearErrorLog() {
                if (!storage || typeof storage.removeItem !== 'function')
                    return false;
                try {
                    storage.removeItem(ERROR_LOG_KEY);
                    return true;
                }
                catch (err) {
                    warn('[GMH] Failed to clear error log', err);
                    return false;
                }
            },
        };
        return handler;
    };

    const noop$3 = () => { };
    const createExportRange = ({ console: consoleLike, window: windowLike, localStorage, } = {}) => {
        const defaultConsole = typeof console !== 'undefined' ? console : null;
        const logger = consoleLike ?? defaultConsole ?? {};
        const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop$3;
        const table = typeof logger.table === 'function'
            ? logger.table.bind(logger)
            : noop$3;
        const pageWindow = windowLike ??
            (typeof window !== 'undefined' ? window : undefined);
        const storage = localStorage ?? null;
        const requested = {
            start: null,
            end: null,
        };
        let totals = { message: 0, user: 0, llm: 0, entry: 0 };
        const listeners = new Set();
        let lastWarnTs = 0;
        const toPositiveInt = (value) => {
            if (typeof value !== 'number' && typeof value !== 'string')
                return null;
            const num = Number(value);
            if (!Number.isFinite(num) || num <= 0)
                return null;
            return Math.floor(num);
        };
        const emitRangeWarning = (message, data) => {
            const now = Date.now();
            if (now - lastWarnTs < 500)
                return;
            lastWarnTs = now;
            warn('[GMH] export range adjusted:', message, data);
        };
        const isRangeDebugEnabled = () => {
            const flag = pageWindow?.GMH_DEBUG_RANGE;
            if (typeof flag === 'boolean')
                return flag;
            if (typeof flag === 'string') {
                const trimmed = flag.trim().toLowerCase();
                if (!trimmed)
                    return false;
                return trimmed !== '0' && trimmed !== 'false' && trimmed !== 'off';
            }
            try {
                const stored = storage?.getItem?.('GMH_DEBUG_RANGE');
                if (stored === null || stored === undefined)
                    return false;
                const normalized = stored.trim().toLowerCase();
                return normalized === '1' || normalized === 'true' || normalized === 'on';
            }
            catch {
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
            const totalMessages = typeof totals.message === 'number' && Number.isFinite(totals.message)
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
            const total = typeof totalMessages === 'number' && Number.isFinite(totalMessages)
                ? Math.max(0, Math.floor(totalMessages))
                : 0;
            const rawStart = typeof requested.start === 'number' && Number.isFinite(requested.start)
                ? Math.max(1, Math.floor(requested.start))
                : null;
            const rawEnd = typeof requested.end === 'number' && Number.isFinite(requested.end)
                ? Math.max(1, Math.floor(requested.end))
                : null;
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
                    messageTotal: typeof totalMessages === 'number' ? totalMessages : 0,
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
                const clampToAvailable = (value) => {
                    if (typeof value !== 'number' || !Number.isFinite(value)) {
                        return availableStart;
                    }
                    return Math.min(availableEnd, Math.max(availableStart, value));
                };
                const startCandidate = hasStart ? clampToAvailable(rawStart) : intersectionStart;
                const endCandidate = hasEnd ? clampToAvailable(rawEnd) : intersectionEnd;
                effectiveStart = Math.min(startCandidate, endCandidate);
                effectiveEnd = Math.max(startCandidate, endCandidate);
                if (effectiveStart > intersectionStart)
                    effectiveStart = intersectionStart;
                if (effectiveEnd < intersectionEnd)
                    effectiveEnd = intersectionEnd;
                if (effectiveStart !== desiredStart || effectiveEnd !== desiredEnd) {
                    reason = 'intersect';
                }
            }
            else {
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
                messageTotal: typeof totalMessages === 'number' ? totalMessages : total,
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
                if (blockIdx !== null) {
                    blockUnitMap.set(blockIdx, unit);
                }
                return unit;
            };
            turns.forEach((turn, idx) => {
                const sourceBlocks = Array.isArray(turn.__gmhSourceBlocks)
                    ? turn.__gmhSourceBlocks.filter((value) => Number.isInteger(value) && value >= 0)
                    : [];
                if (sourceBlocks.length) {
                    sourceBlocks.forEach((blockIdx) => {
                        const unit = ensureUnit(blockIdx);
                        unit.turnIndices.add(idx);
                    });
                }
                else {
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
                }
                catch (err) {
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
                    rangeDetails: null,
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
                    intersection: bounds.intersectionStart !== null && bounds.intersectionEnd !== null
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
                const turnsOut = indices
                    .map((idx) => list[idx] ?? null)
                    .filter((turn) => Boolean(turn));
                const ordinals = indices.map((idx) => ordinalByTurnIndex.get(idx) ?? null);
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
                const { turns: turnsOut, indices, ordinals, rangeDetails, } = deriveSelection(0, units.length - 1);
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
                    rangeDetails,
                };
            }
            const startPos = Math.max(0, totalMessages - (bounds.end ?? totalMessages));
            const endPos = Math.max(startPos, totalMessages - (bounds.start ?? 1));
            const { turns: turnsOut, indices, ordinals, rangeDetails, } = deriveSelection(startPos, endPos);
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
                rangeDetails,
            };
        };
        const controller = {
            getRange() {
                return { ...requested };
            },
            getTotals() {
                return { ...totals };
            },
            describe(totalMessages) {
                return resolveBounds(totalMessages);
            },
            apply,
            setStart(value) {
                const next = toPositiveInt(value);
                if (requested.start === next)
                    return snapshot();
                requested.start = next;
                normalizeRequestedOrder();
                notify();
                return snapshot();
            },
            setEnd(value) {
                const next = toPositiveInt(value);
                if (requested.end === next)
                    return snapshot();
                requested.end = next;
                normalizeRequestedOrder();
                notify();
                return snapshot();
            },
            setRange(startValue, endValue) {
                const nextStart = toPositiveInt(startValue);
                const nextEnd = toPositiveInt(endValue);
                if (requested.start === nextStart && requested.end === nextEnd)
                    return snapshot();
                requested.start = nextStart;
                requested.end = nextEnd;
                normalizeRequestedOrder();
                notify();
                return snapshot();
            },
            clear() {
                if (requested.start === null && requested.end === null)
                    return snapshot();
                requested.start = null;
                requested.end = null;
                notify();
                return snapshot();
            },
            setTotals(input = {}) {
                const messageSource = input.message ?? input.entry ?? input.all;
                const nextMessage = Number.isFinite(Number(messageSource))
                    ? Math.max(0, Math.floor(Number(messageSource)))
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
                if (totals.message === nextMessage &&
                    totals.user === nextUser &&
                    totals.llm === nextLlm &&
                    totals.entry === nextEntry) {
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
                if (typeof listener !== 'function')
                    return noop$3;
                listeners.add(listener);
                try {
                    listener(snapshot());
                }
                catch (err) {
                    warn('[GMH] range subscriber failed', err);
                }
                return () => listeners.delete(listener);
            },
            snapshot,
        };
        return controller;
    };

    const noop$2 = () => { };
    const HISTORY_LIMIT = 5;
    const cloneEntry = (entry) => entry ? { ...entry } : null;
    const makeKey = (index, messageId) => {
        if (typeof messageId === 'string' && messageId)
            return `id:${messageId}`;
        if (Number.isFinite(index))
            return `idx:${index}`;
        return `tmp:${Date.now()}`;
    };
    const createTurnBookmarks = ({ console: consoleLike } = {}) => {
        const logger = consoleLike ??
            (typeof console !== 'undefined' ? console : {});
        const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop$2;
        const history = [];
        const listeners = new Set();
        const snapshotHistory = () => history.map((item) => ({ ...item }));
        const emit = () => {
            const snapshot = snapshotHistory();
            listeners.forEach((listener) => {
                try {
                    listener(snapshot);
                }
                catch (err) {
                    warn('[GMH] bookmark listener failed', err);
                }
            });
        };
        const api = {
            record(index, ordinal, messageId, axis) {
                const numericIndex = Number(index);
                if (!Number.isFinite(numericIndex))
                    return null;
                let normalizedOrdinal = null;
                if (ordinal !== null && ordinal !== undefined) {
                    const numericOrdinal = Number(ordinal);
                    if (Number.isFinite(numericOrdinal) && numericOrdinal > 0) {
                        normalizedOrdinal = numericOrdinal;
                    }
                }
                const normalizedId = typeof messageId === 'string' && messageId ? messageId : null;
                if (axis && axis !== 'message') {
                    warn('[GMH] non-message bookmark axis ignored', {
                        axis,
                        index: numericIndex,
                        ordinal: normalizedOrdinal,
                        messageId: normalizedId,
                    });
                }
                const key = makeKey(numericIndex, normalizedId);
                const entry = {
                    key,
                    index: numericIndex,
                    ordinal: normalizedOrdinal,
                    messageId: normalizedId,
                    timestamp: Date.now(),
                };
                const existing = history.findIndex((item) => item.key === key);
                if (existing !== -1)
                    history.splice(existing, 1);
                history.unshift(entry);
                if (history.length > HISTORY_LIMIT)
                    history.length = HISTORY_LIMIT;
                emit();
                return cloneEntry(entry);
            },
            clear() {
                if (!history.length)
                    return;
                history.length = 0;
                emit();
            },
            remove(key) {
                if (!key)
                    return;
                const next = history.findIndex((item) => item.key === key);
                if (next === -1)
                    return;
                history.splice(next, 1);
                emit();
            },
            get() {
                return cloneEntry(history[0]);
            },
            latest() {
                return cloneEntry(history[0]);
            },
            pick(key) {
                if (!key)
                    return null;
                const found = history.find((item) => item.key === key);
                return cloneEntry(found);
            },
            list() {
                return snapshotHistory();
            },
            subscribe(listener) {
                if (typeof listener !== 'function')
                    return noop$2;
                listeners.add(listener);
                try {
                    listener(snapshotHistory());
                }
                catch (err) {
                    warn('[GMH] bookmark subscriber failed', err);
                }
                return () => listeners.delete(listener);
            },
        };
        return api;
    };

    const noop$1 = () => { };
    const cloneSummary = (summary) => ({ ...summary });
    const toIterableElements = (nodes) => Array.from(nodes).filter((node) => node instanceof Element);
    const createMessageIndexer = ({ console: consoleLike, document: documentLike, MutationObserver: MutationObserverLike, requestAnimationFrame: rafLike, exportRange, getActiveAdapter, getEntryOrigin, } = {}) => {
        const logger = consoleLike ??
            (typeof console !== 'undefined' ? console : {});
        const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop$1;
        typeof logger.error === 'function' ? logger.error.bind(logger) : noop$1;
        const documentRef = documentLike ?? (typeof document !== 'undefined' ? document : undefined);
        const MutationObserverRef = MutationObserverLike ?? (typeof MutationObserver !== 'undefined' ? MutationObserver : undefined);
        const raf = typeof rafLike === 'function'
            ? rafLike
            : typeof requestAnimationFrame === 'function'
                ? requestAnimationFrame.bind(globalThis)
                : null;
        const exportRangeRef = exportRange;
        const getAdapter = typeof getActiveAdapter === 'function' ? getActiveAdapter : () => null;
        const getOrigins = typeof getEntryOrigin === 'function' ? getEntryOrigin : () => [];
        if (!documentRef) {
            throw new Error('createMessageIndexer requires a document reference');
        }
        let observer = null;
        let scheduled = false;
        let active = false;
        const ordinalCacheByIndex = new Map();
        const ordinalCacheById = new Map();
        let lastSummary = {
            totalMessages: 0,
            userMessages: 0,
            llmMessages: 0,
            containerPresent: false,
            timestamp: 0,
        };
        const listeners = new Set();
        const notify = () => {
            const snapshot = cloneSummary(lastSummary);
            listeners.forEach((listener) => {
                try {
                    listener(snapshot);
                }
                catch (err) {
                    warn('[GMH] index listener failed', err);
                }
            });
        };
        const indexMessages = () => {
            const adapter = getAdapter();
            const container = adapter?.findContainer?.(documentRef) ?? null;
            const blockNodes = adapter?.listMessageBlocks?.(container ?? documentRef) ?? [];
            const blocks = Array.isArray(blockNodes)
                ? toIterableElements(blockNodes)
                : blockNodes
                    ? toIterableElements(blockNodes)
                    : [];
            let userMessageCount = 0;
            ordinalCacheByIndex.clear();
            ordinalCacheById.clear();
            blocks.forEach((block, idx) => {
                try {
                    block.setAttribute('data-gmh-message', '1');
                    block.setAttribute('data-gmh-message-index', String(idx));
                    const messageId = block.getAttribute('data-gmh-message-id') ||
                        block.getAttribute('data-message-id') ||
                        block.getAttribute('data-id') ||
                        null;
                    if (messageId) {
                        block.setAttribute('data-gmh-message-id', messageId);
                    }
                    else {
                        block.removeAttribute('data-gmh-message-id');
                    }
                    const role = adapter?.detectRole?.(block) || 'unknown';
                    block.setAttribute('data-gmh-message-role', role);
                    const channel = role === 'player' ? 'user' : 'llm';
                    block.setAttribute('data-gmh-channel', channel);
                    if (channel === 'user')
                        userMessageCount += 1;
                    block.removeAttribute('data-gmh-player-turn');
                    block.removeAttribute('data-gmh-user-ordinal');
                    block.removeAttribute('data-gmh-message-ordinal');
                }
                catch {
                    // ignore per-node errors
                }
            });
            let messageOrdinal = 0;
            let userOrdinal = 0;
            for (let i = blocks.length - 1; i >= 0; i -= 1) {
                const block = blocks[i];
                if (!block)
                    continue;
                messageOrdinal += 1;
                block.setAttribute('data-gmh-message-ordinal', String(messageOrdinal));
                if (block.getAttribute('data-gmh-channel') === 'user') {
                    userOrdinal += 1;
                    block.setAttribute('data-gmh-user-ordinal', String(userOrdinal));
                }
                else {
                    block.removeAttribute('data-gmh-user-ordinal');
                }
                const blockIdxAttr = block.getAttribute('data-gmh-message-index');
                if (blockIdxAttr !== null) {
                    const numericIdx = Number(blockIdxAttr);
                    if (Number.isFinite(numericIdx)) {
                        ordinalCacheByIndex.set(numericIdx, messageOrdinal);
                    }
                }
                const blockMessageId = block.getAttribute('data-gmh-message-id');
                if (blockMessageId) {
                    ordinalCacheById.set(blockMessageId, messageOrdinal);
                }
            }
            const entryOrigin = getOrigins() || [];
            const entryOriginIndices = Array.isArray(entryOrigin)
                ? entryOrigin.filter((idx) => Number.isInteger(idx) && idx >= 0)
                : [];
            const uniqueEntryCount = entryOriginIndices.length ? new Set(entryOriginIndices).size : 0;
            const entryCount = blocks.length || uniqueEntryCount;
            const llmCount = Math.max(blocks.length - userMessageCount, 0);
            lastSummary = {
                totalMessages: blocks.length,
                userMessages: userMessageCount,
                llmMessages: llmCount,
                containerPresent: Boolean(container),
                timestamp: Date.now(),
            };
            const range = exportRangeRef;
            if (range && typeof range.setTotals === 'function') {
                try {
                    range.setTotals({
                        message: blocks.length,
                        user: userMessageCount,
                        llm: llmCount,
                        entry: entryCount,
                    });
                }
                catch (err) {
                    warn('[GMH] failed to update export range totals', err);
                }
            }
            notify();
            return lastSummary;
        };
        const schedule = () => {
            if (scheduled)
                return;
            scheduled = true;
            const runIndexing = () => {
                try {
                    indexMessages();
                }
                catch (err) {
                    warn('[GMH] message indexing failed', err);
                }
                finally {
                    scheduled = false;
                }
            };
            if (raf) {
                raf(() => runIndexing());
            }
            else {
                setTimeout(runIndexing, 16);
            }
        };
        const ensureObserver = () => {
            if (observer || !MutationObserverRef || !documentRef)
                return;
            const target = documentRef.body || documentRef.documentElement;
            if (!target)
                return;
            observer = new MutationObserverRef(() => {
                if (!active)
                    return;
                schedule();
            });
            observer.observe(target, { childList: true, subtree: true });
        };
        const api = {
            start() {
                if (active) {
                    schedule();
                    return;
                }
                active = true;
                ensureObserver();
                try {
                    indexMessages();
                }
                catch (err) {
                    warn('[GMH] initial message indexing failed', err);
                }
            },
            stop() {
                active = false;
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
                scheduled = false;
            },
            refresh(options) {
                const immediate = Boolean(options?.immediate);
                if (immediate)
                    return indexMessages();
                schedule();
                return cloneSummary(lastSummary);
            },
            getSummary() {
                return cloneSummary(lastSummary);
            },
            lookupOrdinalByIndex(index) {
                const numericIndex = Number(index);
                if (!Number.isFinite(numericIndex))
                    return null;
                return ordinalCacheByIndex.has(numericIndex)
                    ? ordinalCacheByIndex.get(numericIndex)
                    : null;
            },
            lookupOrdinalByMessageId(messageId) {
                if (typeof messageId !== 'string' || !messageId)
                    return null;
                return ordinalCacheById.has(messageId)
                    ? ordinalCacheById.get(messageId)
                    : null;
            },
            subscribe(listener) {
                if (typeof listener !== 'function')
                    return noop$1;
                listeners.add(listener);
                try {
                    listener(cloneSummary(lastSummary));
                }
                catch (err) {
                    warn('[GMH] index subscriber failed', err);
                }
                return () => listeners.delete(listener);
            },
        };
        return api;
    };

    const noop = () => { };
    const resolveDocument = (doc) => doc ?? (typeof document !== 'undefined' ? document : undefined);
    const resolveElementClass = (ElementClass) => ElementClass ?? (typeof Element !== 'undefined' ? Element : undefined);
    const resolveConsole = (consoleLike) => consoleLike ?? (typeof console !== 'undefined' ? console : {});
    const resolveMessageIndexer = (indexer) => indexer ?? null;
    const resolveTurnBookmarks = (bookmarks) => bookmarks ?? null;
    const ensureWarn = (logger) => typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop;
    const toElement = (target, ElementRef) => {
        if (!ElementRef || !target || !(target instanceof ElementRef))
            return null;
        return target;
    };
    const lookupOrdinal = (index, messageId, indexer, ordinalAttr) => {
        const byIndex = Number.isFinite(index) && indexer?.lookupOrdinalByIndex
            ? indexer.lookupOrdinalByIndex(index)
            : null;
        const byMessageId = messageId && indexer?.lookupOrdinalByMessageId
            ? indexer.lookupOrdinalByMessageId(messageId)
            : null;
        const byAttribute = ordinalAttr !== null && ordinalAttr !== undefined ? Number(ordinalAttr) : null;
        const resolved = [byIndex, byMessageId, byAttribute].find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
        return typeof resolved === 'number' ? resolved : null;
    };
    const createBookmarkListener = ({ document: documentLike, ElementClass, messageIndexer, turnBookmarks, console: consoleLike, } = {}) => {
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
        const handleBookmarkCandidate = (event) => {
            const target = toElement(event.target, ElementRef);
            if (!target)
                return;
            const message = target.closest('[data-gmh-message-index], [data-turn-index]');
            if (!message)
                return;
            const indexAttr = message.getAttribute('data-gmh-message-index') ?? message.getAttribute('data-turn-index');
            if (indexAttr === null)
                return;
            const index = Number(indexAttr);
            if (!Number.isFinite(index))
                return;
            const ordinalAttr = message.getAttribute('data-gmh-message-ordinal') ?? message.getAttribute('data-message-ordinal');
            const messageIdAttr = message.getAttribute('data-gmh-message-id') ?? message.getAttribute('data-message-id');
            const resolvedOrdinal = lookupOrdinal(index, messageIdAttr, indexer, ordinalAttr);
            if (!bookmarks || typeof bookmarks.record !== 'function') {
                warn('[GMH] bookmark listener missing turnBookmarks.record');
                return;
            }
            bookmarks.record(index, resolvedOrdinal, messageIdAttr ?? null, 'message');
        };
        const api = {
            start() {
                if (active)
                    return;
                doc.addEventListener('click', handleBookmarkCandidate, true);
                active = true;
            },
            stop() {
                if (!active)
                    return;
                doc.removeEventListener('click', handleBookmarkCandidate, true);
                active = false;
            },
            isActive() {
                return active;
            },
        };
        return api;
    };

    const configs = new Map();
    const createNormalizedConfig = (config) => ({
        selectors: config?.selectors ? { ...config.selectors } : {},
        metadata: config?.metadata ? { ...config.metadata } : {},
    });
    const registerAdapterConfig = (name, config = {}) => {
        if (!name)
            return;
        configs.set(name, createNormalizedConfig(config));
    };
    const getAdapterConfig = (name) => configs.get(name) ?? { selectors: {}, metadata: {} };
    const getAdapterSelectors = (name) => clone(getAdapterConfig(name).selectors ?? {});
    const getAdapterMetadata = (name) => clone(getAdapterConfig(name).metadata ?? {});
    const listAdapterNames = () => Array.from(configs.keys());
    const adapterRegistry = {
        register: registerAdapterConfig,
        get: getAdapterConfig,
        list: listAdapterNames,
    };

    const normNL = (value) => String(value ?? '').replace(/\r\n?|\u2028|\u2029/g, '\n');
    const stripTicks = (value) => String(value ?? '').replace(/```+/g, '');
    const collapseSpaces = (value) => String(value ?? '')
        .replace(/\s+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    const stripQuotes = (value) => String(value ?? '')
        .replace(/^['"“”『「《【]+/, '')
        .replace(/['"“”』」》】]+$/, '')
        .trim();
    const stripBrackets = (value) => String(value ?? '').replace(/^\[|\]$/g, '').trim();
    const sanitizeText = (value) => collapseSpaces(normNL(value).replace(/[\t\v\f\u00a0\u200b]/g, ' '));
    const parseListInput = (raw) => {
        if (!raw)
            return [];
        return normNL(raw)
            .split(/[,\n]/)
            .map((item) => collapseSpaces(item))
            .filter(Boolean);
    };

    const sleep = (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    const triggerDownload = (blob, filename) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    };
    const isScrollable = (element) => {
        if (!element)
            return false;
        if (element === document.body || element === document.documentElement) {
            const target = element === document.body ? document.documentElement : element;
            return target.scrollHeight > target.clientHeight + 4;
        }
        if (!(element instanceof Element))
            return false;
        const styles = getComputedStyle(element);
        const overflowY = styles.overflowY;
        const scrollableStyle = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
        return scrollableStyle && element.scrollHeight > element.clientHeight + 4;
    };

    const looksLikeName = (raw) => {
        const value = String(raw ?? '')
            .replace(/^[\-•\s]+/, '')
            .trim();
        if (!value)
            return false;
        if (/^(INFO|메시지 이미지)$/i.test(value))
            return false;
        return /^[가-힣A-Za-z][\w가-힣 .,'’]{0,24}$/.test(value);
    };
    const luhnValid = (value) => {
        const digits = String(value ?? '').replace(/[^\d]/g, '');
        if (digits.length < 13 || digits.length > 19)
            return false;
        let sum = 0;
        let shouldDouble = false;
        for (let i = digits.length - 1; i >= 0; i -= 1) {
            const digit = parseInt(digits[i] ?? '', 10);
            if (Number.isNaN(digit))
                return false;
            let nextDigit = digit;
            if (shouldDouble) {
                nextDigit *= 2;
                if (nextDigit > 9)
                    nextDigit -= 9;
            }
            sum += nextDigit;
            shouldDouble = !shouldDouble;
        }
        return sum % 10 === 0;
    };
    const isIndexable = (value) => typeof value === 'object' && value !== null;
    const resolvePath = (object, path) => {
        if (!path)
            return object;
        const segments = path.split('.');
        let cursor = object;
        for (const segment of segments) {
            if (!isIndexable(cursor))
                return undefined;
            cursor = cursor[segment];
        }
        return cursor;
    };
    const requireDeps = (deps, requirements = {}) => {
        const entries = Object.entries(requirements);
        entries.forEach(([path, validator]) => {
            const check = typeof validator === 'function' ? validator : () => true;
            const value = resolvePath(deps, path);
            if (!check(value)) {
                throw new Error(`[GMH] Missing or invalid dependency: ${path}`);
            }
        });
        return deps;
    };

    const DEFAULT_PLAYER_MARK$1 = '⟦PLAYER⟧ ';
    const createGenitAdapter = ({ registry = adapterRegistry, playerMark = DEFAULT_PLAYER_MARK$1, getPlayerNames = () => [], isPrologueBlock = () => false, errorHandler, } = {}) => {
        let infoNodeRegistry = new WeakSet();
        let playerNameAccessor = typeof getPlayerNames === 'function' ? getPlayerNames : () => [];
        const warnWithHandler = (err, context, fallbackMessage) => {
            if (errorHandler?.handle) {
                const level = errorHandler.LEVELS?.WARN || 'warn';
                errorHandler.handle(err, context, level);
            }
            else if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                console.warn(fallbackMessage, err);
            }
        };
        const resolvePlayerNames = () => {
            const names = playerNameAccessor();
            if (Array.isArray(names)) {
                return names.filter((name) => typeof name === 'string');
            }
            return [];
        };
        const registryGet = registry && typeof registry.get === 'function'
            ? (name) => registry.get(name)
            : getAdapterConfig;
        const adapterConfig = registryGet('genit');
        const selectors = adapterConfig.selectors || {};
        const playerScopeSelector = (selectors.playerScopes || []).filter(Boolean).join(',');
        const npcScopeSelector = (selectors.npcGroups || []).filter(Boolean).join(',');
        const isPrologueBlockFn = typeof isPrologueBlock === 'function' ? isPrologueBlock : () => false;
        const collectAll = (selList, root = document) => {
            const out = [];
            const seen = new Set();
            if (!selList?.length)
                return out;
            for (const sel of selList) {
                if (!sel)
                    continue;
                if (root instanceof Element && root.matches(sel) && !seen.has(root)) {
                    seen.add(root);
                    out.push(root);
                }
                let nodes;
                try {
                    nodes = root.querySelectorAll(sel);
                }
                catch (e) {
                    continue;
                }
                nodes.forEach((node) => {
                    if (!node || seen.has(node))
                        return;
                    seen.add(node);
                    out.push(node);
                });
            }
            return out;
        };
        const firstMatch = (selList, root = document) => {
            if (!selList?.length)
                return null;
            for (const sel of selList) {
                if (!sel)
                    continue;
                try {
                    const node = root.querySelector(sel);
                    if (node)
                        return node;
                }
                catch (e) {
                    continue;
                }
            }
            return null;
        };
        const matchesSelectorList = (node, selList) => {
            if (!(node instanceof Element))
                return false;
            if (!selList?.length)
                return false;
            return selList.some((sel) => {
                if (!sel)
                    return false;
                try {
                    return node.matches(sel);
                }
                catch (err) {
                    return false;
                }
            });
        };
        const closestMatchInList = (node, selList) => {
            if (!(node instanceof Element))
                return null;
            if (!selList?.length)
                return null;
            for (const sel of selList) {
                if (!sel)
                    continue;
                try {
                    const match = node.closest(sel);
                    if (match)
                        return match;
                }
                catch (err) {
                    continue;
                }
            }
            return null;
        };
        const containsSelector = (root, selList) => {
            if (!(root instanceof Element))
                return false;
            if (!selList?.length)
                return false;
            return selList.some((sel) => {
                if (!sel)
                    return false;
                try {
                    return Boolean(root.querySelector(sel));
                }
                catch (err) {
                    return false;
                }
            });
        };
        const textSegmentsFromNode = (node) => {
            if (!node)
                return [];
            let text = '';
            if (node instanceof HTMLElement) {
                text = node.innerText ?? node.textContent ?? '';
            }
            else if (node instanceof Element || node instanceof Node) {
                text = node.textContent ?? '';
            }
            if (!text)
                return [];
            return text
                .split(/\r?\n+/)
                .map((seg) => seg.trim())
                .filter(Boolean);
        };
        const findScrollableAncestor = (node) => {
            let current = node instanceof Element ? node : null;
            for (let depth = 0; depth < 6 && current; depth += 1) {
                if (isScrollable(current))
                    return current;
                current = current.parentElement;
            }
            return null;
        };
        const findByRole = (root = document) => {
            const roleNodes = collectAll(['[role]'], root);
            return roleNodes.find((node) => {
                const role = node.getAttribute('role') || '';
                return /log|list|main|region/i.test(role) && isScrollable(node);
            });
        };
        const findByTextHint = (root = document) => {
            const hints = selectors.textHints || [];
            if (!hints.length)
                return null;
            const nodes = collectAll(['main', 'section', 'article'], root).filter((node) => {
                if (!node || node.childElementCount < 3)
                    return false;
                const text = (node.textContent || '').trim();
                if (!text || text.length > 400)
                    return false;
                return hints.some((hint) => text.includes(hint));
            });
            return nodes.find((node) => isScrollable(node));
        };
        const getChatContainer = (doc = document) => {
            const direct = firstMatch(selectors.chatContainers, doc);
            if (direct && isScrollable(direct))
                return direct;
            const roleMatch = findByRole(doc);
            if (roleMatch)
                return roleMatch;
            const block = firstMatch(selectors.messageRoot, doc);
            if (block) {
                const scrollable = findScrollableAncestor(block.parentElement);
                if (scrollable)
                    return scrollable;
            }
            const hintMatch = findByTextHint(doc);
            if (hintMatch)
                return hintMatch;
            return null;
        };
        const getMessageBlocks = (root) => {
            const targetRoot = root || document;
            const blocks = collectAll(selectors.messageRoot, targetRoot);
            if (blocks.length)
                return blocks;
            if (targetRoot !== document) {
                const fallback = collectAll(selectors.messageRoot, document);
                if (fallback.length)
                    return fallback;
            }
            return [];
        };
        const getReactMessage = (block) => {
            if (!block || typeof block !== 'object')
                return null;
            try {
                const allKeys = Object.getOwnPropertyNames(block);
                const fiberKeys = allKeys.filter((k) => k.startsWith('__reactFiber'));
                if (!fiberKeys.length)
                    return null;
                const fiberKey = fiberKeys[0];
                const fiberHost = block;
                let fiber = fiberHost[fiberKey];
                for (let depth = 0; depth < 10 && fiber; depth++) {
                    const props = fiber.memoizedProps;
                    if (props && props.message && typeof props.message === 'object') {
                        return props.message;
                    }
                    fiber = fiber.return;
                }
            }
            catch (err) {
                // Silently fail if property access throws
            }
            return null;
        };
        const detectRole = (block) => {
            if (!block)
                return 'unknown';
            // Phase 1: Most reliable CSS check - justify-end indicates normal player dialogue
            // This catches 99% of player messages quickly
            const hasJustifyEnd = block.querySelector('.justify-end') !== null;
            if (hasJustifyEnd)
                return 'player';
            // Phase 1.5: Check for NPC markers BEFORE Phase 2
            // This prevents NPC messages from being misclassified by React content comparison
            const hasNpc = collectAll(selectors.npcGroups, block).length > 0;
            if (hasNpc)
                return 'npc';
            // Phase 2: Detect player thought/action inputs via content mismatch
            // genit.ai transforms user thought/action into AI-narrated 3rd person,
            // but DOM still renders original user input while React has transformed version
            try {
                const reactMessage = getReactMessage(block);
                if (reactMessage && reactMessage.role === 'assistant') {
                    const domText = collapseSpaces(block.textContent || '');
                    const reactText = collapseSpaces(reactMessage.content || '');
                    // If texts differ and DOM is shorter (user input vs AI expansion),
                    // this is a player thought/action input
                    if (domText && reactText &&
                        domText !== reactText &&
                        domText.length > 0 &&
                        domText.length < reactText.length * 0.95) { // DOM significantly shorter
                        return 'player';
                    }
                }
                // Normal user dialogue (React role="user")
                if (reactMessage && reactMessage.role === 'user') {
                    return 'player';
                }
            }
            catch (err) {
                // Silently fall back to CSS detection if React traversal fails
            }
            // Phase 3: CSS-based detection (fallback)
            const hasPlayer = collectAll(selectors.playerScopes, block).length > 0;
            if (hasPlayer)
                return 'player';
            return 'narration';
        };
        /**
         * Determines the structured snapshot part type for a DOM node.
         * @param {Element | null} node - Node under evaluation.
         * @returns {string}
         */
        const resolvePartType = (node) => {
            if (!(node instanceof Element))
                return 'paragraph';
            const tag = node.tagName?.toLowerCase?.() || '';
            if (!tag)
                return 'paragraph';
            if (tag === 'pre')
                return 'code';
            if (tag === 'code' && node.closest('pre'))
                return 'code';
            if (tag === 'blockquote')
                return 'blockquote';
            if (tag === 'ul' || tag === 'ol')
                return 'list';
            if (tag === 'img')
                return 'image';
            if (tag === 'hr')
                return 'horizontal-rule';
            if (/^h[1-6]$/.test(tag))
                return 'heading';
            if (tag === 'table')
                return 'table';
            return 'paragraph';
        };
        const detectCodeLanguage = (node) => {
            if (!(node instanceof Element))
                return null;
            const target = node.matches?.('code') && !node.matches('pre code') ? node : node.querySelector?.('code');
            const classSource = target instanceof Element ? target : node;
            const classList = classSource instanceof Element ? Array.from(classSource.classList) : [];
            for (const cls of classList) {
                if (cls.startsWith('language-'))
                    return cls.slice('language-'.length) || null;
            }
            const dataLang = target?.getAttribute?.('data-language') || node.getAttribute?.('data-language');
            if (dataLang)
                return dataLang;
            return null;
        };
        const buildStructuredPart = (node, context = {}, options = {}) => {
            const baseLines = Array.isArray(options.lines) ? options.lines.slice() : [];
            const partType = options.type || resolvePartType(node);
            const part = {
                type: partType,
                flavor: context.flavor || 'speech',
                role: context.role || null,
                speaker: context.speaker || null,
                lines: baseLines,
                legacyFormat: options.legacyFormat || context.legacyFormat || null,
            };
            if (Array.isArray(options.legacyLines)) {
                part.legacyLines = options.legacyLines.slice();
            }
            if (partType === 'code') {
                const elementNode = node instanceof Element ? node : null;
                const codeCandidate = elementNode && elementNode.matches('pre') ? elementNode.querySelector('code') : null;
                const codeTarget = codeCandidate instanceof Element ? codeCandidate : elementNode;
                const rawSource = (codeCandidate ?? node);
                const raw = (rawSource?.textContent ?? '').replace(/\r\n/g, '\n');
                part.text = raw;
                part.language = detectCodeLanguage(codeTarget ?? null);
                if (!part.lines.length) {
                    part.lines = raw
                        .split(/\n/)
                        .map((line) => line.replace(/\s+$/g, '').trim())
                        .filter(Boolean);
                }
            }
            else if (partType === 'list' && node instanceof Element) {
                const ordered = node.tagName?.toLowerCase() === 'ol';
                const items = Array.from(node.querySelectorAll('li'))
                    .map((li) => collapseSpaces(li.textContent || ''))
                    .filter(Boolean);
                part.ordered = ordered;
                part.items = items;
                if (!part.lines.length) {
                    part.lines = items.slice();
                }
            }
            else if (partType === 'image' && node instanceof Element) {
                const imgEl = node instanceof HTMLImageElement ? node : node.querySelector?.('img') || null;
                if (imgEl) {
                    part.src = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
                    part.alt = imgEl.getAttribute('alt') || '';
                    part.title = imgEl.getAttribute('title') || '';
                }
                if (!part.lines.length && part.alt) {
                    part.lines = [part.alt];
                }
            }
            else if (partType === 'heading' && node instanceof Element) {
                const levelMatch = node.tagName?.match(/h(\d)/i);
                part.level = levelMatch ? Number(levelMatch[1]) : null;
                const headingText = collapseSpaces(node.textContent || '');
                part.text = headingText;
                if (!part.lines.length && headingText) {
                    part.lines = [headingText];
                }
            }
            else if (partType === 'horizontal-rule') {
                if (!part.lines.length)
                    part.lines = [];
            }
            else if (!part.lines.length) {
                const fallbackLines = textSegmentsFromNode(node);
                part.lines = fallbackLines;
            }
            return part;
        };
        const getOrderPath = (node, root) => {
            if (!(node instanceof Node) || !(root instanceof Node))
                return null;
            const path = [];
            let current = node;
            let guard = 0;
            while (current && current !== root && guard < 200) {
                const parent = current.parentNode;
                if (!parent)
                    return null;
                const index = Array.prototype.indexOf.call(parent.childNodes, current);
                path.push(index);
                current = parent;
                guard += 1;
            }
            if (current !== root)
                return null;
            path.reverse();
            return path;
        };
        /**
         * Comparator used to keep structured parts in DOM order.
         * @param {number[]} a
         * @param {number[]} b
         * @returns {number}
         */
        const compareOrderPaths = (a, b) => {
            const len = Math.max(a.length, b.length);
            for (let i = 0; i < len; i += 1) {
                const valA = Number.isFinite(a[i]) ? a[i] : -1;
                const valB = Number.isFinite(b[i]) ? b[i] : -1;
                if (valA !== valB)
                    return valA - valB;
            }
            return 0;
        };
        /**
         * Creates a collector to manage structured message parts with ordering.
         * @param {{ playerName?: string }} [defaults={}] - Default speaker metadata.
         * @param {{ rootNode?: Node | null }} [context={}] - Context for ordering.
         * @returns {StructuredCollector}
         */
        const createStructuredCollector = (defaults = {}, context = {}) => {
            const parts = [];
            const snapshotDefaults = {
                playerName: defaults.playerName || '플레이어',
            };
            const infoLineSet = new Set();
            const normalizeLine = (line) => typeof line === 'string' ? line.trim() : '';
            const filterInfoLines = (lines = []) => lines
                .map((line) => normalizeLine(line))
                .filter((line) => line.length)
                .filter((line) => !infoLineSet.has(line));
            const rootNode = context?.rootNode instanceof Node ? context.rootNode : null;
            let fallbackCounter = 0;
            return {
                push(part, meta = {}) {
                    if (!part)
                        return;
                    const next = { ...part };
                    if (!Array.isArray(next.lines))
                        next.lines = [];
                    if (!next.role && next.flavor === 'speech')
                        next.role = 'unknown';
                    if (!next.speaker && next.role === 'player')
                        next.speaker = snapshotDefaults.playerName;
                    if (next.type === 'info') {
                        next.lines = next.lines.map((line) => normalizeLine(line)).filter(Boolean);
                        next.legacyLines = Array.isArray(next.legacyLines)
                            ? next.legacyLines.map((line) => normalizeLine(line)).filter(Boolean)
                            : [];
                        next.lines.forEach((line) => infoLineSet.add(line));
                        next.legacyLines.forEach((line) => infoLineSet.add(line));
                    }
                    else if (infoLineSet.size) {
                        next.lines = filterInfoLines(next.lines);
                        if (Array.isArray(next.legacyLines)) {
                            next.legacyLines = filterInfoLines(next.legacyLines);
                            if (!next.lines.length && !next.legacyLines.length)
                                return;
                        }
                        else if (!next.lines.length) {
                            return;
                        }
                    }
                    if (next.type !== 'info' && !Array.isArray(next.legacyLines)) {
                        delete next.legacyLines;
                    }
                    else if (next.type !== 'info' && Array.isArray(next.legacyLines) && !next.legacyLines.length) {
                        delete next.legacyLines;
                    }
                    const orderNode = meta?.node instanceof Node ? meta.node : null;
                    const orderPathRaw = orderNode && rootNode ? getOrderPath(orderNode, rootNode) : null;
                    const fallbackToken = (fallbackCounter += 1);
                    const orderPath = orderPathRaw
                        ? orderPathRaw
                        : [Number.MAX_SAFE_INTEGER, fallbackToken];
                    parts.push({ part: next, orderPath, fallback: fallbackToken });
                },
                list() {
                    return parts
                        .slice()
                        .sort((a, b) => {
                        const diff = compareOrderPaths(a.orderPath, b.orderPath);
                        if (diff !== 0)
                            return diff;
                        return a.fallback - b.fallback;
                    })
                        .map((entry) => entry.part);
                },
                defaults: snapshotDefaults,
            };
        };
        /**
         * Memoizes info nodes to prevent duplicate narration emission.
         * @param {Node | null | undefined} node - Entry node for the info subtree.
         */
        const markInfoNodeTree = (node) => {
            if (!node)
                return;
            try {
                const markSubtree = (element) => {
                    if (!element)
                        return;
                    infoNodeRegistry.add(element);
                    if (element instanceof Element) {
                        element.querySelectorAll('*').forEach((child) => infoNodeRegistry.add(child));
                    }
                };
                markSubtree(node);
                if (node instanceof Element) {
                    const infoContainer = node.closest?.('.info-card, .info-block, .gmh-info') || null;
                    if (infoContainer)
                        markSubtree(infoContainer);
                    const preContainer = node.closest?.('pre, code');
                    if (preContainer)
                        markSubtree(preContainer);
                }
            }
            catch (err) {
                /* noop */
            }
        };
        /**
         * Checks if a node belongs to a cached info subtree.
         * @param {Node | null | undefined} node - Node to test.
         * @returns {boolean}
         */
        const isInfoRelatedNode = (node) => {
            if (!node)
                return false;
            if (infoNodeRegistry.has(node))
                return true;
            if (node instanceof Element && closestMatchInList(node, selectors.infoCode))
                return true;
            return false;
        };
        const emitInfo = (block, pushLine, collector = null) => {
            const infoNode = firstMatch(selectors.infoCode, block);
            if (!infoNode)
                return;
            const infoLinesOut = [];
            const infoSeen = new Set();
            pushLine('INFO');
            const infoLines = textSegmentsFromNode(infoNode);
            infoLines.forEach((seg) => {
                const trimmed = (seg || '').trim();
                if (!trimmed)
                    return;
                if (infoSeen.has(trimmed))
                    return;
                infoSeen.add(trimmed);
                infoLinesOut.push(trimmed);
                pushLine(trimmed);
            });
            markInfoNodeTree(infoNode);
            if (collector) {
                const infoCardWrapper = infoNode.closest('.bg-card, .info-card, .info-block') ||
                    infoNode.closest('pre') ||
                    infoNode;
                collector.push({
                    type: 'info',
                    flavor: 'meta',
                    role: 'system',
                    speaker: 'INFO',
                    lines: infoLinesOut,
                    legacyLines: ['INFO', ...infoLinesOut],
                    legacyFormat: 'meta',
                }, { node: infoCardWrapper });
            }
        };
        const emitPlayerLines = (block, pushLine, collector = null) => {
            const blockRole = block?.getAttribute?.('data-gmh-message-role') || detectRole(block);
            if (blockRole !== 'player')
                return;
            const scopes = collectAll(selectors.playerScopes, block);
            const scopeList = scopes.length ? [...scopes] : [];
            if (playerScopeSelector && block.matches?.(playerScopeSelector)) {
                if (!scopeList.includes(block))
                    scopeList.unshift(block);
            }
            if (!scopeList.length) {
                scopeList.push(block);
            }
            else if (scopeList.length > 1) {
                const rootIndex = scopeList.indexOf(block);
                if (rootIndex >= 0)
                    scopeList.splice(rootIndex, 1);
            }
            const textNodes = [];
            const nodeSeen = new Set();
            for (const scope of scopeList) {
                collectAll(selectors.playerText, scope).forEach((node) => {
                    if (!nodeSeen.has(node)) {
                        nodeSeen.add(node);
                        textNodes.push(node);
                    }
                });
            }
            const targets = textNodes.length ? textNodes : scopeList;
            const filteredTargets = targets.filter((node) => {
                if (!(node instanceof Element))
                    return true;
                const playerScope = closestMatchInList(node, selectors.playerScopes) ||
                    (playerScopeSelector && node.closest?.(playerScopeSelector));
                const withinPlayer = Boolean(playerScope || scopeList.includes(node));
                if (!withinPlayer && scopeList.length)
                    return false;
                if (matchesSelectorList(node, selectors.narrationBlocks) ||
                    closestMatchInList(node, selectors.narrationBlocks)) {
                    if (!withinPlayer)
                        return false;
                }
                if (matchesSelectorList(node, selectors.npcGroups))
                    return false;
                if (closestMatchInList(node, selectors.npcGroups))
                    return false;
                if (matchesSelectorList(node, selectors.infoCode))
                    return false;
                if (containsSelector(node, selectors.infoCode))
                    return false;
                return true;
            });
            const effectiveTargets = filteredTargets.length ? filteredTargets : targets;
            const seenSegments = new Set();
            effectiveTargets.forEach((node) => {
                if (isInfoRelatedNode(node))
                    return;
                const partLines = [];
                textSegmentsFromNode(node).forEach((seg) => {
                    if (!seg)
                        return;
                    if (seenSegments.has(seg))
                        return;
                    seenSegments.add(seg);
                    pushLine(playerMark + seg);
                    partLines.push(seg);
                });
                if (collector && partLines.length) {
                    const playerName = collector.defaults?.playerName || '플레이어';
                    const part = buildStructuredPart(node, {
                        flavor: 'speech',
                        role: 'player',
                        speaker: playerName,
                        legacyFormat: 'player',
                    }, {
                        lines: partLines,
                        legacyFormat: 'player',
                    });
                    collector.push(part, { node });
                }
            });
        };
        const extractNameFromGroup = (group) => {
            const nameNode = firstMatch(selectors.npcName, group);
            let name = nameNode?.getAttribute?.('data-author-name') || nameNode?.textContent;
            if (!name) {
                name =
                    group.getAttribute('data-author') ||
                        group.getAttribute('data-username') ||
                        group.getAttribute('data-name');
            }
            return stripQuotes(collapseSpaces(name || '')).slice(0, 40);
        };
        const emitNpcLines = (block, pushLine, collector = null) => {
            const blockRole = block?.getAttribute?.('data-gmh-message-role') || detectRole(block);
            if (blockRole !== 'npc')
                return;
            const groups = collectAll(selectors.npcGroups, block);
            if (!groups.length)
                return;
            groups.forEach((group) => {
                if (playerScopeSelector && group.closest(playerScopeSelector))
                    return;
                const nameRaw = extractNameFromGroup(group);
                const name = nameRaw || 'NPC';
                const bubbleNodes = collectAll(selectors.npcBubble, group);
                const targets = bubbleNodes.length ? bubbleNodes : [group];
                targets.forEach((node) => {
                    if (isInfoRelatedNode(node))
                        return;
                    const partLines = [];
                    textSegmentsFromNode(node).forEach((seg) => {
                        if (!seg)
                            return;
                        if (seg && seg === name)
                            return;
                        pushLine(`@${name}@ "${seg}"`);
                        partLines.push(seg);
                    });
                    if (collector && partLines.length) {
                        const part = buildStructuredPart(node, {
                            flavor: 'speech',
                            role: 'npc',
                            speaker: name,
                            legacyFormat: 'npc',
                        }, {
                            lines: partLines,
                            legacyFormat: 'npc',
                        });
                        collector.push(part, { node });
                    }
                });
            });
        };
        const emitNarrationLines = (block, pushLine, collector = null) => {
            const blockRole = block?.getAttribute?.('data-gmh-message-role') || detectRole(block);
            if (blockRole === 'player') {
                return;
            }
            const targets = [];
            const seenNodes = new Set();
            const queueNode = (node, loose = false) => {
                if (!(node instanceof Element) || seenNodes.has(node))
                    return;
                seenNodes.add(node);
                targets.push({ node, loose });
            };
            const collected = collectAll(selectors.narrationBlocks, block);
            collected.forEach((node) => {
                queueNode(node, false);
            });
            const playerNames = resolvePlayerNames();
            const knownLabels = new Set([collector?.defaults?.playerName]
                .concat(playerNames)
                .filter(Boolean)
                .map((name) => name.trim()));
            const shouldSkipNarrationLine = (text, element) => {
                const clean = text.trim();
                if (!clean)
                    return true;
                if (/^INFO$/i.test(clean))
                    return true;
                if (knownLabels.has(clean))
                    return true;
                const wordCount = clean.split(/\s+/).length;
                const mutedContext = element?.classList?.contains('text-muted-foreground') ||
                    element?.closest?.('.text-muted-foreground, .markdown-content.text-muted-foreground');
                if (wordCount === 1) {
                    if (knownLabels.has(clean))
                        return true;
                    if (/^[A-Za-z][A-Za-z .,'’]{0,24}$/.test(clean)) {
                        return !mutedContext;
                    }
                    return false;
                }
                if (wordCount <= 3 && looksLikeName(clean) && !/[.!?…:,]/.test(clean)) {
                    return !mutedContext;
                }
                return false;
            };
            if (!targets.length) {
                const fallbackParagraphs = Array.from(block.querySelectorAll('p'));
                fallbackParagraphs.forEach((node) => {
                    if (seenNodes.has(node))
                        return;
                    if (isInfoRelatedNode(node))
                        return;
                    if (node.closest('code, pre'))
                        return;
                    if (playerScopeSelector && node.closest(playerScopeSelector))
                        return;
                    if (npcScopeSelector) {
                        const npcContainer = node.closest(npcScopeSelector);
                        if (npcContainer) {
                            const withinNpcBubble = matchesSelectorList(node, selectors.npcBubble) ||
                                closestMatchInList(node, selectors.npcBubble) ||
                                containsSelector(node, selectors.npcBubble);
                            if (withinNpcBubble)
                                return;
                        }
                    }
                    const text = node.textContent?.trim();
                    if (!text || text.length < 6)
                        return;
                    queueNode(node, true);
                });
                const npcGroups = collectAll(selectors.npcGroups, block);
                npcGroups.forEach((group) => {
                    let sibling = group?.nextElementSibling || null;
                    let steps = 0;
                    while (sibling && steps < 4) {
                        steps += 1;
                        if (!(sibling instanceof Element))
                            break;
                        if (seenNodes.has(sibling)) {
                            sibling = sibling.nextElementSibling;
                            continue;
                        }
                        if (isInfoRelatedNode(sibling)) {
                            sibling = sibling.nextElementSibling;
                            continue;
                        }
                        if (playerScopeSelector && sibling.closest(playerScopeSelector))
                            break;
                        const text = sibling.textContent?.trim();
                        if (!text || text.length < 6)
                            break;
                        queueNode(sibling, true);
                        sibling = sibling.nextElementSibling;
                    }
                });
            }
            if (!targets.length) {
                return;
            }
            targets.forEach(({ node, loose }) => {
                if (npcScopeSelector) {
                    const npcContainer = node.closest(npcScopeSelector);
                    if (npcContainer) {
                        const withinNpcBubble = matchesSelectorList(node, selectors.npcBubble) ||
                            closestMatchInList(node, selectors.npcBubble) ||
                            containsSelector(node, selectors.npcBubble);
                        const mutedNarration = node instanceof Element && node.classList?.contains('text-muted-foreground');
                        if (withinNpcBubble && !mutedNarration) {
                            const hostBlock = node.closest('[data-gmh-message-index]') || block;
                            if (!isPrologueBlockFn(hostBlock)) {
                                return;
                            }
                        }
                    }
                }
                if (isInfoRelatedNode(node)) {
                    return;
                }
                const partLines = [];
                const segments = textSegmentsFromNode(node);
                segments.forEach((seg) => {
                    if (!seg)
                        return;
                    const clean = seg.trim();
                    if (!clean)
                        return;
                    if (!loose && shouldSkipNarrationLine(clean, node)) {
                        return;
                    }
                    pushLine(clean);
                    partLines.push(clean);
                });
                if (collector && partLines.length) {
                    const part = buildStructuredPart(node, {
                        flavor: 'narration',
                        role: 'narration',
                        speaker: '내레이션',
                        legacyFormat: 'plain',
                    }, {
                        lines: partLines,
                        legacyFormat: 'plain',
                    });
                    collector.push(part, { node });
                }
            });
        };
        const emitTranscriptLines = (block, pushLine, collector = null) => {
            emitInfo(block, pushLine, collector);
            emitPlayerLines(block, pushLine, collector);
            emitNpcLines(block, pushLine, collector);
            emitNarrationLines(block, pushLine, collector);
        };
        const collectStructuredMessage = (block) => {
            if (!block)
                return null;
            const playerGuess = guessPlayerNames()[0] || '플레이어';
            const collector = createStructuredCollector({ playerName: playerGuess }, { rootNode: block });
            const localLines = [];
            const pushLine = (line) => {
                const trimmed = (line || '').trim();
                if (!trimmed)
                    return;
                localLines.push(trimmed);
            };
            try {
                emitTranscriptLines(block, pushLine, collector);
            }
            catch (err) {
                warnWithHandler(err, 'adapter', '[GMH] structured emit failed');
                emitTranscriptLines(block, pushLine);
            }
            const parts = collector.list();
            const role = block?.getAttribute?.('data-gmh-message-role') || detectRole(block) || 'unknown';
            const ordinalAttr = Number(block?.getAttribute?.('data-gmh-message-ordinal'));
            const indexAttr = Number(block?.getAttribute?.('data-gmh-message-index'));
            const userOrdinalAttr = Number(block?.getAttribute?.('data-gmh-user-ordinal'));
            const channelAttr = block?.getAttribute?.('data-gmh-channel') || null;
            const idAttr = block?.getAttribute?.('data-gmh-message-id') ||
                block?.getAttribute?.('data-message-id') ||
                block?.getAttribute?.('data-id') ||
                null;
            const firstSpeakerPart = parts.find((part) => part?.speaker);
            const speaker = firstSpeakerPart?.speaker ||
                (role === 'player'
                    ? collector.defaults.playerName
                    : role === 'narration'
                        ? '내레이션'
                        : role === 'npc'
                            ? 'NPC'
                            : null);
            const message = {
                id: idAttr,
                index: Number.isFinite(indexAttr) ? indexAttr : null,
                ordinal: Number.isFinite(ordinalAttr) ? ordinalAttr : null,
                userOrdinal: Number.isFinite(userOrdinalAttr) ? userOrdinalAttr : null,
                role,
                channel: channelAttr || (role === 'player' ? 'user' : role === 'npc' ? 'llm' : 'system'),
                speaker,
                parts,
            };
            if (localLines.length) {
                Object.defineProperty(message, 'legacyLines', {
                    value: localLines.slice(),
                    enumerable: false,
                    writable: true,
                    configurable: true,
                });
            }
            return message;
        };
        const guessPlayerNames = () => {
            const results = new Set();
            collectAll(selectors.playerNameHints).forEach((node) => {
                const text = node?.textContent?.trim();
                if (text)
                    results.add(stripQuotes(text));
                const attrNames = ['data-username', 'data-user-name', 'data-display-name'];
                for (const attr of attrNames) {
                    const val = node.getAttribute?.(attr);
                    if (val)
                        results.add(stripQuotes(val));
                }
            });
            collectAll(selectors.playerScopes).forEach((scope) => {
                const attrNames = ['data-username', 'data-user-name', 'data-author'];
                for (const attr of attrNames) {
                    const val = scope.getAttribute?.(attr);
                    if (val)
                        results.add(stripQuotes(val));
                }
            });
            return Array.from(results)
                .map((name) => collapseSpaces(name || ''))
                .filter((name) => name && /^[\w가-힣][\w가-힣 _.-]{1,20}$/.test(name));
        };
        const getPanelAnchor = (doc = document) => {
            const anchor = firstMatch(selectors.panelAnchor, doc);
            return anchor || doc.body;
        };
        const match = (loc) => /genit\.ai/i.test(loc.hostname ?? '');
        const genitAdapter = {
            id: 'genit',
            label: 'Genit',
            match,
            findContainer: (doc = document) => getChatContainer(doc),
            listMessageBlocks: (root) => getMessageBlocks(root),
            emitTranscriptLines,
            collectStructuredMessage,
            detectRole,
            guessPlayerNames,
            getPanelAnchor,
            dumpSelectors: () => clone(selectors),
            resetInfoRegistry: () => {
                infoNodeRegistry = new WeakSet();
            },
            setPlayerNameAccessor(fn) {
                if (typeof fn === 'function') {
                    playerNameAccessor = fn;
                }
            },
        };
        return genitAdapter;
    };

    const STORAGE_KEYS = {
        privacyProfile: 'gmh_privacy_profile',
        privacyBlacklist: 'gmh_privacy_blacklist',
        privacyWhitelist: 'gmh_privacy_whitelist',
    };
    const PRIVACY_PROFILES = {
        safe: {
            key: 'safe',
            label: 'SAFE (권장)',
            maskAddressHints: true,
            maskNarrativeSensitive: true,
        },
        standard: {
            key: 'standard',
            label: 'STANDARD',
            maskAddressHints: false,
            maskNarrativeSensitive: false,
        },
        research: {
            key: 'research',
            label: 'RESEARCH',
            maskAddressHints: false,
            maskNarrativeSensitive: false,
        },
    };
    const DEFAULT_PRIVACY_PROFILE = 'safe';

    const CONFIG = {
      LIMITS: {
        PRIVACY_LIST_MAX: 1000,
        PRIVACY_ITEM_MAX: 200,
        PREVIEW_TURN_LIMIT: 5,
      },
      TIMING: {
        AUTO_LOADER: {
          METER_INTERVAL_MS: 1500,
          PROFILES: {
            default: {
              cycleDelayMs: 700,
              settleTimeoutMs: 2000,
              maxStableRounds: 3,
              guardLimit: 60,
            },
            stability: {
              cycleDelayMs: 1200,
              settleTimeoutMs: 2600,
              maxStableRounds: 5,
              guardLimit: 140,
            },
            fast: {
              cycleDelayMs: 350,
              settleTimeoutMs: 900,
              maxStableRounds: 2,
              guardLimit: 40,
            },
          },
        },
      },
    };

    const MAX_CUSTOM_LIST_ITEMS = CONFIG.LIMITS.PRIVACY_LIST_MAX;
    const MAX_CUSTOM_ITEM_LENGTH = CONFIG.LIMITS.PRIVACY_ITEM_MAX;
    const DISALLOWED_PATTERN = /<|>|javascript:/i;
    const sanitizeList = (items, collapseSpaces) => {
        if (!Array.isArray(items)) {
            return { list: [], invalidType: Boolean(items), truncated: false, clipped: false };
        }
        const list = [];
        let invalidType = false;
        let truncated = false;
        let clipped = false;
        for (let i = 0; i < items.length; i += 1) {
            if (list.length >= MAX_CUSTOM_LIST_ITEMS) {
                truncated = true;
                break;
            }
            const raw = items[i];
            if (typeof raw !== 'string') {
                if (raw !== undefined && raw !== null)
                    invalidType = true;
                continue;
            }
            const collapsed = collapseSpaces(raw);
            const collapsedString = typeof collapsed === 'string' ? collapsed : String(collapsed ?? '');
            const trimmed = collapsedString.trim();
            if (!trimmed) {
                if (raw.trim?.())
                    invalidType = true;
                continue;
            }
            if (DISALLOWED_PATTERN.test(trimmed)) {
                invalidType = true;
                continue;
            }
            let entry = trimmed;
            if (entry.length > MAX_CUSTOM_ITEM_LENGTH) {
                entry = entry.slice(0, MAX_CUSTOM_ITEM_LENGTH);
                clipped = true;
            }
            list.push(entry);
        }
        if (items.length > MAX_CUSTOM_LIST_ITEMS)
            truncated = true;
        return { list, invalidType, truncated, clipped };
    };
    const createPrivacyStore = ({ storage, errorHandler, collapseSpaces = (value) => value, defaultProfile = DEFAULT_PRIVACY_PROFILE, profiles = PRIVACY_PROFILES, } = {}) => {
        const config = {
            profile: defaultProfile,
            blacklist: [],
            whitelist: [],
        };
        const safeHandle = (err, context, level) => {
            if (!errorHandler?.handle)
                return;
            const severity = level || errorHandler.LEVELS?.WARN;
            try {
                errorHandler.handle(err, context, severity);
            }
            catch {
            }
        };
        const warnListIssue = (type, reason, context) => {
            const message = `[GMH] ${type} ${reason}`;
            safeHandle(new Error(message), context, errorHandler?.LEVELS?.WARN);
        };
        const applySanitizedList = (items, type, context) => {
            const { list, invalidType, truncated, clipped } = sanitizeList(items, collapseSpaces);
            if (invalidType)
                warnListIssue(type, 'contains invalid entries; dropping invalid values.', context);
            if (truncated)
                warnListIssue(type, `exceeded ${MAX_CUSTOM_LIST_ITEMS} entries; extra values dropped.`, context);
            if (clipped)
                warnListIssue(type, `entries trimmed to ${MAX_CUSTOM_ITEM_LENGTH} characters.`, context);
            return list;
        };
        const readItem = (key) => {
            if (!storage || typeof storage.getItem !== 'function')
                return null;
            try {
                return storage.getItem(key);
            }
            catch (err) {
                safeHandle(err, 'privacy/load');
                return null;
            }
        };
        const writeItem = (key, value) => {
            if (!storage || typeof storage.setItem !== 'function')
                return;
            try {
                storage.setItem(key, value);
            }
            catch (err) {
                safeHandle(err, 'privacy/save');
            }
        };
        const loadLists = (raw, label) => {
            if (!raw)
                return [];
            try {
                const parsed = JSON.parse(raw);
                return applySanitizedList(parsed, label, 'privacy/load');
            }
            catch (err) {
                safeHandle(err, 'privacy/load');
                return [];
            }
        };
        const load = () => {
            const profileKey = readItem(STORAGE_KEYS.privacyProfile) || defaultProfile;
            const rawBlacklist = readItem(STORAGE_KEYS.privacyBlacklist);
            const rawWhitelist = readItem(STORAGE_KEYS.privacyWhitelist);
            config.profile = profiles[profileKey] ? profileKey : defaultProfile;
            config.blacklist = loadLists(rawBlacklist, 'privacy blacklist');
            config.whitelist = loadLists(rawWhitelist, 'privacy whitelist');
            return config;
        };
        const persist = () => {
            writeItem(STORAGE_KEYS.privacyProfile, config.profile);
            writeItem(STORAGE_KEYS.privacyBlacklist, JSON.stringify(config.blacklist || []));
            writeItem(STORAGE_KEYS.privacyWhitelist, JSON.stringify(config.whitelist || []));
            return config;
        };
        const setProfile = (profileKey) => {
            config.profile = profiles[profileKey] ? profileKey : defaultProfile;
            return persist();
        };
        const setCustomList = (type, items) => {
            if (type === 'blacklist') {
                config.blacklist = applySanitizedList(items, 'privacy blacklist', 'privacy/save');
            }
            if (type === 'whitelist') {
                config.whitelist = applySanitizedList(items, 'privacy whitelist', 'privacy/save');
            }
            return persist();
        };
        load();
        return {
            config,
            load,
            persist,
            setProfile,
            setCustomList,
        };
    };

    const REDACTION_PATTERNS = {
        email: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
        krPhone: /\b01[016789]-?\d{3,4}-?\d{4}\b/g,
        intlPhone: /\+\d{1,3}\s?\d{1,4}[\s-]?\d{3,4}[\s-]?\d{4}\b/g,
        rrn: /\b\d{6}-?\d{7}\b/g,
        card: /\b(?:\d[ -]?){13,19}\b/g,
        ip: /\b\d{1,3}(\.\d{1,3}){3}\b/g,
        handle: /@[A-Za-z0-9_]{2,30}\b/g,
        addressHint: /(\d+호|\d+동|[가-힣]{2,}(로|길)\s?\d+(-\d+)?)/g,
    };
    const escapeForRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const buildStandardRules = () => [
        {
            name: 'EMAIL',
            rx: REDACTION_PATTERNS.email,
            mask: () => '[REDACTED:EMAIL]',
        },
        {
            name: 'PHONE',
            rx: REDACTION_PATTERNS.krPhone,
            mask: () => '[REDACTED:PHONE]',
        },
        {
            name: 'PHONE',
            rx: REDACTION_PATTERNS.intlPhone,
            mask: () => '[REDACTED:PHONE]',
        },
        {
            name: 'RRN',
            rx: REDACTION_PATTERNS.rrn,
            mask: () => '[REDACTED:RRN]',
        },
        {
            name: 'CARD',
            rx: REDACTION_PATTERNS.card,
            validator: luhnValid,
            mask: () => '[REDACTED:CARD]',
        },
        {
            name: 'IP',
            rx: REDACTION_PATTERNS.ip,
            mask: () => '[REDACTED:IP]',
        },
        {
            name: 'HANDLE',
            rx: REDACTION_PATTERNS.handle,
            mask: () => '[REDACTED:HANDLE]',
        },
    ];
    const createRedactionRules = (profileKey, profiles = PRIVACY_PROFILES) => {
        const profile = profiles[profileKey] ?? profiles[DEFAULT_PRIVACY_PROFILE];
        const rules = buildStandardRules();
        if (profile?.maskAddressHints) {
            rules.push({
                name: 'ADDR',
                rx: REDACTION_PATTERNS.addressHint,
                mask: () => '[REDACTED:ADDR]',
            });
        }
        return rules;
    };
    const protectWhitelist = (text, whitelist) => {
        if (!Array.isArray(whitelist) || !whitelist.length) {
            return { text, tokens: [] };
        }
        let output = text;
        const tokens = [];
        whitelist.forEach((term, index) => {
            if (!term)
                return;
            const token = `§WL${index}_${term.length}§`;
            const rx = new RegExp(escapeForRegex(term), 'gi');
            let replaced = false;
            output = output.replace(rx, () => {
                replaced = true;
                return token;
            });
            if (replaced)
                tokens.push({ token, value: term });
        });
        return { text: output, tokens };
    };
    const restoreWhitelist = (text, tokens) => {
        if (!tokens?.length)
            return text;
        return tokens.reduce((acc, { token, value }) => acc.replace(new RegExp(escapeForRegex(token), 'g'), value), text);
    };
    const applyRules = (text, rules, counts) => rules.reduce((acc, rule) => {
        if (!rule?.rx)
            return acc;
        return acc.replace(rule.rx, (match) => {
            if (rule.validator && !rule.validator(match))
                return match;
            counts[rule.name] = (counts[rule.name] || 0) + 1;
            return typeof rule.mask === 'function' ? rule.mask(match) : rule.mask;
        });
    }, text);
    const applyCustomBlacklist = (text, blacklist, counts) => {
        if (!Array.isArray(blacklist) || !blacklist.length)
            return text;
        let output = text;
        blacklist.forEach((term) => {
            if (!term)
                return;
            const rx = new RegExp(escapeForRegex(term), 'gi');
            output = output.replace(rx, () => {
                counts.CUSTOM = (counts.CUSTOM || 0) + 1;
                return '[REDACTED:CUSTOM]';
            });
        });
        return output;
    };
    const MINOR_KEYWORDS = /(미성년|중학생|고등학생|나이\s*1[0-7]|소년|소녀|minor|under\s*18|중딩|고딩|중[1-3]|고[1-3]|(?:13|14|15|16|17)\s*살|teen(?:ager)?|underage)/i;
    const SEXUAL_KEYWORDS = /(성관계|성적|섹스|sex|음란|선정|야한|야스|삽입|자위|강간|에로)/i;
    const MINOR_KEYWORDS_MATCH = /(미성년|중학생|고등학생|나이\s*1[0-7]|소년|소녀|minor|under\s*18|중딩|고딩|중[1-3]|고[1-3]|(?:13|14|15|16|17)\s*살|teen(?:ager)?|underage)/gi;
    const SEXUAL_KEYWORDS_MATCH = /(성관계|성적|섹스|sex|음란|선정|야한|야스|삽입|자위|강간|에로)/gi;
    const ACADEMIC_PATTERN = /성적\s*(향상|저하|관리|평가|우수|부진|분석|상승|하락)/i;
    const SEX_ED_PATTERN = /성\s*(교육|상담|발달|정체성|소수자|평등|인지|지식)/i;
    const ORIENTATION_PATTERN = /성적\s*(지향|취향|매력|선호)/i;
    const PROTECTIVE_FORWARD = /(교육|예방|캠페인|세미나|강연|워크샵|보호|지원|상담|치료|개입|법률)\s*.*\s*(미성년|청소년)/i;
    const PROTECTIVE_REVERSE = /(미성년|청소년)\s*.*\s*(교육|예방|캠페인|세미나|강연|워크샵|보호|지원|상담|치료|개입|법률)/i;
    const RIGHTS_PATTERN = /성적\s*(자기결정권|권리|자율성|주체성|건강|동의)/i;
    const EXPLICIT_MEDIA = /(야한|음란|에로)\s*(사진|영상|동영상|이미지|pic|video|gif)/i;
    const EXPLICIT_CRIME = /(강간|성폭행|몰카|아청법)/i;
    const PROXIMITY_WINDOW = 100;
    const calculateProximityScore = (text) => {
        if (!text)
            return 0;
        const source = String(text);
        const minorMatches = [...source.matchAll(MINOR_KEYWORDS_MATCH)];
        const sexualMatches = [...source.matchAll(SEXUAL_KEYWORDS_MATCH)];
        if (!minorMatches.length || !sexualMatches.length)
            return 0;
        let maxScore = 0;
        minorMatches.forEach((minor) => {
            sexualMatches.forEach((sexual) => {
                const distance = Math.abs((minor.index ?? 0) - (sexual.index ?? 0));
                if (distance > PROXIMITY_WINDOW)
                    return;
                const score = 100 - distance;
                if (score > maxScore) {
                    maxScore = score;
                }
            });
        });
        return maxScore;
    };
    const hasMinorSexualContext = (text) => {
        if (!text)
            return false;
        const safeText = String(text);
        if (!MINOR_KEYWORDS.test(safeText))
            return false;
        if (!SEXUAL_KEYWORDS.test(safeText))
            return false;
        const hasLegitimateContext = ACADEMIC_PATTERN.test(safeText) ||
            SEX_ED_PATTERN.test(safeText) ||
            ORIENTATION_PATTERN.test(safeText) ||
            PROTECTIVE_FORWARD.test(safeText) ||
            PROTECTIVE_REVERSE.test(safeText) ||
            RIGHTS_PATTERN.test(safeText);
        const hasExplicitDanger = EXPLICIT_CRIME.test(safeText) || EXPLICIT_MEDIA.test(safeText);
        if (hasLegitimateContext && !hasExplicitDanger) {
            return false;
        }
        const proximityScore = calculateProximityScore(safeText);
        return proximityScore >= 70;
    };
    const redactText = (text, profileKey, counts, config, profiles = PRIVACY_PROFILES) => {
        const whitelist = Array.isArray(config?.whitelist) ? config?.whitelist : [];
        const blacklist = Array.isArray(config?.blacklist) ? config?.blacklist : [];
        const profile = profiles[profileKey] ?? profiles[DEFAULT_PRIVACY_PROFILE];
        const rules = createRedactionRules(profile.key, profiles);
        const safeText = String(text ?? '');
        const { text: protectedText, tokens } = protectWhitelist(safeText, whitelist);
        let result = applyRules(protectedText, rules, counts);
        result = applyCustomBlacklist(result, blacklist, counts);
        result = restoreWhitelist(result, tokens);
        if (profile.maskNarrativeSensitive) {
            result = result.replace(/(자살|자해|강간|폭행|살해)/gi, () => {
                counts.SENSITIVE = (counts.SENSITIVE || 0) + 1;
                return '[REDACTED:SENSITIVE]';
            });
        }
        return result;
    };
    const formatRedactionCounts = (counts) => {
        if (!counts)
            return '레다크션 없음';
        const entries = Object.entries(counts).filter(([, value]) => value > 0);
        if (!entries.length)
            return '레다크션 없음';
        return entries.map(([key, value]) => `${key}:${value}`).join(', ');
    };

    const cloneTurns = (turns = []) => Array.isArray(turns)
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
    const cloneSession$1 = (session) => {
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
        if (!part || typeof part !== 'object')
            return null;
        const sanitized = { ...part };
        const maybeRedact = (value) => typeof value === 'string' ? redactText(value, profileKey, counts) : value;
        sanitized.speaker = maybeRedact(sanitized.speaker);
        if (Array.isArray(part.lines))
            sanitized.lines = part.lines.map((line) => maybeRedact(line));
        if (Array.isArray(part.legacyLines))
            sanitized.legacyLines = part.legacyLines.map((line) => maybeRedact(line));
        if (Array.isArray(part.items))
            sanitized.items = part.items.map((item) => maybeRedact(item));
        sanitized.text = maybeRedact(part.text);
        sanitized.alt = maybeRedact(part.alt);
        sanitized.title = maybeRedact(part.title);
        return sanitized;
    };
    const sanitizeStructuredSnapshot = (snapshot, profileKey, counts, redactText) => {
        if (!snapshot)
            return null;
        const messages = Array.isArray(snapshot.messages)
            ? snapshot.messages.map((message) => {
                const sanitizedMessage = { ...message };
                sanitizedMessage.speaker =
                    typeof message.speaker === 'string'
                        ? redactText(message.speaker, profileKey, counts)
                        : message.speaker;
                sanitizedMessage.parts = Array.isArray(message.parts)
                    ? message.parts
                        .map((part) => sanitizeStructuredPart(part, profileKey, counts, redactText))
                        .filter((part) => Boolean(part))
                    : [];
                if (Array.isArray(message.legacyLines) && message.legacyLines.length) {
                    Object.defineProperty(sanitizedMessage, 'legacyLines', {
                        value: message.legacyLines.map((line) => redactText(line, profileKey, counts)),
                        enumerable: false,
                        writable: true,
                        configurable: true,
                    });
                }
                else {
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
    const createPrivacyPipeline = ({ profiles = PRIVACY_PROFILES, getConfig, redactText, hasMinorSexualContext, getPlayerNames = () => [], logger = null, storage = null, }) => {
        if (typeof redactText !== 'function') {
            throw new Error('createPrivacyPipeline: redactText function is required');
        }
        const getProfileKey = (profileKey) => profiles && profiles[profileKey] ? profileKey : DEFAULT_PRIVACY_PROFILE;
        const applyPrivacyPipeline = (session, rawText, profileKey, structuredSnapshot = null) => {
            const activeProfile = getProfileKey(profileKey);
            const counts = {};
            const config = typeof getConfig === 'function' ? getConfig() : undefined;
            const boundRedact = (value, targetProfile, targetCounts) => redactText(value, targetProfile, targetCounts, config, profiles);
            const sanitizedSession = cloneSession$1(session);
            sanitizedSession.turns = sanitizedSession.turns.map((turn) => {
                const next = { ...turn };
                next.text = boundRedact(turn.text, activeProfile, counts);
                if (next.speaker)
                    next.speaker = boundRedact(next.speaker, activeProfile, counts);
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
                }
                else if (Array.isArray(value)) {
                    sanitizedMeta[key] = value.map((item) => typeof item === 'string' ? boundRedact(item, activeProfile, counts) : item);
                }
                else {
                    sanitizedMeta[key] = value;
                }
            });
            sanitizedSession.meta = sanitizedMeta;
            sanitizedSession.warnings = sanitizedSession.warnings.map((warning) => typeof warning === 'string' ? boundRedact(warning, activeProfile, counts) : warning);
            const playerNames = getPlayerNames();
            const sanitizedPlayers = playerNames.map((name) => boundRedact(name, activeProfile, counts));
            sanitizedSession.player_names = sanitizedPlayers;
            const sanitizedRaw = boundRedact(rawText, activeProfile, counts);
            const sanitizedStructured = sanitizeStructuredSnapshot(structuredSnapshot, activeProfile, counts, boundRedact);
            const totalRedactions = Object.values(counts).reduce((sum, value) => sum + (value || 0), 0);
            const blocked = typeof hasMinorSexualContext === 'function' ? hasMinorSexualContext(rawText) : false;
            const debugEnabled = typeof storage?.getItem === 'function' && storage.getItem('gmh_debug_blocking');
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

    const DEFAULT_PLAYER_MARK = '⟦PLAYER⟧ ';
    const stripLegacySpeechLine = (line, role, { playerMark = DEFAULT_PLAYER_MARK } = {}) => {
        if (!line)
            return '';
        let text = line;
        if (role === 'player' && text.startsWith(playerMark)) {
            text = text.slice(playerMark.length);
        }
        const npcMatch = text.match(/^@([^@]+)@\s+"(.+)"$/);
        if (npcMatch) {
            return npcMatch[2].trim();
        }
        return text.trim();
    };
    const toJSONExport = (session, normalizedRaw, { playerNames = [] } = {}) => {
        const payload = {
            version: '1.0',
            generated_at: new Date().toISOString(),
            source: session?.source,
            player_names: session?.player_names || playerNames,
            meta: session?.meta,
            turns: session?.turns,
            warnings: session?.warnings,
            raw_excerpt: (normalizedRaw || '').slice(0, 2000),
        };
        return JSON.stringify(payload, null, 2);
    };
    const toTXTExport = (session, opts = {}) => {
        const { includeMeta = true } = opts;
        const turns = Array.isArray(opts.turns)
            ? opts.turns
            : Array.isArray(session?.turns)
                ? session.turns
                : [];
        const lines = [];
        if (includeMeta) {
            const actors = Array.isArray(session?.meta?.actors) ? session.meta.actors : [];
            if (session?.meta?.title)
                lines.push(`# TITLE: ${session.meta.title}`);
            if (session?.meta?.date)
                lines.push(`# DATE: ${session.meta.date}`);
            if (session?.meta?.place)
                lines.push(`# PLACE: ${session.meta.place}`);
            if (actors.length)
                lines.push(`# ACTORS: ${actors.join(', ')}`);
            lines.push('');
        }
        turns.forEach((turn) => {
            const speaker = turn?.role === 'narration' ? '내레이션' : turn?.speaker || '메시지';
            lines.push(`@${speaker}@ ${turn?.text ?? ''}`);
        });
        return lines.join('\n').trim();
    };
    const toMarkdownExport = (session, opts = {}) => {
        const { includeMeta = true, heading = '# 대화 로그', } = opts;
        const turns = Array.isArray(opts.turns)
            ? opts.turns
            : Array.isArray(session?.turns)
                ? session.turns
                : [];
        const lines = [heading];
        if (includeMeta) {
            const actors = Array.isArray(session?.meta?.actors) ? session.meta.actors : [];
            const metaLines = [];
            if (session?.meta?.date)
                metaLines.push(`- 날짜: ${session.meta.date}`);
            if (session?.meta?.place)
                metaLines.push(`- 장소: ${session.meta.place}`);
            if (session?.meta?.mode)
                metaLines.push(`- 모드: ${session.meta.mode}`);
            if (actors.length)
                metaLines.push(`- 참여자: ${actors.join(', ')}`);
            if (metaLines.length) {
                lines.push(metaLines.join('\n'));
                lines.push('');
            }
        }
        else {
            lines.push('');
        }
        turns.forEach((turn) => {
            if (turn?.role === 'narration') {
                lines.push(`> **내레이션**: ${turn?.text ?? ''}`);
            }
            else {
                lines.push(`- **${turn?.speaker ?? '발화자'}**: ${turn?.text ?? ''}`);
            }
        });
        return lines.join('\n').trim();
    };

    const coerceLines = (input) => Array.isArray(input) ? input.filter((line) => typeof line === 'string') : [];
    const renderStructuredMarkdownPart = (part, message, { playerMark = DEFAULT_PLAYER_MARK } = {}) => {
        const out = [];
        const fallbackLines = coerceLines(part?.legacyLines);
        const baseLines = coerceLines(part?.lines);
        const normalizedLines = baseLines.length > 0
            ? baseLines
            : fallbackLines.map((line) => stripLegacySpeechLine(line, part?.role || message?.role, { playerMark }));
        const safeLines = normalizedLines.filter((line) => line.trim().length > 0);
        const flavor = part?.flavor || 'speech';
        switch (part?.type) {
            case 'info': {
                out.push('> **INFO**');
                safeLines.forEach((line) => out.push(`> ${line}`));
                break;
            }
            case 'code': {
                const language = part?.language || '';
                const codeText = typeof part?.text === 'string' && part.text.trim()
                    ? part.text
                    : safeLines.join('\n');
                out.push('```' + language);
                out.push(codeText);
                out.push('```');
                break;
            }
            case 'list': {
                const ordered = Boolean(part?.ordered);
                safeLines.forEach((line, idx) => {
                    out.push(ordered ? `${idx + 1}. ${line}` : `- ${line}`);
                });
                break;
            }
            case 'blockquote': {
                safeLines.forEach((line) => out.push(`> ${line}`));
                break;
            }
            case 'image': {
                const alt = part?.alt || '이미지';
                const src = part?.src || '';
                out.push(`![${alt}](${src})`);
                break;
            }
            case 'heading': {
                const level = Math.min(6, Math.max(3, Number(part?.level) || 3));
                const text = safeLines.join(' ');
                out.push(`${'#'.repeat(level)} ${text}`.trim());
                break;
            }
            case 'horizontal-rule': {
                out.push('---');
                break;
            }
            case 'table': {
                safeLines.forEach((line) => out.push(line));
                break;
            }
            case 'paragraph':
            default: {
                if (flavor === 'narration') {
                    safeLines.forEach((line) => out.push(`> ${line}`));
                }
                else if (flavor === 'speech' && (part?.role || message?.role) === 'npc') {
                    const speaker = part?.speaker || message?.speaker || 'NPC';
                    safeLines.forEach((line) => out.push(`> ${speaker}: ${line}`));
                }
                else {
                    safeLines.forEach((line) => out.push(line));
                }
                break;
            }
        }
        if (!out.length && fallbackLines.length) {
            fallbackLines.forEach((line) => out.push(line));
        }
        return out;
    };
    const toStructuredMarkdown = (options = {}) => {
        const { messages = [], session, profile, rangeInfo, playerNames = [], playerMark = DEFAULT_PLAYER_MARK, } = options;
        const lines = ['# 구조 보존 대화 로그'];
        const meta = session?.meta || {};
        if (meta.title)
            lines.push(`**제목:** ${meta.title}`);
        if (meta.date)
            lines.push(`**날짜:** ${meta.date}`);
        if (meta.place)
            lines.push(`**장소:** ${meta.place}`);
        if (Array.isArray(meta.actors) && meta.actors.length) {
            lines.push(`**참여자:** ${meta.actors.join(', ')}`);
        }
        if (profile)
            lines.push(`**레다크션 프로파일:** ${profile.toUpperCase()}`);
        if (rangeInfo && rangeInfo?.active) {
            const totalMessagesForRange = rangeInfo.total || rangeInfo.messageTotal || messages.length || 0;
            lines.push(`**선택 범위:** 메시지 ${rangeInfo.start}-${rangeInfo.end} · ${rangeInfo.count}/${totalMessagesForRange}`);
        }
        if (playerNames.length) {
            lines.push(`**플레이어 이름:** ${playerNames.join(', ')}`);
        }
        if (lines[lines.length - 1] !== '')
            lines.push('');
        messages.forEach((message, idx) => {
            const ordinal = Number.isFinite(message?.ordinal) ? `[#${message.ordinal}] ` : '';
            const speakerLabel = message?.role === 'narration' ? '내레이션' : message?.speaker || '메시지';
            const roleLabel = message?.role && message.role !== 'narration' ? ` (${message.role})` : '';
            lines.push(`## ${ordinal}${speakerLabel}${roleLabel}`.trim());
            const parts = Array.isArray(message?.parts) && message.parts.length
                ? message.parts
                : [
                    {
                        type: 'paragraph',
                        flavor: message?.role === 'narration' ? 'narration' : 'speech',
                        role: message?.role,
                        speaker: message?.speaker,
                        lines: coerceLines(message?.legacyLines).map((line) => stripLegacySpeechLine(line, message?.role, { playerMark })),
                    },
                ];
            parts.forEach((part) => {
                const rendered = renderStructuredMarkdownPart(part, message, { playerMark }).filter((line) => typeof line === 'string');
                if (rendered.length) {
                    lines.push(...rendered);
                    if (rendered[rendered.length - 1] !== '')
                        lines.push('');
                }
            });
            if (idx !== messages.length - 1)
                lines.push('');
        });
        return lines.join('\n').replace(/\n{3,}/g, '\n\n');
    };
    const toStructuredJSON = (options = {}) => {
        const { session, structuredSelection, structuredSnapshot, profile, playerNames = [], rangeInfo, normalizedRaw, } = options;
        const generatedAt = new Date().toISOString();
        const messages = Array.isArray(structuredSelection?.messages)
            ? structuredSelection.messages
            : Array.isArray(structuredSnapshot?.messages)
                ? structuredSnapshot.messages
                : [];
        const structuredMeta = {
            total_messages: structuredSelection?.sourceTotal ??
                structuredSnapshot?.messages?.length ??
                messages.length,
            exported_messages: messages.length,
            selection: structuredSelection?.range || rangeInfo || null,
            errors: structuredSnapshot?.errors || [],
        };
        const metaBase = session?.meta || {};
        const payload = {
            version: '2.0-structured',
            generated_at: generatedAt,
            source: session?.source || 'genit-memory-helper',
            profile: profile || 'safe',
            player_names: playerNames,
            meta: {
                ...metaBase,
                structured: structuredMeta,
            },
            messages,
            warnings: session?.warnings || [],
            classic_fallback: {
                version: '1.0',
                turns: session?.turns || [],
                raw_excerpt: (normalizedRaw || '').slice(0, 2000),
            },
        };
        return JSON.stringify(payload, null, 2);
    };
    const toStructuredTXT = (options = {}) => {
        const { messages = [], session, profile, rangeInfo, playerNames = [] } = options;
        const lines = [];
        lines.push('=== Conversation Export ===');
        const meta = session?.meta || {};
        if (meta.title)
            lines.push(`Title: ${meta.title}`);
        if (meta.date)
            lines.push(`Date: ${meta.date}`);
        if (meta.place)
            lines.push(`Place: ${meta.place}`);
        if (profile)
            lines.push(`Profile: ${profile.toUpperCase()}`);
        if (playerNames.length)
            lines.push(`Players: ${playerNames.join(', ')}`);
        if (rangeInfo && rangeInfo?.active) {
            lines.push(`Range: messages ${rangeInfo.start}-${rangeInfo.end} / ${rangeInfo.total || rangeInfo.messageTotal || messages.length || 0}`);
        }
        lines.push('');
        const formatSpeakerTag = (message) => {
            const ordinalLabel = Number.isFinite(message?.ordinal) ? `#${message?.ordinal}` : '#?';
            const speaker = message?.role === 'narration' ? '내레이션' : message?.speaker || message?.role || '메시지';
            const roleLabel = message?.role || message?.channel || 'message';
            return `[${ordinalLabel}][${speaker}][${roleLabel}]`;
        };
        const appendPartLines = (part, messageSpeaker) => {
            const partLines = coerceLines(part?.lines);
            const fallback = coerceLines(part?.legacyLines);
            const resolvedLines = partLines.length ? partLines : fallback;
            const speakerName = part?.speaker || messageSpeaker;
            switch (part?.type) {
                case 'info': {
                    resolvedLines.forEach((line) => {
                        lines.push(`[INFO] ${line}`);
                    });
                    break;
                }
                case 'blockquote': {
                    resolvedLines.forEach((line) => lines.push(`> ${line}`));
                    break;
                }
                case 'list': {
                    const ordered = Boolean(part?.ordered);
                    resolvedLines.forEach((line, idx) => {
                        lines.push(`${ordered ? idx + 1 : '-'} ${line}`);
                    });
                    break;
                }
                case 'code': {
                    lines.push('```' + (part?.language || ''));
                    const text = typeof part?.text === 'string' && part.text.trim()
                        ? part.text
                        : resolvedLines.join('\n');
                    lines.push(text);
                    lines.push('```');
                    break;
                }
                case 'image': {
                    const alt = part?.alt || '이미지';
                    const src = part?.src || '';
                    lines.push(`[IMAGE] ${alt}${src ? ` <${src}>` : ''}`);
                    break;
                }
                case 'heading': {
                    resolvedLines.forEach((line) => lines.push(`== ${line} ==`));
                    break;
                }
                case 'paragraph':
                default: {
                    const isSpeech = part?.flavor === 'speech';
                    resolvedLines.forEach((line) => {
                        if (isSpeech)
                            lines.push(`- ${speakerName}: ${line}`);
                        else
                            lines.push(`- ${line}`);
                    });
                    break;
                }
            }
        };
        messages.forEach((message, idx) => {
            const header = formatSpeakerTag(message);
            lines.push(header);
            const messageSpeaker = message?.role === 'narration' ? '내레이션' : message?.speaker || '화자';
            const parts = Array.isArray(message?.parts) && message.parts.length
                ? message.parts
                : [
                    {
                        type: 'paragraph',
                        flavor: message?.role === 'narration' ? 'narration' : 'speech',
                        speaker: messageSpeaker,
                        lines: coerceLines(message?.legacyLines),
                    },
                ];
            parts.forEach((part) => appendPartLines(part, messageSpeaker));
            if (idx !== messages.length - 1)
                lines.push('');
        });
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    };

    const defaultStamp = () => new Date().toISOString().replace(/[:.]/g, '-');
    const buildExportBundle = (session, normalizedRaw, format, stamp, options = {}) => {
        const stampToken = stamp || defaultStamp();
        const { structuredSelection, structuredSnapshot, profile, playerNames = [], rangeInfo, playerMark, } = options;
        const selectionMessages = structuredSelection?.messages ?? [];
        const base = `genit_turns_${stampToken}`;
        if (format === 'structured-md') {
            const markdown = toStructuredMarkdown({
                messages: selectionMessages,
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
                structuredSelection: structuredSelection ?? undefined,
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
                messages: selectionMessages,
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
    const buildExportManifest = ({ profile, counts, stats, overallStats, format, warnings, source, range, version, }) => ({
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

    const PLAYER_NAME_FALLBACKS = ['플레이어', '소중한코알라5299'];
    const PLAYER_MARK = '⟦PLAYER⟧ ';
    const HEADER_RE = /^(\d+월\s*\d+일.*?\d{1,2}:\d{2})\s*\|\s*([^|]+?)\s*\|\s*📍\s*([^|]+)\s*\|?(.*)$/;
    const CODE_RE = /^([A-J])\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/i;
    const META_KEYWORDS = ['지도', '등장', 'Actors', '배우', '기록코드', 'Codes', 'SCENE'];
    const SYSTEM_ALIASES = ['player', '플레이어', '유저', '나'];
    const buildAliasSet = (names) => new Set(names.map((n) => n.toLowerCase()).concat(SYSTEM_ALIASES));
    let playerNames = [...PLAYER_NAME_FALLBACKS];
    let playerAliases = buildAliasSet(playerNames);
    let entryOriginProvider = () => [];
    const setPlayerNames = (names = []) => {
        const next = Array.from(new Set([...PLAYER_NAME_FALLBACKS, ...names]
            .map((name) => (typeof name === 'string' ? name.trim() : ''))
            .filter(Boolean)));
        playerNames = next.length ? next : [...PLAYER_NAME_FALLBACKS];
        playerAliases = buildAliasSet(playerNames);
    };
    const getPlayerNames = () => playerNames.slice();
    const setEntryOriginProvider = (provider) => {
        entryOriginProvider = typeof provider === 'function' ? provider : () => [];
    };
    const getEntryOrigin = () => {
        const origin = entryOriginProvider();
        return Array.isArray(origin) ? origin.slice() : [];
    };
    const primaryPlayerName = () => getPlayerNames()[0] || PLAYER_NAME_FALLBACKS[0];
    const normalizeSpeakerName = (name) => {
        const stripped = collapseSpaces(String(name ?? '')).replace(/[\[\]{}()]+/g, '').replace(/^[-•]+/, '').trim();
        if (!stripped)
            return '내레이션';
        const lower = stripped.toLowerCase();
        if (playerAliases.has(lower))
            return primaryPlayerName();
        if (/^(system|시스템|내레이션|narration)$/i.test(lower))
            return '내레이션';
        return stripped;
    };
    const roleForSpeaker = (name) => {
        if (name === '내레이션')
            return 'narration';
        if (getPlayerNames().includes(name))
            return 'player';
        return 'npc';
    };
    const normalizeTranscript = (raw) => stripTicks(normNL(String(raw ?? ''))).replace(/[\t\u00a0\u200b]/g, ' ');
    const looksNarrative = (line) => {
        const s = line.trim();
        if (!s)
            return false;
        if (/^[\[\(].*[\]\)]$/.test(s))
            return true;
        if (/^(...|···|…)/.test(s))
            return true;
        if (/^(당신|너는|그는|그녀는)\s/.test(s))
            return true;
        if (/[.!?"']$/.test(s))
            return true;
        if (/[가-힣]{2,}(은|는|이|가|을|를|으로|로|에게|에서|하며|면서|라고)\s/.test(s))
            return true;
        if (s.includes(' ')) {
            const words = s.split(/\s+/);
            if (words.length >= 4)
                return true;
        }
        return false;
    };
    const isActorStatsLine = (line) => /\|/.test(line) && /❤️|💗|💦|🪣/.test(line);
    const isMetaLine = (line) => {
        const stripped = stripBrackets(line);
        if (!stripped)
            return true;
        if (/^INFO$/i.test(stripped))
            return true;
        if (isActorStatsLine(stripped))
            return true;
        if (/^메시지 이미지$/i.test(stripped))
            return true;
        if (CODE_RE.test(stripped.replace(/\s+/g, '')))
            return true;
        for (const keyword of META_KEYWORDS) {
            if (stripped.startsWith(keyword))
                return true;
        }
        if (/^[-=]{3,}$/.test(stripped))
            return true;
        return false;
    };
    const parseTurns = (raw) => {
        const lines = normalizeTranscript(raw).split('\n');
        const originLines = getEntryOrigin();
        const turns = [];
        const warnings = [];
        const metaHints = { header: null, codes: [], titles: [] };
        let currentSceneId = 1;
        let pendingSpeaker = null;
        const addEntriesToTurn = (turn, lineIndexes = []) => {
            if (!turn)
                return;
            const normalized = Array.from(new Set((Array.isArray(lineIndexes) ? lineIndexes : [])
                .filter((idx) => Number.isInteger(idx) && idx >= 0)
                .sort((a, b) => a - b)));
            if (!normalized.length)
                return;
            const existing = Array.isArray(turn.__gmhEntries)
                ? turn.__gmhEntries.filter((value) => Number.isInteger(value))
                : [];
            const merged = Array.from(new Set([...existing, ...normalized])).sort((a, b) => a - b);
            Object.defineProperty(turn, '__gmhEntries', {
                value: merged,
                enumerable: false,
                writable: true,
                configurable: true,
            });
            const sourceBlocks = merged
                .map((lineIdx) => originLines[lineIdx])
                .filter((idx) => Number.isInteger(idx));
            if (sourceBlocks.length) {
                Object.defineProperty(turn, '__gmhSourceBlocks', {
                    value: Array.from(new Set(sourceBlocks)).sort((a, b) => a - b),
                    enumerable: false,
                    writable: true,
                    configurable: true,
                });
            }
        };
        const pushTurn = (speaker, text, roleOverride, lineIndexes = []) => {
            const textClean = sanitizeText(text);
            if (!textClean)
                return;
            const speakerName = normalizeSpeakerName(speaker ?? '내레이션');
            const role = roleOverride ?? roleForSpeaker(speakerName);
            if (role === 'player' && turns.length) {
                currentSceneId += 1;
            }
            const last = turns[turns.length - 1];
            if (last && last.speaker === speakerName && last.role === role && role !== 'narration') {
                last.text = `${last.text} ${textClean}`.trim();
                addEntriesToTurn(last, lineIndexes);
                return;
            }
            const nextTurn = {
                speaker: speakerName,
                role,
                text: textClean,
                sceneId: currentSceneId,
                channel: role === 'player' ? 'user' : 'llm',
            };
            addEntriesToTurn(nextTurn, lineIndexes);
            turns.push(nextTurn);
        };
        for (let i = 0; i < lines.length; i += 1) {
            const original = lines[i] ?? '';
            if (!original)
                continue;
            let line = original.trim();
            if (!line)
                continue;
            const headerMatch = HEADER_RE.exec(line);
            if (headerMatch) {
                if (!metaHints.header)
                    metaHints.header = headerMatch;
                currentSceneId += 1;
                pendingSpeaker = null;
                continue;
            }
            if (/^#/.test(line) && line.length <= 80) {
                metaHints.titles.push(stripQuotes(line.replace(/^#+/, '').trim()));
                pendingSpeaker = null;
                continue;
            }
            if (CODE_RE.test(line.replace(/\s+/g, ''))) {
                metaHints.codes.push(line.trim());
                pendingSpeaker = null;
                continue;
            }
            if (stripBrackets(line).toUpperCase() === 'INFO') {
                currentSceneId += 1;
                pendingSpeaker = null;
                continue;
            }
            let forcedPlayer = false;
            if (line.startsWith(PLAYER_MARK)) {
                forcedPlayer = true;
                line = line.slice(PLAYER_MARK.length).trim();
            }
            if (!line)
                continue;
            if (isMetaLine(line)) {
                pendingSpeaker = null;
                continue;
            }
            let match = line.match(/^@([^@]{1,40})@\s*["“]?([\s\S]+?)["”]?\s*$/);
            if (match) {
                const speaker = normalizeSpeakerName(match[1]);
                pushTurn(speaker, match[2], roleForSpeaker(speaker), [i]);
                pendingSpeaker = speaker;
                continue;
            }
            if (forcedPlayer) {
                const speaker = primaryPlayerName();
                pushTurn(speaker, stripQuotes(line), 'player', [i]);
                pendingSpeaker = speaker;
                continue;
            }
            match = line.match(/^([^:@—\-]{1,40})\s*[:\-—]\s*(.+)$/);
            if (match && looksLikeName(match[1])) {
                const speaker = normalizeSpeakerName(match[1]);
                pushTurn(speaker, stripQuotes(match[2]), roleForSpeaker(speaker), [i]);
                pendingSpeaker = speaker;
                continue;
            }
            if (looksNarrative(line) || /^".+"$/.test(line) || /^“.+”$/.test(line)) {
                pushTurn('내레이션', stripQuotes(line), 'narration', [i]);
                pendingSpeaker = null;
                continue;
            }
            if (looksLikeName(line)) {
                const speaker = normalizeSpeakerName(line);
                const textBuf = [];
                const bufLines = [i];
                let j = i + 1;
                while (j < lines.length) {
                    let peek = (lines[j] ?? '').trim();
                    if (!peek) {
                        j += 1;
                        break;
                    }
                    let peekForced = false;
                    if (peek.startsWith(PLAYER_MARK)) {
                        peekForced = true;
                        peek = peek.slice(PLAYER_MARK.length).trim();
                    }
                    if (!peek) {
                        j += 1;
                        continue;
                    }
                    if (HEADER_RE.test(peek) || stripBrackets(peek).toUpperCase() === 'INFO')
                        break;
                    if (isMetaLine(peek))
                        break;
                    if (peekForced)
                        break;
                    if (looksLikeName(peek) || /^@[^@]+@/.test(peek))
                        break;
                    textBuf.push(peek);
                    bufLines.push(j);
                    j += 1;
                    if (!/["”]$/.test(peek))
                        break;
                }
                if (textBuf.length) {
                    pushTurn(speaker, stripQuotes(textBuf.join(' ')), roleForSpeaker(speaker), bufLines);
                    pendingSpeaker = speaker;
                    i = j - 1;
                    continue;
                }
                pendingSpeaker = speaker;
                continue;
            }
            if (pendingSpeaker) {
                pushTurn(pendingSpeaker, stripQuotes(line), roleForSpeaker(pendingSpeaker), [i]);
                continue;
            }
            if (line.length <= 30 && /[!?…]$/.test(line) && turns.length) {
                const last = turns[turns.length - 1];
                last.text = `${last.text} ${line}`.trim();
                addEntriesToTurn(last, [i]);
                continue;
            }
            pushTurn('내레이션', line, 'narration', [i]);
            pendingSpeaker = null;
        }
        return { turns, warnings, metaHints };
    };
    /**
     * Produces derived metadata using meta hints and structured turns.
     *
     * @param {TranscriptMetaHints} metaHints
     * @param {TranscriptTurn[]} turns
     * @returns {TranscriptMeta}
     */
    const deriveMeta = (metaHints, turns) => {
        const meta = {};
        if (metaHints.header) {
            const [, time, modeRaw, placeRaw] = metaHints.header;
            if (time)
                meta.date = time.trim();
            if (modeRaw)
                meta.mode = modeRaw.trim();
            if (placeRaw)
                meta.place = placeRaw.trim();
        }
        const title = metaHints.titles.find(Boolean);
        if (title)
            meta.title = title;
        const actorSet = new Set();
        let userCount = 0;
        let llmCount = 0;
        for (const turn of turns) {
            if (turn.role === 'player' || turn.role === 'npc')
                actorSet.add(turn.speaker);
            if (turn.channel === 'user')
                userCount += 1;
            else if (turn.channel === 'llm')
                llmCount += 1;
        }
        meta.actors = Array.from(actorSet);
        if (!meta.title && meta.place)
            meta.title = `${meta.place} 세션`;
        meta.player = primaryPlayerName();
        meta.turn_count = userCount;
        meta.message_count = turns.length;
        meta.channel_counts = { user: userCount, llm: llmCount };
        return meta;
    };
    const buildSession = (raw) => {
        const { turns, warnings, metaHints } = parseTurns(raw);
        const meta = deriveMeta(metaHints, turns);
        return {
            meta,
            turns,
            warnings,
            source: 'genit-memory-helper',
        };
    };

    /**
     * Wraps export functions so they automatically receive current player name context.
     */
    const withPlayerNames = (getPlayerNames, exportFn) =>
      (session, raw, options = {}) =>
        exportFn(session, raw, {
          playerNames: getPlayerNames(),
          ...options,
        });

    /**
     * CSS used for the legacy preview privacy overlay.
     */
    const LEGACY_PREVIEW_CSS = `
.gmh-preview-overlay{position:fixed;inset:0;background:rgba(15,23,42,0.72);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:24px;}
.gmh-preview-card{background:#0f172a;color:#e2e8f0;border-radius:14px;box-shadow:0 18px 48px rgba(8,15,30,0.55);width:min(520px,94vw);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;font:13px/1.5 'Inter',system-ui,sans-serif;}
.gmh-preview-header{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid rgba(148,163,184,0.25);font-weight:600;}
.gmh-preview-body{padding:18px 20px;overflow:auto;display:grid;gap:16px;}
.gmh-preview-summary{display:grid;gap:8px;border:1px solid rgba(148,163,184,0.25);border-radius:10px;padding:12px;background:rgba(30,41,59,0.65);}
.gmh-preview-summary div{display:flex;justify-content:space-between;gap:12px;}
.gmh-preview-summary strong{color:#bfdbfe;}
.gmh-preview-turns{list-style:none;margin:0;padding:0;display:grid;gap:10px;}
.gmh-preview-turn{background:rgba(30,41,59,0.55);border-radius:10px;padding:10px 12px;border:1px solid rgba(59,130,246,0.12);}
.gmh-preview-turn--selected{border-color:rgba(56,189,248,0.45);background:rgba(56,189,248,0.12);}
.gmh-turn-list__badge{display:inline-flex;align-items:center;gap:4px;margin-left:8px;font-size:11px;color:#38bdf8;background:rgba(56,189,248,0.12);padding:0 8px;border-radius:999px;}
.gmh-preview-turn-speaker{font-weight:600;color:#c4b5fd;margin-bottom:4px;}
.gmh-preview-turn-text{color:#e2e8f0;}
.gmh-preview-footnote{font-size:12px;color:#94a3b8;}
.gmh-preview-actions{display:flex;gap:10px;padding:16px 20px;border-top:1px solid rgba(148,163,184,0.25);background:rgba(15,23,42,0.92);}
.gmh-preview-actions button{flex:1;padding:10px 12px;border-radius:10px;border:0;font-weight:600;cursor:pointer;transition:background 0.15s ease;}
.gmh-preview-cancel{background:#1e293b;color:#e2e8f0;}
.gmh-preview-cancel:hover{background:#243049;}
.gmh-preview-confirm{background:#34d399;color:#053527;}
.gmh-preview-confirm:hover{background:#22c55e;color:#052e21;}
.gmh-preview-close{background:none;border:0;color:#94a3b8;font-size:18px;cursor:pointer;}
.gmh-preview-close:hover{color:#f8fafc;}
@media (max-width:480px){.gmh-preview-card{width:100%;border-radius:12px;}}
`;
    /**
     * CSS bundle for the modern design-system panel.
     */
    const DESIGN_SYSTEM_CSS = `
:root{--gmh-bg:#0b1020;--gmh-surface:#0f172a;--gmh-surface-alt:rgba(30,41,59,0.65);--gmh-fg:#e2e8f0;--gmh-muted:#94a3b8;--gmh-accent:#38bdf8;--gmh-accent-soft:#c4b5fd;--gmh-success:#34d399;--gmh-warning:#fbbf24;--gmh-danger:#f87171;--gmh-border:rgba(148,163,184,0.25);--gmh-radius:14px;--gmh-radius-sm:10px;--gmh-panel-shadow:0 18px 48px rgba(8,15,30,0.55);--gmh-font:13px/1.5 'Inter',system-ui,-apple-system,BlinkMacSystemFont,sans-serif;}
.gmh-modal-overlay{position:fixed;inset:0;background:rgba(8,11,20,0.72);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:24px;}
.gmh-modal{background:var(--gmh-surface);color:var(--gmh-fg);border-radius:var(--gmh-radius);box-shadow:var(--gmh-panel-shadow);width:min(560px,94vw);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;font:var(--gmh-font);}
.gmh-modal--sm{width:min(420px,94vw);}
.gmh-modal--lg{width:min(720px,94vw);}
.gmh-modal__header{display:flex;flex-direction:column;gap:8px;padding:18px 22px;border-bottom:1px solid var(--gmh-border);}
.gmh-modal__header-row{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.gmh-modal__title{font-size:16px;font-weight:600;margin:0;color:var(--gmh-fg);}
.gmh-modal__description{margin:0;font-size:13px;color:var(--gmh-muted);line-height:1.45;}
.gmh-modal__body{padding:20px 22px;}
.gmh-modal__body--scroll{overflow:auto;display:grid;gap:18px;}
.gmh-modal__footer{padding:18px 22px;border-top:1px solid var(--gmh-border);background:rgba(11,16,32,0.92);}
.gmh-modal__actions{display:flex;gap:12px;flex-wrap:wrap;}
.gmh-modal__close{border:0;background:none;color:var(--gmh-muted);font-size:18px;cursor:pointer;padding:4px;border-radius:50%;transition:color 0.15s ease,background 0.15s ease;}
.gmh-modal__close:hover{color:#f8fafc;background:rgba(148,163,184,0.16);}
.gmh-button{flex:1;padding:10px 12px;border-radius:var(--gmh-radius-sm);border:0;font-weight:600;cursor:pointer;transition:background 0.15s ease,color 0.15s ease;min-width:120px;}
.gmh-button--primary{background:var(--gmh-success);color:#053527;}
.gmh-button--primary:hover{background:#22c55e;color:#052e21;}
.gmh-button--secondary{background:#1e293b;color:var(--gmh-fg);border:1px solid var(--gmh-border);}
.gmh-button--secondary:hover{background:#243049;}
.gmh-button--ghost{background:rgba(15,23,42,0.65);color:var(--gmh-muted);border:1px solid transparent;}
.gmh-button--ghost:hover{color:var(--gmh-fg);border-color:var(--gmh-border);}
.gmh-modal-footnote{font-size:12px;color:var(--gmh-muted);}
.gmh-modal-stack{display:grid;gap:18px;}
.gmh-privacy-summary{display:grid;gap:8px;border:1px solid var(--gmh-border);border-radius:var(--gmh-radius-sm);padding:14px;background:var(--gmh-surface-alt);}
.gmh-privacy-summary__row{display:flex;justify-content:space-between;gap:12px;font-size:13px;}
.gmh-privacy-summary__label{color:var(--gmh-muted);font-weight:600;}
.gmh-section-title{font-weight:600;color:#cbd5f5;font-size:13px;}
.gmh-turn-list{list-style:none;margin:0;padding:0;display:grid;gap:10px;}
.gmh-turn-list__item{background:var(--gmh-surface-alt);border-radius:var(--gmh-radius-sm);padding:10px 12px;border:1px solid rgba(59,130,246,0.18);}
.gmh-turn-list__item--selected{border-color:rgba(56,189,248,0.45);background:rgba(56,189,248,0.12);}
.gmh-turn-list__speaker{font-weight:600;color:var(--gmh-accent-soft);margin-bottom:4px;font-size:12px;}
.gmh-turn-list__badge{display:inline-flex;align-items:center;gap:4px;margin-left:8px;font-size:11px;color:var(--gmh-accent);background:rgba(56,189,248,0.12);padding:0 8px;border-radius:999px;}
.gmh-turn-list__text{color:var(--gmh-fg);font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;}
.gmh-turn-list__empty{color:var(--gmh-muted);text-align:center;}
.gmh-panel{position:fixed;right:16px;bottom:16px;z-index:2147483000;background:var(--gmh-bg);color:var(--gmh-fg);padding:16px 16px 22px;border-radius:18px;box-shadow:var(--gmh-panel-shadow);display:grid;gap:14px;width:min(320px,92vw);font:var(--gmh-font);max-height:70vh;overflow:auto;transform:translateY(0);opacity:1;visibility:visible;transition:transform 0.2s ease,opacity 0.15s ease,visibility 0.15s ease;will-change:transform,opacity;}
.
.gmh-panel--dragging,.gmh-panel--resizing{transition:none !important;cursor:grabbing;}
.gmh-panel__header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;}
.gmh-panel__headline{display:flex;flex-direction:column;gap:2px;}
.gmh-panel__drag-handle{border:0;background:transparent;color:var(--gmh-muted);padding:6px 8px;border-radius:var(--gmh-radius-sm);cursor:grab;display:grid;place-items:center;font-size:16px;transition:background 0.15s ease,color 0.15s ease;}
.gmh-panel__drag-handle:hover{background:rgba(148,163,184,0.18);color:var(--gmh-accent);}
.gmh-panel__drag-handle:focus-visible{outline:2px solid var(--gmh-accent);outline-offset:2px;}
.gmh-panel__drag-handle[aria-disabled="true"]{cursor:not-allowed;opacity:0.5;}
.gmh-panel__drag-icon{pointer-events:none;line-height:1;}
.gmh-panel__resize-handle{position:absolute;width:18px;height:18px;bottom:6px;right:10px;cursor:nwse-resize;border-radius:6px;opacity:0.7;}
.gmh-panel__resize-handle::after{content:'';position:absolute;inset:0;border-radius:inherit;background:linear-gradient(135deg,transparent 40%,rgba(148,163,184,0.35) 40%,rgba(148,163,184,0.8));}
.gmh-panel__resize-handle:hover{opacity:1;}
.gmh-panel__resize-handle[style*="none"]{display:none !important;}
.gmh-settings-grid{display:grid;gap:12px;}
.gmh-settings-row{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:var(--gmh-radius-sm);border:1px solid rgba(148,163,184,0.25);background:var(--gmh-surface-alt);}
.gmh-settings-row__main{display:flex;flex-direction:column;gap:4px;}
.gmh-settings-row__label{font-weight:600;font-size:13px;color:var(--gmh-fg);}
.gmh-settings-row__description{font-size:12px;color:var(--gmh-muted);}
.gmh-settings-row input[type="checkbox"]{width:18px;height:18px;accent-color:var(--gmh-accent);}
.gmh-settings-row input[type="number"]{width:88px;background:#0f172a;border:1px solid var(--gmh-border);color:var(--gmh-fg);border-radius:8px;padding:6px 8px;}
html.gmh-collapsed #genit-memory-helper-panel{transform:translateY(calc(100% + 24px));opacity:0;visibility:hidden;pointer-events:none;}
html.gmh-panel-open #genit-memory-helper-panel{pointer-events:auto;}
#gmh-fab{position:fixed;right:16px;bottom:16px;width:52px;height:52px;border-radius:50%;border:0;display:grid;place-items:center;font:700 13px/1 var(--gmh-font);background:var(--gmh-accent);color:#041016;cursor:pointer;box-shadow:0 10px 28px rgba(8,15,30,0.45);z-index:2147483001;transition:transform 0.2s ease,box-shadow 0.2s ease,opacity 0.15s ease;touch-action:manipulation;}
#gmh-fab:hover{box-shadow:0 14px 32px rgba(8,15,30,0.55);transform:translateY(-2px);}
#gmh-fab:active{transform:translateY(0);box-shadow:0 6px 18px rgba(8,15,30,0.45);}
html.gmh-panel-open #gmh-fab{transform:translateY(-4px);box-shadow:0 12px 30px rgba(8,15,30,0.5);}
.gmh-panel__title{font-size:15px;font-weight:600;margin:0;}
.gmh-panel__tag{font-size:11px;color:var(--gmh-muted);margin-top:2px;}
.gmh-panel__section{border-top:1px solid var(--gmh-border);padding-top:12px;display:grid;gap:10px;}
.gmh-panel__section:first-of-type{border-top:none;padding-top:0;}
.gmh-panel__section-title{font-size:12px;color:var(--gmh-muted);font-weight:600;letter-spacing:0.08em;text-transform:uppercase;}
.gmh-field-row{display:flex;gap:10px;align-items:center;width:100%;}
.gmh-field-row--wrap{flex-wrap:wrap;align-items:flex-start;}
.gmh-field-label{font-size:12px;font-weight:600;color:var(--gmh-muted);}
.gmh-helper-text{font-size:11px;color:var(--gmh-muted);line-height:1.4;}
.gmh-range-controls{display:flex;align-items:center;gap:8px;flex:1;min-width:0;flex-wrap:wrap;}
.gmh-bookmark-controls{display:flex;gap:6px;flex-wrap:wrap;}
.gmh-range-sep{color:var(--gmh-muted);}
.gmh-input,.gmh-select{flex:1;background:#111827;color:var(--gmh-fg);border:1px solid var(--gmh-border);border-radius:var(--gmh-radius-sm);padding:8px 10px;font:inherit;}
.gmh-select--compact{padding:6px 8px;}
.gmh-bookmark-select{flex:1;display:flex;align-items:center;gap:8px;}
.gmh-input--compact{flex:0;min-width:72px;width:72px;}
.gmh-textarea{width:100%;min-height:96px;background:#111827;color:var(--gmh-fg);border:1px solid var(--gmh-border);border-radius:var(--gmh-radius-sm);padding:10px;font:inherit;resize:vertical;}
.gmh-small-btn{padding:8px 10px;border-radius:var(--gmh-radius-sm);border:1px solid transparent;cursor:pointer;font-weight:600;font-size:12px;background:rgba(15,23,42,0.65);color:var(--gmh-muted);transition:background 0.15s ease,color 0.15s ease,border 0.15s ease;}
.gmh-small-btn--accent{background:var(--gmh-accent);color:#041016;}
.gmh-small-btn--muted{background:rgba(15,23,42,0.65);color:var(--gmh-muted);border:1px solid transparent;}
.gmh-small-btn--muted:hover{color:var(--gmh-fg);border-color:var(--gmh-border);}
.gmh-small-btn--accent:hover{background:#0ea5e9;color:#03212f;}
.gmh-panel-btn{flex:1;padding:10px 12px;border-radius:var(--gmh-radius-sm);border:0;font-weight:600;cursor:pointer;transition:background 0.15s ease,color 0.15s ease;}
.gmh-panel-btn--accent{background:var(--gmh-success);color:#053527;}
.gmh-panel-btn--accent:hover{background:#22c55e;color:#052e21;}
.gmh-panel-btn--neutral{background:#1e293b;color:var(--gmh-fg);}
.gmh-panel-btn--neutral:hover{background:#243049;}
.gmh-panel-btn--warn{background:#ef4444;color:#fff;}
.gmh-panel-btn--warn:hover{background:#dc2626;}
.gmh-panel-btn--compact{flex:0.5;}
.gmh-disabled{opacity:0.6;pointer-events:none;}
.gmh-progress{display:grid;gap:6px;}
.gmh-progress__track{height:6px;border-radius:999px;background:rgba(148,163,184,0.2);overflow:hidden;position:relative;}
.gmh-progress__fill{height:100%;width:0%;border-radius:inherit;background:var(--gmh-accent);transition:width 0.2s ease;}
.gmh-progress__fill[data-state="error"]{background:var(--gmh-danger);}
.gmh-progress__fill[data-state="done"]{background:var(--gmh-success);}
.gmh-progress__fill[data-indeterminate="true"]{width:40%;animation:gmhProgressSlide 1.6s linear infinite;}
@keyframes gmhProgressSlide{0%{transform:translateX(-120%);}50%{transform:translateX(-10%);}100%{transform:translateX(120%);}}
.gmh-progress__label{font-size:12px;color:var(--gmh-muted);}
.gmh-status-line{font-size:12px;color:var(--gmh-muted);}
.gmh-subtext{font-size:12px;color:var(--gmh-muted);line-height:1.5;}
@media (max-width:480px){.gmh-modal{width:100%;border-radius:12px;}.gmh-modal__actions{flex-direction:column;}.gmh-panel{right:12px;left:12px;bottom:12px;width:auto;max-height:76vh;}.gmh-panel::-webkit-scrollbar{width:6px;}.gmh-panel::-webkit-scrollbar-thumb{background:rgba(148,163,184,0.35);border-radius:999px;}#gmh-fab{width:48px;height:48px;right:12px;bottom:12px;font-size:12px;}}
@media (prefers-reduced-motion:reduce){.gmh-panel,.gmh-modal,.gmh-progress__fill,#gmh-fab{transition:none !important;animation-duration:0.001s !important;}}
`;
    /**
     * Injects the legacy preview stylesheet into the provided document once.
     */
    function ensureLegacyPreviewStyles(doc = typeof document !== 'undefined' ? document : null) {
        if (!doc)
            return;
        if (doc.getElementById('gmh-preview-style'))
            return;
        const style = doc.createElement('style');
        style.id = 'gmh-preview-style';
        style.textContent = LEGACY_PREVIEW_CSS;
        doc.head.appendChild(style);
    }
    /**
     * Injects the design-system stylesheet into the provided document once.
     */
    function ensureDesignSystemStyles(doc = typeof document !== 'undefined' ? document : null) {
        if (!doc)
            return;
        if (doc.getElementById('gmh-design-system-style'))
            return;
        const style = doc.createElement('style');
        style.id = 'gmh-design-system-style';
        style.textContent = DESIGN_SYSTEM_CSS;
        doc.head.appendChild(style);
    }

    const PANEL_SETTINGS_STORAGE_KEY = 'gmh_panel_settings_v1';

    /**
     * @typedef {import('../types').PanelSettingsController} PanelSettingsController
     * @typedef {import('../types').PanelSettingsValue} PanelSettingsValue
     * @typedef {import('../types').PanelSettingsLayout} PanelSettingsLayout
     * @typedef {import('../types').PanelSettingsBehavior} PanelSettingsBehavior
     */

    /**
     * @typedef {object} PanelSettingsOptions
     * @property {<T>(value: T) => T} clone
     * @property {(target: PanelSettingsValue, patch: unknown) => PanelSettingsValue} deepMerge
     * @property {Pick<Storage, 'getItem' | 'setItem'> | null} [storage]
     * @property {Console | { warn?: (...args: unknown[]) => void } | null} [logger]
     */

    /**
     * Creates the panel settings store with persistence, change notifications, and defaults.
     *
     * @param {PanelSettingsOptions} [options]
     * @returns {PanelSettingsController}
     */
    function createPanelSettings({
      clone,
      deepMerge,
      storage = typeof localStorage !== 'undefined' ? localStorage : null,
      logger = typeof console !== 'undefined' ? console : null,
    } = {}) {
      if (typeof clone !== 'function' || typeof deepMerge !== 'function') {
        throw new Error('createPanelSettings requires clone and deepMerge helpers');
      }

      /** @type {PanelSettingsValue} */
      const DEFAULTS = {
        layout: {
          anchor: 'right',
          offset: 16,
          bottom: 16,
          width: null,
          height: null,
        },
        behavior: {
          autoHideEnabled: true,
          autoHideDelayMs: 10000,
          collapseOnOutside: false,
          collapseOnFocus: false,
          allowDrag: true,
          allowResize: true,
        },
      };

      const log = logger || { warn: () => {} };
      const settingsStore = storage;

      let settings = clone(DEFAULTS);

      if (settingsStore) {
        try {
          const raw = settingsStore.getItem(PANEL_SETTINGS_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            settings = deepMerge(clone(DEFAULTS), parsed);
          }
        } catch (err) {
          log?.warn?.('[GMH] failed to load panel settings', err);
          settings = clone(DEFAULTS);
        }
      }

      /** @type {Set<(value: PanelSettingsValue) => void>} */
      const listeners = new Set();

      /**
       * @returns {void}
       */
      const persist = () => {
        if (!settingsStore) return;
        try {
          settingsStore.setItem(PANEL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        } catch (err) {
          log?.warn?.('[GMH] failed to persist panel settings', err);
        }
      };

      /**
       * @returns {void}
       */
      const notify = () => {
        const snapshot = clone(settings);
        listeners.forEach((listener) => {
          try {
            listener(snapshot);
          } catch (err) {
            log?.warn?.('[GMH] panel settings listener failed', err);
          }
        });
      };

      return {
        STORAGE_KEY: PANEL_SETTINGS_STORAGE_KEY,
        defaults: clone(DEFAULTS),
        /**
         * @returns {PanelSettingsValue}
         */
        get() {
          return clone(settings);
        },
        /**
         * @param {Partial<PanelSettingsValue>} patch
         * @returns {PanelSettingsValue}
         */
        update(patch) {
          if (!patch || typeof patch !== 'object') return clone(settings);
          const nextSettings = deepMerge(settings, patch);
          const before = JSON.stringify(settings);
          const after = JSON.stringify(nextSettings);
          if (after === before) return clone(settings);
          settings = nextSettings;
          persist();
          notify();
          return clone(settings);
        },
        /**
         * @returns {PanelSettingsValue}
         */
        reset() {
          const before = JSON.stringify(settings);
          const defaultsString = JSON.stringify(DEFAULTS);
          if (before === defaultsString) {
            settings = clone(DEFAULTS);
            return clone(settings);
          }
          settings = clone(DEFAULTS);
          persist();
          notify();
          return clone(settings);
        },
        /**
         * @param {(value: PanelSettingsValue) => void} listener
         * @returns {() => void}
         */
        onChange(listener) {
          if (typeof listener !== 'function') return () => {};
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    }

    const normalizeBlocks = (collection) => {
        if (!collection)
            return [];
        if (Array.isArray(collection))
            return collection;
        return Array.from(collection);
    };
    const normalizeNumeric = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const ensureDocument$1 = (documentRef) => {
        if (!documentRef || typeof documentRef.createElement !== 'function') {
            throw new Error('snapshot feature requires a document reference');
        }
        return documentRef;
    };
    const createDescribeNode = (documentRef) => (node) => {
        const doc = ensureDocument$1(documentRef);
        const ElementCtor = doc?.defaultView?.Element || (typeof Element !== 'undefined' ? Element : null);
        if (!ElementCtor || !node || !(node instanceof ElementCtor))
            return null;
        const parts = [];
        let current = node;
        let depth = 0;
        while (current && depth < 5) {
            let part = current.tagName.toLowerCase();
            if (current.id)
                part += `#${current.id}`;
            if (current.classList?.length)
                part += `.${Array.from(current.classList).slice(0, 3).join('.')}`;
            parts.unshift(part);
            current = current.parentElement;
            depth += 1;
        }
        return parts.join(' > ');
    };
    function createSnapshotFeature({ getActiveAdapter, triggerDownload, setPanelStatus, errorHandler, documentRef = typeof document !== 'undefined' ? document : null, locationRef = typeof location !== 'undefined' ? location : null, }) {
        if (!getActiveAdapter || !triggerDownload || !setPanelStatus || !errorHandler) {
            throw new Error('createSnapshotFeature missing required dependencies');
        }
        const describeNode = createDescribeNode(documentRef);
        const downloadDomSnapshot = () => {
            const doc = documentRef;
            const loc = locationRef;
            if (!doc || !loc)
                return;
            try {
                const adapter = getActiveAdapter();
                const container = adapter?.findContainer?.(doc);
                const blocks = normalizeBlocks(adapter?.listMessageBlocks?.(container || doc));
                const snapshot = {
                    url: loc.href,
                    captured_at: new Date().toISOString(),
                    container_path: describeNode(container),
                    block_count: blocks.length,
                    selector_strategies: adapter?.dumpSelectors?.(),
                    container_html_sample: container ? (container.innerHTML || '').slice(0, 40000) : null,
                };
                const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
                    type: 'application/json',
                });
                triggerDownload(blob, `genit-snapshot-${Date.now()}.json`);
                setPanelStatus('DOM 스냅샷이 저장되었습니다.', 'success');
            }
            catch (error) {
                const handler = errorHandler?.handle ? errorHandler : null;
                const message = handler?.handle
                    ? handler.handle(error, 'snapshot', handler.LEVELS?.ERROR)
                    : error?.message || String(error);
                setPanelStatus(`스냅샷 실패: ${message}`, 'error');
            }
        };
        return {
            describeNode,
            downloadDomSnapshot,
        };
    }
    function createStructuredSnapshotReader({ getActiveAdapter, setEntryOriginProvider, documentRef = typeof document !== 'undefined' ? document : null, }) {
        if (!getActiveAdapter)
            throw new Error('createStructuredSnapshotReader requires getActiveAdapter');
        const doc = ensureDocument$1(documentRef);
        let entryOrigin = [];
        let latestStructuredSnapshot = null;
        let blockCache = new WeakMap();
        let blockIdRegistry = new WeakMap();
        let blockIdCounter = 0;
        if (typeof setEntryOriginProvider === 'function') {
            setEntryOriginProvider(() => entryOrigin);
        }
        const getBlockId = (block) => {
            if (!block)
                return null;
            if (!blockIdRegistry.has(block)) {
                blockIdCounter += 1;
                blockIdRegistry.set(block, blockIdCounter);
            }
            return blockIdRegistry.get(block);
        };
        const fingerprintText = (value) => {
            if (!value)
                return '0:0';
            let hash = 0;
            for (let i = 0; i < value.length; i += 1) {
                hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
            }
            return `${value.length}:${hash.toString(16)}`;
        };
        const getBlockSignature = (block) => {
            if (!block || typeof block.getAttribute !== 'function')
                return 'none';
            const idAttr = block.getAttribute('data-gmh-message-id') ||
                block.getAttribute('data-message-id') ||
                block.getAttribute('data-id');
            if (idAttr)
                return `id:${idAttr}`;
            const text = block.textContent || '';
            return `text:${fingerprintText(text)}`;
        };
        /**
         * Deep clones structured message payloads to avoid adapter mutation.
         *
         * @param {StructuredSnapshotMessage | null | undefined} message
         * @returns {StructuredSnapshotMessage | null}
         */
        const cloneStructuredMessage = (message) => {
            if (!message || typeof message !== 'object')
                return null;
            const cloned = { ...message };
            if (Array.isArray(message.parts)) {
                cloned.parts = message.parts.map((part) => part && typeof part === 'object' ? { ...part } : part);
            }
            if (Array.isArray(message.legacyLines))
                cloned.legacyLines = message.legacyLines.slice();
            if (Array.isArray(message.__gmhEntries))
                cloned.__gmhEntries = message.__gmhEntries.slice();
            if (Array.isArray(message.__gmhSourceBlocks))
                cloned.__gmhSourceBlocks = message.__gmhSourceBlocks.slice();
            return cloned;
        };
        const ensureCacheEntry = (adapter, block, forceReparse) => {
            if (!block)
                return { structured: null, lines: [], errors: [], signature: 'none' };
            const signature = getBlockSignature(block);
            if (!forceReparse && blockCache.has(block)) {
                const cached = blockCache.get(block);
                if (cached && cached.signature === signature) {
                    return cached;
                }
            }
            const localSeen = new Set();
            const errors = [];
            let structured = null;
            let lines = [];
            try {
                const collected = adapter?.collectStructuredMessage?.(block);
                if (collected && typeof collected === 'object') {
                    structured = cloneStructuredMessage(collected);
                    const legacy = Array.isArray(collected.legacyLines) ? collected.legacyLines : [];
                    lines = legacy.reduce((acc, line) => {
                        const trimmed = (line || '').trim();
                        if (!trimmed || localSeen.has(trimmed))
                            return acc;
                        localSeen.add(trimmed);
                        acc.push(trimmed);
                        return acc;
                    }, []);
                }
            }
            catch (error) {
                errors.push(error?.message || String(error));
            }
            if (!structured) {
                const fallbackLines = [];
                const pushLine = (line) => {
                    const trimmed = (line || '').trim();
                    if (!trimmed || localSeen.has(trimmed))
                        return;
                    localSeen.add(trimmed);
                    fallbackLines.push(trimmed);
                };
                try {
                    adapter?.emitTranscriptLines?.(block, pushLine);
                }
                catch (error) {
                    errors.push(error?.message || String(error));
                }
                lines = fallbackLines;
            }
            const entry = {
                structured,
                lines,
                errors,
                signature,
            };
            blockCache.set(block, entry);
            return entry;
        };
        const captureStructuredSnapshot = (options = {}) => {
            const { force } = options || {};
            if (force) {
                blockCache = new WeakMap();
                blockIdRegistry = new WeakMap();
                blockIdCounter = 0;
            }
            const adapter = getActiveAdapter();
            const container = adapter?.findContainer?.(doc);
            const blocks = normalizeBlocks(adapter?.listMessageBlocks?.(container || doc));
            if (!container && !blocks.length)
                throw new Error('채팅 컨테이너를 찾을 수 없습니다.');
            if (!blocks.length) {
                entryOrigin = [];
                latestStructuredSnapshot = {
                    messages: [],
                    legacyLines: [],
                    entryOrigin: [],
                    errors: [],
                    generatedAt: Date.now(),
                };
                return latestStructuredSnapshot;
            }
            const seenLine = new Set();
            const legacyLines = [];
            const origins = [];
            const messages = [];
            const errors = [];
            const totalBlocks = blocks.length;
            adapter?.resetInfoRegistry?.();
            blocks.forEach((block, idx) => {
                const fallbackIndex = Number(block?.getAttribute?.('data-gmh-message-index'));
                const originIndex = Number.isFinite(fallbackIndex) ? fallbackIndex : idx;
                const blockId = getBlockId(block);
                const cacheEntry = ensureCacheEntry(adapter, block, Boolean(force));
                const cacheLines = Array.isArray(cacheEntry.lines) ? cacheEntry.lines : [];
                const structured = cacheEntry.structured ? cloneStructuredMessage(cacheEntry.structured) : null;
                if (structured) {
                    const ordinalAttr = Number(block?.getAttribute?.('data-gmh-message-ordinal'));
                    const indexAttr = Number(block?.getAttribute?.('data-gmh-message-index'));
                    const userOrdinalAttr = Number(block?.getAttribute?.('data-gmh-user-ordinal'));
                    const channelAttr = block?.getAttribute?.('data-gmh-channel');
                    structured.ordinal = Number.isFinite(ordinalAttr) ? ordinalAttr : totalBlocks - idx;
                    structured.index = Number.isFinite(indexAttr) ? indexAttr : originIndex;
                    if (Number.isFinite(userOrdinalAttr))
                        structured.userOrdinal = userOrdinalAttr;
                    else if (structured.userOrdinal)
                        delete structured.userOrdinal;
                    if (channelAttr)
                        structured.channel = channelAttr;
                    else if (!structured.channel) {
                        structured.channel =
                            structured.role === 'player'
                                ? 'user'
                                : structured.role === 'npc'
                                    ? 'llm'
                                    : 'system';
                    }
                    messages.push(structured);
                }
                cacheLines.forEach((line) => {
                    const trimmed = (line || '').trim();
                    if (!trimmed)
                        return;
                    const lineKey = `${blockId ?? originIndex}::${trimmed}`;
                    if (seenLine.has(lineKey))
                        return;
                    seenLine.add(lineKey);
                    legacyLines.push(trimmed);
                    origins.push(originIndex);
                });
                if (Array.isArray(cacheEntry.errors)) {
                    cacheEntry.errors.forEach((message) => {
                        errors.push({ index: originIndex, error: message });
                    });
                }
            });
            if (origins.length < legacyLines.length) {
                while (origins.length < legacyLines.length)
                    origins.push(null);
            }
            else if (origins.length > legacyLines.length) {
                origins.length = legacyLines.length;
            }
            entryOrigin = origins.slice();
            latestStructuredSnapshot = {
                messages,
                legacyLines,
                entryOrigin: origins,
                errors,
                generatedAt: Date.now(),
            };
            return latestStructuredSnapshot;
        };
        const readTranscriptText = (options = {}) => captureStructuredSnapshot(options).legacyLines.join('\n');
        const projectStructuredMessages = (structuredSnapshot, rangeInfo) => {
            if (!structuredSnapshot) {
                return {
                    messages: [],
                    sourceTotal: 0,
                    range: {
                        active: false,
                        start: null,
                        end: null,
                        messageStartIndex: null,
                        messageEndIndex: null,
                    },
                };
            }
            const messages = Array.isArray(structuredSnapshot.messages)
                ? structuredSnapshot.messages.slice()
                : [];
            const total = messages.length;
            const baseRange = {
                active: Boolean(rangeInfo?.active),
                start: normalizeNumeric(rangeInfo?.start),
                end: normalizeNumeric(rangeInfo?.end),
                messageStartIndex: normalizeNumeric(rangeInfo?.messageStartIndex),
                messageEndIndex: normalizeNumeric(rangeInfo?.messageEndIndex),
                count: normalizeNumeric(rangeInfo?.count) ?? undefined,
                total: normalizeNumeric(rangeInfo?.total) ?? undefined,
                messageTotal: normalizeNumeric(rangeInfo?.messageTotal) ?? undefined,
            };
            if (!messages.length || !baseRange.active) {
                return { messages, sourceTotal: total, range: { ...baseRange, active: false } };
            }
            let filtered = messages;
            if (Number.isFinite(baseRange.messageStartIndex) && Number.isFinite(baseRange.messageEndIndex)) {
                const lower = Math.min(baseRange.messageStartIndex, baseRange.messageEndIndex);
                const upper = Math.max(baseRange.messageStartIndex, baseRange.messageEndIndex);
                filtered = messages.filter((message) => {
                    const idx = Number(message?.index);
                    return Number.isFinite(idx) ? idx >= lower && idx <= upper : false;
                });
            }
            else if (Number.isFinite(baseRange.start) && Number.isFinite(baseRange.end)) {
                const lowerOrdinal = Math.min(baseRange.start, baseRange.end);
                const upperOrdinal = Math.max(baseRange.start, baseRange.end);
                filtered = messages.filter((message) => {
                    const ord = Number(message?.ordinal);
                    return Number.isFinite(ord) ? ord >= lowerOrdinal && ord <= upperOrdinal : false;
                });
            }
            if (!filtered.length) {
                filtered = messages.slice();
            }
            return {
                messages: filtered,
                sourceTotal: total,
                range: {
                    ...baseRange,
                    active: Boolean(baseRange.active && filtered.length && filtered.length <= total),
                },
            };
        };
        const readStructuredMessages = (options = {}) => {
            const { force } = options || {};
            if (!force && latestStructuredSnapshot) {
                return Array.isArray(latestStructuredSnapshot.messages)
                    ? latestStructuredSnapshot.messages.slice()
                    : [];
            }
            const snapshot = captureStructuredSnapshot(options);
            return Array.isArray(snapshot.messages) ? snapshot.messages.slice() : [];
        };
        const getEntryOrigin = () => entryOrigin.slice();
        return {
            captureStructuredSnapshot,
            readTranscriptText,
            projectStructuredMessages,
            readStructuredMessages,
            getEntryOrigin,
        };
    }

    const METER_INTERVAL_MS = CONFIG.TIMING.AUTO_LOADER.METER_INTERVAL_MS;
    const toElementArray = (collection) => {
        if (!collection)
            return [];
        if (Array.isArray(collection))
            return collection;
        return Array.from(collection);
    };
    function createAutoLoader({ stateApi, stateEnum, errorHandler, messageIndexer, exportRange, setPanelStatus, getActiveAdapter, sleep, isScrollable, documentRef = typeof document !== 'undefined' ? document : null, windowRef = typeof window !== 'undefined' ? window : null, normalizeTranscript, buildSession, readTranscriptText, logger = typeof console !== 'undefined' ? console : null, } = {}) {
        if (!stateApi || typeof stateApi.setState !== 'function') {
            throw new Error('createAutoLoader requires stateApi with setState');
        }
        if (!stateEnum)
            throw new Error('createAutoLoader requires stateEnum');
        if (!errorHandler || typeof errorHandler.handle !== 'function') {
            throw new Error('createAutoLoader requires errorHandler');
        }
        if (!getActiveAdapter)
            throw new Error('createAutoLoader requires getActiveAdapter');
        if (!sleep)
            throw new Error('createAutoLoader requires sleep helper');
        if (!isScrollable)
            throw new Error('createAutoLoader requires isScrollable helper');
        if (!normalizeTranscript || !buildSession || !readTranscriptText) {
            throw new Error('createAutoLoader requires transcript helpers');
        }
        if (!documentRef)
            throw new Error('createAutoLoader requires document reference');
        if (!windowRef)
            throw new Error('createAutoLoader requires window reference');
        const doc = documentRef;
        const win = windowRef;
        const ElementCtor = doc?.defaultView?.Element || (typeof Element !== 'undefined' ? Element : null);
        const MutationObserverCtor = win?.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
        const setTimeoutFn = typeof win?.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
        const setIntervalFn = typeof win?.setInterval === 'function' ? win.setInterval.bind(win) : setInterval;
        const clearIntervalFn = typeof win?.clearInterval === 'function' ? win.clearInterval.bind(win) : clearInterval;
        const AUTO_PROFILES = CONFIG.TIMING.AUTO_LOADER.PROFILES;
        const AUTO_CFG = {
            profile: 'default',
        };
        const AUTO_STATE = {
            running: false,
            container: null,
            meterTimer: null,
        };
        const profileListeners = new Set();
        const warnWithHandler = (err, context, fallbackMessage) => {
            if (errorHandler?.handle) {
                const level = errorHandler.LEVELS?.WARN || 'warn';
                errorHandler.handle(err, context, level);
            }
            else if (logger?.warn) {
                logger.warn(fallbackMessage, err);
            }
        };
        const notifyProfileChange = () => {
            profileListeners.forEach((listener) => {
                try {
                    listener(AUTO_CFG.profile);
                }
                catch (err) {
                    warnWithHandler(err, 'autoload', '[GMH] auto profile listener failed');
                }
            });
        };
        const getProfile = () => AUTO_CFG.profile;
        function ensureScrollContainer() {
            const adapter = typeof getActiveAdapter === 'function' ? getActiveAdapter() : null;
            const adapterContainer = adapter?.findContainer?.(doc);
            if (adapterContainer) {
                if (isScrollable(adapterContainer))
                    return adapterContainer;
                if (ElementCtor && adapterContainer instanceof ElementCtor) {
                    let ancestor = adapterContainer.parentElement;
                    for (let depth = 0; depth < 6 && ancestor; depth += 1) {
                        if (isScrollable(ancestor))
                            return ancestor;
                        ancestor = ancestor.parentElement;
                    }
                }
                return adapterContainer;
            }
            const messageBlocks = toElementArray(adapter?.listMessageBlocks?.(doc));
            if (messageBlocks.length) {
                let ancestor = messageBlocks[0]?.parentElement || null;
                for (let depth = 0; depth < 6 && ancestor; depth += 1) {
                    if (isScrollable(ancestor))
                        return ancestor;
                    ancestor = ancestor.parentElement;
                }
            }
            return (doc.scrollingElement || doc.documentElement || doc.body);
        }
        function waitForGrowth(el, startHeight, timeout) {
            if (!MutationObserverCtor) {
                return new Promise((resolve) => {
                    setTimeoutFn(() => resolve(false), timeout);
                });
            }
            return new Promise((resolve) => {
                let finished = false;
                const obs = new MutationObserverCtor(() => {
                    if (el.scrollHeight > startHeight + 4) {
                        finished = true;
                        obs.disconnect();
                        resolve(true);
                    }
                });
                obs.observe(el, { childList: true, subtree: true });
                setTimeoutFn(() => {
                    if (!finished) {
                        obs.disconnect();
                        resolve(false);
                    }
                }, timeout);
            });
        }
        async function scrollUpCycle(container, profile) {
            if (!container)
                return { grew: false, before: 0, after: 0 };
            const target = container;
            const before = target.scrollHeight;
            target.scrollTop = 0;
            const grew = await waitForGrowth(target, before, profile.settleTimeoutMs);
            return { grew, before, after: target.scrollHeight };
        }
        const statsCache = {
            summaryKey: null,
            rawKey: null,
            data: null,
        };
        const clearStatsCache = () => {
            statsCache.summaryKey = null;
            statsCache.rawKey = null;
            statsCache.data = null;
        };
        let lastSessionSignature = windowRef?.location?.href || (typeof location !== 'undefined' ? location.href : null);
        const makeSummaryKey = (summary) => {
            if (!summary)
                return null;
            const total = Number.isFinite(summary.totalMessages) ? summary.totalMessages : 'na';
            const user = Number.isFinite(summary.userMessages) ? summary.userMessages : 'na';
            const stamp = summary.timestamp || 'na';
            return `${total}:${user}:${stamp}`;
        };
        function collectTurnStats(options = {}) {
            const force = Boolean(options.force);
            let summary = null;
            try {
                const currentSignature = windowRef?.location?.href || (typeof location !== 'undefined' ? location.href : null);
                if (currentSignature && currentSignature !== lastSessionSignature) {
                    lastSessionSignature = currentSignature;
                    clearStatsCache();
                    exportRange?.clear?.();
                    exportRange?.setTotals?.({ message: 0, user: 0, llm: 0, entry: 0 });
                }
                try {
                    summary = messageIndexer?.refresh?.({ immediate: true }) || null;
                }
                catch (err) {
                    warnWithHandler(err, 'autoload', '[GMH] message indexing before stats failed');
                }
                const summaryKey = makeSummaryKey(summary);
                if (!force && summaryKey && statsCache.data && statsCache.summaryKey === summaryKey) {
                    return statsCache.data;
                }
                let rawText = null;
                let rawKey = null;
                const transcriptOptions = force ? { force: true } : {};
                if (!summaryKey) {
                    rawText = readTranscriptText(transcriptOptions);
                    rawKey = typeof rawText === 'string' ? rawText : String(rawText ?? '');
                    if (!force && statsCache.data && statsCache.rawKey === rawKey) {
                        return statsCache.data;
                    }
                }
                else {
                    rawText = readTranscriptText(transcriptOptions);
                }
                const normalized = normalizeTranscript(rawText);
                const session = buildSession(normalized);
                const userMessages = session.turns.filter((t) => t.channel === 'user').length;
                const llmMessages = session.turns.filter((t) => t.channel === 'llm').length;
                const previousTotals = exportRange?.getTotals?.() || {
                    message: 0,
                    user: 0,
                    llm: 0,
                    entry: 0,
                };
                const blockSet = new Set();
                session.turns.forEach((turn) => {
                    const blocks = Array.isArray(turn?.__gmhSourceBlocks) ? turn.__gmhSourceBlocks : [];
                    blocks
                        .filter((idx) => Number.isInteger(idx) && idx >= 0)
                        .forEach((idx) => blockSet.add(idx));
                });
                const entryCount = blockSet.size || session.turns.length;
                const nextTotals = {
                    message: session.turns.length,
                    user: userMessages,
                    llm: llmMessages,
                    entry: entryCount,
                };
                const totalsShrank = Number.isFinite(previousTotals.message) && previousTotals.message > nextTotals.message;
                const userShrank = Number.isFinite(previousTotals.user) && previousTotals.user > nextTotals.user;
                const llmShrank = Number.isFinite(previousTotals.llm) && previousTotals.llm > nextTotals.llm;
                const entryShrank = Number.isFinite(previousTotals.entry) && previousTotals.entry > nextTotals.entry;
                if (totalsShrank || userShrank || llmShrank || entryShrank) {
                    exportRange?.clear?.();
                }
                exportRange?.setTotals?.(nextTotals);
                const stats = {
                    session,
                    userMessages,
                    llmMessages,
                    totalMessages: session.turns.length,
                };
                statsCache.summaryKey = summaryKey;
                statsCache.rawKey = summaryKey ? null : rawKey;
                statsCache.data = stats;
                lastSessionSignature = currentSignature || lastSessionSignature;
                return stats;
            }
            catch (error) {
                clearStatsCache();
                if (errorHandler?.handle) {
                    const level = errorHandler.LEVELS?.ERROR || 'error';
                    errorHandler.handle(error, 'autoload', level);
                }
                return {
                    session: null,
                    userMessages: 0,
                    llmMessages: 0,
                    totalMessages: 0,
                    error,
                };
            }
        }
        const notifyScan = (payload) => {
            stateApi.setState(stateEnum.SCANNING, payload);
        };
        const notifyDone = (payload) => {
            stateApi.setState(stateEnum.DONE, payload);
        };
        const notifyError = (payload) => {
            stateApi.setState(stateEnum.ERROR, payload);
        };
        const notifyIdle = (payload) => {
            stateApi.setState(stateEnum.IDLE, payload);
        };
        async function autoLoadAll() {
            const profile = AUTO_PROFILES[getProfile()] || AUTO_PROFILES.default;
            const container = ensureScrollContainer();
            if (!container) {
                notifyError({
                    label: '자동 로딩 실패',
                    message: '채팅 컨테이너를 찾을 수 없습니다.',
                    tone: 'error',
                    progress: { value: 1 },
                });
                return {
                    session: null,
                    userMessages: 0,
                    llmMessages: 0,
                    totalMessages: 0,
                    error: new Error('container missing'),
                };
            }
            AUTO_STATE.running = true;
            AUTO_STATE.container = container;
            let stableRounds = 0;
            let guard = 0;
            while (AUTO_STATE.running && guard < profile.guardLimit) {
                guard += 1;
                notifyScan({
                    label: '위로 끝까지 로딩',
                    message: `추가 수집 중 (${guard}/${profile.guardLimit})`,
                    tone: 'progress',
                    progress: { indeterminate: true },
                });
                const { grew, before, after } = await scrollUpCycle(container, profile);
                if (!AUTO_STATE.running)
                    break;
                const delta = after - before;
                stableRounds = !grew || delta < 6 ? stableRounds + 1 : 0;
                if (stableRounds >= profile.maxStableRounds)
                    break;
                await sleep(profile.cycleDelayMs);
            }
            AUTO_STATE.running = false;
            const stats = collectTurnStats();
            if (stats.error) {
                notifyError({
                    label: '자동 로딩 실패',
                    message: '스크롤 후 파싱 실패',
                    tone: 'error',
                    progress: { value: 1 },
                });
            }
            else {
                notifyDone({
                    label: '자동 로딩 완료',
                    message: `유저 메시지 ${stats.userMessages}개 확보`,
                    tone: 'success',
                    progress: { value: 1 },
                });
            }
            return stats;
        }
        async function autoLoadUntilPlayerTurns(target) {
            const profile = AUTO_PROFILES[getProfile()] || AUTO_PROFILES.default;
            const container = ensureScrollContainer();
            if (!container) {
                notifyError({
                    label: '자동 로딩 실패',
                    message: '채팅 컨테이너를 찾을 수 없습니다.',
                    tone: 'error',
                    progress: { value: 1 },
                });
                return {
                    session: null,
                    userMessages: 0,
                    llmMessages: 0,
                    totalMessages: 0,
                    error: new Error('container missing'),
                };
            }
            AUTO_STATE.running = true;
            AUTO_STATE.container = container;
            let stableRounds = 0;
            let stagnantRounds = 0;
            let loopCount = 0;
            let prevUserMessages = -1;
            while (AUTO_STATE.running && loopCount < profile.guardLimit) {
                loopCount += 1;
                const stats = collectTurnStats();
                if (stats.error) {
                    notifyError({
                        label: '자동 로딩 실패',
                        message: '파싱 실패 - DOM 변화를 감지하지 못했습니다.',
                        tone: 'error',
                        progress: { value: 1 },
                    });
                    break;
                }
                if (stats.userMessages >= target) {
                    notifyDone({
                        label: '자동 로딩 완료',
                        message: `목표 달성 · 유저 메시지 ${stats.userMessages}개 확보`,
                        tone: 'success',
                        progress: { value: 1 },
                    });
                    break;
                }
                const ratio = target > 0 ? Math.min(1, stats.userMessages / target) : 0;
                notifyScan({
                    label: '메시지 확보 중',
                    message: `유저 메시지 ${stats.userMessages}/${target}`,
                    tone: 'progress',
                    progress: { value: ratio },
                });
                const { grew, before, after } = await scrollUpCycle(container, profile);
                if (!AUTO_STATE.running)
                    break;
                const delta = after - before;
                stableRounds = !grew || delta < 6 ? stableRounds + 1 : 0;
                stagnantRounds = stats.userMessages === prevUserMessages ? stagnantRounds + 1 : 0;
                prevUserMessages = stats.userMessages;
                if (stableRounds >= profile.maxStableRounds || stagnantRounds >= profile.guardLimit) {
                    notifyDone({
                        label: '자동 로딩 종료',
                        message: '추가 데이터를 불러오지 못했습니다. 더 이상 기록이 없거나 막혀있습니다.',
                        tone: 'warning',
                        progress: { value: ratio },
                    });
                    break;
                }
                await sleep(profile.cycleDelayMs);
            }
            AUTO_STATE.running = false;
            const finalStats = collectTurnStats();
            if (finalStats?.error) {
                notifyError({
                    label: '자동 로딩 실패',
                    message: '메시지 정보를 수집하지 못했습니다.',
                    tone: 'error',
                    progress: { value: 1 },
                });
                return finalStats;
            }
            if (stateApi.getState?.() === stateEnum.SCANNING) {
                const ratio = target > 0 ? Math.min(1, finalStats.userMessages / target) : 0;
                notifyDone({
                    label: '자동 로딩 종료',
                    message: `유저 메시지 ${finalStats.userMessages}/${target}`,
                    tone: 'warning',
                    progress: { value: ratio },
                });
            }
            return finalStats;
        }
        function stopAutoLoad() {
            if (!AUTO_STATE.running)
                return;
            AUTO_STATE.running = false;
            notifyIdle({
                label: '대기 중',
                message: '자동 로딩을 중지했습니다.',
                tone: 'info',
                progress: { value: 0 },
            });
        }
        function startTurnMeter(meter) {
            if (!meter)
                return;
            const render = () => {
                const stats = collectTurnStats();
                if (stats.error) {
                    meter.textContent = '메시지 측정 실패: DOM을 읽을 수 없습니다.';
                    return;
                }
                meter.textContent = `메시지 현황 · 유저 ${stats.userMessages} · LLM ${stats.llmMessages}`;
            };
            render();
            if (AUTO_STATE.meterTimer)
                return;
            AUTO_STATE.meterTimer = setIntervalFn(() => {
                if (!meter.isConnected) {
                    clearIntervalFn(AUTO_STATE.meterTimer);
                    AUTO_STATE.meterTimer = null;
                    return;
                }
                render();
            }, METER_INTERVAL_MS);
        }
        const autoLoader = {
            lastMode: null,
            lastTarget: null,
            lastProfile: AUTO_CFG.profile,
            async start(mode, target, opts = {}) {
                if (AUTO_STATE.running) {
                    setPanelStatus?.('이미 자동 로딩이 진행 중입니다.', 'muted');
                    return null;
                }
                if (opts.profile) {
                    AUTO_CFG.profile = AUTO_PROFILES[opts.profile] ? opts.profile : 'default';
                    this.lastProfile = AUTO_CFG.profile;
                    notifyProfileChange();
                }
                this.lastMode = mode;
                this.lastProfile = AUTO_CFG.profile;
                try {
                    if (mode === 'all') {
                        this.lastTarget = null;
                        return await autoLoadAll();
                    }
                    if (mode === 'turns') {
                        const numericTarget = Number(target);
                        const goal = Number.isFinite(numericTarget) ? numericTarget : Number(target) || 0;
                        if (!goal || goal <= 0) {
                            setPanelStatus?.('유저 메시지 목표가 올바르지 않습니다.', 'error');
                            return null;
                        }
                        this.lastTarget = goal;
                        return await autoLoadUntilPlayerTurns(goal);
                    }
                }
                catch (error) {
                    errorHandler.handle(error, 'autoload', errorHandler.LEVELS?.ERROR);
                    throw error;
                }
                return null;
            },
            async startCurrent(profileName) {
                if (!this.lastMode) {
                    setPanelStatus?.('재시도할 이전 작업이 없습니다.', 'muted');
                    return null;
                }
                if (profileName) {
                    AUTO_CFG.profile = AUTO_PROFILES[profileName] ? profileName : 'default';
                }
                else {
                    AUTO_CFG.profile = this.lastProfile || 'default';
                }
                this.lastProfile = AUTO_CFG.profile;
                notifyProfileChange();
                return this.start(this.lastMode, this.lastTarget);
            },
            setProfile(profileName) {
                const next = AUTO_PROFILES[profileName] ? profileName : 'default';
                AUTO_CFG.profile = next;
                this.lastProfile = next;
                setPanelStatus?.(`프로파일이 '${next}'로 설정되었습니다.`, 'info');
                notifyProfileChange();
            },
            stop() {
                stopAutoLoad();
            },
        };
        const subscribeProfileChange = (listener) => {
            if (typeof listener !== 'function')
                return () => { };
            profileListeners.add(listener);
            return () => profileListeners.delete(listener);
        };
        notifyProfileChange();
        return {
            autoLoader,
            autoState: AUTO_STATE,
            autoProfiles: AUTO_PROFILES,
            getProfile,
            subscribeProfileChange,
            startTurnMeter,
            collectTurnStats,
        };
    }

    /**
     * @typedef {import('../types').AutoLoaderController} AutoLoaderController
     * @typedef {import('../types').AutoLoaderExports} AutoLoaderExports
     */

    /**
     * @typedef {object} AutoLoaderControlsOptions
     * @property {Document | null} [documentRef]
     * @property {AutoLoaderController} autoLoader
     * @property {AutoLoaderExports['autoState']} autoState
     * @property {(message: string, tone?: string | null) => void} [setPanelStatus]
     * @property {(meter: HTMLElement | null) => void} startTurnMeter
     * @property {() => string} getAutoProfile
     * @property {(listener: () => void) => void} subscribeProfileChange
     * @property {() => Promise<void> | void} [downloadDomSnapshot]
     */

    /**
     * @typedef {object} AutoLoaderControls
     * @property {(panel: Element | null) => void} ensureAutoLoadControlsModern
     * @property {(panel: Element | null) => void} ensureAutoLoadControlsLegacy
     * @property {(panel: Element | null) => void} mountStatusActionsModern
     * @property {(panel: Element | null) => void} mountStatusActionsLegacy
     */

    /**
     * Generates UI hooks for controlling the auto-loader and download status buttons.
     *
     * @param {AutoLoaderControlsOptions} [options]
     * @returns {AutoLoaderControls}
     */
    function createAutoLoaderControls({
      documentRef = typeof document !== 'undefined' ? document : null,
      autoLoader,
      autoState,
      setPanelStatus,
      startTurnMeter,
      getAutoProfile,
      subscribeProfileChange,
      downloadDomSnapshot,
    } = {}) {
      if (!documentRef) throw new Error('createAutoLoaderControls requires document reference');
      if (!autoLoader) throw new Error('createAutoLoaderControls requires autoLoader');
      if (!autoState) throw new Error('createAutoLoaderControls requires autoState');
      if (!startTurnMeter) throw new Error('createAutoLoaderControls requires startTurnMeter');
      if (!getAutoProfile) throw new Error('createAutoLoaderControls requires getAutoProfile');
      if (!subscribeProfileChange) {
        throw new Error('createAutoLoaderControls requires subscribeProfileChange');
      }

      const doc = documentRef;
      const profileSelectElements = new Set();

      /**
       * Synchronizes the profile dropdowns with the latest active profile.
       * @returns {void}
       */
      const syncProfileSelects = () => {
        const profile = getAutoProfile();
        for (const el of Array.from(profileSelectElements)) {
          if (!el || !el.isConnected) {
            profileSelectElements.delete(el);
            continue;
          }
          el.value = profile;
        }
      };

      subscribeProfileChange(syncProfileSelects);

      /**
       * Adds profile select elements to the synchronization set.
       * @param {HTMLSelectElement | null} select
       * @returns {void}
       */
      const registerProfileSelect = (select) => {
        if (!select) return;
        profileSelectElements.add(select);
        syncProfileSelects();
        select.onchange = (event) => {
          autoLoader.setProfile(event.target.value);
        };
      };

      /**
       * Ensures the modern auto-loader controls markup exists within the panel.
       * @param {Element | null} panel
       * @returns {void}
       */
      const ensureAutoLoadControlsModern = (panel) => {
        if (!panel) return;
        let wrap = panel.querySelector('#gmh-autoload-controls');
        if (!wrap) {
          wrap = doc.createElement('div');
          wrap.id = 'gmh-autoload-controls';
          panel.appendChild(wrap);
        }
        if (wrap.dataset.ready === 'true') return;
        wrap.dataset.ready = 'true';
        wrap.innerHTML = `
      <div class="gmh-field-row">
        <button id="gmh-autoload-all" class="gmh-panel-btn gmh-panel-btn--accent">위로 끝까지 로딩</button>
        <button id="gmh-autoload-stop" class="gmh-panel-btn gmh-panel-btn--warn gmh-panel-btn--compact">정지</button>
      </div>
      <div class="gmh-field-row">
        <input id="gmh-autoload-turns" class="gmh-input" type="number" min="1" step="1" placeholder="최근 유저 메시지 N" />
        <button id="gmh-autoload-turns-btn" class="gmh-small-btn gmh-small-btn--accent">메시지 확보</button>
      </div>
      <div id="gmh-turn-meter" class="gmh-subtext"></div>
    `;

        const btnAll = wrap.querySelector('#gmh-autoload-all');
        const btnStop = wrap.querySelector('#gmh-autoload-stop');
        const btnTurns = wrap.querySelector('#gmh-autoload-turns-btn');
        const inputTurns = wrap.querySelector('#gmh-autoload-turns');
        const meter = wrap.querySelector('#gmh-turn-meter');

        const toggleControls = (disabled) => {
          btnAll.disabled = disabled;
          btnTurns.disabled = disabled;
          btnAll.classList.toggle('gmh-disabled', disabled);
          btnTurns.classList.toggle('gmh-disabled', disabled);
        };

        btnAll.onclick = async () => {
          if (autoState.running) return;
          toggleControls(true);
          try {
            await autoLoader.start('all');
          } finally {
            toggleControls(false);
          }
        };

        btnTurns.onclick = async () => {
          if (autoState.running) return;
          const rawVal = inputTurns?.value?.trim();
          const target = Number.parseInt(rawVal || '0', 10);
          if (!Number.isFinite(target) || target <= 0) {
            setPanelStatus?.('유저 메시지 수를 입력해주세요.', 'error');
            return;
          }
          toggleControls(true);
          try {
            await autoLoader.start('turns', target);
          } finally {
            toggleControls(false);
          }
        };

        btnStop.onclick = () => {
          if (!autoState.running) {
            setPanelStatus?.('자동 로딩이 실행 중이 아닙니다.', 'muted');
            return;
          }
          autoLoader.stop();
        };

        startTurnMeter(meter);
      };

      /**
       * Ensures the legacy auto-loader controls markup exists within the panel.
       * @param {Element | null} panel
       * @returns {void}
       */
      const ensureAutoLoadControlsLegacy = (panel) => {
        if (!panel || panel.querySelector('#gmh-autoload-controls')) return;

        const wrap = doc.createElement('div');
        wrap.id = 'gmh-autoload-controls';
        wrap.style.cssText = 'display:grid; gap:6px; border-top:1px solid #1f2937; padding-top:6px;';
        wrap.innerHTML = `
      <div style="display:flex; gap:8px;">
        <button id="gmh-autoload-all" style="flex:1; background:#38bdf8; border:0; color:#041; border-radius:8px; padding:6px; cursor:pointer;">위로 끝까지 로딩</button>
        <button id="gmh-autoload-stop" style="width:88px; background:#ef4444; border:0; color:#fff; border-radius:8px; padding:6px; cursor:pointer;">정지</button>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <input id="gmh-autoload-turns" type="number" min="1" step="1" placeholder="최근 유저 메시지 N" style="flex:1; background:#111827; color:#f1f5f9; border:1px solid #1f2937; border-radius:8px; padding:6px;" />
        <button id="gmh-autoload-turns-btn" style="width:96px; background:#34d399; border:0; color:#041; border-radius:8px; padding:6px; cursor:pointer;">메시지 확보</button>
      </div>
      <div id="gmh-turn-meter" style="opacity:.7; font-size:11px;"></div>
    `;

        panel.appendChild(wrap);

        const btnAll = wrap.querySelector('#gmh-autoload-all');
        const btnStop = wrap.querySelector('#gmh-autoload-stop');
        const btnTurns = wrap.querySelector('#gmh-autoload-turns-btn');
        const inputTurns = wrap.querySelector('#gmh-autoload-turns');
        const meter = wrap.querySelector('#gmh-turn-meter');

        const toggleControls = (disabled) => {
          btnAll.disabled = disabled;
          btnTurns.disabled = disabled;
          btnAll.style.opacity = disabled ? '0.6' : '1';
          btnTurns.style.opacity = disabled ? '0.6' : '1';
        };

        btnAll.onclick = async () => {
          if (autoState.running) return;
          toggleControls(true);
          try {
            await autoLoader.start('all');
          } finally {
            toggleControls(false);
          }
        };

        btnTurns.onclick = async () => {
          if (autoState.running) return;
          const rawVal = inputTurns?.value?.trim();
          const target = Number.parseInt(rawVal || '0', 10);
          if (!Number.isFinite(target) || target <= 0) {
            setPanelStatus?.('유저 메시지 수를 입력해주세요.', 'error');
            return;
          }
          toggleControls(true);
          try {
            const stats = await autoLoader.start('turns', target);
            if (stats && !stats.error) {
              setPanelStatus?.(`현재 유저 메시지 ${stats.userMessages}개 확보.`, 'success');
            }
          } finally {
            toggleControls(false);
          }
        };

        btnStop.onclick = () => {
          if (!autoState.running) {
            setPanelStatus?.('자동 로딩이 실행 중이 아닙니다.', 'muted');
            return;
          }
          autoLoader.stop();
          setPanelStatus?.('자동 로딩 중지를 요청했습니다.', 'warning');
        };

        startTurnMeter(meter);
      };

      /**
       * Builds markup for the status action buttons for modern/legacy panels.
       * @param {boolean} [modern=false]
       * @returns {string}
       */
      const createStatusActionsMarkup = (modern = false) => {
        if (modern) {
          return `
      <div class="gmh-field-row">
        <label for="gmh-profile-select" class="gmh-subtext gmh-field-label--inline">프로파일</label>
        <select id="gmh-profile-select" class="gmh-select">
          <option value="default">기본</option>
          <option value="stability">안정</option>
          <option value="fast">빠름</option>
        </select>
      </div>
      <div class="gmh-field-row">
        <button id="gmh-btn-retry" class="gmh-small-btn gmh-small-btn--muted">재시도</button>
        <button id="gmh-btn-retry-stable" class="gmh-small-btn gmh-small-btn--muted">안정 모드</button>
        <button id="gmh-btn-snapshot" class="gmh-small-btn gmh-small-btn--muted">DOM 스냅샷</button>
      </div>`;
        }
        return `
      <div style="display:flex; gap:6px; align-items:center;">
        <label for="gmh-profile-select" style="font-size:11px; color:#94a3b8;">프로파일</label>
        <select id="gmh-profile-select" style="flex:1; background:#111827; color:#f8fafc; border:1px solid #1f2937; border-radius:6px; padding:6px;">
          <option value="default">기본</option>
          <option value="stability">안정</option>
          <option value="fast">빠름</option>
        </select>
      </div>
      <div style="display:flex; gap:6px;">
        <button id="gmh-btn-retry" style="flex:1; background:#f1f5f9; color:#0f172a; border:0; border-radius:6px; padding:6px; cursor:pointer;">재시도</button>
        <button id="gmh-btn-retry-stable" style="flex:1; background:#e0e7ff; color:#1e1b4b; border:0; border-radius:6px; padding:6px; cursor:pointer;">안정 모드 재시도</button>
        <button id="gmh-btn-snapshot" style="flex:1; background:#ffe4e6; color:#881337; border:0; border-radius:6px; padding:6px; cursor:pointer;">DOM 스냅샷</button>
      </div>`;
      };

      /**
       * Binds retry/download handlers within the status actions container.
       * @param {HTMLElement} actions
       * @param {boolean} modern
       * @returns {void}
       */
      const bindStatusActions = (actions, modern) => {
        const select = actions.querySelector('#gmh-profile-select');
        if (select) registerProfileSelect(select);

        const retryBtn = actions.querySelector('#gmh-btn-retry');
        if (retryBtn) {
          retryBtn.onclick = async () => {
            if (autoState.running) {
              setPanelStatus?.('이미 자동 로딩이 진행 중입니다.', 'muted');
              return;
            }
            await autoLoader.startCurrent();
          };
        }

        const retryStableBtn = actions.querySelector('#gmh-btn-retry-stable');
        if (retryStableBtn) {
          retryStableBtn.onclick = async () => {
            if (autoState.running) {
              setPanelStatus?.('이미 자동 로딩이 진행 중입니다.', 'muted');
              return;
            }
            await autoLoader.startCurrent('stability');
          };
        }

        const snapshotBtn = actions.querySelector('#gmh-btn-snapshot');
        if (snapshotBtn) {
          snapshotBtn.onclick = () => downloadDomSnapshot?.();
        }
      };

      /**
       * Mounts the modern status actions block into the panel.
       * @param {Element | null} panel
       * @returns {void}
       */
      const mountStatusActionsModern = (panel) => {
        if (!panel) return;
        let actions = panel.querySelector('#gmh-status-actions');
        if (!actions) {
          actions = doc.createElement('div');
          actions.id = 'gmh-status-actions';
          panel.appendChild(actions);
        }
        if (actions.dataset.ready === 'true') return;
        actions.dataset.ready = 'true';
        actions.innerHTML = createStatusActionsMarkup(true);
        bindStatusActions(actions);
      };

      /**
       * Mounts the legacy status actions block into the panel.
       * @param {Element | null} panel
       * @returns {void}
       */
      const mountStatusActionsLegacy = (panel) => {
        if (!panel || panel.querySelector('#gmh-status-actions')) return;
        const actions = doc.createElement('div');
        actions.id = 'gmh-status-actions';
        actions.style.cssText =
          'display:grid; gap:6px; border-top:1px solid rgba(148,163,184,0.25); padding-top:6px;';
        actions.innerHTML = createStatusActionsMarkup(false);
        bindStatusActions(actions);
        panel.appendChild(actions);
      };

      return {
        ensureAutoLoadControlsModern,
        ensureAutoLoadControlsLegacy,
        mountStatusActionsModern,
        mountStatusActionsLegacy,
      };
    }

    /**
     * @typedef {import('../types').ExportRangeController} ExportRangeController
     * @typedef {import('../types').TurnBookmarks} TurnBookmarks
     * @typedef {import('../types').TurnBookmarkEntry} TurnBookmarkEntry
     * @typedef {import('../types').MessageIndexer} MessageIndexer
     */

    /**
     * @typedef {object} RangeControlsOptions
     * @property {Document | null} [documentRef]
     * @property {Window | null} [windowRef]
     * @property {ExportRangeController} exportRange
     * @property {TurnBookmarks} turnBookmarks
     * @property {MessageIndexer} messageIndexer
     * @property {(message: string, tone?: string | null) => void} [setPanelStatus]
     */

    /**
     * @typedef {object} RangeControls
     * @property {(panel: Element | null) => void} bindRangeControls
     */

    /**
     * Creates DOM bindings for export range selectors and bookmark integration.
     *
     * @param {RangeControlsOptions} options
     * @returns {RangeControls}
     */
    function createRangeControls({
      documentRef = typeof document !== 'undefined' ? document : null,
      windowRef = typeof window !== 'undefined' ? window : null,
      exportRange,
      turnBookmarks,
      messageIndexer,
      setPanelStatus,
    }) {
      if (!documentRef) throw new Error('createRangeControls requires document reference');
      if (!exportRange) throw new Error('createRangeControls requires exportRange');
      if (!turnBookmarks) throw new Error('createRangeControls requires turnBookmarks');
      if (!messageIndexer) throw new Error('createRangeControls requires messageIndexer');

      const doc = documentRef;
      const win = windowRef;
      const cssEscape = () => doc?.defaultView?.CSS?.escape || win?.CSS?.escape;

      let rangeUnsubscribe = null;
      let selectedBookmarkKey = '';
      let bookmarkSelectionPinned = false;

      /**
       * @param {unknown} value
       * @returns {number | null}
       */
      const toNumber = (value) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
      };

      /**
       * Subscribes to export range changes.
       * @param {(snapshot: unknown) => void} handler
       * @returns {void}
       */
      const subscribeRange = (handler) => {
        if (typeof exportRange?.subscribe !== 'function') return;
        if (typeof rangeUnsubscribe === 'function') rangeUnsubscribe();
        rangeUnsubscribe = exportRange.subscribe(handler);
      };

      /**
       * Invokes the handler once with the current export range snapshot.
       * @param {(snapshot: any) => void} handler
       * @returns {void}
       */
      const updateRangeSnapshot = (handler) => {
        if (typeof handler !== 'function') return;
        if (typeof exportRange?.snapshot === 'function') {
          handler(exportRange.snapshot());
          return;
        }
        if (typeof exportRange?.describe === 'function') {
          const bounds = exportRange.describe();
          const totals = typeof exportRange?.getTotals === 'function' ? exportRange.getTotals() : {};
          const range = typeof exportRange?.getRange === 'function'
            ? exportRange.getRange()
            : { start: null, end: null };
          handler({ bounds, totals, range });
        }
      };

      /**
        * Updates the bookmark dropdown with the latest entries.
        * @param {HTMLSelectElement | null} select
        * @param {TurnBookmarkEntry[]} [entries=[]]
        * @returns {void}
        */
      const syncBookmarkSelect = (select, entries = []) => {
        if (!select) return;
        const previous = selectedBookmarkKey || select.value || '';
        select.innerHTML = '';
        const placeholder = doc.createElement('option');
        placeholder.value = '';
        placeholder.textContent = entries.length
          ? '최근 클릭한 메시지를 선택하세요'
          : '최근 클릭한 메시지가 없습니다';
        select.appendChild(placeholder);
        entries.forEach((entry) => {
          const option = doc.createElement('option');
          option.value = entry.key;
          const axisLabel = '메시지';
          const ordinalText = Number.isFinite(entry.ordinal)
            ? `${axisLabel} ${entry.ordinal}`
            : `${axisLabel} ?`;
          const idText = entry.messageId ? entry.messageId : `index ${entry.index}`;
          option.textContent = `${ordinalText} · ${idText}`;
          option.dataset.index = String(entry.index);
          select.appendChild(option);
        });
        let nextValue = '';
        if (bookmarkSelectionPinned && entries.some((entry) => entry.key === previous)) {
          nextValue = previous;
        } else if (entries.length) {
          nextValue = entries[0].key;
          bookmarkSelectionPinned = false;
        }
        select.value = nextValue;
        selectedBookmarkKey = nextValue || '';
        if (!nextValue && !entries.length) {
          select.selectedIndex = 0;
        }
      };

      /**
       * Prepares the bookmark select element for range shortcuts.
       * @param {HTMLSelectElement | null} select
       * @returns {void}
       */
      const registerBookmarkSelect = (select) => {
        if (!select) return;
        if (select.dataset.gmhBookmarksReady === 'true') return;
        select.dataset.gmhBookmarksReady = 'true';
        select.addEventListener('change', () => {
          selectedBookmarkKey = select.value || '';
          bookmarkSelectionPinned = Boolean(selectedBookmarkKey);
        });
        if (typeof turnBookmarks?.subscribe === 'function') {
          turnBookmarks.subscribe((entries) => syncBookmarkSelect(select, entries));
        }
        if (typeof turnBookmarks?.list === 'function') {
          syncBookmarkSelect(select, turnBookmarks.list());
        }
      };

      /**
       * Attaches event listeners and range bindings to the provided panel node.
       * @param {Element | null} panel
       * @returns {void}
       */
      const bindRangeControls = (panel) => {
        if (!panel) return;
        const rangeStartInput = panel.querySelector('#gmh-range-start');
        const rangeEndInput = panel.querySelector('#gmh-range-end');
        const rangeClearBtn = panel.querySelector('#gmh-range-clear');
        const rangeMarkStartBtn = panel.querySelector('#gmh-range-mark-start');
        const rangeMarkEndBtn = panel.querySelector('#gmh-range-mark-end');
        const rangeSummary = panel.querySelector('#gmh-range-summary');
        const rangeBookmarkSelect = panel.querySelector('#gmh-range-bookmark-select');

        registerBookmarkSelect(rangeBookmarkSelect);

        const syncRangeControls = (snapshot) => {
          if (!snapshot) return;
          const { bounds, totals, range } = snapshot;
          const messageTotal = totals?.message ?? bounds.messageTotal ?? 0;
          const userTotal = totals?.user ?? bounds.userTotal ?? 0;
          const llmTotal = totals?.llm ?? bounds.llmTotal ?? 0;
          const resolvedStart = bounds.active ? bounds.start : null;
          const resolvedEnd = bounds.active ? bounds.end : null;

          if (rangeStartInput) {
            if (messageTotal) rangeStartInput.max = String(messageTotal);
            else rangeStartInput.removeAttribute('max');
            rangeStartInput.dataset.gmhAxis = 'message';
            rangeStartInput.value = resolvedStart ? String(resolvedStart) : '';
            rangeStartInput.dataset.gmhRequested = range.start ? String(range.start) : '';
          }
          if (rangeEndInput) {
            if (messageTotal) rangeEndInput.max = String(messageTotal);
            else rangeEndInput.removeAttribute('max');
            rangeEndInput.dataset.gmhAxis = 'message';
            rangeEndInput.value = resolvedEnd ? String(resolvedEnd) : '';
            rangeEndInput.dataset.gmhRequested = range.end ? String(range.end) : '';
          }
          if (rangeMarkStartBtn) {
            if (messageTotal) rangeMarkStartBtn.removeAttribute('disabled');
            else rangeMarkStartBtn.setAttribute('disabled', 'true');
          }
          if (rangeMarkEndBtn) {
            if (messageTotal) rangeMarkEndBtn.removeAttribute('disabled');
            else rangeMarkEndBtn.setAttribute('disabled', 'true');
          }
          if (rangeSummary) {
            if (!messageTotal) {
              rangeSummary.textContent = '로드된 메시지가 없습니다.';
              rangeSummary.title = '';
            } else if (!bounds.active) {
              let textLabel = `최근 메시지 ${messageTotal}개 전체`;
              if (userTotal) textLabel += ` · 유저 ${userTotal}개`;
              if (llmTotal) textLabel += ` · LLM ${llmTotal}개`;
              rangeSummary.textContent = textLabel;
              rangeSummary.title = '';
            } else {
              let textLabel = `최근 메시지 ${bounds.start}-${bounds.end} · ${bounds.count}개 / 전체 ${bounds.total}개`;
              if (userTotal) textLabel += ` · 유저 ${userTotal}개`;
              if (llmTotal) textLabel += ` · LLM ${llmTotal}개`;
              rangeSummary.textContent = textLabel;
              rangeSummary.title = '';
            }
          }
        };

        if (rangeStartInput || rangeEndInput || rangeSummary || rangeMarkStartBtn || rangeMarkEndBtn) {
          subscribeRange(syncRangeControls);
          updateRangeSnapshot(syncRangeControls);

          const handleStartChange = () => {
            if (!rangeStartInput) return;
            const value = toNumber(rangeStartInput.value);
            if (value && value > 0) {
              exportRange?.setStart?.(value);
            } else {
              exportRange?.setStart?.(null);
              rangeStartInput.value = '';
            }
          };

          const handleEndChange = () => {
            if (!rangeEndInput) return;
            const value = toNumber(rangeEndInput.value);
            if (value && value > 0) {
              exportRange?.setEnd?.(value);
            } else {
              exportRange?.setEnd?.(null);
              rangeEndInput.value = '';
            }
          };

          if (rangeStartInput && rangeStartInput.dataset.gmhRangeReady !== 'true') {
            rangeStartInput.dataset.gmhRangeReady = 'true';
            rangeStartInput.addEventListener('change', handleStartChange);
            rangeStartInput.addEventListener('blur', handleStartChange);
          }
          if (rangeEndInput && rangeEndInput.dataset.gmhRangeReady !== 'true') {
            rangeEndInput.dataset.gmhRangeReady = 'true';
            rangeEndInput.addEventListener('change', handleEndChange);
            rangeEndInput.addEventListener('blur', handleEndChange);
          }
          if (rangeClearBtn && rangeClearBtn.dataset.gmhRangeReady !== 'true') {
            rangeClearBtn.dataset.gmhRangeReady = 'true';
            rangeClearBtn.addEventListener('click', () => {
              exportRange?.clear?.();
              turnBookmarks?.clear?.();
              selectedBookmarkKey = '';
              bookmarkSelectionPinned = false;
              if (rangeBookmarkSelect) rangeBookmarkSelect.value = '';
            });
          }

          const getActiveBookmark = () => {
            if (rangeBookmarkSelect) {
              const key = rangeBookmarkSelect.value || selectedBookmarkKey || '';
              if (key) {
                const picked = turnBookmarks?.pick?.(key);
                if (picked) return picked;
              }
            }
            return turnBookmarks?.latest?.();
          };

          /**
           * Records the current message context as a range start/end.
           * @param {'start' | 'end'} mode
           * @returns {void}
           */
          const doBookmark = (mode) => {
            const lookupOrdinalByIndex = messageIndexer?.lookupOrdinalByIndex;
            const lookupOrdinalByMessageId = messageIndexer?.lookupOrdinalByMessageId;

            const buildContextFromElement = (element) => {
              if (!(element instanceof Element)) return null;
              const messageEl = element.closest('[data-gmh-message-index]');
              if (!messageEl) return null;
              const indexAttr = messageEl.getAttribute('data-gmh-message-index');
              const messageIdAttr =
                messageEl.getAttribute('data-gmh-message-id') ||
                messageEl.getAttribute('data-message-id');
              const index = toNumber(indexAttr);

              const resolvedOrdinal = [
                Number.isFinite(index) && typeof lookupOrdinalByIndex === 'function'
                  ? lookupOrdinalByIndex(index)
                  : null,
                messageIdAttr && typeof lookupOrdinalByMessageId === 'function'
                  ? lookupOrdinalByMessageId(messageIdAttr)
                  : null,
                toNumber(messageEl.getAttribute('data-gmh-message-ordinal')),
              ].find((value) => Number.isFinite(value) && value > 0);

              return {
                element: messageEl,
                index: Number.isFinite(index) ? index : null,
                ordinal: Number.isFinite(resolvedOrdinal) ? resolvedOrdinal : null,
                messageId: messageIdAttr || null,
              };
            };

            const resolveFromElement = (element) => buildContextFromElement(element);

            const escapeForAttr = (value) => {
              if (typeof value !== 'string') return '';
              const esc = cssEscape();
              return typeof esc === 'function' ? esc(value) : value.replace(/"/g, '\\"');
            };

            const listByMessageId = (messageId) => {
              if (!messageId) return [];
              try {
                const selector = `[data-gmh-message-id="${escapeForAttr(messageId)}"]`;
                return Array.from(doc.querySelectorAll(selector));
              } catch (err) {
                return [];
              }
            };

            const selectBestCandidate = (candidates, preferredIndex = null) => {
              const elements = Array.from(new Set(candidates.filter((el) => el instanceof Element)));
              if (!elements.length) return null;
              if (Number.isFinite(preferredIndex)) {
                const exact = elements.find(
                  (el) => Number(el.getAttribute('data-gmh-message-index')) === preferredIndex,
                );
                if (exact) return exact;
              }
              const withOrdinal = elements
                .map((el) => ({
                  el,
                  ord: toNumber(el.getAttribute('data-gmh-message-ordinal')),
                  idx: toNumber(el.getAttribute('data-gmh-message-index')),
                }))
                .sort((a, b) => {
                  if (Number.isFinite(a.ord) && Number.isFinite(b.ord)) return a.ord - b.ord;
                  if (Number.isFinite(a.idx) && Number.isFinite(b.idx)) return b.idx - a.idx;
                  return 0;
                });
              return withOrdinal[0]?.el || elements[elements.length - 1];
            };

            const safeQueryById = (messageId, preferredIndex = null) => {
              const candidates = listByMessageId(messageId);
              return selectBestCandidate(candidates, preferredIndex);
            };

            const getCandidateContext = () => {
              const bookmark = getActiveBookmark();
              if (bookmark) {
                const fromBookmark =
                  safeQueryById(bookmark.messageId, bookmark.index) ||
                  (Number.isFinite(bookmark.index)
                    ? selectBestCandidate(
                        Array.from(doc.querySelectorAll(`[data-gmh-message-index="${bookmark.index}"]`)),
                        bookmark.index,
                      )
                    : null);
                const resolvedBookmark = resolveFromElement(fromBookmark);
                if (resolvedBookmark) return resolvedBookmark;
              }
              const active = doc.activeElement;
              const resolvedActive = resolveFromElement(active);
              if (resolvedActive) return resolvedActive;
              const latest = doc.querySelector('[data-gmh-message-ordinal="1"]');
              return resolveFromElement(latest);
            };

            const context = getCandidateContext();
            if (!context) {
              setPanelStatus?.('메시지를 찾을 수 없습니다.', 'warning');
              return;
            }

            try {
              messageIndexer?.refresh?.({ immediate: true });
            } catch (err) {
              win?.console?.warn?.('[GMH] ordinal refresh failed', err);
            }

            const reselectElement = () => {
              if (context.element instanceof Element && context.element.isConnected) {
                const current = buildContextFromElement(context.element);
                if (current) return current;
              }

              const candidates = [];
              if (context.messageId) candidates.push(...listByMessageId(context.messageId));
              if (Number.isFinite(context.index)) {
                candidates.push(...doc.querySelectorAll(`[data-gmh-message-index="${context.index}"]`));
              }

              const chosen = selectBestCandidate(candidates, context.index);
              return chosen ? buildContextFromElement(chosen) : null;
            };

            const refreshedContext = reselectElement() || context;

            const ordinalFromIndex =
              Number.isFinite(refreshedContext.index) && typeof messageIndexer?.lookupOrdinalByIndex === 'function'
                ? messageIndexer.lookupOrdinalByIndex(refreshedContext.index)
                : null;
            const ordinalFromId =
              refreshedContext.messageId && typeof messageIndexer?.lookupOrdinalByMessageId === 'function'
                ? messageIndexer.lookupOrdinalByMessageId(refreshedContext.messageId)
                : null;
            const ordinalFromAttr = toNumber(
              refreshedContext.element?.getAttribute?.('data-gmh-message-ordinal') ?? refreshedContext.ordinal,
            );
            const resolvedOrdinal = [ordinalFromIndex, ordinalFromId, ordinalFromAttr].find(
              (value) => Number.isFinite(value) && value > 0,
            );
            if (!Number.isFinite(resolvedOrdinal) || resolvedOrdinal <= 0) {
              setPanelStatus?.('메시지 순서를 찾을 수 없습니다. 화면을 새로고침해 주세요.', 'warning');
              return;
            }

            if (mode === 'start') {
              exportRange?.setStart?.(resolvedOrdinal);
              if (rangeStartInput) rangeStartInput.value = String(resolvedOrdinal);
              setPanelStatus?.(`메시지 ${resolvedOrdinal}을 시작으로 지정했습니다.`, 'info');
            } else {
              exportRange?.setEnd?.(resolvedOrdinal);
              if (rangeEndInput) rangeEndInput.value = String(resolvedOrdinal);
              setPanelStatus?.(`메시지 ${resolvedOrdinal}을 끝으로 지정했습니다.`, 'info');
            }

            const recorded = turnBookmarks?.record?.(
              refreshedContext.index,
              resolvedOrdinal,
              refreshedContext.messageId,
              'message',
            );
            if (recorded?.key) {
              selectedBookmarkKey = recorded.key;
              bookmarkSelectionPinned = false;
              if (rangeBookmarkSelect) rangeBookmarkSelect.value = recorded.key;
            }
          };

          if (rangeMarkStartBtn && rangeMarkStartBtn.dataset.gmhRangeReady !== 'true') {
            rangeMarkStartBtn.dataset.gmhRangeReady = 'true';
            rangeMarkStartBtn.addEventListener('click', () => doBookmark('start'));
          }
          if (rangeMarkEndBtn && rangeMarkEndBtn.dataset.gmhRangeReady !== 'true') {
            rangeMarkEndBtn.dataset.gmhRangeReady = 'true';
            rangeMarkEndBtn.addEventListener('click', () => doBookmark('end'));
          }
        }
      };

      return {
        bindRangeControls,
      };
    }

    /**
     * Registers keyboard shortcuts for panel visibility and auto-loader actions.
     *
     * @typedef {import('../types').PanelShortcutsOptions} PanelShortcutsOptions
     * @returns {{ bindShortcuts: (panel: Element | null, options?: { modern?: boolean }) => void }}
     */
    function createPanelShortcuts({
      windowRef = typeof window !== 'undefined' ? window : null,
      panelVisibility,
      autoLoader,
      autoState,
      configurePrivacyLists,
      modal,
    } = /** @type {PanelShortcutsOptions} */ ({})) {
      if (!windowRef) throw new Error('createPanelShortcuts requires window reference');
      if (!panelVisibility) throw new Error('createPanelShortcuts requires panelVisibility');
      if (!autoLoader) throw new Error('createPanelShortcuts requires autoLoader');
      if (!autoState) throw new Error('createPanelShortcuts requires autoState');
      if (!configurePrivacyLists) throw new Error('createPanelShortcuts requires configurePrivacyLists');

      let shortcutsBound = false;

      /**
       * @param {Element | null} panel
       * @param {{ modern?: boolean }} [options]
       * @returns {void}
       */
      const bindShortcuts = (panel, { modern } = {}) => {
        if (!modern || shortcutsBound) return;
        if (!panel) return;

        const win = windowRef;
        /**
         * @param {KeyboardEvent} event
         * @returns {void}
         */
        const handler = (event) => {
          if (!event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
          const key = event.key?.toLowerCase();
          const target = event.target;
          if (target instanceof win.HTMLElement) {
            const tag = target.tagName.toLowerCase();
            const isInputLike =
              ['input', 'textarea', 'select'].includes(tag) || target.isContentEditable;
            if (isInputLike && !['g', 'm'].includes(key)) return;
          }
          if (modal?.isOpen?.()) return;
          switch (key) {
            case 'g':
              event.preventDefault();
              panelVisibility.open({ focus: true, persist: true });
              break;
            case 'm':
              event.preventDefault();
              panelVisibility.toggle();
              break;
            case 's':
              event.preventDefault();
              if (!autoState.running) {
                autoLoader
                  .start('all')
                  .catch((error) => win.console?.warn?.('[GMH] auto shortcut', error));
              }
              break;
            case 'p':
              event.preventDefault();
              configurePrivacyLists();
              break;
            case 'e':
              event.preventDefault();
              /** @type {HTMLButtonElement | null} */ (
                panel.querySelector('#gmh-export')
              )?.click();
              break;
          }
        };

        win.addEventListener('keydown', handler);
        shortcutsBound = true;
      };

      return {
        bindShortcuts,
      };
    }

    function createShareWorkflow(options) {
        const typedOptions = options;
        const { captureStructuredSnapshot, normalizeTranscript, buildSession, exportRange: exportRangeOption, projectStructuredMessages, cloneSession, applyPrivacyPipeline, privacyConfig, privacyProfiles, formatRedactionCounts, setPanelStatus, toMarkdownExport, toJSONExport, toTXTExport, toStructuredMarkdown, toStructuredJSON, toStructuredTXT, buildExportBundle, buildExportManifest, triggerDownload, clipboard, stateApi: stateApiOption, stateEnum, confirmPrivacyGate, getEntryOrigin, collectSessionStats, alert: alertFn = (msg) => globalThis.alert?.(msg), logger = typeof console !== 'undefined' ? console : null, } = typedOptions;
        const exportRange = exportRangeOption;
        const stateApi = stateApiOption;
        requireDeps({
            captureStructuredSnapshot,
            normalizeTranscript,
            buildSession,
            exportRange,
            projectStructuredMessages,
            cloneSession,
            applyPrivacyPipeline,
            privacyConfig,
            privacyProfiles,
            formatRedactionCounts,
            setPanelStatus,
            toMarkdownExport,
            toJSONExport,
            toTXTExport,
            toStructuredMarkdown,
            toStructuredJSON,
            toStructuredTXT,
            buildExportBundle,
            buildExportManifest,
            triggerDownload,
            clipboard,
            stateApi,
            stateEnum,
            confirmPrivacyGate,
            getEntryOrigin,
            collectSessionStats,
        }, {
            captureStructuredSnapshot: (fn) => typeof fn === 'function',
            normalizeTranscript: (fn) => typeof fn === 'function',
            buildSession: (fn) => typeof fn === 'function',
            projectStructuredMessages: (fn) => typeof fn === 'function',
            cloneSession: (fn) => typeof fn === 'function',
            applyPrivacyPipeline: (fn) => typeof fn === 'function',
            privacyConfig: (value) => Boolean(value),
            privacyProfiles: (value) => Boolean(value),
            formatRedactionCounts: (fn) => typeof fn === 'function',
            setPanelStatus: (fn) => typeof fn === 'function',
            toMarkdownExport: (fn) => typeof fn === 'function',
            toJSONExport: (fn) => typeof fn === 'function',
            toTXTExport: (fn) => typeof fn === 'function',
            toStructuredMarkdown: (fn) => typeof fn === 'function',
            toStructuredJSON: (fn) => typeof fn === 'function',
            toStructuredTXT: (fn) => typeof fn === 'function',
            buildExportBundle: (fn) => typeof fn === 'function',
            buildExportManifest: (fn) => typeof fn === 'function',
            triggerDownload: (fn) => typeof fn === 'function',
            exportRange: (value) => Boolean(value?.setTotals),
            'clipboard.set': (fn) => typeof fn === 'function',
            stateApi: (value) => Boolean(value?.setState),
            stateEnum: (value) => Boolean(value),
            confirmPrivacyGate: (fn) => typeof fn === 'function',
            getEntryOrigin: (fn) => typeof fn === 'function',
            collectSessionStats: (fn) => typeof fn === 'function',
        });
        const parseAll = () => {
            const snapshot = captureStructuredSnapshot({ force: true });
            const raw = snapshot.legacyLines.join('\n');
            const normalized = normalizeTranscript(raw);
            const session = buildSession(normalized);
            if (!session.turns.length)
                throw new Error('대화 메시지를 찾을 수 없습니다.');
            const userCount = session.turns.filter((turn) => turn.channel === 'user').length;
            const llmCount = session.turns.filter((turn) => turn.channel === 'llm').length;
            const entryCount = session.turns.reduce((sum, turn) => {
                if (Array.isArray(turn?.__gmhEntries))
                    return sum + turn.__gmhEntries.length;
                return sum + 1;
            }, 0);
            exportRange?.setTotals?.({
                message: session.turns.length,
                user: userCount,
                llm: llmCount,
                entry: entryCount,
            });
            return { session, raw: normalized, snapshot };
        };
        const prepareShare = async ({ confirmLabel, cancelStatusMessage, blockedStatusMessage, } = {}) => {
            try {
                stateApi.setState(stateEnum.REDACTING, {
                    label: '민감정보 마스킹 중',
                    message: '레다크션 파이프라인 적용 중...',
                    tone: 'progress',
                    progress: { indeterminate: true },
                });
                const { session, raw, snapshot } = parseAll();
                const privacy = applyPrivacyPipeline(session, raw, privacyConfig.profile, snapshot);
                if (privacy.blocked) {
                    alertFn(`미성년자 성적 맥락이 감지되어 작업을 중단했습니다.

차단 이유를 확인하려면:
1. F12 키를 눌러 개발자 도구 열기
2. 콘솔(Console) 탭 선택
3. 다음 명령어 입력 후 Enter:
   localStorage.setItem('gmh_debug_blocking', '1')
4. 다시 내보내기/복사 시도
5. 콘솔에서 상세 정보 확인

※ 정당한 교육/상담 내용이 차단되었다면 GitHub Issues로 신고해주세요.
https://github.com/devforai-creator/genit-memory-helper/issues`);
                    stateApi.setState(stateEnum.ERROR, {
                        label: '작업 차단',
                        message: blockedStatusMessage || '미성년자 민감 맥락으로 작업이 차단되었습니다.',
                        tone: 'error',
                        progress: { value: 1 },
                    });
                    return null;
                }
                const requestedRange = exportRange?.getRange?.() || { start: null, end: null };
                const sanitizedUserCount = privacy.sanitizedSession.turns.filter((turn) => turn.channel === 'user').length;
                const sanitizedLlmCount = privacy.sanitizedSession.turns.filter((turn) => turn.channel === 'llm').length;
                const sanitizedEntryCount = privacy.sanitizedSession.turns.reduce((sum, turn) => sum + (Array.isArray(turn?.__gmhEntries) ? turn.__gmhEntries.length : 1), 0);
                exportRange?.setTotals?.({
                    message: privacy.sanitizedSession.turns.length,
                    user: sanitizedUserCount,
                    llm: sanitizedLlmCount,
                    entry: sanitizedEntryCount,
                });
                if (requestedRange.start || requestedRange.end) {
                    exportRange?.setRange?.(requestedRange.start, requestedRange.end);
                }
                const selection = exportRange?.apply?.(privacy.sanitizedSession.turns) || {
                    indices: [],
                    ordinals: [],
                    turns: [],
                    rangeDetails: null,
                    info: exportRange?.describe?.(privacy.sanitizedSession.turns.length),
                };
                const rangeInfo = selection?.info || exportRange?.describe?.(privacy.sanitizedSession.turns.length);
                const structuredSelection = projectStructuredMessages(privacy.structured, rangeInfo);
                const exportSession = cloneSession(privacy.sanitizedSession);
                const entryOrigin = typeof getEntryOrigin === 'function' ? getEntryOrigin() : [];
                const selectedIndices = selection.indices?.length
                    ? selection.indices
                    : privacy.sanitizedSession.turns.map((_, idx) => idx);
                const selectedIndexSet = new Set(selectedIndices);
                exportSession.turns = selectedIndices.map((index, localIndex) => {
                    const original = privacy.sanitizedSession.turns[index] || {};
                    const clone = { ...original };
                    Object.defineProperty(clone, '__gmhIndex', {
                        value: index,
                        enumerable: false,
                    });
                    Object.defineProperty(clone, '__gmhOrdinal', {
                        value: selection.ordinals?.[localIndex] ?? null,
                        enumerable: false,
                    });
                    Object.defineProperty(clone, '__gmhSourceBlock', {
                        value: entryOrigin[index] ?? null,
                        enumerable: false,
                    });
                    return clone;
                });
                exportSession.meta = {
                    ...(exportSession.meta || {}),
                    selection: {
                        active: Boolean(selection.info?.active),
                        range: {
                            start: selection.info?.start ?? null,
                            end: selection.info?.end ?? null,
                            count: selection.info?.count ?? null,
                            total: selection.info?.total ?? null,
                        },
                        indices: {
                            start: selection.info?.startIndex ?? null,
                            end: selection.info?.endIndex ?? null,
                        },
                    },
                };
                const stats = collectSessionStats(exportSession);
                const overallStats = collectSessionStats(privacy.sanitizedSession);
                const previewTurns = exportSession.turns.slice(-5);
                stateApi.setState(stateEnum.PREVIEW, {
                    label: '미리보기 준비 완료',
                    message: '레다크션 결과를 검토하세요.',
                    tone: 'info',
                    progress: { value: 0.75 },
                });
                const ok = await confirmPrivacyGate({
                    profile: privacy.profile,
                    counts: privacy.counts,
                    stats,
                    overallStats,
                    rangeInfo,
                    selectedIndices: Array.from(selectedIndexSet),
                    selectedOrdinals: selection.ordinals || [],
                    previewTurns,
                    actionLabel: confirmLabel || '계속',
                });
                if (!ok) {
                    stateApi.setState(stateEnum.IDLE, {
                        label: '대기 중',
                        message: cancelStatusMessage || '작업을 취소했습니다.',
                        tone: cancelStatusMessage ? 'muted' : 'info',
                        progress: { value: 0 },
                    });
                    if (cancelStatusMessage)
                        setPanelStatus?.(cancelStatusMessage, 'muted');
                    return null;
                }
                return {
                    privacy,
                    stats,
                    overallStats,
                    selection,
                    rangeInfo,
                    exportSession,
                    structuredSelection,
                };
            }
            catch (error) {
                const errorMsg = error?.message || String(error);
                alertFn(`오류: ${errorMsg}`);
                stateApi.setState(stateEnum.ERROR, {
                    label: '작업 실패',
                    message: '작업 준비 중 오류가 발생했습니다.',
                    tone: 'error',
                    progress: { value: 1 },
                });
                return null;
            }
        };
        /**
         * Executes the export flow for the selected format.
         *
         * @param {PreparedShareResult | null} prepared
         * @param {string} format
         * @returns {Promise<boolean>}
         */
        const performExport = async (prepared, format) => {
            if (!prepared)
                return false;
            try {
                stateApi.setState(stateEnum.EXPORTING, {
                    label: '내보내기 진행 중',
                    message: `${format.toUpperCase()} 내보내기를 준비하는 중입니다...`,
                    tone: 'progress',
                    progress: { indeterminate: true },
                });
                const { privacy, stats, exportSession, selection, overallStats, structuredSelection, rangeInfo: preparedRangeInfo, } = prepared;
                const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                const sessionForExport = exportSession || privacy.sanitizedSession;
                const rangeInfo = preparedRangeInfo || selection?.info || exportRange?.describe?.();
                const hasCustomRange = Boolean(rangeInfo?.active);
                const selectionRaw = hasCustomRange
                    ? sessionForExport.turns
                        .map((turn) => {
                        const label = turn.role === 'narration' ? '내레이션' : turn.speaker || turn.role || '메시지';
                        return `${label}: ${turn.text}`;
                    })
                        .join('\n')
                    : privacy.sanitizedRaw;
                const bundleOptions = {
                    structuredSelection,
                    structuredSnapshot: privacy.structured,
                    profile: privacy.profile,
                    playerNames: privacy.playerNames,
                    rangeInfo,
                };
                let targetFormat = format;
                let bundle;
                let structuredFallback = false;
                try {
                    bundle = buildExportBundle(sessionForExport, selectionRaw, targetFormat, stamp, bundleOptions);
                }
                catch (error) {
                    if (targetFormat === 'structured-json' ||
                        targetFormat === 'structured-md' ||
                        targetFormat === 'structured-txt') {
                        logger?.warn?.('[GMH] structured export failed, falling back', error);
                        structuredFallback = true;
                        if (targetFormat === 'structured-json')
                            targetFormat = 'json';
                        else if (targetFormat === 'structured-md')
                            targetFormat = 'md';
                        else
                            targetFormat = 'txt';
                        bundle = buildExportBundle(sessionForExport, selectionRaw, targetFormat, stamp, bundleOptions);
                    }
                    else {
                        throw error;
                    }
                }
                const fileBlob = new Blob([bundle.content], { type: bundle.mime });
                triggerDownload(fileBlob, bundle.filename);
                const manifest = buildExportManifest({
                    profile: privacy.profile,
                    counts: { ...privacy.counts },
                    stats,
                    overallStats,
                    format: targetFormat,
                    warnings: privacy.sanitizedSession.warnings,
                    source: privacy.sanitizedSession.source,
                    range: sessionForExport.meta?.selection || rangeInfo,
                });
                const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], {
                    type: 'application/json',
                });
                const manifestName = `${bundle.filename.replace(/\.[^.]+$/, '')}.manifest.json`;
                triggerDownload(manifestBlob, manifestName);
                const summary = formatRedactionCounts(privacy.counts);
                const profileLabel = privacyProfiles[privacy.profile]?.label || privacy.profile;
                const messageTotalAvailable = rangeInfo?.messageTotal || sessionForExport.turns.length;
                const userTotalAvailable = rangeInfo?.userTotal || overallStats?.userMessages || stats.userMessages;
                const llmTotalAvailable = rangeInfo?.llmTotal || overallStats?.llmMessages || stats.llmMessages;
                let rangeNote = hasCustomRange
                    ? ` · (선택) 메시지 ${rangeInfo.start}-${rangeInfo.end}/${rangeInfo.total}`
                    : ` · 전체 메시지 ${messageTotalAvailable}개`;
                if (Number.isFinite(userTotalAvailable)) {
                    rangeNote += ` · 유저 ${stats.userMessages}개`;
                }
                if (Number.isFinite(llmTotalAvailable)) {
                    rangeNote += ` · LLM ${stats.llmMessages}개`;
                }
                const message = `${targetFormat.toUpperCase()} 내보내기 완료${rangeNote} · ${profileLabel} · ${summary}`;
                stateApi.setState(stateEnum.DONE, {
                    label: '내보내기 완료',
                    message,
                    tone: 'success',
                    progress: { value: 1 },
                });
                if (structuredFallback) {
                    setPanelStatus?.('구조 보존 내보내기에 실패하여 Classic 포맷으로 전환했습니다.', 'warning');
                }
                if (privacy.sanitizedSession.warnings.length) {
                    logger?.warn?.('[GMH] warnings:', privacy.sanitizedSession.warnings);
                }
                return true;
            }
            catch (error) {
                const errorMsg = error?.message || String(error);
                alertFn(`오류: ${errorMsg}`);
                stateApi.setState(stateEnum.ERROR, {
                    label: '내보내기 실패',
                    message: '내보내기 실패',
                    tone: 'error',
                    progress: { value: 1 },
                });
                return false;
            }
        };
        /**
         * Copies the last 15 sanitized turns to the clipboard.
         *
         * @param {ShareWorkflowApi['prepareShare']} prepareShareFn
         * @returns {Promise<void>}
         */
        const copyRecent = async (prepareShareFn) => {
            const prepared = await prepareShareFn({
                confirmLabel: '복사 계속',
                cancelStatusMessage: '복사를 취소했습니다.',
                blockedStatusMessage: '미성년자 민감 맥락으로 복사가 차단되었습니다.',
            });
            if (!prepared)
                return;
            try {
                stateApi.setState(stateEnum.EXPORTING, {
                    label: '복사 진행 중',
                    message: '최근 15메시지를 복사하는 중입니다...',
                    tone: 'progress',
                    progress: { indeterminate: true },
                });
                const { privacy, overallStats, stats } = prepared;
                const effectiveStats = overallStats || stats;
                const turns = privacy.sanitizedSession.turns.slice(-15);
                const md = toMarkdownExport(privacy.sanitizedSession, {
                    turns,
                    includeMeta: false,
                    heading: '## 최근 15메시지',
                });
                clipboard.set(md, { type: 'text', mimetype: 'text/plain' });
                const summary = formatRedactionCounts(privacy.counts);
                const profileLabel = privacyProfiles[privacy.profile]?.label || privacy.profile;
                const message = `최근 15메시지 복사 완료 · 유저 ${effectiveStats.userMessages}개 · LLM ${effectiveStats.llmMessages}개 · ${profileLabel} · ${summary}`;
                stateApi.setState(stateEnum.DONE, {
                    label: '복사 완료',
                    message,
                    tone: 'success',
                    progress: { value: 1 },
                });
                if (privacy.sanitizedSession.warnings.length) {
                    logger?.warn?.('[GMH] warnings:', privacy.sanitizedSession.warnings);
                }
            }
            catch (error) {
                const errorMsg = error?.message || String(error);
                alertFn(`오류: ${errorMsg}`);
                stateApi.setState(stateEnum.ERROR, {
                    label: '복사 실패',
                    message: '복사 실패',
                    tone: 'error',
                    progress: { value: 1 },
                });
            }
        };
        /**
         * Copies the full sanitized transcript to the clipboard.
         *
         * @param {ShareWorkflowApi['prepareShare']} prepareShareFn
         * @returns {Promise<void>}
         */
        const copyAll = async (prepareShareFn) => {
            const prepared = await prepareShareFn({
                confirmLabel: '복사 계속',
                cancelStatusMessage: '복사를 취소했습니다.',
                blockedStatusMessage: '미성년자 민감 맥락으로 복사가 차단되었습니다.',
            });
            if (!prepared)
                return;
            try {
                stateApi.setState(stateEnum.EXPORTING, {
                    label: '복사 진행 중',
                    message: '전체 Markdown을 복사하는 중입니다...',
                    tone: 'progress',
                    progress: { indeterminate: true },
                });
                const { privacy, overallStats, stats } = prepared;
                const effectiveStats = overallStats || stats;
                const md = toMarkdownExport(privacy.sanitizedSession);
                clipboard.set(md, { type: 'text', mimetype: 'text/plain' });
                const summary = formatRedactionCounts(privacy.counts);
                const profileLabel = privacyProfiles[privacy.profile]?.label || privacy.profile;
                const message = `전체 Markdown 복사 완료 · 유저 ${effectiveStats.userMessages}개 · LLM ${effectiveStats.llmMessages}개 · ${profileLabel} · ${summary}`;
                stateApi.setState(stateEnum.DONE, {
                    label: '복사 완료',
                    message,
                    tone: 'success',
                    progress: { value: 1 },
                });
                if (privacy.sanitizedSession.warnings.length) {
                    logger?.warn?.('[GMH] warnings:', privacy.sanitizedSession.warnings);
                }
            }
            catch (error) {
                const errorMsg = error?.message || String(error);
                alertFn(`오류: ${errorMsg}`);
                stateApi.setState(stateEnum.ERROR, {
                    label: '복사 실패',
                    message: '복사 실패',
                    tone: 'error',
                    progress: { value: 1 },
                });
            }
        };
        /**
         * Forces a reparse cycle to refresh sanitized stats without exporting.
         */
        const reparse = () => {
            try {
                stateApi.setState(stateEnum.REDACTING, {
                    label: '재파싱 중',
                    message: '대화 로그를 다시 분석하는 중입니다...',
                    tone: 'progress',
                    progress: { indeterminate: true },
                });
                const { session, raw, snapshot } = parseAll();
                const privacy = applyPrivacyPipeline(session, raw, privacyConfig.profile, snapshot);
                const stats = collectSessionStats(privacy.sanitizedSession);
                const summary = formatRedactionCounts(privacy.counts);
                const profileLabel = privacyProfiles[privacy.profile]?.label || privacy.profile;
                const extra = privacy.blocked ? ' · ⚠️ 미성년자 맥락 감지' : '';
                const message = `재파싱 완료 · 유저 ${stats.userMessages}개 · LLM ${stats.llmMessages}개 · 경고 ${privacy.sanitizedSession.warnings.length}건 · ${profileLabel} · ${summary}${extra}`;
                stateApi.setState(stateEnum.DONE, {
                    label: '재파싱 완료',
                    message,
                    tone: 'info',
                    progress: { value: 1 },
                });
                if (privacy.sanitizedSession.warnings.length) {
                    logger?.warn?.('[GMH] warnings:', privacy.sanitizedSession.warnings);
                }
            }
            catch (error) {
                const errorMsg = error?.message || String(error);
                alertFn(`오류: ${errorMsg}`);
            }
        };
        return {
            parseAll,
            prepareShare,
            performExport,
            copyRecent,
            copyAll,
            reparse,
        };
    }

    /**
     * Connects panel buttons, share workflow actions, and keyboard shortcuts.
     *
     * @typedef {import('../types').PanelInteractionsOptions} PanelInteractionsOptions
     * @returns {{ bindPanelInteractions: (panel: Element | null, options?: { modern?: boolean }) => void; syncPrivacyProfileSelect: (profileKey?: string | null) => void }}
     */
    function createPanelInteractions({
      panelVisibility,
      setPanelStatus,
      setPrivacyProfile,
      getPrivacyProfile,
      privacyProfiles,
      configurePrivacyLists,
      openPanelSettings,
      ensureAutoLoadControlsModern,
      ensureAutoLoadControlsLegacy,
      mountStatusActionsModern,
      mountStatusActionsLegacy,
      bindRangeControls,
      bindShortcuts,
      bindGuideControls,
      prepareShare,
      performExport,
      copyRecentShare,
      copyAllShare,
      autoLoader,
      autoState,
      stateApi,
      stateEnum,
      alert: alertFn = (message) => globalThis.alert?.(message),
      logger = typeof console !== 'undefined' ? console : null,
    } = /** @type {PanelInteractionsOptions} */ ({})) {
      if (!panelVisibility) throw new Error('createPanelInteractions requires panelVisibility');
      if (!setPrivacyProfile) throw new Error('createPanelInteractions requires setPrivacyProfile');
      if (!bindRangeControls) throw new Error('createPanelInteractions requires bindRangeControls');
      if (!bindShortcuts) throw new Error('createPanelInteractions requires bindShortcuts');
      if (!prepareShare || !performExport || !copyRecentShare || !copyAllShare) {
        throw new Error('createPanelInteractions requires share workflow helpers');
      }
      if (!stateApi || !stateEnum) {
        throw new Error('createPanelInteractions requires state helpers');
      }

      /** @type {HTMLSelectElement | null} */
      let privacySelect = null;

      /**
       * @param {string | null | undefined} [profileKey]
       * @returns {void}
       */
      const syncPrivacyProfileSelect = (profileKey) => {
        if (!privacySelect) return;
        const nextValue = profileKey ?? getPrivacyProfile?.();
        if (typeof nextValue === 'string' && privacySelect.value !== nextValue) {
          privacySelect.value = nextValue;
        }
      };

      /**
       * @param {string} message
       * @param {string} [tone]
       */
      const notify = (message, tone) => {
        if (typeof setPanelStatus === 'function' && message) {
          setPanelStatus(message, tone);
        }
      };

      /**
       * @param {Element | null} panel
       * @param {{ modern?: boolean }} [options]
       */
      const attachShareHandlers = (panel, { modern = false } = {}) => {
        /** @type {HTMLSelectElement | null} */
        const exportFormatSelect = panel.querySelector('#gmh-export-format');
        /** @type {HTMLButtonElement | null} */
        const quickExportBtn = panel.querySelector('#gmh-quick-export');

        /**
         * @param {{ confirmLabel?: string; cancelStatusMessage?: string; blockedStatusMessage?: string }} [options]
         * @returns {ReturnType<PanelInteractionsOptions['prepareShare']>}
         */
        const prepareShareWithDialog = (options = {}) =>
          prepareShare({
            confirmLabel: options.confirmLabel,
            cancelStatusMessage: options.cancelStatusMessage,
            blockedStatusMessage: options.blockedStatusMessage,
          });

        /**
         * @param {string} format
         * @param {{ confirmLabel?: string; cancelStatusMessage?: string; blockedStatusMessage?: string }} [options]
         * @returns {Promise<void>}
         */
        const exportWithFormat = async (format, options = {}) => {
          const prepared = await prepareShareWithDialog(options);
          if (!prepared) return;
          await performExport(prepared, format);
        };

        /**
         * @returns {ReturnType<PanelInteractionsOptions['copyRecentShare']>}
         */
        const copyRecent = () => copyRecentShare(prepareShareWithDialog);
        /**
         * @returns {ReturnType<PanelInteractionsOptions['copyAllShare']>}
         */
        const copyAll = () => copyAllShare(prepareShareWithDialog);

        /** @type {HTMLButtonElement | null} */
        const copyRecentBtn = panel.querySelector('#gmh-copy-recent');
        if (copyRecentBtn) {
          copyRecentBtn.onclick = () => copyRecent();
        }

        /** @type {HTMLButtonElement | null} */
        const copyAllBtn = panel.querySelector('#gmh-copy-all');
        if (copyAllBtn) {
          copyAllBtn.onclick = () => copyAll();
        }

        /** @type {HTMLButtonElement | null} */
        const exportBtn = panel.querySelector('#gmh-export');
        if (exportBtn) {
          exportBtn.onclick = async () => {
            const format = exportFormatSelect?.value || 'json';
            await exportWithFormat(format, {
              confirmLabel: '내보내기 진행',
              cancelStatusMessage: '내보내기를 취소했습니다.',
              blockedStatusMessage: '미성년자 민감 맥락으로 내보내기가 차단되었습니다.',
            });
          };
        }

        if (quickExportBtn) {
          quickExportBtn.onclick = async () => {
            if (autoState?.running) {
              notify('이미 자동 로딩이 진행 중입니다.', 'muted');
              return;
            }
            const originalText = quickExportBtn.textContent;
            quickExportBtn.disabled = true;
            quickExportBtn.textContent = '진행 중...';
            try {
              stateApi.setState(stateEnum.SCANNING, {
                label: '원클릭 내보내기',
                message: '전체 로딩 중...',
                tone: 'progress',
                progress: { indeterminate: true },
              });
              await autoLoader?.start?.('all');
              const format = exportFormatSelect?.value || 'json';
              await exportWithFormat(format, {
                confirmLabel: `${format.toUpperCase()} 내보내기`,
                cancelStatusMessage: '내보내기를 취소했습니다.',
                blockedStatusMessage: '미성년자 민감 맥락으로 내보내기가 차단되었습니다.',
              });
            } catch (error) {
              alertFn?.(`오류: ${(error && error.message) || error}`);
              stateApi.setState(stateEnum.ERROR, {
                label: '원클릭 실패',
                message: '원클릭 내보내기 실패',
                tone: 'error',
                progress: { value: 1 },
              });
            } finally {
              quickExportBtn.disabled = false;
              quickExportBtn.textContent = originalText;
            }
          };
        }
      };

      /**
       * @param {Element | null} panel
       * @param {{ modern?: boolean }} [options]
       * @returns {void}
       */
      const bindPanelInteractions = (panel, { modern = false } = {}) => {
        if (!panel || typeof panel.querySelector !== 'function') {
          if (logger?.warn) {
            logger.warn('[GMH] panel interactions: invalid panel element');
          }
          return;
        }

        panelVisibility.bind(panel, { modern });

        privacySelect = /** @type {HTMLSelectElement | null} */ (panel.querySelector('#gmh-privacy-profile'));
        if (privacySelect) {
          syncPrivacyProfileSelect();
          privacySelect.onchange = (event) => {
            const value = /** @type {HTMLSelectElement} */ (event.target).value;
            setPrivacyProfile(value);
            const label = privacyProfiles?.[value]?.label || value;
            notify(`프라이버시 프로필이 ${label}로 설정되었습니다.`, 'info');
          };
        }

        /** @type {HTMLButtonElement | null} */
        const privacyConfigBtn = panel.querySelector('#gmh-privacy-config');
        if (privacyConfigBtn) {
          privacyConfigBtn.onclick = () => configurePrivacyLists?.();
        }

        /** @type {HTMLButtonElement | null} */
        const settingsBtn = panel.querySelector('#gmh-panel-settings');
        if (settingsBtn) {
          settingsBtn.onclick = () => openPanelSettings?.();
        }

        if (modern) {
          ensureAutoLoadControlsModern?.(panel);
          mountStatusActionsModern?.(panel);
        } else {
          ensureAutoLoadControlsLegacy?.(panel);
          mountStatusActionsLegacy?.(panel);
        }

        bindRangeControls(panel);
        bindShortcuts(panel, { modern });
        bindGuideControls?.(panel);

        attachShareHandlers(panel, { modern });
      };

      return {
        bindPanelInteractions,
        syncPrivacyProfileSelect,
      };
    }

    /**
     * @typedef {import('../types').GenitAdapter} GenitAdapter
     */

    /**
     * @typedef {object} StateViewApi
     * @property {(bindings?: { progressFill?: HTMLElement | null; progressLabel?: HTMLElement | null }) => void} bind
     */

    /**
     * @typedef {object} ModernPanelOptions
     * @property {Document | null} [documentRef]
     * @property {() => void} ensureStyles
     * @property {string} [version]
     * @property {() => GenitAdapter | null | undefined} getActiveAdapter
     * @property {(element: HTMLElement | null) => void} attachStatusElement
     * @property {StateViewApi} stateView
     * @property {(panel: Element, options?: { modern?: boolean }) => void} bindPanelInteractions
     * @property {string} [panelId]
     * @property {Console | { warn?: (...args: unknown[]) => void } | null} [logger]
     */

    /**
     * Mounts the modern (React-inspired) panel layout.
     *
     * @param {ModernPanelOptions} [options]
     * @returns {{ mount: () => Element | null }}
     */
    function createModernPanel({
      documentRef = typeof document !== 'undefined' ? document : null,
      ensureStyles,
      version = '0.0.0-dev',
      getActiveAdapter,
      attachStatusElement,
      stateView,
      bindPanelInteractions,
      panelId = 'genit-memory-helper-panel',
      logger = typeof console !== 'undefined' ? console : null,
    } = {}) {
      const doc = documentRef;
      if (!doc) throw new Error('createModernPanel requires documentRef');
      if (typeof ensureStyles !== 'function') throw new Error('createModernPanel requires ensureStyles');
      if (typeof getActiveAdapter !== 'function') throw new Error('createModernPanel requires getActiveAdapter');
      if (!stateView || typeof stateView.bind !== 'function') {
        throw new Error('createModernPanel requires stateView with bind');
      }
      if (typeof bindPanelInteractions !== 'function') {
        throw new Error('createModernPanel requires bindPanelInteractions');
      }

      const log = logger || { warn: () => {} };

      /**
       * Ensures the modern panel is attached to the DOM.
       * @returns {Element | null}
       */
      const mount = () => {
        ensureStyles();
        const existing = doc.querySelector(`#${panelId}`);
        if (existing) return existing;

        const panel = doc.createElement('div');
        panel.id = panelId;
        panel.className = 'gmh-panel';
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', 'Genit Memory Helper');
        panel.tabIndex = -1;
        panel.dataset.version = version;
        panel.innerHTML = `
      <div class="gmh-panel__header">
        <button
          id="gmh-panel-drag-handle"
          class="gmh-panel__drag-handle"
          type="button"
          aria-label="패널 이동"
          title="패널 끌어서 이동"
        >
          <span class="gmh-panel__drag-icon" aria-hidden="true">⋮⋮</span>
        </button>
        <div class="gmh-panel__headline">
          <div class="gmh-panel__title">Genit Memory Helper</div>
          <div class="gmh-panel__tag">v${version}</div>
        </div>
        <button id="gmh-panel-settings" class="gmh-small-btn gmh-small-btn--muted" title="설정">⚙</button>
      </div>
      <div class="gmh-progress">
        <div class="gmh-progress__track">
          <div id="gmh-progress-fill" class="gmh-progress__fill" data-indeterminate="false"></div>
        </div>
        <div id="gmh-progress-label" class="gmh-progress__label">대기 중</div>
      </div>
      <div id="gmh-status" class="gmh-status-line"></div>
      <section class="gmh-panel__section" id="gmh-section-privacy">
        <div class="gmh-panel__section-title">Privacy</div>
        <div class="gmh-field-row">
          <select id="gmh-privacy-profile" class="gmh-select">
            <option value="safe">SAFE (권장)</option>
            <option value="standard">STANDARD</option>
            <option value="research">RESEARCH</option>
          </select>
          <button id="gmh-privacy-config" class="gmh-small-btn gmh-small-btn--accent">민감어</button>
        </div>
      </section>
      <section class="gmh-panel__section" id="gmh-section-autoload">
        <div class="gmh-panel__section-title">Auto Load</div>
        <div id="gmh-autoload-controls"></div>
      </section>
      <section class="gmh-panel__section" id="gmh-section-export">
        <div class="gmh-panel__section-title">Export</div>
        <div class="gmh-field-row">
          <button id="gmh-copy-recent" class="gmh-panel-btn gmh-panel-btn--neutral">최근 15메시지 복사</button>
          <button id="gmh-copy-all" class="gmh-panel-btn gmh-panel-btn--neutral">전체 MD 복사</button>
        </div>
        <div class="gmh-field-row gmh-field-row--wrap">
          <label for="gmh-range-start" class="gmh-field-label">메시지 범위</label>
          <div class="gmh-range-controls">
            <input
              id="gmh-range-start"
              class="gmh-input gmh-input--compact"
              type="number"
              min="1"
              inputmode="numeric"
              pattern="[0-9]*"
              placeholder="시작 메시지"
            />
            <span class="gmh-range-sep" aria-hidden="true">~</span>
            <input
              id="gmh-range-end"
              class="gmh-input gmh-input--compact"
              type="number"
              min="1"
              inputmode="numeric"
              pattern="[0-9]*"
              placeholder="끝 메시지"
            />
            <div class="gmh-bookmark-controls">
              <button id="gmh-range-mark-start" type="button" class="gmh-small-btn gmh-small-btn--muted" title="현재 메시지를 시작으로 지정">시작지정</button>
              <button id="gmh-range-mark-end" type="button" class="gmh-small-btn gmh-small-btn--muted" title="현재 메시지를 끝으로 지정">끝지정</button>
            </div>
            <button id="gmh-range-clear" type="button" class="gmh-small-btn gmh-small-btn--muted">전체</button>
          </div>
        </div>
        <div class="gmh-field-row gmh-field-row--wrap">
          <label for="gmh-range-bookmark-select" class="gmh-field-label">최근 북마크</label>
          <div class="gmh-bookmark-select">
            <select id="gmh-range-bookmark-select" class="gmh-select gmh-select--compact">
              <option value="">최근 클릭한 메시지가 없습니다</option>
            </select>
          </div>
        </div>
        <div id="gmh-range-summary" class="gmh-helper-text">범위 전체 내보내기</div>
        <div class="gmh-field-row">
          <select id="gmh-export-format" class="gmh-select">
            <option value="structured-md" selected>Rich Markdown (.md) — 추천</option>
            <option value="structured-json">Rich JSON (.json)</option>
            <option value="structured-txt">Rich TXT (.txt)</option>
            <optgroup label="Classic (경량/호환)">
              <option value="json">Classic JSON (.json)</option>
              <option value="md">Classic Markdown (.md)</option>
              <option value="txt">Classic TXT (.txt)</option>
            </optgroup>
          </select>
          <button id="gmh-export" class="gmh-small-btn gmh-small-btn--accent">내보내기</button>
        </div>
        <button id="gmh-quick-export" class="gmh-panel-btn gmh-panel-btn--accent">원클릭 내보내기</button>
      </section>
      <section class="gmh-panel__section" id="gmh-section-guides">
        <div class="gmh-panel__section-title">Guides & Tools</div>
        <div class="gmh-field-row">
          <button id="gmh-reparse" class="gmh-small-btn gmh-small-btn--muted">재파싱</button>
          <button id="gmh-guide" class="gmh-small-btn gmh-small-btn--muted">요약 가이드</button>
          <button id="gmh-reguide" class="gmh-small-btn gmh-small-btn--muted">재요약 가이드</button>
        </div>
        <div id="gmh-status-actions"></div>
      </section>
      <div id="gmh-panel-resize-handle" class="gmh-panel__resize-handle" aria-hidden="true"></div>
    `;

        const adapter = getActiveAdapter();
        const anchor = adapter?.getPanelAnchor?.(doc) || doc.body;
        if (!anchor) {
          log?.warn?.('[GMH] modern panel anchor missing');
          return null;
        }
        anchor.appendChild(panel);

        const statusEl = panel.querySelector('#gmh-status');
        if (typeof attachStatusElement === 'function') {
          attachStatusElement(statusEl);
        }
        if (statusEl) {
          statusEl.setAttribute('role', 'status');
          statusEl.setAttribute('aria-live', 'polite');
        }

        const progressFill = panel.querySelector('#gmh-progress-fill');
        const progressLabel = panel.querySelector('#gmh-progress-label');
        stateView.bind({ progressFill, progressLabel });

        try {
          bindPanelInteractions(panel, { modern: true });
        } catch (err) {
          log?.warn?.('[GMH] panel interactions init failed', err);
        }

        return panel;
      };

      return { mount };
    }

    /**
     * @typedef {import('../types').GenitAdapter} GenitAdapter
     */

    /**
     * @typedef {object} LegacyStateViewApi
     * @property {() => void} bind
     */

    /**
     * @typedef {object} LegacyPanelOptions
     * @property {Document | null} [documentRef]
     * @property {() => GenitAdapter | null | undefined} getActiveAdapter
     * @property {(element: HTMLElement | null) => void} attachStatusElement
     * @property {(message: string, tone?: string | null) => void} setPanelStatus
     * @property {LegacyStateViewApi} stateView
     * @property {(panel: Element, options?: { modern?: boolean }) => void} bindPanelInteractions
     * @property {string} [panelId]
     */

    /**
     * Mounts the legacy panel layout for older styling.
     *
     * @param {LegacyPanelOptions} [options]
     * @returns {{ mount: () => Element | null }}
     */
    function createLegacyPanel({
      documentRef = typeof document !== 'undefined' ? document : null,
      getActiveAdapter,
      attachStatusElement,
      setPanelStatus,
      stateView,
      bindPanelInteractions,
      panelId = 'genit-memory-helper-panel',
    } = {}) {
      const doc = documentRef;
      if (!doc) throw new Error('createLegacyPanel requires documentRef');
      if (typeof getActiveAdapter !== 'function') {
        throw new Error('createLegacyPanel requires getActiveAdapter');
      }
      if (typeof attachStatusElement !== 'function') {
        throw new Error('createLegacyPanel requires attachStatusElement');
      }
      if (typeof setPanelStatus !== 'function') {
        throw new Error('createLegacyPanel requires setPanelStatus');
      }
      if (!stateView || typeof stateView.bind !== 'function') {
        throw new Error('createLegacyPanel requires stateView with bind');
      }
      if (typeof bindPanelInteractions !== 'function') {
        throw new Error('createLegacyPanel requires bindPanelInteractions');
      }

      /**
       * Creates the legacy panel markup if necessary and returns it.
       * @returns {Element | null}
       */
      const mount = () => {
        const existing = doc.querySelector(`#${panelId}`);
        if (existing) return existing;

        const panel = doc.createElement('div');
        panel.id = panelId;
        panel.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 999999;
      background: #0b1020; color: #fff; padding: 10px 12px; border-radius: 10px;
      font: 12px/1.3 ui-sans-serif, system-ui; box-shadow: 0 8px 20px rgba(0,0,0,.4);
      display: grid; gap: 8px; min-width: 260px;
    `;
        panel.innerHTML = `
      <div style="font-weight:600">Genit Memory Helper</div>
      <div style="display:flex; gap:8px; align-items:center;">
        <select id="gmh-privacy-profile" style="flex:1; background:#111827; color:#f1f5f9; border:1px solid #1f2937; border-radius:8px; padding:8px;">
          <option value="safe">SAFE (권장)</option>
          <option value="standard">STANDARD</option>
          <option value="research">RESEARCH</option>
        </select>
        <button id="gmh-privacy-config" style="background:#c084fc; border:0; color:#210; border-radius:8px; padding:8px; cursor:pointer;">민감어</button>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="gmh-copy-recent" style="flex:1; background:#22c55e; border:0; color:#051; border-radius:8px; padding:8px; cursor:pointer;">최근 15메시지 복사</button>
        <button id="gmh-copy-all" style="flex:1; background:#60a5fa; border:0; color:#031; border-radius:8px; padding:8px; cursor:pointer;">전체 MD 복사</button>
      </div>
      <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
        <label for="gmh-range-start" style="font-size:11px; color:#94a3b8; font-weight:600;">메시지 범위</label>
        <div style="display:flex; gap:6px; align-items:center; flex:1;">
          <input id="gmh-range-start" type="number" min="1" inputmode="numeric" pattern="[0-9]*" placeholder="시작 메시지" style="width:70px; background:#111827; color:#f8fafc; border:1px solid #1f2937; border-radius:8px; padding:6px 8px;" />
          <span style="color:#94a3b8;">~</span>
          <input id="gmh-range-end" type="number" min="1" inputmode="numeric" pattern="[0-9]*" placeholder="끝 메시지" style="width:70px; background:#111827; color:#f8fafc; border:1px solid #1f2937; border-radius:8px; padding:6px 8px;" />
          <button id="gmh-range-mark-start" type="button" style="background:rgba(15,23,42,0.65); color:#94a3b8; border:1px solid #1f2937; border-radius:8px; padding:6px 10px; cursor:pointer;" title="현재 메시지를 시작으로 지정">시작지정</button>
          <button id="gmh-range-mark-end" type="button" style="background:rgba(15,23,42,0.65); color:#94a3b8; border:1px solid #1f2937; border-radius:8px; padding:6px 10px; cursor:pointer;" title="현재 메시지를 끝으로 지정">끝지정</button>
          <button id="gmh-range-clear" type="button" style="background:rgba(15,23,42,0.65); color:#94a3b8; border:1px solid #1f2937; border-radius:8px; padding:6px 10px; cursor:pointer;">전체</button>
        </div>
      </div>
      <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
        <label for="gmh-range-bookmark-select" style="font-size:11px; color:#94a3b8; font-weight:600;">최근 북마크</label>
        <select id="gmh-range-bookmark-select" style="flex:1; min-width:160px; background:#111827; color:#f8fafc; border:1px solid #1f2937; border-radius:8px; padding:6px 8px;">
          <option value="">최근 클릭한 메시지가 없습니다</option>
        </select>
      </div>
      <div id="gmh-range-summary" style="font-size:11px; color:#94a3b8;">범위 전체 내보내기</div>
      <div style="display:flex; gap:8px; align-items:center;">
        <select id="gmh-export-format" style="flex:1; background:#111827; color:#f1f5f9; border:1px solid #1f2937; border-radius:8px; padding:8px;">
          <option value="structured-md" selected>Rich Markdown (.md) — 추천</option>
          <option value="structured-json">Rich JSON (.json)</option>
          <option value="structured-txt">Rich TXT (.txt)</option>
          <optgroup label="Classic (경량/호환)">
            <option value="json">Classic JSON (.json)</option>
            <option value="md">Classic Markdown (.md)</option>
            <option value="txt">Classic TXT (.txt)</option>
          </optgroup>
        </select>
        <button id="gmh-export" style="flex:1; background:#2dd4bf; border:0; color:#052; border-radius:8px; padding:8px; cursor:pointer;">내보내기</button>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="gmh-quick-export" style="flex:1; background:#38bdf8; border:0; color:#031; border-radius:8px; padding:8px; cursor:pointer;">원클릭 내보내기</button>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="gmh-reparse" style="flex:1; background:#f59e0b; border:0; color:#210; border-radius:8px; padding:8px; cursor:pointer;">재파싱</button>
        <button id="gmh-guide" style="flex:1; background:#a78bfa; border:0; color:#210; border-radius:8px; padding:8px; cursor:pointer;">요약 가이드</button>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="gmh-reguide" style="flex:1; background:#fbbf24; border:0; color:#210; border-radius:8px; padding:8px; cursor:pointer;">재요약 가이드</button>
      </div>
      <div id="gmh-status" style="opacity:.85"></div>
    `;

        const adapter = getActiveAdapter();
        const anchor = adapter?.getPanelAnchor?.(doc) || doc.body;
        if (!anchor) return null;
        anchor.appendChild(panel);

        const statusEl = panel.querySelector('#gmh-status');
        attachStatusElement(statusEl);
        setPanelStatus('준비 완료', 'info');
        stateView.bind();
        bindPanelInteractions(panel, { modern: false });

        return panel;
      };

      return { mount };
    }

    const DEFAULT_PREVIEW_LIMIT = 5;

    /**
     * @typedef {import('../types').StructuredSnapshotMessage} StructuredSnapshotMessage
     * @typedef {import('../types').StructuredSelectionRangeInfo} StructuredSelectionRangeInfo
     * @typedef {import('../types').ExportRangeInfo} ExportRangeInfo
     * @typedef {import('../types').ModalController} ModalController
     */

    /**
     * @typedef {object} PrivacyGateStats
     * @property {number} userMessages
     * @property {number} llmMessages
     * @property {number} [totalMessages]
     * @property {number} [entryCount]
     * @property {Record<string, unknown>} [metadata]
     */

    /**
     * @typedef {object} PrivacyGateCounts
     * @property {Record<string, number>} [redactions]
     * @property {Record<string, number>} [details]
     * @property {number} [total]
     * @property {Record<string, unknown>} [metadata]
     */

    /**
     * @typedef {object} PrivacyPreviewTurn
     * @property {string} [role]
     * @property {string} [speaker]
     * @property {string} [text]
     * @property {number} [__gmhIndex]
     * @property {number} [__gmhOrdinal]
     * @property {StructuredSnapshotMessage['parts']} [parts]
     */

    /**
     * @typedef {object} PrivacyGateConfirmOptions
     * @property {string} profile
     * @property {PrivacyGateCounts | Record<string, number>} counts
     * @property {PrivacyGateStats} stats
     * @property {PrivacyGateStats | null} [overallStats]
     * @property {StructuredSelectionRangeInfo | ExportRangeInfo | null} [rangeInfo]
     * @property {number[]} [selectedIndices]
     * @property {number[]} [selectedOrdinals]
     * @property {PrivacyPreviewTurn[]} [previewTurns]
     * @property {string} [actionLabel]
     * @property {string} [heading]
     * @property {string} [subheading]
     */

    /**
     * @typedef {object} PrivacyGateOptions
     * @property {Document | null} [documentRef]
     * @property {(counts: Record<string, number>) => string} [formatRedactionCounts]
     * @property {Record<string, { label?: string }>} [privacyProfiles]
     * @property {number} [previewLimit]
     * @property {(value: string) => string} [truncateText]
     */

    /**
     * @typedef {PrivacyGateOptions & {
     *   ensureLegacyPreviewStyles?: () => void;
     * }} LegacyPrivacyGateOptions
     */

    /**
     * @typedef {PrivacyGateOptions & {
     *   ensureDesignSystemStyles?: () => void;
     *   modal?: ModalController | null;
     * }} ModernPrivacyGateOptions
     */

    /**
     * Validates that a document reference is available.
     * @param {Document | null | undefined} documentRef
     * @returns {Document}
     */
    const ensureDocument = (documentRef) => {
      if (!documentRef || typeof documentRef.createElement !== 'function') {
        throw new Error('privacy gate requires a document reference');
      }
      return documentRef;
    };

    /**
     * Truncates preview text to a configurable length.
     * @param {unknown} value
     * @param {number} [max=220]
     * @returns {string}
     */
    const defaultTruncate = (value, max = 220) => {
      const text = String(value || '').trim();
      if (text.length <= max) return text;
      return `${text.slice(0, max - 1)}…`;
    };

    /**
     * Renders preview turn items for the privacy gate.
     * @param {object} params
     * @param {Document | null | undefined} params.documentRef
     * @param {PrivacyPreviewTurn[] | StructuredSnapshotMessage[] | null | undefined} params.previewTurns
     * @param {number} params.previewLimit
     * @param {StructuredSelectionRangeInfo | ExportRangeInfo | null | undefined} params.rangeInfo
     * @param {number[]} params.selectedIndices
     * @param {number[]} params.selectedOrdinals
     * @param {(value: unknown, max?: number) => string} [params.truncateText]
     * @param {boolean} params.modern
     * @returns {HTMLElement}
     */
    const buildTurns = ({
      documentRef,
      previewTurns,
      previewLimit,
      rangeInfo,
      selectedIndices,
      selectedOrdinals,
      truncateText,
      modern,
    }) => {
      const doc = ensureDocument(documentRef);
      const list = doc.createElement('ul');
      list.className = modern ? 'gmh-turn-list' : 'gmh-preview-turns';
      const highlightActive = rangeInfo?.active;
      const selectedIndexSet = new Set(selectedIndices || []);
      const ordinalLookup = new Map();
      (selectedIndices || []).forEach((idx, i) => {
        const ord = selectedOrdinals?.[i] ?? null;
        ordinalLookup.set(idx, ord);
      });

      const turns = Array.isArray(previewTurns) ? previewTurns : [];
      turns.slice(-previewLimit).forEach((turn) => {
        if (!turn) return;
        const item = doc.createElement('li');
        item.className = modern ? 'gmh-turn-list__item' : 'gmh-preview-turn';
        item.tabIndex = 0;

        const sourceIndex = typeof turn.__gmhIndex === 'number' ? turn.__gmhIndex : null;
        if (sourceIndex !== null) item.dataset.turnIndex = String(sourceIndex);

        const playerOrdinal = (() => {
          if (typeof turn.__gmhOrdinal === 'number') return turn.__gmhOrdinal;
          if (sourceIndex !== null && ordinalLookup.has(sourceIndex)) {
            return ordinalLookup.get(sourceIndex);
          }
          return null;
        })();
        if (typeof playerOrdinal === 'number') {
          item.dataset.playerTurn = String(playerOrdinal);
        }

        if (highlightActive && sourceIndex !== null && selectedIndexSet.has(sourceIndex)) {
          item.classList.add(modern ? 'gmh-turn-list__item--selected' : 'gmh-preview-turn--selected');
        }

        const speaker = doc.createElement('div');
        speaker.className = modern ? 'gmh-turn-list__speaker' : 'gmh-preview-turn-speaker';
        const speakerLabel = doc.createElement('span');
        speakerLabel.textContent = `${turn.speaker || '??'} · ${turn.role}`;
        speaker.appendChild(speakerLabel);

        if (typeof playerOrdinal === 'number' && playerOrdinal > 0) {
          const badge = doc.createElement('span');
          badge.className = modern ? 'gmh-turn-list__badge' : 'gmh-turn-list__badge';
          badge.textContent = `메시지 ${playerOrdinal}`;
          speaker.appendChild(badge);
        }

        const text = doc.createElement('div');
        text.className = modern ? 'gmh-turn-list__text' : 'gmh-preview-turn-text';
        const truncate = typeof truncateText === 'function' ? truncateText : defaultTruncate;
        text.textContent = truncate(turn.text || '');

        item.appendChild(speaker);
        item.appendChild(text);
        list.appendChild(item);
      });

      if (!list.children.length) {
        const empty = doc.createElement(modern ? 'li' : 'div');
        empty.className = modern
          ? 'gmh-turn-list__item gmh-turn-list__empty'
          : 'gmh-preview-turn';
        const emptyText = modern ? empty : doc.createElement('div');
        if (!modern) {
          emptyText.className = 'gmh-preview-turn-text';
          emptyText.textContent = '표시할 메시지가 없습니다. 상단 요약만 확인해주세요.';
          empty.appendChild(emptyText);
        } else {
          empty.textContent = '표시할 메시지가 없습니다. 상단 요약만 확인해주세요.';
        }
        list.appendChild(empty);
      }

      return list;
    };

    /**
     * Builds the summary box summarizing counts and stats for the dialog.
     * @param {object} params
     * @param {Document | null | undefined} params.documentRef
     * @param {(counts: Record<string, number>) => string} [params.formatRedactionCounts]
     * @param {Record<string, { label?: string }>} [params.privacyProfiles]
     * @param {string} params.profile
     * @param {Record<string, number>} params.counts
     * @param {PrivacyGateStats} params.stats
     * @param {PrivacyGateStats | null} [params.overallStats]
     * @param {StructuredSelectionRangeInfo | ExportRangeInfo | null | undefined} [params.rangeInfo]
     * @param {boolean} params.modern
     * @returns {HTMLElement}
     */
    const buildSummaryBox = ({
      documentRef,
      formatRedactionCounts,
      privacyProfiles,
      profile,
      counts,
      stats,
      overallStats,
      rangeInfo,
      modern,
    }) => {
      const doc = ensureDocument(documentRef);
      const summary = typeof formatRedactionCounts === 'function'
        ? formatRedactionCounts(counts)
        : '';
      const profileLabel = privacyProfiles?.[profile]?.label || profile;
      const turnsLabel = overallStats
        ? `유저 메시지 ${stats.userMessages}/${overallStats.userMessages} · 전체 메시지 ${stats.totalMessages}/${overallStats.totalMessages}`
        : `유저 메시지 ${stats.userMessages} · 전체 메시지 ${stats.totalMessages}`;

      const container = doc.createElement('div');
      container.className = modern ? 'gmh-privacy-summary' : 'gmh-preview-summary';

      const createRow = (labelText, valueText) => {
        const row = doc.createElement('div');
        if (modern) {
          row.className = 'gmh-privacy-summary__row';
          const labelEl = doc.createElement('span');
          labelEl.className = 'gmh-privacy-summary__label';
          labelEl.textContent = labelText;
          const valueEl = doc.createElement('span');
          valueEl.textContent = valueText;
          row.appendChild(labelEl);
          row.appendChild(valueEl);
        } else {
          const strong = doc.createElement('strong');
          strong.textContent = labelText;
          const value = doc.createElement('span');
          value.textContent = valueText;
          row.appendChild(strong);
          row.appendChild(value);
        }
        return row;
      };

      [
        createRow('프로필', profileLabel),
        createRow('메시지 수', turnsLabel),
        createRow('레다크션', summary),
      ].forEach((row) => container.appendChild(row));

      if (rangeInfo?.total) {
        const messageTotal = rangeInfo.messageTotal ?? rangeInfo.total;
        const rangeText = rangeInfo.active
          ? `메시지 ${rangeInfo.start}-${rangeInfo.end} · ${rangeInfo.count}/${messageTotal}`
          : `메시지 ${messageTotal}개 전체`;
        const extraParts = [];
        if (Number.isFinite(rangeInfo.userTotal)) extraParts.push(`유저 ${rangeInfo.userTotal}개`);
        if (Number.isFinite(rangeInfo.llmTotal)) extraParts.push(`LLM ${rangeInfo.llmTotal}개`);
        const complement = extraParts.length ? ` · ${extraParts.join(' · ')}` : '';
        container.appendChild(createRow('범위', rangeText + complement));
      }

      return container;
    };

    /**
     * Builds the classic privacy confirmation dialog rendered inside the legacy panel.
     *
     * @param {LegacyPrivacyGateOptions} [options]
     * @returns {{ confirm: (confirmOptions?: PrivacyGateConfirmOptions) => Promise<boolean> }}
     */
    function createLegacyPrivacyGate({
      documentRef = typeof document !== 'undefined' ? document : null,
      formatRedactionCounts,
      privacyProfiles,
      ensureLegacyPreviewStyles,
      truncateText = defaultTruncate,
      previewLimit = DEFAULT_PREVIEW_LIMIT,
    } = {}) {
      const doc = ensureDocument(documentRef);
      if (typeof ensureLegacyPreviewStyles !== 'function') {
        throw new Error('legacy privacy gate requires ensureLegacyPreviewStyles');
      }

      /**
       * Opens the legacy overlay preview and resolves with the user choice.
       * @param {PrivacyGateConfirmOptions} [params]
       * @returns {Promise<boolean>}
       */
      const confirm = ({
        profile,
        counts,
        stats,
        overallStats = null,
        rangeInfo = null,
        selectedIndices = [],
        selectedOrdinals = [],
        previewTurns = [],
        actionLabel = '계속',
        heading = '공유 전 확인',
        subheading = '외부로 공유하기 전에 민감정보가 없는지 확인하세요.',
      } = {}) => {
        ensureLegacyPreviewStyles();

        const overlay = doc.createElement('div');
        overlay.className = 'gmh-preview-overlay';
        const card = doc.createElement('div');
        card.className = 'gmh-preview-card';
        overlay.appendChild(card);

        const header = doc.createElement('div');
        header.className = 'gmh-preview-header';
        const headerLabel = doc.createElement('span');
        headerLabel.textContent = heading;
        header.appendChild(headerLabel);
        const closeBtn = doc.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'gmh-preview-close';
        closeBtn.setAttribute('aria-label', '닫기');
        closeBtn.textContent = '✕';
        header.appendChild(closeBtn);
        card.appendChild(header);

        const body = doc.createElement('div');
        body.className = 'gmh-preview-body';
        body.appendChild(
          buildSummaryBox({
            documentRef: doc,
            formatRedactionCounts,
            privacyProfiles,
            profile,
            counts,
            stats,
            overallStats,
            rangeInfo,
            modern: false,
          }),
        );

        const previewTitle = doc.createElement('div');
        previewTitle.style.fontWeight = '600';
        previewTitle.style.color = '#cbd5f5';
        previewTitle.textContent = `미리보기 (${Math.min(previewTurns.length, previewLimit)}메시지)`;
        body.appendChild(previewTitle);

        body.appendChild(
          buildTurns({
            documentRef: doc,
            previewTurns,
            previewLimit,
            rangeInfo,
            selectedIndices,
            selectedOrdinals,
            truncateText,
            modern: false,
          }),
        );

        const footnote = doc.createElement('div');
        footnote.className = 'gmh-preview-footnote';
        footnote.textContent = subheading;
        body.appendChild(footnote);

        card.appendChild(body);

        const actions = doc.createElement('div');
        actions.className = 'gmh-preview-actions';
        const cancelBtn = doc.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'gmh-preview-cancel';
        cancelBtn.textContent = '취소';
        const confirmBtn = doc.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'gmh-preview-confirm';
        confirmBtn.textContent = actionLabel;
        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        card.appendChild(actions);

        const bodyEl = doc.body || doc.querySelector('body');
        if (!bodyEl) throw new Error('document body missing');
        const prevOverflow = bodyEl.style.overflow;
        bodyEl.style.overflow = 'hidden';
        bodyEl.appendChild(overlay);

        return new Promise((resolve) => {
          const cleanup = (result) => {
            bodyEl.style.overflow = prevOverflow;
            overlay.remove();
            doc.removeEventListener('keydown', onKey);
            resolve(result);
          };

          const onKey = (event) => {
            if (event.key === 'Escape') cleanup(false);
          };
          doc.addEventListener('keydown', onKey);

          overlay.addEventListener('click', (event) => {
            if (event.target === overlay) cleanup(false);
          });
          closeBtn.addEventListener('click', () => cleanup(false));
          cancelBtn.addEventListener('click', () => cleanup(false));
          confirmBtn.addEventListener('click', () => cleanup(true));
        });
      };

      return { confirm };
    }

    /**
     * Builds the modern privacy confirmation modal using design-system styles.
     *
     * @param {ModernPrivacyGateOptions} [options]
     * @returns {{ confirm: (confirmOptions?: PrivacyGateConfirmOptions) => Promise<boolean> }}
     */
    function createModernPrivacyGate({
      documentRef = typeof document !== 'undefined' ? document : null,
      formatRedactionCounts,
      privacyProfiles,
      ensureDesignSystemStyles,
      modal,
      truncateText = defaultTruncate,
      previewLimit = DEFAULT_PREVIEW_LIMIT,
    } = {}) {
      const doc = ensureDocument(documentRef);
      if (typeof ensureDesignSystemStyles !== 'function') {
        throw new Error('modern privacy gate requires ensureDesignSystemStyles');
      }
      if (!modal || typeof modal.open !== 'function') {
        throw new Error('modern privacy gate requires modal.open');
      }

      /**
       * Opens the design-system modal and resolves with the user's decision.
       * @param {PrivacyGateConfirmOptions} [params]
       * @returns {Promise<boolean>}
       */
      const confirm = ({
        profile,
        counts,
        stats,
        overallStats = null,
        rangeInfo = null,
        selectedIndices = [],
        selectedOrdinals = [],
        previewTurns = [],
        actionLabel = '계속',
        heading = '공유 전 확인',
        subheading = '외부로 공유하기 전에 민감정보가 없는지 확인하세요.',
      } = {}) => {
        ensureDesignSystemStyles();

        const stack = doc.createElement('div');
        stack.className = 'gmh-modal-stack';

        stack.appendChild(
          buildSummaryBox({
            documentRef: doc,
            formatRedactionCounts,
            privacyProfiles,
            profile,
            counts,
            stats,
            overallStats,
            rangeInfo,
            modern: true,
          }),
        );

        const previewTitle = doc.createElement('div');
        previewTitle.className = 'gmh-section-title';
        previewTitle.textContent = `미리보기 (${Math.min(previewTurns.length, previewLimit)}메시지)`;
        stack.appendChild(previewTitle);

        stack.appendChild(
          buildTurns({
            documentRef: doc,
            previewTurns,
            previewLimit,
            rangeInfo,
            selectedIndices,
            selectedOrdinals,
            truncateText,
            modern: true,
          }),
        );

        const footnote = doc.createElement('div');
        footnote.className = 'gmh-modal-footnote';
        footnote.textContent = subheading;
        stack.appendChild(footnote);

        return modal
          .open({
            title: heading,
            description: '',
            content: stack,
            size: 'medium',
            initialFocus: '[data-action="confirm"]',
            actions: [
              {
                id: 'cancel',
                label: '취소',
                variant: 'secondary',
                value: false,
                attrs: { 'data-action': 'cancel' },
              },
              {
                id: 'confirm',
                label: actionLabel,
                variant: 'primary',
                value: true,
                attrs: { 'data-action': 'confirm' },
              },
            ],
          })
          .then((result) => Boolean(result));
      };

      return { confirm };
    }

    const SUMMARY_GUIDE_PROMPT = `
당신은 "장기기억 보관용 사서"입니다.
아래 파일은 캐릭터 채팅 로그를 정형화한 것입니다.
목표는 이 데이터를 2000자 이내로 요약하여, 캐릭터 플랫폼의 "유저노트"에 넣을 수 있는 형식으로 정리하는 것입니다.

조건:
1. 중요도 기준
   - 플레이어와 NPC 관계 변화, 약속, 목표, 갈등, 선호/금기만 포함.
   - 사소한 농담·잡담은 제외.
   - 최근일수록 더 비중 있게 반영.

2. 출력 구조
   - [전체 줄거리 요약]: 주요 사건 흐름을 3~6개 항목으로.
   - [주요 관계 변화]: NPC별 감정/태도 변화를 정리.
   - [핵심 테마]: 반복된 규칙, 세계관 요소, 목표.

3. 형식 규칙
   - 전체 길이는 1200~1800자.
   - 문장은 간결하게.
   - 플레이어 이름은 "플레이어"로 통일.
`;
    const RESUMMARY_GUIDE_PROMPT = `
아래에는 [이전 요약본]과 [새 로그 파일]이 있습니다.
이 둘을 통합하여, 2000자 이내의 "최신 장기기억 요약본"을 만드세요.

규칙:
- 이전 요약본에서 이미 있는 사실은 유지하되, 새 로그 파일에 나온 사건/관계 변화로 업데이트.
- 모순되면 "최근 사건"을 우선.
- 출력 구조는 [전체 줄거리 요약] / [주요 관계 변화] / [핵심 테마].
- 길이는 1200~1800자.
`;
    function createGuidePrompts({ clipboard, setPanelStatus, statusMessages = {}, }) {
        if (!clipboard || typeof clipboard.set !== 'function') {
            throw new Error('createGuidePrompts requires clipboard helper');
        }
        const notify = (message, tone) => {
            if (typeof setPanelStatus === 'function' && message) {
                setPanelStatus(message, tone);
            }
        };
        const summaryMessage = statusMessages.summaryCopied || '요약 프롬프트가 클립보드에 복사되었습니다.';
        const resummaryMessage = statusMessages.resummaryCopied || '재요약 프롬프트가 클립보드에 복사되었습니다.';
        const copySummaryGuide = () => {
            clipboard.set(SUMMARY_GUIDE_PROMPT, { type: 'text', mimetype: 'text/plain' });
            notify(summaryMessage, 'success');
            return SUMMARY_GUIDE_PROMPT;
        };
        const copyResummaryGuide = () => {
            clipboard.set(RESUMMARY_GUIDE_PROMPT, { type: 'text', mimetype: 'text/plain' });
            notify(resummaryMessage, 'success');
            return RESUMMARY_GUIDE_PROMPT;
        };
        return {
            copySummaryGuide,
            copyResummaryGuide,
            prompts: {
                summary: SUMMARY_GUIDE_PROMPT,
                resummary: RESUMMARY_GUIDE_PROMPT,
            },
        };
    }

    /**
     * @typedef {object} GuideControlsOptions
     * @property {() => void} [reparse]
     * @property {() => Promise<void> | void} copySummaryGuide
     * @property {() => Promise<void> | void} copyResummaryGuide
     * @property {Console | { warn?: (...args: unknown[]) => void } | null} [logger]
     */

    /**
     * @typedef {object} GuideControls
     * @property {(panel: Element | null) => void} bindGuideControls
     */

    /**
     * Wires panel guide buttons to share workflow helpers.
     *
     * @param {GuideControlsOptions} [options]
     * @returns {GuideControls}
     */
    function createGuideControls({
      reparse,
      copySummaryGuide,
      copyResummaryGuide,
      logger = typeof console !== 'undefined' ? console : null,
    } = {}) {
      if (typeof copySummaryGuide !== 'function' || typeof copyResummaryGuide !== 'function') {
        throw new Error('createGuideControls requires summary and resummary copy functions');
      }

      /**
       * Registers click handlers on the guide controls rendered in the panel.
       * @param {Element | null} panel
       * @returns {void}
       */
      const bindGuideControls = (panel) => {
        if (!panel || typeof panel.querySelector !== 'function') {
          if (logger?.warn) {
            logger.warn('[GMH] guide controls: panel missing querySelector');
          }
          return;
        }

        const reparseBtn = panel.querySelector('#gmh-reparse');
        if (reparseBtn && typeof reparse === 'function') {
          reparseBtn.onclick = () => reparse();
        }

        const guideBtn = panel.querySelector('#gmh-guide');
        if (guideBtn) {
          guideBtn.onclick = () => copySummaryGuide();
        }

        const reguideBtn = panel.querySelector('#gmh-reguide');
        if (reguideBtn) {
          reguideBtn.onclick = () => copyResummaryGuide();
        }
      };

      return { bindGuideControls };
    }

    function registerGenitConfig(registerAdapterConfig) {
      registerAdapterConfig('genit', {
        selectors: {
          chatContainers: [
            '[data-chat-container]',
            '[data-testid="chat-scroll-region"]',
            '[data-testid="conversation-scroll"]',
            '[data-testid="chat-container"]',
            '[data-role="conversation"]',
            '[data-overlayscrollbars]',
            '.flex-1.min-h-0.overflow-y-auto',
            'main [class*="overflow-y"]',
          ],
          messageRoot: [
            '[data-message-id]',
            '[role="listitem"][data-id]',
            '[data-testid="message-wrapper"]',
          ],
          infoCode: ['code.language-INFO', 'pre code.language-INFO'],
          playerScopes: [
            '[data-role="user"]',
            '[data-from-user="true"]',
            '[data-author-role="user"]',
            '.flex.w-full.justify-end',
            '.flex.flex-col.items-end',
          ],
          playerText: [
            '.space-y-3.mb-6 > .markdown-content:nth-of-type(1)',
            '[data-role="user"] .markdown-content:not(.text-muted-foreground)',
            '[data-author-role="user"] .markdown-content:not(.text-muted-foreground)',
            '.flex.w-full.justify-end .markdown-content:not(.text-muted-foreground)',
            '.flex.flex-col.items-end .markdown-content:not(.text-muted-foreground)',
            '.markdown-content.text-right',
            '.p-4.rounded-xl.bg-background p',
            '[data-role="user"] .markdown-content.text-muted-foreground',
            '[data-author-role="user"] .markdown-content.text-muted-foreground',
            '.flex.w-full.justify-end .markdown-content.text-muted-foreground',
            '.flex.flex-col.items-end .markdown-content.text-muted-foreground',
            '.flex.justify-end .text-muted-foreground.text-sm',
            '.flex.justify-end .text-muted-foreground',
            '.flex.flex-col.items-end .text-muted-foreground',
            '.p-3.rounded-lg.bg-muted\\/50 p',
            '.flex.justify-end .p-3.rounded-lg.bg-muted\\/50 p',
            '.flex.flex-col.items-end .p-3.rounded-lg.bg-muted\\/50 p',
          ],
          npcGroups: ['[data-role="assistant"]', '.flex.flex-col.w-full.group'],
          npcName: [
            '[data-author-name]',
            '[data-author]',
            '[data-username]',
            '.text-sm.text-muted-foreground.mb-1.ml-1',
          ],
          npcBubble: ['.p-4.rounded-xl.bg-background', '.p-3.rounded-lg.bg-muted\\/50'],
          narrationBlocks: [
            '.markdown-content.text-muted-foreground > p',
            '.text-muted-foreground.text-sm > p',
          ],
          panelAnchor: ['[data-testid="app-root"]', '#__next', '#root', 'main'],
          playerNameHints: [
            '[data-role="user"] [data-username]',
            '[data-profile-name]',
            '[data-user-name]',
            '[data-testid="profile-name"]',
            'header [data-username]',
          ],
          textHints: ['메시지', '채팅', '대화'],
        },
      });
    }

    function isPrologueBlock(element) {
      let current = element instanceof Element ? element : null;
      let hops = 0;
      while (current && hops < 400) {
        if (current.hasAttribute?.('data-gmh-player-turn')) return false;
        if (current.previousElementSibling) {
          current = current.previousElementSibling;
        } else {
          current = current.parentElement;
        }
        hops += 1;
      }
      return true;
    }

    function createAdapterAPI({ GMH, errorHandler, PLAYER_NAME_FALLBACKS, setPlayerNames, getPlayerNames }) {
      GMH.Adapters = GMH.Adapters || {};
      GMH.Core = GMH.Core || {};

      GMH.Adapters.Registry = GMH.Adapters.Registry ?? null;
      GMH.Adapters.register = GMH.Adapters.register ?? (() => {});
      GMH.Adapters.getSelectors = GMH.Adapters.getSelectors ?? (() => null);
      GMH.Adapters.getMetadata = GMH.Adapters.getMetadata ?? (() => null);
      GMH.Adapters.list = GMH.Adapters.list ?? (() => []);

      const warnDetectFailure = (err) => {
        const level = errorHandler?.LEVELS?.WARN || 'warn';
        errorHandler?.handle?.(err, 'adapter/detect', level);
      };

      const pickAdapter = (loc = location, doc = document) => {
        const candidates = Array.isArray(GMH.Core.adapters) ? GMH.Core.adapters : [];
        for (const adapter of candidates) {
          try {
            if (adapter?.match?.(loc, doc)) return adapter;
          } catch (err) {
            warnDetectFailure(err);
          }
        }
        return GMH.Adapters.genit;
      };

      GMH.Core.pickAdapter = pickAdapter;

      let activeAdapter = null;
      const getActiveAdapter = () => {
        if (!activeAdapter) {
          activeAdapter = pickAdapter(location, document);
        }
        return activeAdapter;
      };

      GMH.Core.getActiveAdapter = getActiveAdapter;

      const guessPlayerNamesFromDOM = () => {
        const adapter = getActiveAdapter();
        return adapter?.guessPlayerNames?.() || [];
      };

      const updatePlayerNames = () => {
        const names = Array.from(
          new Set([...PLAYER_NAME_FALLBACKS, ...guessPlayerNamesFromDOM()].filter(Boolean)),
        );
        setPlayerNames(names);
        GMH.Adapters.genit?.setPlayerNameAccessor?.(() => getPlayerNames());
      };

      return {
        pickAdapter,
        getActiveAdapter,
        guessPlayerNamesFromDOM,
        updatePlayerNames,
        resetActiveAdapter() {
          activeAdapter = null;
        },
      };
    }

    /**
     * Registers available DOM adapters and exposes helper APIs for adapter selection.
     *
     * @param {object} options - Injection container.
     * @param {typeof import('../core/namespace.ts').GMH} options.GMH - Global namespace handle.
     * @param {Map} options.adapterRegistry - Registry backing store.
     * @param {Function} options.registerAdapterConfig - Adapter registration helper.
     * @param {Function} options.getAdapterSelectors - Accessor for adapter selectors.
     * @param {Function} options.getAdapterMetadata - Accessor for adapter metadata.
     * @param {Function} options.listAdapterNames - Lists registered adapter identifiers.
     * @param {Function} options.createGenitAdapter - Factory for Genit adapter.
     * @param {object} [options.errorHandler] - Optional error handler for logging.
     * @param {Function} options.getPlayerNames - Retrieves configured player names.
     * @param {Function} options.setPlayerNames - Persists player names.
     * @param {Array<string>} options.PLAYER_NAME_FALLBACKS - Default player name list.
     * @returns {object} Adapter utilities bound to the GMH namespace.
     */
    function composeAdapters({
      GMH,
      adapterRegistry,
      registerAdapterConfig,
      getAdapterSelectors,
      getAdapterMetadata,
      listAdapterNames,
      createGenitAdapter,
      errorHandler,
      getPlayerNames,
      setPlayerNames,
      PLAYER_NAME_FALLBACKS,
    }) {
      GMH.Adapters = GMH.Adapters || {};
      GMH.Core = GMH.Core || {};

      GMH.Adapters.Registry = adapterRegistry;
      GMH.Adapters.register = (name, config) => registerAdapterConfig(name, config);
      GMH.Adapters.getSelectors = (name) => getAdapterSelectors(name);
      GMH.Adapters.getMetadata = (name) => getAdapterMetadata(name);
      GMH.Adapters.list = () => listAdapterNames();

      registerGenitConfig(registerAdapterConfig);

      const genitAdapter = createGenitAdapter({
        registry: adapterRegistry,
        getPlayerNames,
        isPrologueBlock,
        errorHandler,
      });

      GMH.Adapters.genit = genitAdapter;
      GMH.Core.adapters = [genitAdapter];

      const api = createAdapterAPI({
        GMH,
        errorHandler,
        PLAYER_NAME_FALLBACKS,
        setPlayerNames,
        getPlayerNames,
      });
      api.updatePlayerNames();

      return {
        genitAdapter,
        ...api,
      };
    }

    /**
     * Builds the privacy configuration pipeline and persistence store.
     *
     * @param {object} options - Dependency container.
     * @param {Function} options.createPrivacyStore - Factory for privacy store.
     * @param {Function} options.createPrivacyPipeline - Factory for redaction pipeline.
     * @param {object} options.PRIVACY_PROFILES - Available privacy profile definitions.
     * @param {string} options.DEFAULT_PRIVACY_PROFILE - Default profile key.
     * @param {Function} options.collapseSpaces - Text normaliser.
     * @param {Function} options.privacyRedactText - Redaction function.
     * @param {Function} options.hasMinorSexualContext - Minor detection helper.
     * @param {Function} options.getPlayerNames - Player name accessor.
     * @param {object} options.ENV - Environment shims (console/storage).
     * @param {object} options.errorHandler - Error handler instance.
     * @returns {object} Privacy helpers bound to runtime configuration.
     */
    function composePrivacy({
      createPrivacyStore,
      createPrivacyPipeline,
      PRIVACY_PROFILES,
      DEFAULT_PRIVACY_PROFILE,
      collapseSpaces,
      privacyRedactText,
      hasMinorSexualContext,
      getPlayerNames,
      ENV,
      errorHandler,
    }) {
      const privacyStore = createPrivacyStore({
        storage: ENV.localStorage,
        errorHandler,
        collapseSpaces,
        defaultProfile: DEFAULT_PRIVACY_PROFILE,
        profiles: PRIVACY_PROFILES,
      });

      const privacyConfig = privacyStore.config;

      const setPrivacyProfile = (profileKey) => {
        privacyStore.setProfile(profileKey);
        return privacyConfig.profile;
      };

      const setCustomList = (type, items) => {
        privacyStore.setCustomList(type, items);
        return privacyConfig;
      };

      const boundRedactText = (text, profileKey, counts) =>
        privacyRedactText(text, profileKey, counts, privacyConfig, PRIVACY_PROFILES);

      const { applyPrivacyPipeline } = createPrivacyPipeline({
        profiles: PRIVACY_PROFILES,
        getConfig: () => privacyConfig,
        redactText: boundRedactText,
        hasMinorSexualContext,
        getPlayerNames,
        logger: ENV.console,
        storage: ENV.localStorage,
      });

      return {
        privacyStore,
        privacyConfig,
        setPrivacyProfile,
        setCustomList,
        applyPrivacyPipeline,
        boundRedactText,
      };
    }

    function cloneSession(session) {
      const clonedTurns = Array.isArray(session?.turns)
        ? session.turns.map((turn) => {
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
      return {
        meta: { ...(session?.meta || {}) },
        turns: clonedTurns,
        warnings: Array.isArray(session?.warnings) ? [...session.warnings] : [],
        source: session?.source,
      };
    }

    function collectSessionStats(session) {
      if (!session) return { userMessages: 0, llmMessages: 0, totalMessages: 0, warnings: 0 };
      const userMessages = session.turns?.filter((turn) => turn.channel === 'user')?.length || 0;
      const llmMessages = session.turns?.filter((turn) => turn.channel === 'llm')?.length || 0;
      const totalMessages = session.turns?.length || 0;
      const warnings = session.warnings?.length || 0;
      return { userMessages, llmMessages, totalMessages, warnings };
    }

    /**
     * Wires the share workflow with grouped dependencies returned from index.
     *
     * @param {object} options - Dependency container.
     * @param {Function} options.createShareWorkflow - Share workflow factory.
     * @param {Function} options.captureStructuredSnapshot - Structured snapshot capture helper.
     * @param {Function} options.normalizeTranscript - Transcript normaliser.
     * @param {Function} options.buildSession - Session builder.
     * @param {object} options.exportRange - Export range controller.
     * @param {Function} options.projectStructuredMessages - Structured message projector.
     * @param {Function} options.applyPrivacyPipeline - Privacy pipeline executor.
     * @param {object} options.privacyConfig - Active privacy configuration reference.
     * @param {object} options.privacyProfiles - Supported privacy profiles.
     * @param {Function} options.formatRedactionCounts - Formatter for redaction metrics.
     * @param {Function} options.setPanelStatus - Panel status setter.
     * @param {Function} options.toMarkdownExport - Classic markdown exporter.
     * @param {Function} options.toJSONExport - Classic JSON exporter.
     * @param {Function} options.toTXTExport - Classic TXT exporter.
     * @param {Function} options.toStructuredMarkdown - Structured markdown exporter.
     * @param {Function} options.toStructuredJSON - Structured JSON exporter.
     * @param {Function} options.toStructuredTXT - Structured TXT exporter.
     * @param {Function} options.buildExportBundle - Bundle builder.
     * @param {Function} options.buildExportManifest - Manifest builder.
     * @param {Function} options.triggerDownload - Download helper.
     * @param {object} options.clipboard - Clipboard helpers.
     * @param {object} options.stateApi - State manager API.
     * @param {object} options.stateEnum - State enum reference.
     * @param {Function} options.confirmPrivacyGate - Privacy confirmation helper.
     * @param {Function} options.getEntryOrigin - Entry origin accessor.
     * @param {object} options.logger - Logger implementation.
     * @returns {object} Share workflow API with helper statistics.
     */
    function composeShareWorkflow({
      createShareWorkflow,
      captureStructuredSnapshot,
      normalizeTranscript,
      buildSession,
      exportRange,
      projectStructuredMessages,
      applyPrivacyPipeline,
      privacyConfig,
      privacyProfiles,
      formatRedactionCounts,
      setPanelStatus,
      toMarkdownExport,
      toJSONExport,
      toTXTExport,
      toStructuredMarkdown,
      toStructuredJSON,
      toStructuredTXT,
      buildExportBundle,
      buildExportManifest,
      triggerDownload,
      clipboard,
      stateApi,
      stateEnum,
      confirmPrivacyGate,
      getEntryOrigin,
      logger,
    }) {
      const shareApi = createShareWorkflow({
        captureStructuredSnapshot,
        normalizeTranscript,
        buildSession,
        exportRange,
        projectStructuredMessages,
        cloneSession,
        applyPrivacyPipeline,
        privacyConfig,
        privacyProfiles,
        formatRedactionCounts,
        setPanelStatus,
        toMarkdownExport,
        toJSONExport,
        toTXTExport,
        toStructuredMarkdown,
        toStructuredJSON,
        toStructuredTXT,
        buildExportBundle,
        buildExportManifest,
        triggerDownload,
        clipboard,
        stateApi,
        stateEnum,
        confirmPrivacyGate,
        getEntryOrigin,
        collectSessionStats,
        logger,
      });

      return {
        ...shareApi,
        collectSessionStats,
      };
    }

    /**
     * Creates the shared modal controller used across classic/modern panels.
     */
    function createModal({ documentRef = typeof document !== 'undefined' ? document : null, windowRef = typeof window !== 'undefined' ? window : null, } = {}) {
        const doc = documentRef;
        const win = windowRef;
        if (!doc || !win) {
            return {
                open: async () => false,
                close: () => { },
                isOpen: () => false,
            };
        }
        const HTMLElementCtor = win.HTMLElement || (typeof HTMLElement !== 'undefined' ? HTMLElement : null);
        const NodeCtor = win.Node || (typeof Node !== 'undefined' ? Node : null);
        let activeModal = null;
        let modalIdCounter = 0;
        /**
         * Sanitises markup snippets before injecting them into the modal body.
         */
        const sanitizeMarkupFragment = (markup) => {
            const template = doc.createElement('template');
            template.innerHTML = String(markup ?? '');
            template.content
                .querySelectorAll('script, style, iframe, object, embed, link, meta')
                .forEach((node) => node.remove());
            template.content.querySelectorAll('*').forEach((element) => {
                Array.from(element.attributes).forEach((attr) => {
                    const name = attr.name.toLowerCase();
                    const value = String(attr.value || '');
                    if (name.startsWith('on')) {
                        element.removeAttribute(attr.name);
                        return;
                    }
                    if (/(javascript:|data:text\/html)/i.test(value)) {
                        element.removeAttribute(attr.name);
                        return;
                    }
                    if (name === 'srcdoc')
                        element.removeAttribute(attr.name);
                });
            });
            return template.content;
        };
        const focusableSelector = [
            'a[href]',
            'area[href]',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            'button:not([disabled])',
            '[tabindex]:not([tabindex="-1"])',
        ].join(',');
        const getFocusable = (root) => {
            if (!root)
                return [];
            const candidates = Array.from(root.querySelectorAll(focusableSelector));
            return candidates.filter((el) => {
                if (!(HTMLElementCtor && el instanceof HTMLElementCtor))
                    return false;
                const style = win.getComputedStyle(el);
                return style.visibility !== 'hidden' && style.display !== 'none';
            });
        };
        const buildButton = (action, finalize) => {
            const button = doc.createElement('button');
            button.type = 'button';
            if (typeof action.type === 'string') {
                button.setAttribute('type', action.type);
            }
            button.className = 'gmh-button';
            if (action.variant)
                button.classList.add(`gmh-button--${action.variant}`);
            if (action.attrs && typeof action.attrs === 'object') {
                Object.entries(action.attrs).forEach(([key, value]) => {
                    button.setAttribute(key, value);
                });
            }
            if (action.disabled)
                button.disabled = true;
            button.textContent = action.label || '확인';
            button.addEventListener('click', (event) => {
                if (button.disabled)
                    return;
                if (typeof action.onSelect === 'function') {
                    const shouldClose = action.onSelect(event);
                    if (shouldClose === false)
                        return;
                }
                finalize(action.value);
            });
            return button;
        };
        const closeActive = (result) => {
            if (activeModal && typeof activeModal.close === 'function') {
                activeModal.close(result, true);
            }
        };
        /**
         * Opens a modal dialog with sanitized markup and focus trapping.
         */
        const open = (options = {}) => {
            ensureDesignSystemStyles();
            closeActive(false);
            return new Promise((resolve) => {
                const overlay = doc.createElement('div');
                overlay.className = 'gmh-modal-overlay';
                const dialog = doc.createElement('div');
                dialog.className = 'gmh-modal';
                if (options.size === 'small')
                    dialog.classList.add('gmh-modal--sm');
                if (options.size === 'large')
                    dialog.classList.add('gmh-modal--lg');
                dialog.setAttribute('role', 'dialog');
                dialog.setAttribute('aria-modal', 'true');
                dialog.setAttribute('tabindex', '-1');
                modalIdCounter += 1;
                const modalId = `gmh-modal-${modalIdCounter}`;
                const titleId = `${modalId}-title`;
                const descId = options.description ? `${modalId}-desc` : '';
                dialog.id = modalId;
                const header = doc.createElement('div');
                header.className = 'gmh-modal__header';
                const headerRow = doc.createElement('div');
                headerRow.className = 'gmh-modal__header-row';
                const title = doc.createElement('h2');
                title.className = 'gmh-modal__title';
                title.textContent = options.title || '';
                title.id = titleId;
                headerRow.appendChild(title);
                let closeBtn = null;
                if (options.dismissible !== false) {
                    closeBtn = doc.createElement('button');
                    closeBtn.type = 'button';
                    closeBtn.className = 'gmh-modal__close';
                    closeBtn.setAttribute('aria-label', '닫기');
                    closeBtn.textContent = '×';
                    headerRow.appendChild(closeBtn);
                }
                header.appendChild(headerRow);
                if (options.description) {
                    const desc = doc.createElement('p');
                    desc.className = 'gmh-modal__description';
                    desc.textContent = options.description;
                    desc.id = descId;
                    header.appendChild(desc);
                }
                dialog.setAttribute('aria-labelledby', titleId);
                if (options.description)
                    dialog.setAttribute('aria-describedby', descId);
                else
                    dialog.removeAttribute('aria-describedby');
                const body = doc.createElement('div');
                body.className = 'gmh-modal__body gmh-modal__body--scroll';
                if (options.bodyClass)
                    body.classList.add(options.bodyClass);
                const { content } = options;
                if (NodeCtor && content instanceof NodeCtor) {
                    body.appendChild(content);
                }
                else if (typeof content === 'string') {
                    body.appendChild(sanitizeMarkupFragment(content));
                }
                const footer = doc.createElement('div');
                footer.className = 'gmh-modal__footer';
                const actionsWrap = doc.createElement('div');
                actionsWrap.className = 'gmh-modal__actions';
                const actions = Array.isArray(options.actions) ? options.actions : [];
                const finalize = (result) => {
                    cleanup(result);
                };
                actions.forEach((action) => {
                    const button = buildButton(action, finalize);
                    actionsWrap.appendChild(button);
                });
                if (actionsWrap.childElementCount) {
                    footer.appendChild(actionsWrap);
                }
                dialog.appendChild(header);
                dialog.appendChild(body);
                if (actionsWrap.childElementCount)
                    dialog.appendChild(footer);
                overlay.appendChild(dialog);
                const bodyEl = doc.body;
                const prevOverflow = bodyEl.style.overflow;
                const restoreTarget = HTMLElementCtor && doc.activeElement instanceof HTMLElementCtor
                    ? doc.activeElement
                    : null;
                bodyEl.style.overflow = 'hidden';
                bodyEl.appendChild(overlay);
                overlay.setAttribute('role', 'presentation');
                const onKeydown = (event) => {
                    if (event.key === 'Escape' && options.dismissible !== false) {
                        event.preventDefault();
                        cleanup(false);
                        return;
                    }
                    if (event.key === 'Tab') {
                        const focusables = getFocusable(dialog);
                        if (!focusables.length) {
                            event.preventDefault();
                            return;
                        }
                        const first = focusables[0];
                        const last = focusables[focusables.length - 1];
                        if (event.shiftKey && doc.activeElement === first) {
                            event.preventDefault();
                            last.focus();
                        }
                        else if (!event.shiftKey && doc.activeElement === last) {
                            event.preventDefault();
                            first.focus();
                        }
                    }
                };
                const cleanup = (result) => {
                    if (!overlay.isConnected)
                        return;
                    doc.removeEventListener('keydown', onKeydown, true);
                    overlay.remove();
                    bodyEl.style.overflow = prevOverflow;
                    if (restoreTarget && typeof restoreTarget.focus === 'function') {
                        restoreTarget.focus();
                    }
                    activeModal = null;
                    resolve(result);
                };
                if (options.dismissible !== false) {
                    overlay.addEventListener('click', (event) => {
                        if (event.target === overlay)
                            cleanup(false);
                    });
                    if (closeBtn)
                        closeBtn.addEventListener('click', () => cleanup(false));
                }
                doc.addEventListener('keydown', onKeydown, true);
                const initialSelector = options.initialFocus || '.gmh-button--primary';
                let focusTarget = (dialog.querySelector(initialSelector) ) ??
                    null;
                if (!(focusTarget && HTMLElementCtor && focusTarget instanceof HTMLElementCtor)) {
                    const focusables = getFocusable(dialog);
                    focusTarget = focusables[0] ?? closeBtn ?? null;
                }
                win.setTimeout(() => {
                    if (focusTarget && typeof focusTarget.focus === 'function')
                        focusTarget.focus();
                }, 20);
                activeModal = {
                    close: cleanup,
                };
            });
        };
        return {
            open,
            close: closeActive,
            isOpen: () => Boolean(activeModal),
        };
    }

    const COLLAPSED_CLASS = 'gmh-collapsed';
    const OPEN_CLASS = 'gmh-panel-open';
    const STORAGE_KEY = 'gmh_panel_collapsed';
    const MIN_GAP = 12;
    const normalizeState = (value, stateEnum) => {
        if (!value)
            return null;
        const next = String(value).toLowerCase();
        return Object.values(stateEnum).includes(next) ? next : null;
    };
    function createPanelVisibility({ panelSettings: panelSettingsRaw, stateEnum, stateApi: stateApiRaw, modal, documentRef = typeof document !== 'undefined' ? document : null, windowRef = typeof window !== 'undefined' ? window : null, storage = typeof localStorage !== 'undefined' ? localStorage : null, logger = typeof console !== 'undefined' ? console : null, }) {
        const panelSettings = panelSettingsRaw;
        const stateApi = stateApiRaw;
        const doc = documentRef ?? null;
        const win = windowRef ?? null;
        if (!panelSettings || !stateEnum || !stateApi || !doc || !win) {
            throw new Error('createPanelVisibility missing required dependencies');
        }
        const DEFAULT_LAYOUT = (() => {
            const layout = (panelSettings.defaults?.layout ?? {});
            return {
                anchor: layout?.anchor === 'left' ? 'left' : 'right',
                offset: Number.isFinite(Number(layout?.offset)) && Number(layout?.offset) > 0
                    ? Math.max(MIN_GAP, Math.round(Number(layout?.offset)))
                    : 16,
                bottom: Number.isFinite(Number(layout?.bottom)) && Number(layout?.bottom) > 0
                    ? Math.max(MIN_GAP, Math.round(Number(layout?.bottom)))
                    : 16,
                width: Number.isFinite(Number(layout?.width)) ? Math.round(Number(layout?.width)) : null,
                height: Number.isFinite(Number(layout?.height)) ? Math.round(Number(layout?.height)) : null,
            };
        })();
        const DEFAULT_BEHAVIOR = (() => {
            const behavior = (panelSettings.defaults?.behavior ?? {});
            return {
                autoHideEnabled: typeof behavior?.autoHideEnabled === 'boolean' ? behavior.autoHideEnabled : true,
                autoHideDelayMs: Number.isFinite(Number(behavior?.autoHideDelayMs))
                    ? Math.max(2000, Math.round(Number(behavior?.autoHideDelayMs)))
                    : 10000,
                collapseOnOutside: typeof behavior?.collapseOnOutside === 'boolean' ? behavior.collapseOnOutside : true,
                collapseOnFocus: typeof behavior?.collapseOnFocus === 'boolean' ? behavior.collapseOnFocus : false,
                allowDrag: typeof behavior?.allowDrag === 'boolean' ? behavior.allowDrag : true,
                allowResize: typeof behavior?.allowResize === 'boolean' ? behavior.allowResize : true,
            };
        })();
        const coerceLayout = (input = {}) => {
            const layout = { ...DEFAULT_LAYOUT, ...(input ?? {}) };
            return {
                anchor: layout.anchor === 'left' ? 'left' : 'right',
                offset: Number.isFinite(Number(layout.offset))
                    ? Math.max(MIN_GAP, Math.round(Number(layout.offset)))
                    : DEFAULT_LAYOUT.offset,
                bottom: Number.isFinite(Number(layout.bottom))
                    ? Math.max(MIN_GAP, Math.round(Number(layout.bottom)))
                    : DEFAULT_LAYOUT.bottom,
                width: Number.isFinite(Number(layout.width))
                    ? Math.max(240, Math.round(Number(layout.width)))
                    : null,
                height: Number.isFinite(Number(layout.height))
                    ? Math.max(220, Math.round(Number(layout.height)))
                    : null,
            };
        };
        const coerceBehavior = (input = {}) => {
            const behavior = { ...DEFAULT_BEHAVIOR, ...(input ?? {}) };
            behavior.autoHideEnabled =
                typeof behavior.autoHideEnabled === 'boolean'
                    ? behavior.autoHideEnabled
                    : DEFAULT_BEHAVIOR.autoHideEnabled;
            behavior.autoHideDelayMs = Number.isFinite(Number(behavior.autoHideDelayMs))
                ? Math.max(2000, Math.round(Number(behavior.autoHideDelayMs)))
                : DEFAULT_BEHAVIOR.autoHideDelayMs;
            behavior.collapseOnOutside =
                typeof behavior.collapseOnOutside === 'boolean'
                    ? behavior.collapseOnOutside
                    : DEFAULT_BEHAVIOR.collapseOnOutside;
            behavior.collapseOnFocus =
                typeof behavior.collapseOnFocus === 'boolean'
                    ? behavior.collapseOnFocus
                    : DEFAULT_BEHAVIOR.collapseOnFocus;
            behavior.allowDrag =
                typeof behavior.allowDrag === 'boolean' ? behavior.allowDrag : DEFAULT_BEHAVIOR.allowDrag;
            behavior.allowResize =
                typeof behavior.allowResize === 'boolean'
                    ? behavior.allowResize
                    : DEFAULT_BEHAVIOR.allowResize;
            return behavior;
        };
        let panelEl = null;
        let fabEl = null;
        let fabLastToggleAt = 0;
        let dragHandle = null;
        let resizeHandle = null;
        let modernMode = false;
        let idleTimer = null;
        let stateUnsubscribe = null;
        let outsidePointerHandler = null;
        let focusCollapseHandler = null;
        let escapeKeyHandler = null;
        let panelListenersBound = false;
        let resizeScheduled = false;
        let currentState = stateEnum.IDLE || '';
        let userCollapsed = false;
        let persistedPreference = null;
        let lastFocusTarget = null;
        let dragSession = null;
        let resizeSession = null;
        let applyingSettings = false;
        let focusTimeouts = [];
        let focusAnimationFrame = null;
        let currentSettings = panelSettings.get();
        let currentLayout = coerceLayout(currentSettings.layout);
        let currentBehavior = coerceBehavior(currentSettings.behavior);
        panelSettings.onChange((next) => {
            currentSettings = next;
            currentLayout = coerceLayout(next.layout);
            currentBehavior = coerceBehavior(next.behavior);
            if (panelEl && modernMode) {
                applyingSettings = true;
                try {
                    applyLayout();
                    refreshBehavior();
                }
                finally {
                    applyingSettings = false;
                }
            }
        });
        const getRoot = () => doc.documentElement;
        const isModernActive = () => modernMode && !!panelEl;
        const isCollapsed = () => {
            if (!isModernActive())
                return false;
            return getRoot().classList.contains(COLLAPSED_CLASS);
        };
        const loadPersistedCollapsed = () => {
            if (!storage)
                return null;
            try {
                const raw = storage.getItem(STORAGE_KEY);
                if (raw === '1')
                    return true;
                if (raw === '0')
                    return false;
            }
            catch (err) {
                logger?.warn?.('[GMH] failed to read panel state', err);
            }
            return null;
        };
        const persistCollapsed = (value) => {
            if (!storage)
                return;
            persistedPreference = value;
            try {
                if (value === null)
                    storage.removeItem(STORAGE_KEY);
                else
                    storage.setItem(STORAGE_KEY, value ? '1' : '0');
            }
            catch (err) {
                logger?.warn?.('[GMH] failed to persist panel state', err);
            }
        };
        const rememberFocus = () => {
            const active = doc.activeElement;
            if (!active || active === doc.body)
                return;
            if (!(active instanceof HTMLElement))
                return;
            if (panelEl && panelEl.contains(active))
                return;
            lastFocusTarget = active;
        };
        const clearFocusSchedules = () => {
            if (focusAnimationFrame) {
                cancelAnimationFrame(focusAnimationFrame);
                focusAnimationFrame = null;
            }
            if (focusTimeouts.length) {
                focusTimeouts.forEach((id) => win.clearTimeout(id));
                focusTimeouts = [];
            }
        };
        const clearFocusMemory = () => {
            lastFocusTarget = null;
        };
        const restoreFocus = () => {
            const target = lastFocusTarget;
            if (!target)
                return;
            lastFocusTarget = null;
            requestAnimationFrame(() => {
                try {
                    target.focus({ preventScroll: true });
                }
                catch (err) {
                    logger?.warn?.('[GMH] focus restore failed', err);
                }
            });
        };
        const focusPanelElement = () => {
            const panelElement = panelEl;
            if (!panelElement || typeof panelElement.focus !== 'function')
                return;
            const attempt = () => {
                try {
                    panelElement.focus({ preventScroll: true });
                }
                catch {
                    /* noop */
                }
            };
            clearFocusSchedules();
            attempt();
            focusAnimationFrame = requestAnimationFrame(() => {
                focusAnimationFrame = null;
                attempt();
            });
            focusTimeouts = [win.setTimeout(attempt, 0), win.setTimeout(attempt, 50)];
        };
        const clearIdleTimer = () => {
            if (idleTimer) {
                win.clearTimeout(idleTimer);
                idleTimer = null;
            }
        };
        const getAutoHideDelay = () => {
            if (!currentBehavior.autoHideEnabled)
                return null;
            return currentBehavior.autoHideDelayMs || 10000;
        };
        const applyRootState = (collapsed) => {
            const root = getRoot();
            if (!modernMode) {
                root.classList.remove(COLLAPSED_CLASS);
                root.classList.remove(OPEN_CLASS);
                return;
            }
            if (collapsed) {
                root.classList.add(COLLAPSED_CLASS);
                root.classList.remove(OPEN_CLASS);
            }
            else {
                root.classList.add(OPEN_CLASS);
                root.classList.remove(COLLAPSED_CLASS);
            }
        };
        const syncAria = (collapsed) => {
            if (!panelEl)
                return;
            panelEl.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
            if (fabEl)
                fabEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        };
        const scheduleIdleClose = () => {
            if (!isModernActive())
                return;
            clearIdleTimer();
            if (isCollapsed())
                return;
            if (currentState !== (stateEnum.IDLE || ''))
                return;
            const delay = getAutoHideDelay();
            if (!delay)
                return;
            idleTimer = win.setTimeout(() => {
                if (!isModernActive())
                    return;
                if (currentState !== (stateEnum.IDLE || ''))
                    return;
                close('idle');
            }, delay);
        };
        const resetIdleTimer = () => {
            if (!isModernActive())
                return;
            if (isCollapsed())
                return;
            scheduleIdleClose();
        };
        const applyLayout = () => {
            if (!panelEl)
                return;
            const layout = coerceLayout(currentLayout);
            const viewportWidth = win.innerWidth || doc.documentElement.clientWidth || 1280;
            const viewportHeight = win.innerHeight || doc.documentElement.clientHeight || 720;
            const maxWidth = Math.max(MIN_GAP, viewportWidth - MIN_GAP * 2);
            const maxHeight = Math.max(MIN_GAP, viewportHeight - MIN_GAP * 2);
            const width = layout.width ? Math.min(Math.max(260, layout.width), maxWidth) : null;
            const height = layout.height ? Math.min(Math.max(240, layout.height), maxHeight) : null;
            panelEl.style.width = width ? `${width}px` : '';
            if (height) {
                panelEl.style.height = `${height}px`;
                panelEl.style.maxHeight = `${height}px`;
            }
            else {
                panelEl.style.height = '';
                panelEl.style.maxHeight = '70vh';
            }
            const rect = panelEl.getBoundingClientRect();
            const effectiveHeight = height || rect.height || 320;
            const bottomLimit = Math.max(MIN_GAP, viewportHeight - effectiveHeight - MIN_GAP);
            const bottom = Math.min(Math.max(MIN_GAP, layout.bottom ?? DEFAULT_LAYOUT.bottom), bottomLimit);
            const horizontalLimit = Math.max(MIN_GAP, viewportWidth - MIN_GAP - 160);
            const offset = Math.min(Math.max(MIN_GAP, layout.offset ?? DEFAULT_LAYOUT.offset), horizontalLimit);
            if (layout.anchor === 'left') {
                panelEl.style.left = `${offset}px`;
                panelEl.style.right = 'auto';
            }
            else {
                panelEl.style.left = 'auto';
                panelEl.style.right = `${offset}px`;
            }
            panelEl.style.bottom = `${bottom}px`;
            panelEl.style.top = 'auto';
            const finalLayout = { ...layout, offset, bottom, width, height };
            const changed = finalLayout.anchor !== currentLayout.anchor ||
                finalLayout.offset !== currentLayout.offset ||
                finalLayout.bottom !== currentLayout.bottom ||
                finalLayout.width !== currentLayout.width ||
                finalLayout.height !== currentLayout.height;
            currentLayout = finalLayout;
            if (changed && !applyingSettings) {
                panelSettings.update({ layout: finalLayout });
            }
        };
        const refreshOutsideHandler = () => {
            if (outsidePointerHandler) {
                doc.removeEventListener('pointerdown', outsidePointerHandler);
                outsidePointerHandler = null;
            }
            if (!currentBehavior.collapseOnOutside)
                return;
            outsidePointerHandler = (event) => {
                if (!isModernActive())
                    return;
                if (isCollapsed())
                    return;
                const target = event.target;
                if (!(target instanceof Node))
                    return;
                if (panelEl && panelEl.contains(target))
                    return;
                if (fabEl && fabEl.contains(target))
                    return;
                if (modal?.isOpen?.())
                    return;
                clearFocusMemory();
                close('user');
            };
            doc.addEventListener('pointerdown', outsidePointerHandler);
        };
        const refreshFocusCollapseHandler = () => {
            if (focusCollapseHandler) {
                doc.removeEventListener('focusin', focusCollapseHandler, true);
                focusCollapseHandler = null;
            }
            if (!currentBehavior.collapseOnFocus)
                return;
            focusCollapseHandler = (event) => {
                if (!isModernActive() || isCollapsed())
                    return;
                const target = event.target;
                if (!(target instanceof Node))
                    return;
                if (panelEl && panelEl.contains(target))
                    return;
                if (fabEl && fabEl.contains(target))
                    return;
                if (modal?.isOpen?.())
                    return;
                close('focus');
            };
            doc.addEventListener('focusin', focusCollapseHandler, true);
        };
        const updateHandleAccessibility = () => {
            if (dragHandle) {
                dragHandle.disabled = !currentBehavior.allowDrag;
                dragHandle.setAttribute('aria-disabled', currentBehavior.allowDrag ? 'false' : 'true');
            }
            if (resizeHandle) {
                resizeHandle.style.display = currentBehavior.allowResize ? '' : 'none';
            }
        };
        const refreshBehavior = () => {
            if (!panelEl || !modernMode)
                return;
            refreshOutsideHandler();
            refreshFocusCollapseHandler();
            updateHandleAccessibility();
            if (!isCollapsed())
                scheduleIdleClose();
        };
        const handleViewportResize = () => {
            if (!panelEl || !modernMode)
                return;
            if (resizeScheduled)
                return;
            resizeScheduled = true;
            requestAnimationFrame(() => {
                resizeScheduled = false;
                applyLayout();
            });
        };
        win.addEventListener('resize', handleViewportResize);
        const ensureFab = () => {
            if (!modernMode)
                return null;
            if (!fabEl || !fabEl.isConnected) {
                fabEl = doc.getElementById('gmh-fab');
            }
            if (!fabEl || !fabEl.isConnected) {
                fabEl = doc.createElement('button');
                fabEl.id = 'gmh-fab';
                fabEl.type = 'button';
                fabEl.textContent = 'GMH';
                fabEl.setAttribute('aria-label', 'Genit Memory Helper 토글');
                fabEl.setAttribute('aria-controls', 'genit-memory-helper-panel');
                doc.body.appendChild(fabEl);
            }
            fabEl.onclick = (event) => {
                const now = typeof performance?.now === 'function' ? performance.now() : Date.now();
                if (now - fabLastToggleAt < 350)
                    return;
                event.preventDefault();
                fabLastToggleAt = now;
                toggle();
            };
            fabEl.setAttribute('aria-expanded', isCollapsed() ? 'false' : 'true');
            return fabEl;
        };
        const attachPanelListeners = () => {
            if (!isModernActive() || panelListenersBound || !panelEl)
                return;
            const passiveReset = () => resetIdleTimer();
            panelEl.addEventListener('pointerdown', passiveReset, { passive: true });
            panelEl.addEventListener('pointermove', passiveReset, { passive: true });
            panelEl.addEventListener('wheel', passiveReset, { passive: true });
            panelEl.addEventListener('touchstart', passiveReset, { passive: true });
            panelEl.addEventListener('keydown', resetIdleTimer);
            panelEl.addEventListener('focusin', resetIdleTimer);
            panelListenersBound = true;
        };
        const ensureEscapeHandler = () => {
            if (escapeKeyHandler)
                return;
            escapeKeyHandler = (event) => {
                if (!isModernActive())
                    return;
                if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey)
                    return;
                if (modal?.isOpen?.())
                    return;
                if (isCollapsed())
                    return;
                close('user');
                event.preventDefault();
            };
            win.addEventListener('keydown', escapeKeyHandler);
        };
        const ensureStateSubscription = () => {
            if (stateUnsubscribe || typeof stateApi?.subscribe !== 'function')
                return;
            stateUnsubscribe = stateApi.subscribe((next) => {
                currentState = normalizeState(next, stateEnum) || stateEnum.IDLE || '';
                if (!modernMode)
                    return;
                if (currentState !== (stateEnum.IDLE || '')) {
                    if (!userCollapsed)
                        open({ focus: false });
                    clearIdleTimer();
                }
                else {
                    userCollapsed = false;
                    scheduleIdleClose();
                }
            });
        };
        const bindHandles = () => {
            if (!panelEl)
                return;
            const nextDragHandle = panelEl.querySelector('#gmh-panel-drag-handle');
            if (dragHandle && dragHandle !== nextDragHandle) {
                dragHandle.removeEventListener('pointerdown', handleDragStart);
            }
            dragHandle = nextDragHandle;
            if (dragHandle)
                dragHandle.addEventListener('pointerdown', handleDragStart);
            const nextResizeHandle = panelEl.querySelector('#gmh-panel-resize-handle');
            if (resizeHandle && resizeHandle !== nextResizeHandle) {
                resizeHandle.removeEventListener('pointerdown', handleResizeStart);
            }
            resizeHandle = nextResizeHandle;
            if (resizeHandle)
                resizeHandle.addEventListener('pointerdown', handleResizeStart);
            updateHandleAccessibility();
        };
        const stopDragTracking = () => {
            if (!dragSession)
                return;
            win.removeEventListener('pointermove', handleDragMove);
            win.removeEventListener('pointerup', handleDragEnd);
            win.removeEventListener('pointercancel', handleDragCancel);
            if (dragHandle && dragSession.pointerId !== undefined) {
                try {
                    dragHandle.releasePointerCapture(dragSession.pointerId);
                }
                catch {
                    /* noop */
                }
            }
            panelEl?.classList.remove('gmh-panel--dragging');
            dragSession = null;
        };
        const handleDragStart = (event) => {
            if (!panelEl || !modernMode)
                return;
            if (!currentBehavior.allowDrag)
                return;
            if (event.button && event.button !== 0)
                return;
            event.preventDefault();
            dragSession = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                rect: panelEl.getBoundingClientRect(),
            };
            panelEl.classList.add('gmh-panel--dragging');
            clearIdleTimer();
            try {
                dragHandle?.setPointerCapture(event.pointerId);
            }
            catch {
                /* noop */
            }
            win.addEventListener('pointermove', handleDragMove);
            win.addEventListener('pointerup', handleDragEnd);
            win.addEventListener('pointercancel', handleDragCancel);
        };
        const handleDragMove = (event) => {
            if (!dragSession || !panelEl)
                return;
            const dx = event.clientX - dragSession.startX;
            const dy = event.clientY - dragSession.startY;
            const { rect } = dragSession;
            const viewportWidth = win.innerWidth || doc.documentElement.clientWidth || 1280;
            const viewportHeight = win.innerHeight || doc.documentElement.clientHeight || 720;
            let nextLeft = rect.left + dx;
            let nextTop = rect.top + dy;
            const maxLeft = viewportWidth - rect.width - MIN_GAP;
            const maxTop = viewportHeight - rect.height - MIN_GAP;
            nextLeft = Math.min(Math.max(MIN_GAP, nextLeft), Math.max(MIN_GAP, maxLeft));
            nextTop = Math.min(Math.max(MIN_GAP, nextTop), Math.max(MIN_GAP, maxTop));
            panelEl.style.left = `${Math.round(nextLeft)}px`;
            panelEl.style.top = `${Math.round(nextTop)}px`;
            panelEl.style.right = 'auto';
            panelEl.style.bottom = 'auto';
        };
        const finalizeDragLayout = () => {
            if (!panelEl)
                return;
            const rect = panelEl.getBoundingClientRect();
            const viewportWidth = win.innerWidth || doc.documentElement.clientWidth || 1280;
            const viewportHeight = win.innerHeight || doc.documentElement.clientHeight || 720;
            const anchor = rect.left + rect.width / 2 <= viewportWidth / 2 ? 'left' : 'right';
            const offset = anchor === 'left'
                ? Math.round(Math.max(MIN_GAP, rect.left))
                : Math.round(Math.max(MIN_GAP, viewportWidth - rect.right));
            const bottom = Math.round(Math.max(MIN_GAP, viewportHeight - rect.bottom));
            panelSettings.update({ layout: { anchor, offset, bottom } });
        };
        const handleDragEnd = () => {
            if (!dragSession)
                return;
            stopDragTracking();
            finalizeDragLayout();
        };
        const handleDragCancel = () => {
            stopDragTracking();
            applyLayout();
        };
        const stopResizeTracking = () => {
            if (!resizeSession)
                return;
            win.removeEventListener('pointermove', handleResizeMove);
            win.removeEventListener('pointerup', handleResizeEnd);
            win.removeEventListener('pointercancel', handleResizeCancel);
            if (resizeHandle && resizeSession.pointerId !== undefined) {
                try {
                    resizeHandle.releasePointerCapture(resizeSession.pointerId);
                }
                catch {
                    /* noop */
                }
            }
            panelEl?.classList.remove('gmh-panel--resizing');
            resizeSession = null;
        };
        const handleResizeStart = (event) => {
            if (!panelEl || !modernMode)
                return;
            if (!currentBehavior.allowResize)
                return;
            if (event.button && event.button !== 0)
                return;
            event.preventDefault();
            const rect = panelEl.getBoundingClientRect();
            resizeSession = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                width: rect.width,
                height: rect.height,
                nextWidth: rect.width,
                nextHeight: rect.height,
            };
            panelEl.classList.add('gmh-panel--resizing');
            clearIdleTimer();
            try {
                resizeHandle?.setPointerCapture(event.pointerId);
            }
            catch {
                /* noop */
            }
            win.addEventListener('pointermove', handleResizeMove);
            win.addEventListener('pointerup', handleResizeEnd);
            win.addEventListener('pointercancel', handleResizeCancel);
        };
        const handleResizeMove = (event) => {
            if (!resizeSession || !panelEl)
                return;
            const viewportWidth = win.innerWidth || doc.documentElement.clientWidth || 1280;
            const viewportHeight = win.innerHeight || doc.documentElement.clientHeight || 720;
            const dx = event.clientX - resizeSession.startX;
            const dy = event.clientY - resizeSession.startY;
            const horizontalRoom = Math.max(MIN_GAP, viewportWidth - (currentLayout.offset ?? DEFAULT_LAYOUT.offset) - MIN_GAP);
            const verticalRoom = Math.max(MIN_GAP, viewportHeight - (currentLayout.bottom ?? DEFAULT_LAYOUT.bottom) - MIN_GAP);
            let nextWidth = resizeSession.width + dx;
            let nextHeight = resizeSession.height + dy;
            nextWidth = Math.min(Math.max(260, nextWidth), horizontalRoom);
            nextHeight = Math.min(Math.max(240, nextHeight), verticalRoom);
            resizeSession.nextWidth = Math.round(nextWidth);
            resizeSession.nextHeight = Math.round(nextHeight);
            panelEl.style.width = `${resizeSession.nextWidth}px`;
            panelEl.style.height = `${resizeSession.nextHeight}px`;
            panelEl.style.maxHeight = `${resizeSession.nextHeight}px`;
        };
        const handleResizeEnd = () => {
            if (!resizeSession)
                return;
            const { nextWidth, nextHeight } = resizeSession;
            stopResizeTracking();
            panelSettings.update({
                layout: {
                    width: nextWidth,
                    height: nextHeight,
                },
            });
        };
        const handleResizeCancel = () => {
            stopResizeTracking();
            applyLayout();
        };
        const open = ({ focus = false, persist = false } = {}) => {
            if (!panelEl)
                return false;
            if (!modernMode) {
                if (focus && typeof panelEl.focus === 'function') {
                    requestAnimationFrame(() => panelEl.focus({ preventScroll: true }));
                }
                return true;
            }
            const wasCollapsed = isCollapsed();
            applyRootState(false);
            syncAria(false);
            if (fabEl)
                fabEl.setAttribute('aria-expanded', 'true');
            if (persist)
                persistCollapsed(false);
            userCollapsed = false;
            applyLayout();
            refreshBehavior();
            if (focus) {
                rememberFocus();
                focusPanelElement();
            }
            if (currentState === (stateEnum.IDLE || ''))
                scheduleIdleClose();
            else
                clearIdleTimer();
            return wasCollapsed;
        };
        const close = (reason = 'user') => {
            if (!panelEl || !modernMode)
                return false;
            if (isCollapsed())
                return false;
            applyRootState(true);
            syncAria(true);
            if (fabEl)
                fabEl.setAttribute('aria-expanded', 'false');
            clearIdleTimer();
            clearFocusSchedules();
            if (reason === 'user') {
                userCollapsed = true;
                persistCollapsed(true);
                if (lastFocusTarget)
                    restoreFocus();
            }
            if (reason === 'idle')
                userCollapsed = false;
            if (reason !== 'user')
                clearFocusMemory();
            return true;
        };
        const toggle = () => {
            if (!panelEl || !modernMode)
                return false;
            if (isCollapsed()) {
                open({ focus: true, persist: true });
                return true;
            }
            close('user');
            return false;
        };
        const bind = (panel, { modern } = {}) => {
            const panelElement = panel instanceof HTMLElement ? panel : null;
            if (panel && !panelElement) {
                if (logger?.warn) {
                    logger.warn('[GMH] panel visibility: ignored non-HTMLElement panel');
                }
            }
            panelEl = panelElement;
            panelListenersBound = false;
            modernMode = !!modern && !!panelEl;
            if (!panelEl)
                return;
            if (!modernMode) {
                if (fabEl && fabEl.isConnected) {
                    fabEl.remove();
                    fabEl = null;
                }
                applyRootState(false);
                syncAria(false);
                return;
            }
            ensureStateSubscription();
            currentState = normalizeState(stateApi?.getState?.(), stateEnum) || stateEnum.IDLE || '';
            ensureFab();
            attachPanelListeners();
            ensureEscapeHandler();
            bindHandles();
            persistedPreference = loadPersistedCollapsed();
            const shouldCollapse = (() => {
                if (typeof persistedPreference === 'boolean')
                    return persistedPreference;
                const mq = win.matchMedia?.('(max-width: 768px)');
                if (mq?.matches)
                    return true;
                if (typeof win.innerWidth === 'number')
                    return win.innerWidth <= 768;
                return false;
            })();
            if (!shouldCollapse)
                applyLayout();
            applyRootState(shouldCollapse);
            syncAria(shouldCollapse);
            userCollapsed = shouldCollapse;
            refreshBehavior();
            if (!shouldCollapse)
                scheduleIdleClose();
        };
        const onStatusUpdate = ({ tone } = {}) => {
            if (!isModernActive())
                return;
            if (tone && ['error', 'warning', 'progress'].includes(tone) && isCollapsed()) {
                open({ focus: false });
            }
            if (!isCollapsed())
                scheduleIdleClose();
        };
        return {
            bind,
            open,
            close,
            toggle,
            isCollapsed,
            onStatusUpdate,
        };
    }

    const STATUS_TONES = {
        success: { color: '#34d399', icon: '✅' },
        info: { color: '#93c5fd', icon: 'ℹ️' },
        progress: { color: '#facc15', icon: '⏳' },
        warning: { color: '#f97316', icon: '⚠️' },
        error: { color: '#f87171', icon: '❌' },
        muted: { color: '#cbd5f5', icon: '' },
    };
    /**
     * Creates a minimal status manager that updates panel status text and notifies listeners.
     */
    function createStatusManager({ panelVisibility } = {}) {
        let statusElement = null;
        /**
         * Sets the DOM element where panel status text renders.
         */
        const attachStatusElement = (element) => {
            statusElement = element ?? null;
        };
        /**
         * Updates the status element text and tone styling.
         */
        const setStatus = (message, toneOrColor = 'info') => {
            if (!statusElement)
                return;
            const text = String(message || '');
            let icon = '';
            let color = '#9ca3af';
            let tone = toneOrColor ?? undefined;
            if (typeof toneOrColor === 'string' && toneOrColor.startsWith('#')) {
                color = toneOrColor;
                tone = null;
            }
            else if (typeof toneOrColor === 'string' && STATUS_TONES[toneOrColor]) {
                tone = toneOrColor;
            }
            else if (!toneOrColor) {
                tone = 'info';
            }
            if (tone && STATUS_TONES[tone]) {
                color = STATUS_TONES[tone].color;
                icon = STATUS_TONES[tone].icon || '';
            }
            statusElement.textContent = icon ? `${icon} ${text}` : text;
            statusElement.style.color = color;
            if (tone)
                statusElement.dataset.tone = tone;
            else
                delete statusElement.dataset.tone;
            panelVisibility?.onStatusUpdate?.({ tone: tone ?? null });
        };
        return {
            STATUS_TONES,
            attachStatusElement,
            setStatus,
        };
    }

    const STATE_PRESET_MAP = {
        idle: {
            label: '대기 중',
            message: '준비 완료',
            tone: 'info',
            progress: { value: 0 },
        },
        scanning: {
            label: '스크롤/수집 중',
            message: '위로 불러오는 중...',
            tone: 'progress',
            progress: { indeterminate: true },
        },
        redacting: {
            label: '민감정보 마스킹 중',
            message: '레다크션 파이프라인 적용 중...',
            tone: 'progress',
            progress: { indeterminate: true },
        },
        preview: {
            label: '미리보기 준비 완료',
            message: '레다크션 결과를 검토하세요.',
            tone: 'info',
            progress: { value: 0.75 },
        },
        exporting: {
            label: '내보내기 진행 중',
            message: '파일을 준비하는 중입니다...',
            tone: 'progress',
            progress: { indeterminate: true },
        },
        done: {
            label: '작업 완료',
            message: '결과를 확인하세요.',
            tone: 'success',
            progress: { value: 1 },
        },
        error: {
            label: '오류 발생',
            message: '작업을 다시 시도해주세요.',
            tone: 'error',
            progress: { value: 1 },
        },
    };
    const STATE_PRESETS = STATE_PRESET_MAP;
    /**
     * Builds the state view binder so the panel shows current workflow progress.
     */
    function createStateView({ stateApi, statusManager, stateEnum, }) {
        if (!stateApi)
            throw new Error('createStateView requires stateApi');
        if (!statusManager)
            throw new Error('createStateView requires statusManager');
        let progressFillEl = null;
        let progressLabelEl = null;
        let unsubscribe = null;
        const clamp = (value) => {
            if (!Number.isFinite(value))
                return 0;
            if (value < 0)
                return 0;
            if (value > 1)
                return 1;
            return value;
        };
        const setPanelStatus = statusManager.setStatus;
        const applyState = (stateKey, meta = {}) => {
            const payload = meta?.payload ?? {};
            const preset = STATE_PRESETS[stateKey] ?? STATE_PRESETS.idle;
            const label = payload.label ?? preset.label ?? '';
            const tone = payload.tone ?? preset.tone ?? 'info';
            const message = payload.message ?? preset.message ?? label ?? '';
            const progress = payload.progress ?? preset.progress ?? null;
            if (progressLabelEl)
                progressLabelEl.textContent = label || ' ';
            if (progressFillEl) {
                if (progress?.indeterminate) {
                    progressFillEl.dataset.indeterminate = 'true';
                    progressFillEl.style.width = '40%';
                    progressFillEl.setAttribute('aria-valuenow', '0');
                }
                else {
                    progressFillEl.dataset.indeterminate = 'false';
                    const value = clamp(progress?.value ?? null);
                    progressFillEl.style.width = `${Math.round(value * 100)}%`;
                    progressFillEl.setAttribute('aria-valuenow', String(value));
                }
                progressFillEl.dataset.state = stateKey || 'idle';
                if (label)
                    progressFillEl.setAttribute('aria-valuetext', label);
            }
            if (message)
                setPanelStatus(message, tone);
        };
        const bind = ({ progressFill, progressLabel } = {}) => {
            progressFillEl = progressFill ?? null;
            progressLabelEl = progressLabel ?? null;
            if (typeof unsubscribe === 'function')
                unsubscribe();
            if (progressFillEl) {
                progressFillEl.setAttribute('role', 'progressbar');
                progressFillEl.setAttribute('aria-valuemin', '0');
                progressFillEl.setAttribute('aria-valuemax', '1');
                progressFillEl.setAttribute('aria-valuenow', '0');
                progressFillEl.setAttribute('aria-live', 'polite');
            }
            if (progressLabelEl) {
                progressLabelEl.setAttribute('aria-live', 'polite');
            }
            unsubscribe =
                stateApi.subscribe?.((state, meta) => {
                    const nextState = typeof state === 'string' ? state : stateEnum?.IDLE || 'idle';
                    applyState(nextState, meta);
                }) ?? null;
            const currentRaw = stateApi.getState?.();
            const current = typeof currentRaw === 'string' ? currentRaw : stateEnum?.IDLE || 'idle';
            applyState(current, { payload: STATE_PRESETS[current] || {} });
        };
        return { bind };
    }

    /**
     * Creates privacy list configuration helpers for modal or legacy prompts.
     */
    function createPrivacyConfigurator({ privacyConfig, setCustomList, parseListInput, setPanelStatus, modal, isModernUIActive, documentRef = typeof document !== 'undefined' ? document : null, windowRef = typeof window !== 'undefined' ? window : null, }) {
        if (!documentRef)
            throw new Error('createPrivacyConfigurator requires document');
        const doc = documentRef;
        const win = windowRef;
        const resolveModernActive = () => typeof isModernUIActive === 'function' ? isModernUIActive() : Boolean(isModernUIActive);
        /**
         * Launches the design-system modal for editing privacy lists.
         */
        const configurePrivacyListsModern = async () => {
            ensureDesignSystemStyles(doc);
            const stack = doc.createElement('div');
            stack.className = 'gmh-modal-stack';
            const intro = doc.createElement('p');
            intro.className = 'gmh-subtext';
            intro.textContent =
                '쉼표 또는 줄바꿈으로 여러 항목을 구분하세요. 블랙리스트는 강제 마스킹, 화이트리스트는 예외 처리됩니다.';
            stack.appendChild(intro);
            const makeLabel = (text) => {
                const label = doc.createElement('div');
                label.className = 'gmh-field-label';
                label.textContent = text;
                return label;
            };
            const blackLabel = makeLabel(`블랙리스트 (${privacyConfig.blacklist?.length || 0})`);
            stack.appendChild(blackLabel);
            const blackTextarea = doc.createElement('textarea');
            blackTextarea.id = 'gmh-privacy-blacklist';
            blackTextarea.className = 'gmh-textarea';
            blackTextarea.placeholder = '예: 서울시, 010-1234-5678';
            blackTextarea.value = privacyConfig.blacklist?.join('\n') || '';
            stack.appendChild(blackTextarea);
            const whiteLabel = makeLabel(`화이트리스트 (${privacyConfig.whitelist?.length || 0})`);
            stack.appendChild(whiteLabel);
            const whiteTextarea = doc.createElement('textarea');
            whiteTextarea.id = 'gmh-privacy-whitelist';
            whiteTextarea.className = 'gmh-textarea';
            whiteTextarea.placeholder = '예: 공식 길드명, 공개 닉네임';
            whiteTextarea.value = privacyConfig.whitelist?.join('\n') || '';
            stack.appendChild(whiteTextarea);
            const confirmed = Boolean(await modal.open({
                title: '프라이버시 민감어 관리',
                size: 'large',
                content: stack,
                actions: [
                    {
                        id: 'cancel',
                        label: '취소',
                        variant: 'secondary',
                        value: false,
                        attrs: { 'data-action': 'cancel' },
                    },
                    {
                        id: 'save',
                        label: '저장',
                        variant: 'primary',
                        value: true,
                        attrs: { 'data-action': 'save' },
                    },
                ],
                initialFocus: '#gmh-privacy-blacklist',
            }));
            if (!confirmed) {
                setPanelStatus('프라이버시 설정 변경을 취소했습니다.', 'muted');
                return;
            }
            setCustomList('blacklist', parseListInput(blackTextarea.value));
            setCustomList('whitelist', parseListInput(whiteTextarea.value));
            setPanelStatus('프라이버시 사용자 목록을 저장했습니다.', 'success');
        };
        /**
         * Prompts using classic dialogs to update privacy lists.
         */
        const configurePrivacyListsLegacy = () => {
            const currentBlack = privacyConfig.blacklist?.join('\n') || '';
            const nextBlack = win?.prompt
                ? win.prompt('레다크션 강제 대상(블랙리스트)을 줄바꿈 또는 쉼표로 구분해 입력하세요.\n비워두면 목록을 초기화합니다.', currentBlack)
                : null;
            if (nextBlack !== null) {
                setCustomList('blacklist', parseListInput(nextBlack));
            }
            const currentWhite = privacyConfig.whitelist?.join('\n') || '';
            const nextWhite = win?.prompt
                ? win.prompt('레다크션 예외 대상(화이트리스트)을 줄바꿈 또는 쉼표로 구분해 입력하세요.\n비워두면 목록을 초기화합니다.', currentWhite)
                : null;
            if (nextWhite !== null) {
                setCustomList('whitelist', parseListInput(nextWhite));
            }
            setPanelStatus('프라이버시 사용자 목록을 저장했습니다.', 'info');
        };
        /**
         * Opens either the modern modal or legacy prompt workflow.
         */
        const configurePrivacyLists = async () => {
            if (resolveModernActive()) {
                await configurePrivacyListsModern();
                return;
            }
            configurePrivacyListsLegacy();
        };
        return {
            configurePrivacyLists,
        };
    }

    /**
     * @typedef {import('../types').PanelSettingsController} PanelSettingsController
     * @typedef {import('../types').PanelSettingsValue} PanelSettingsValue
     * @typedef {import('../types').ModalController} ModalController
     */

    /**
     * @typedef {object} PanelSettingsModalOptions
     * @property {PanelSettingsController} panelSettings
     * @property {ModalController} modal
     * @property {(message: string, tone?: string | null) => void} setPanelStatus
     * @property {() => Promise<void> | void} configurePrivacyLists
     * @property {Document | null} [documentRef]
     */

    /**
     * Provides the modal workflow for editing panel settings and privacy lists.
     *
     * @param {PanelSettingsModalOptions} [options]
     * @returns {{ openPanelSettings: () => Promise<void> }}
     */
    function createPanelSettingsController({
      panelSettings,
      modal,
      setPanelStatus,
      configurePrivacyLists,
      documentRef = typeof document !== 'undefined' ? document : null,
    } = {}) {
      if (!panelSettings) throw new Error('createPanelSettingsController requires panelSettings');
      if (!modal) throw new Error('createPanelSettingsController requires modal');
      if (!setPanelStatus) throw new Error('createPanelSettingsController requires setPanelStatus');
      if (!configurePrivacyLists) {
        throw new Error('createPanelSettingsController requires configurePrivacyLists');
      }
      if (!documentRef) throw new Error('createPanelSettingsController requires document');

      const doc = documentRef;

      /**
       * Opens the settings modal and applies user selections.
       * @returns {Promise<void>}
       */
      const openPanelSettings = async () => {
        ensureDesignSystemStyles(doc);
        let keepOpen = true;
        while (keepOpen) {
          keepOpen = false;
          const settings = panelSettings.get();
          const behavior = {
            autoHideEnabled: settings.behavior?.autoHideEnabled !== false,
            autoHideDelayMs:
              Number(settings.behavior?.autoHideDelayMs) && Number(settings.behavior?.autoHideDelayMs) > 0
                ? Math.round(Number(settings.behavior.autoHideDelayMs))
                : 10000,
            collapseOnOutside: settings.behavior?.collapseOnOutside !== false,
            collapseOnFocus: settings.behavior?.collapseOnFocus === true,
            allowDrag: settings.behavior?.allowDrag !== false,
            allowResize: settings.behavior?.allowResize !== false,
          };

          const grid = doc.createElement('div');
          grid.className = 'gmh-settings-grid';

          /**
           * @param {{ id: string; label: string; description?: string; control: HTMLElement }} config
           * @returns {{ row: HTMLElement; control: HTMLElement; controls: HTMLElement }}
           */
          const buildRow = ({ id, label, description, control }) => {
            const row = doc.createElement('div');
            row.className = 'gmh-settings-row';
            const main = doc.createElement('div');
            main.className = 'gmh-settings-row__main';
            const labelEl = doc.createElement('div');
            labelEl.className = 'gmh-settings-row__label';
            labelEl.textContent = label;
            main.appendChild(labelEl);
            if (description) {
              const desc = doc.createElement('div');
              desc.className = 'gmh-settings-row__description';
              desc.textContent = description;
              main.appendChild(desc);
            }
            row.appendChild(main);
            control.id = id;
            const controls = doc.createElement('div');
            controls.style.display = 'flex';
            controls.style.alignItems = 'center';
            controls.style.gap = '8px';
            controls.appendChild(control);
            row.appendChild(controls);
            return { row, control, controls };
          };

          const autoHideToggle = doc.createElement('input');
          autoHideToggle.type = 'checkbox';
          autoHideToggle.checked = behavior.autoHideEnabled;
          const autoHideDelay = doc.createElement('input');
          autoHideDelay.type = 'number';
          autoHideDelay.min = '5';
          autoHideDelay.max = '60';
          autoHideDelay.step = '1';
          autoHideDelay.value = `${Math.round(behavior.autoHideDelayMs / 1000)}`;
          autoHideDelay.disabled = !behavior.autoHideEnabled;
          const delayUnit = doc.createElement('span');
          delayUnit.textContent = '초';
          delayUnit.style.fontSize = '12px';
          delayUnit.style.color = 'var(--gmh-muted)';

          autoHideToggle.addEventListener('change', () => {
            autoHideDelay.disabled = !autoHideToggle.checked;
          });

          const autoHideRow = buildRow({
            id: 'gmh-settings-autohide',
            label: '자동 접힘',
            description: '패널이 유휴 상태로 유지되면 자동으로 접습니다.',
            control: autoHideToggle,
          });
          autoHideRow.controls.appendChild(autoHideDelay);
          autoHideRow.controls.appendChild(delayUnit);
          grid.appendChild(autoHideRow.row);

          const collapseOutsideToggle = doc.createElement('input');
          collapseOutsideToggle.type = 'checkbox';
          collapseOutsideToggle.checked = behavior.collapseOnOutside;
          grid.appendChild(
            buildRow({
              id: 'gmh-settings-collapse-outside',
              label: '밖을 클릭하면 접기',
              description: '패널 외부를 클릭하면 곧바로 접습니다. ⚠️ 모바일에서는 비활성화 권장',
              control: collapseOutsideToggle,
            }).row,
          );

          const focusModeToggle = doc.createElement('input');
          focusModeToggle.type = 'checkbox';
          focusModeToggle.checked = behavior.collapseOnFocus;
          grid.appendChild(
            buildRow({
              id: 'gmh-settings-focus-collapse',
              label: '집중 모드',
              description: '입력 필드나 버튼에 포커스가 이동하면 패널을 접습니다.',
              control: focusModeToggle,
            }).row,
          );

          const dragToggle = doc.createElement('input');
          dragToggle.type = 'checkbox';
          dragToggle.checked = behavior.allowDrag;
          grid.appendChild(
            buildRow({
              id: 'gmh-settings-drag',
              label: '드래그 이동',
              description: '상단 그립으로 패널 위치를 조정할 수 있습니다.',
              control: dragToggle,
            }).row,
          );

          const resizeToggle = doc.createElement('input');
          resizeToggle.type = 'checkbox';
          resizeToggle.checked = behavior.allowResize;
          grid.appendChild(
            buildRow({
              id: 'gmh-settings-resize',
              label: '크기 조절',
              description: '우측 하단 손잡이로 패널 크기를 바꿉니다.',
              control: resizeToggle,
            }).row,
          );

          const modalResult = await modal.open({
            title: 'GMH 설정',
            size: 'large',
            content: grid,
            initialFocus: '#gmh-settings-autohide',
            actions: [
              {
                id: 'privacy',
                label: '민감어 관리',
                variant: 'secondary',
                value: 'privacy',
              },
              {
                id: 'reset',
                label: '기본값 복원',
                variant: 'secondary',
                value: 'reset',
              },
              {
                id: 'save',
                label: '저장',
                variant: 'primary',
                value: 'save',
              },
            ],
          });

          if (!modalResult) {
            setPanelStatus('패널 설정 변경을 취소했습니다.', 'muted');
            return;
          }

          if (modalResult === 'privacy') {
            await configurePrivacyLists();
            keepOpen = true;
            continue;
          }

          if (modalResult === 'reset') {
            panelSettings.reset();
            setPanelStatus('패널 설정을 기본값으로 되돌렸습니다.', 'success');
            keepOpen = true;
            continue;
          }

          const delaySeconds = Number(autoHideDelay.value);
          const safeDelay = Number.isFinite(delaySeconds)
            ? Math.min(Math.max(5, Math.round(delaySeconds)), 120)
            : 10;

          panelSettings.update({
            behavior: {
              autoHideEnabled: autoHideToggle.checked,
              autoHideDelayMs: safeDelay * 1000,
              collapseOnOutside: collapseOutsideToggle.checked,
              collapseOnFocus: focusModeToggle.checked,
              allowDrag: dragToggle.checked,
              allowResize: resizeToggle.checked,
            },
          });

          setPanelStatus('패널 설정을 저장했습니다.', 'success');
        }
      };

      return {
        openPanelSettings,
      };
    }

    /**
     * Composes core UI helpers (modal, panel visibility, status view, privacy controls).
     *
     * @param {object} options - Dependency container.
     * @param {typeof import('../core/namespace.ts').GMH} options.GMH - Global namespace reference.
     * @param {Document} options.documentRef - Document handle.
     * @param {Window} options.windowRef - Window handle.
     * @param {object} options.PanelSettings - Panel settings API.
     * @param {object} options.stateManager - State manager instance.
     * @param {object} options.stateEnum - State enum map.
     * @param {object} options.ENV - Environment shims (console/storage).
     * @param {object} options.privacyConfig - Active privacy configuration object.
     * @param {object} options.privacyProfiles - Privacy profile definitions.
     * @param {Function} options.setCustomList - Setter for custom privacy lists.
     * @param {Function} options.parseListInput - Parser for list inputs.
     * @param {Function} options.isModernUIActive - Getter returning whether modern UI is enabled.
     * @returns {object} Composed UI helpers.
     */
    function composeUI({
      GMH,
      documentRef,
      windowRef,
      PanelSettings,
      stateManager,
      stateEnum,
      ENV,
      privacyConfig,
      privacyProfiles,
      setCustomList,
      parseListInput,
      isModernUIActive,
    }) {
      const modal = createModal({ documentRef, windowRef });
      GMH.UI.Modal = modal;

      const panelVisibility = createPanelVisibility({
        panelSettings: PanelSettings,
        stateEnum,
        stateApi: stateManager,
        modal,
        documentRef,
        windowRef,
        storage: ENV.localStorage,
        logger: ENV.console,
      });

      const statusManager = createStatusManager({ panelVisibility });
      const { setStatus: setPanelStatus, attachStatusElement } = statusManager;

      const stateView = createStateView({
        stateApi: stateManager,
        statusManager,
        stateEnum,
      });
      GMH.UI.StateView = stateView;

      const { configurePrivacyLists } = createPrivacyConfigurator({
        privacyConfig,
        setCustomList,
        parseListInput,
        setPanelStatus,
        modal,
        isModernUIActive,
        documentRef,
        windowRef,
      });

      const { openPanelSettings } = createPanelSettingsController({
        panelSettings: PanelSettings,
        modal,
        setPanelStatus,
        configurePrivacyLists,
        documentRef,
      });

      return {
        modal,
        panelVisibility,
        statusManager,
        setPanelStatus,
        attachStatusElement,
        stateView,
        configurePrivacyLists,
        openPanelSettings,
      };
    }

    /**
     * Sets up panel mounting, boot sequencing, teardown hooks, and mutation observer.
     *
     * @param {object} options - Dependency container.
     * @param {Document} options.documentRef - Document handle.
     * @param {Window} options.windowRef - Window handle.
     * @param {Function} options.mountPanelModern - Modern panel mount function.
     * @param {Function} options.mountPanelLegacy - Legacy panel mount function.
     * @param {Function} options.isModernUIActive - Getter describing whether modern UI is active.
     * @param {object} options.Flags - Feature flags.
     * @param {object} options.errorHandler - Error handler instance.
     * @param {object} options.messageIndexer - Message indexer reference.
     * @param {object} options.bookmarkListener - Bookmark listener reference.
     */
    function setupBootstrap({
      documentRef,
      windowRef,
      mountPanelModern,
      mountPanelLegacy,
      isModernUIActive,
      Flags,
      errorHandler,
      messageIndexer,
      bookmarkListener,
    }) {
      const doc = documentRef;
      const win = windowRef;
      const MutationObserverCtor = win.MutationObserver || globalThis.MutationObserver;
      const requestFrame = typeof win.requestAnimationFrame === 'function'
        ? win.requestAnimationFrame.bind(win)
        : (cb) => setTimeout(cb, 16);

      let panelMounted = false;
      let bootInProgress = false;
      let observerScheduled = false;

      const mountPanel = () => {
        if (isModernUIActive()) {
          mountPanelModern();
        } else {
          if (Flags.killSwitch) {
            const level = errorHandler.LEVELS?.INFO || 'info';
            errorHandler.handle('modern UI disabled by kill switch', 'ui/panel', level);
          }
          mountPanelLegacy();
        }
      };

      const boot = () => {
        if (panelMounted || bootInProgress) return;
        bootInProgress = true;
        try {
          mountPanel();
          messageIndexer?.start?.();
          bookmarkListener?.start?.();
          panelMounted = Boolean(doc.querySelector('#genit-memory-helper-panel'));
        } catch (e) {
          const level = errorHandler.LEVELS?.ERROR || 'error';
          errorHandler.handle(e, 'ui/panel', level);
        } finally {
          bootInProgress = false;
        }
      };

      const registerReadyHook = () => {
        if (doc.readyState === 'complete' || doc.readyState === 'interactive') {
          setTimeout(boot, 1200);
        } else {
          win.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1200));
        }
      };

      const registerTeardown = () => {
        if (win.__GMHTeardownHook) return;
        const teardown = () => {
          panelMounted = false;
          bootInProgress = false;
          try {
            bookmarkListener?.stop?.();
          } catch (err) {
            const level = errorHandler.LEVELS?.WARN || 'warn';
            errorHandler.handle(err, 'bookmark', level);
          }
          try {
            messageIndexer?.stop?.();
          } catch (err) {
            const level = errorHandler.LEVELS?.WARN || 'warn';
            errorHandler.handle(err, 'adapter', level);
          }
        };
        win.addEventListener('pagehide', teardown);
        win.addEventListener('beforeunload', teardown);
        win.__GMHTeardownHook = true;
      };

      const registerMutationObserver = () => {
        if (!MutationObserverCtor) return;
        const observer = new MutationObserverCtor(() => {
          if (observerScheduled || bootInProgress) return;
          observerScheduled = true;
          requestFrame(() => {
            observerScheduled = false;
            const panelNode = doc.querySelector('#genit-memory-helper-panel');
            if (panelNode) {
              panelMounted = true;
              return;
            }
            panelMounted = false;
            boot();
          });
        });
        observer.observe(doc.documentElement || doc.body, { subtree: true, childList: true });
      };

      registerReadyHook();
      registerTeardown();
      registerMutationObserver();

      return { boot, mountPanel };
    }

    (function () {

      const PAGE_WINDOW =
        ENV.window || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
      const detectScriptVersion = () => {
        const gmInfo = ENV.GM_info;
        const version = gmInfo?.script?.version;
        if (typeof version === 'string' && version.trim()) {
          return version.trim();
        }
        return '0.0.0-dev';
      };

      const scriptVersion = detectScriptVersion();

      GMH.VERSION = scriptVersion;

      const {
        getActiveAdapter,
        updatePlayerNames,
      } = composeAdapters({
        GMH,
        adapterRegistry,
        registerAdapterConfig,
        getAdapterSelectors,
        getAdapterMetadata,
        listAdapterNames,
        createGenitAdapter,
        errorHandler: GMH.Core?.ErrorHandler,
        getPlayerNames,
        setPlayerNames,
        PLAYER_NAME_FALLBACKS,
      });
      updatePlayerNames();
      const buildExportBundle$1 = (
        session,
        normalizedRaw,
        format,
        stamp,
        options = {},
      ) =>
        buildExportBundle(session, normalizedRaw, format, stamp, {
          playerNames: getPlayerNames(),
          playerMark: PLAYER_MARK,
          ...options,
        });

      const buildExportManifest$1 = (params) =>
        buildExportManifest({ ...params, version: GMH.VERSION });

      const toJSONExportLegacy = withPlayerNames(getPlayerNames, toJSONExport);

      const toStructuredMarkdownLegacy = (options = {}) =>
        toStructuredMarkdown({
          playerNames: getPlayerNames(),
          playerMark: PLAYER_MARK,
          ...options,
        });

      const toStructuredJSONLegacy = (options = {}) =>
        toStructuredJSON({
          playerNames: getPlayerNames(),
          ...options,
        });

      const toStructuredTXTLegacy = (options = {}) =>
        toStructuredTXT({
          playerNames: getPlayerNames(),
          ...options,
        });

      const PanelSettings = createPanelSettings({
        clone,
        deepMerge,
        storage: ENV.localStorage,
        logger: ENV.console,
      });

      GMH.Settings = {
        panel: {
          get: () => PanelSettings.get(),
          update: (patch) => PanelSettings.update(patch),
          reset: () => PanelSettings.reset(),
          defaults: PanelSettings.defaults,
          STORAGE_KEY: PanelSettings.STORAGE_KEY,
        },
      };

      const exportRange = createExportRange({
        console: ENV.console,
        window: PAGE_WINDOW,
        localStorage: ENV.localStorage,
      });

      GMH.Core.ExportRange = exportRange;

      const turnBookmarks = createTurnBookmarks({ console: ENV.console });
      GMH.Core.TurnBookmarks = turnBookmarks;

      const messageIndexer = createMessageIndexer({
        console: ENV.console,
        document,
        MutationObserver: typeof MutationObserver !== 'undefined' ? MutationObserver : undefined,
        requestAnimationFrame:
          typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined,
        exportRange,
        getActiveAdapter: () => getActiveAdapter(),
        getEntryOrigin: () => getSnapshotEntryOrigin(),
      });

      GMH.Core.MessageIndexer = messageIndexer;

      const bookmarkListener = createBookmarkListener({
        document,
        ElementClass: typeof Element !== 'undefined' ? Element : undefined,
        messageIndexer,
        turnBookmarks,
        console: ENV.console,
      });

      GMH.Core.BookmarkListener = bookmarkListener;

      if (!PAGE_WINDOW.__GMHBookmarkListener) {
        try {
          Object.defineProperty(PAGE_WINDOW, '__GMHBookmarkListener', {
            value: bookmarkListener,
            writable: false,
            configurable: false,
          });
        } catch (err) {
          PAGE_WINDOW.__GMHBookmarkListener = bookmarkListener;
        }
      }

      const Flags = (() => {
        let betaQuery = false;
        try {
          const params = new URLSearchParams(location.search || '');
          betaQuery = params.has('gmhBeta');
        } catch (err) {
          betaQuery = false;
        }
        const storedNewUI = (() => {
          try {
            return localStorage.getItem('gmh_flag_newUI');
          } catch (err) {
            return null;
          }
        })();
        const storedKill = (() => {
          try {
            return localStorage.getItem('gmh_kill');
          } catch (err) {
            return null;
          }
        })();
        const newUI = storedNewUI === '1' || betaQuery;
        const killSwitch = storedKill === '1';
        return {
          newUI,
          killSwitch,
          betaQuery,
        };
      })();

      GMH.Flags = Flags;

      const isModernUIActive = Flags.newUI && !Flags.killSwitch;

      const stateManager = createStateManager({
        console: ENV.console,
        debug: (...args) => {
          if (isModernUIActive && typeof ENV.console?.debug === 'function') {
            ENV.console.debug('[GMH]', ...args);
          }
        },
      });

      GMH.Core.STATE = GMH_STATE;
      GMH.Core.State = stateManager;

      const errorHandler = createErrorHandler({
        console: ENV.console,
        alert: typeof alert === 'function' ? alert : undefined,
        localStorage: ENV.localStorage,
        state: stateManager,
      });

      GMH.Core.ErrorHandler = errorHandler;

      const ensureDefaultUIFlag = () => {
        try {
          const storage = ENV.localStorage || localStorage;
          if (!storage) return;
          const killSwitchEnabled = storage.getItem('gmh_kill') === '1';
          if (killSwitchEnabled) return;
          const currentValue = storage.getItem('gmh_flag_newUI');
          if (currentValue !== '1') {
            storage.setItem('gmh_flag_newUI', '1');
          }
        } catch (err) {
          const level = errorHandler.LEVELS?.WARN || 'warn';
          errorHandler.handle(err, 'storage/write', level);
        }
      };

      ensureDefaultUIFlag();

      // -------------------------------
      // 0) Privacy composition
      // -------------------------------
      const {
        privacyConfig: PRIVACY_CFG,
        setPrivacyProfile: setPrivacyProfileInternal,
        setCustomList: setCustomListInternal,
        applyPrivacyPipeline,
        boundRedactText,
      } = composePrivacy({
        createPrivacyStore,
        createPrivacyPipeline,
        PRIVACY_PROFILES,
        DEFAULT_PRIVACY_PROFILE,
        collapseSpaces,
        privacyRedactText: redactText,
        hasMinorSexualContext,
        getPlayerNames,
        ENV,
        errorHandler,
      });

      let syncPrivacyProfileSelect = () => {};

      const setPrivacyProfile = (profileKey) => {
        setPrivacyProfileInternal(profileKey);
        syncPrivacyProfileSelect(profileKey);
      };

      const setCustomList = (type, items) => {
        setCustomListInternal(type, items);
      };

      const {
        panelVisibility: PanelVisibility,
        setPanelStatus,
        attachStatusElement,
        stateView,
        configurePrivacyLists,
        openPanelSettings,
      } = composeUI({
        GMH,
        documentRef: document,
        windowRef: PAGE_WINDOW,
        PanelSettings,
        stateManager,
        stateEnum: GMH_STATE,
        ENV,
        privacyConfig: PRIVACY_CFG,
        privacyProfiles: PRIVACY_PROFILES,
        setCustomList,
        parseListInput,
        isModernUIActive: () => isModernUIActive,
      });

      GMH.UI.StateView = stateView;

      const { describeNode, downloadDomSnapshot } = createSnapshotFeature({
        getActiveAdapter: () => getActiveAdapter(),
        triggerDownload,
        setPanelStatus,
        errorHandler: GMH.Core.ErrorHandler,
        documentRef: document,
        locationRef: location,
      });

      const {
        captureStructuredSnapshot,
        readTranscriptText,
        projectStructuredMessages,
        readStructuredMessages,
        getEntryOrigin: getSnapshotEntryOrigin,
      } = createStructuredSnapshotReader({
        getActiveAdapter,
        setEntryOriginProvider,
        documentRef: document,
      });

      GMH.Core.getEntryOrigin = () => getSnapshotEntryOrigin();

      const {
        autoLoader,
        autoState: AUTO_STATE,
        startTurnMeter,
        subscribeProfileChange,
        getProfile: getAutoProfile,
      } = createAutoLoader({
        stateApi: stateManager,
        stateEnum: GMH_STATE,
        errorHandler: GMH.Core.ErrorHandler,
        messageIndexer,
        exportRange,
        setPanelStatus,
        getActiveAdapter,
        sleep,
        isScrollable,
        documentRef: document,
        windowRef: PAGE_WINDOW,
        normalizeTranscript,
        buildSession,
        readTranscriptText,
        logger: ENV.console,
      });

      const {
        ensureAutoLoadControlsModern,
        ensureAutoLoadControlsLegacy,
        mountStatusActionsModern,
        mountStatusActionsLegacy,
      } = createAutoLoaderControls({
        documentRef: document,
        autoLoader,
        autoState: AUTO_STATE,
        setPanelStatus,
        startTurnMeter,
        getAutoProfile,
        subscribeProfileChange,
        downloadDomSnapshot,
      });

      const { bindRangeControls } = createRangeControls({
        documentRef: document,
        windowRef: PAGE_WINDOW,
        exportRange,
        turnBookmarks,
        messageIndexer,
        setPanelStatus,
      });

      const { confirm: confirmPrivacyGateLegacy } = createLegacyPrivacyGate({
        documentRef: document,
        formatRedactionCounts,
        privacyProfiles: PRIVACY_PROFILES,
        ensureLegacyPreviewStyles,
        previewLimit: CONFIG.LIMITS.PREVIEW_TURN_LIMIT,
      });

      const { confirm: confirmPrivacyGateModern } = createModernPrivacyGate({
        documentRef: document,
        formatRedactionCounts,
        privacyProfiles: PRIVACY_PROFILES,
        ensureDesignSystemStyles,
        modal: GMH.UI.Modal,
        previewLimit: CONFIG.LIMITS.PREVIEW_TURN_LIMIT,
      });

      const confirmPrivacyGate = (options) =>
        (isModernUIActive ? confirmPrivacyGateModern : confirmPrivacyGateLegacy)(options);

      const {
        prepareShare,
        performExport,
        copyRecent: copyRecentShare,
        copyAll: copyAllShare,
        reparse: reparseShare,
        collectSessionStats,
      } = composeShareWorkflow({
        createShareWorkflow,
        captureStructuredSnapshot,
        normalizeTranscript,
        buildSession,
        exportRange,
        projectStructuredMessages,
        applyPrivacyPipeline,
        privacyConfig: PRIVACY_CFG,
        privacyProfiles: PRIVACY_PROFILES,
        formatRedactionCounts,
        setPanelStatus,
        toMarkdownExport,
        toJSONExport: toJSONExportLegacy,
        toTXTExport,
        toStructuredMarkdown: toStructuredMarkdownLegacy,
        toStructuredJSON: toStructuredJSONLegacy,
        toStructuredTXT: toStructuredTXTLegacy,
        buildExportBundle: buildExportBundle$1,
        buildExportManifest: buildExportManifest$1,
        triggerDownload,
        clipboard: { set: (value, options) => ENV.GM_setClipboard(value, options) },
        stateApi: GMH.Core.State,
        stateEnum: GMH.Core.STATE,
        confirmPrivacyGate,
        getEntryOrigin: () => getSnapshotEntryOrigin?.(),
        logger: ENV.console,
      });


      const { copySummaryGuide, copyResummaryGuide } = createGuidePrompts({
        clipboard: { set: (value, options) => ENV.GM_setClipboard(value, options) },
        setPanelStatus,
      });

      const { bindGuideControls } = createGuideControls({
        reparse: reparseShare,
        copySummaryGuide,
        copyResummaryGuide,
        logger: ENV.console,
      });


      const { bindShortcuts } = createPanelShortcuts({
        windowRef: PAGE_WINDOW,
        panelVisibility: PanelVisibility,
        autoLoader,
        autoState: AUTO_STATE,
        configurePrivacyLists,
        modal: GMH.UI.Modal,
      });


      const {
        bindPanelInteractions,
        syncPrivacyProfileSelect: syncPrivacyProfileSelectFromUI,
      } = createPanelInteractions({
        panelVisibility: PanelVisibility,
        setPanelStatus,
        setPrivacyProfile,
        getPrivacyProfile: () => PRIVACY_CFG.profile,
        privacyProfiles: PRIVACY_PROFILES,
        configurePrivacyLists,
        openPanelSettings,
        ensureAutoLoadControlsModern,
        ensureAutoLoadControlsLegacy,
        mountStatusActionsModern,
        mountStatusActionsLegacy,
        bindRangeControls,
        bindShortcuts,
        bindGuideControls,
        prepareShare,
        performExport,
        copyRecentShare,
        copyAllShare,
        autoLoader,
        autoState: AUTO_STATE,
        stateApi: GMH.Core.State,
        stateEnum: GMH.Core.STATE,
        alert: typeof alert === 'function' ? alert : undefined,
        logger: ENV.console,
      });

      syncPrivacyProfileSelect = (profileKey) => {
        syncPrivacyProfileSelectFromUI(profileKey);
      };

      const { mount: mountPanelModern } = createModernPanel({
        documentRef: document,
        ensureStyles: ensureDesignSystemStyles,
        version: GMH.VERSION,
        getActiveAdapter: () => getActiveAdapter(),
        attachStatusElement,
        stateView: GMH.UI.StateView,
        bindPanelInteractions,
        logger: ENV.console,
      });

      const { mount: mountPanelLegacy } = createLegacyPanel({
        documentRef: document,
        getActiveAdapter: () => getActiveAdapter(),
        attachStatusElement,
        setPanelStatus,
        stateView: GMH.UI.StateView,
        bindPanelInteractions,
      });
      const { mountPanel } = setupBootstrap({
        documentRef: document,
        windowRef: PAGE_WINDOW,
        mountPanelModern,
        mountPanelLegacy,
        isModernUIActive: () => isModernUIActive,
        Flags,
        errorHandler,
        messageIndexer,
        bookmarkListener,
      });

      if (!PAGE_WINDOW.__GMHTest) {
        Object.defineProperty(PAGE_WINDOW, '__GMHTest', {
          value: {
            runPrivacyCheck(rawText, profileKey = 'safe') {
              try {
                const normalized = normalizeTranscript(rawText || '');
                const session = buildSession(normalized);
                return applyPrivacyPipeline(session, normalized, profileKey, null);
              } catch (error) {
                const level = errorHandler.LEVELS?.ERROR || 'error';
                errorHandler.handle(error, 'privacy/redact', level);
                return { error: error?.message || String(error) };
              }
            },
            profiles: PRIVACY_PROFILES,
            formatCounts: formatRedactionCounts,
          },
          writable: false,
          configurable: false,
        });
      }

      Object.assign(GMH.Util, {
        normNL,
        stripTicks,
        collapseSpaces,
        stripQuotes,
        stripBrackets,
        sanitizeText,
        parseListInput,
        luhnValid,
        escapeForRegex,
        describeNode,
      });

      Object.assign(GMH.Privacy, {
        profiles: PRIVACY_PROFILES,
        config: PRIVACY_CFG,
        setPrivacyProfile,
        setCustomList,
        applyPrivacyPipeline,
        redactText: boundRedactText,
        hasMinorSexualContext,
        formatRedactionCounts,
      });

      Object.assign(GMH.Export, {
        toJSONExport: toJSONExportLegacy,
        toTXTExport,
        toMarkdownExport,
        toStructuredJSON: toStructuredJSONLegacy,
        toStructuredMarkdown: toStructuredMarkdownLegacy,
        toStructuredTXT: toStructuredTXTLegacy,
        buildExportBundle: buildExportBundle$1,
        buildExportManifest: buildExportManifest$1,
      });

      Object.assign(GMH.UI, {
        mountPanel,
        setPanelStatus,
        configurePrivacyLists,
        openPanelSettings,
        openPanel: (options) => PanelVisibility.open(options),
        closePanel: (reason) => PanelVisibility.close(reason),
        togglePanel: () => PanelVisibility.toggle(),
        isPanelCollapsed: () => PanelVisibility.isCollapsed(),
      });

      Object.assign(GMH.Core, {
        getAdapter: getActiveAdapter,
        readTranscriptText,
        captureStructuredSnapshot,
        readStructuredMessages,
        projectStructuredMessages,
        normalizeTranscript,
        parseTurns,
        buildSession,
        collectSessionStats,
        autoLoader,
        MessageIndexer: messageIndexer,
        BookmarkListener: bookmarkListener,
      });

      if (!PAGE_WINDOW.GMH) {
        try {
          Object.defineProperty(PAGE_WINDOW, 'GMH', {
            value: GMH,
            writable: false,
            configurable: false,
          });
        } catch (err) {
          const level = errorHandler.LEVELS?.WARN || 'warn';
          errorHandler.handle(err, 'ui/panel', level);
        }
      }
    })();

    exports.ENV = ENV;
    exports.GMH = GMH;

    return exports;

})({});
