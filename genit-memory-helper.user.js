// ==UserScript==
// @name         Genit Memory Helper
// @namespace    local.dev
// @version      2.1.1
// @description  AI 챗봇 대화 로그 추출 및 백업 도구 (JSON/Markdown/TXT Export + LLM 요약 프롬프트)
// @author       devforai-creator
// @match        https://genit.ai/*
// @match        https://www.genit.ai/*
// @match        https://babechat.ai/*
// @match        https://www.babechat.ai/*
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
        Settings: createModuleBucket(),
        Flags: createModuleBucket(),
    };

    const noop$8 = () => { };
    const fallbackClipboard = (text) => {
        if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(text).catch(noop$8);
        }
    };
    const detectWindow = (globals) => {
        if (globals.unsafeWindow)
            return globals.unsafeWindow;
        if (typeof window !== 'undefined')
            return window;
        return undefined;
    };
    const detectGMInfo = (globals) => {
        if (globals.GM_info?.script) {
            return globals.GM_info;
        }
        return {
            script: {
                name: 'genit-memory-helper',
                version: '0.0.0-dev',
            },
        };
    };
    const detectClipboard = (globals) => {
        if (typeof globals.GM_setClipboard === 'function') {
            return globals.GM_setClipboard.bind(globals);
        }
        return fallbackClipboard;
    };
    const detectConsole = () => {
        if (typeof console !== 'undefined')
            return console;
        return {
            log: noop$8,
            warn: noop$8,
            error: noop$8,
            debug: noop$8,
        };
    };
    const detectStorage = () => {
        if (typeof localStorage !== 'undefined')
            return localStorage;
        return undefined;
    };
    const globals = globalThis;
    const ENV = {
        window: detectWindow(globals),
        GM_setClipboard: detectClipboard(globals),
        GM_info: detectGMInfo(globals),
        console: detectConsole(),
        localStorage: detectStorage(),
    };

    const EXPERIMENTAL_STORAGE_PREFIX = 'gmh_experimental_';
    const MEMORY_INDEX_STORAGE_KEY = `${EXPERIMENTAL_STORAGE_PREFIX}memory`;
    const selectStorage = (storage) => {
        if (storage)
            return storage;
        if (ENV.localStorage)
            return ENV.localStorage;
        if (typeof localStorage !== 'undefined')
            return localStorage;
        return null;
    };
    const selectConsole$3 = (consoleRef) => {
        if (consoleRef)
            return consoleRef;
        if (ENV.console)
            return ENV.console;
        if (typeof console !== 'undefined')
            return console;
        return null;
    };
    const createBooleanFlag = (key, label, storage, consoleRef) => {
        const readEnabled = () => {
            if (!storage)
                return false;
            try {
                return storage.getItem(key) === '1';
            }
            catch (err) {
                consoleRef?.warn?.(`[GMH] Failed to read ${label} flag`, err);
                return false;
            }
        };
        const write = (setter) => {
            if (!storage) {
                consoleRef?.warn?.(`[GMH] Experimental flag "${label}" requires localStorage support. Operation skipped.`);
                return false;
            }
            try {
                setter(storage);
                return true;
            }
            catch (err) {
                consoleRef?.warn?.(`[GMH] Failed to update ${label} flag`, err);
                return false;
            }
        };
        return {
            get enabled() {
                return readEnabled();
            },
            enable() {
                const result = write((store) => {
                    store.setItem(key, '1');
                });
                if (result) {
                    consoleRef?.log?.(`[GMH] ${label} experimental flag enabled. Reload required.`);
                }
                return result;
            },
            disable() {
                const result = write((store) => {
                    store.removeItem(key);
                });
                if (result) {
                    consoleRef?.log?.(`[GMH] ${label} experimental flag disabled. Reload recommended.`);
                }
                return result;
            },
        };
    };
    const createExperimentalNamespace = (options = {}) => {
        const storage = selectStorage(options.storage ?? null);
        const consoleRef = selectConsole$3(options.console ?? null);
        return {
            MemoryIndex: createBooleanFlag(MEMORY_INDEX_STORAGE_KEY, 'Memory Index', storage, consoleRef),
        };
    };
    const GMHExperimental = createExperimentalNamespace();

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

    const noop$7 = () => { };
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
        const logger = consoleLike ?? defaultConsole ?? { warn: noop$7, error: noop$7 };
        const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop$7;
        const error = typeof logger.error === 'function' ? logger.error.bind(logger) : noop$7;
        const debugLog = typeof debug === 'function' ? debug : noop$7;
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
                    return noop$7;
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

    const noop$6 = () => { };
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
        return { info: noop$6, warn: noop$6, error: noop$6 };
    };
    const createErrorHandler = ({ console: consoleLike, alert: alertImpl, localStorage, state, } = {}) => {
        const logger = ensureConsole(consoleLike);
        const info = typeof logger.info === 'function' ? logger.info.bind(logger) : noop$6;
        const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop$6;
        const error = typeof logger.error === 'function' ? logger.error.bind(logger) : noop$6;
        const alertFn = typeof alertImpl === 'function' ? alertImpl : noop$6;
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
            const label = (context ? ERROR_CONTEXT_LABELS[context] : undefined) || '오류 발생';
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
            const label = (context ? ERROR_CONTEXT_LABELS[context] : undefined) || '오류';
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

    const noop$5 = () => { };
    const createExportRange = ({ console: consoleLike, window: windowLike, localStorage, } = {}) => {
        const defaultConsole = typeof console !== 'undefined' ? console : null;
        const logger = consoleLike ?? defaultConsole ?? {};
        const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop$5;
        const table = typeof logger.table === 'function'
            ? logger.table.bind(logger)
            : noop$5;
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
                    return noop$5;
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

    const noop$4 = () => { };
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
        const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop$4;
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
                    return noop$4;
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

    const noop$3 = () => { };
    const cloneSummary = (summary) => ({ ...summary });
    const toIterableElements = (nodes) => Array.from(nodes).filter((node) => node instanceof Element);
    const isPreviewMessageNode = (node) => {
        if (!(node instanceof Element))
            return false;
        const rawId = node.getAttribute('data-message-id') ||
            node.getAttribute('data-id') ||
            node.getAttribute('id') ||
            '';
        if (!rawId)
            return false;
        const normalized = rawId.trim().toLowerCase();
        return normalized.startsWith('preview-');
    };
    const createMessageIndexer = ({ console: consoleLike, document: documentLike, MutationObserver: MutationObserverLike, requestAnimationFrame: rafLike, exportRange, getActiveAdapter, getEntryOrigin, } = {}) => {
        const logger = consoleLike ??
            (typeof console !== 'undefined' ? console : {});
        const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop$3;
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
        const messageListeners = new Set();
        let knownMessages = new WeakSet();
        let lastContainer = null;
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
            const rawBlocks = Array.isArray(blockNodes)
                ? toIterableElements(blockNodes)
                : blockNodes
                    ? toIterableElements(blockNodes)
                    : [];
            const blocks = rawBlocks.filter((block) => !isPreviewMessageNode(block));
            if (!container) {
                knownMessages = new WeakSet();
                lastContainer = null;
            }
            else if (container !== lastContainer) {
                knownMessages = new WeakSet();
                lastContainer = container;
            }
            let userMessageCount = 0;
            ordinalCacheByIndex.clear();
            ordinalCacheById.clear();
            const newBlocks = [];
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
                    if (isPreviewMessageNode(block)) {
                        block.removeAttribute('data-gmh-message');
                        block.removeAttribute('data-gmh-message-id');
                        block.removeAttribute('data-gmh-message-index');
                        block.removeAttribute('data-gmh-message-role');
                        block.removeAttribute('data-gmh-channel');
                        block.removeAttribute('data-gmh-user-ordinal');
                        return;
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
                    if (!knownMessages.has(block)) {
                        knownMessages.add(block);
                        newBlocks.push(block);
                    }
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
            if (newBlocks.length && messageListeners.size) {
                const timestamp = Date.now();
                const events = [];
                newBlocks.forEach((block) => {
                    if (isPreviewMessageNode(block)) {
                        return;
                    }
                    const ordinalAttr = Number(block.getAttribute('data-gmh-message-ordinal'));
                    if (!Number.isFinite(ordinalAttr))
                        return;
                    const indexAttr = Number(block.getAttribute('data-gmh-message-index'));
                    const messageId = block.getAttribute('data-gmh-message-id') || null;
                    const channelAttr = block.getAttribute('data-gmh-channel') || null;
                    events.push({
                        element: block,
                        ordinal: ordinalAttr,
                        index: Number.isFinite(indexAttr) ? indexAttr : -1,
                        messageId,
                        channel: channelAttr,
                        timestamp,
                    });
                });
                if (events.length) {
                    events.forEach((event) => {
                        messageListeners.forEach((listener) => {
                            try {
                                listener(event);
                            }
                            catch (err) {
                                warn('[GMH] message event listener failed', err);
                            }
                        });
                    });
                }
            }
            const entryOrigin = getOrigins() || [];
            const entryOriginIndices = Array.isArray(entryOrigin)
                ? entryOrigin.filter((idx) => typeof idx === 'number' && Number.isInteger(idx) && idx >= 0)
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
                knownMessages = new WeakSet();
                lastContainer = null;
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
                    return noop$3;
                listeners.add(listener);
                try {
                    listener(cloneSummary(lastSummary));
                }
                catch (err) {
                    warn('[GMH] index subscriber failed', err);
                }
                return () => listeners.delete(listener);
            },
            subscribeMessages(listener) {
                if (typeof listener !== 'function')
                    return noop$3;
                messageListeners.add(listener);
                return () => messageListeners.delete(listener);
            },
        };
        return api;
    };

    const noop$2 = () => { };
    const resolveDocument = (doc) => doc ?? (typeof document !== 'undefined' ? document : undefined);
    const resolveElementClass = (ElementClass) => ElementClass ?? (typeof Element !== 'undefined' ? Element : undefined);
    const resolveConsole = (consoleLike) => consoleLike ?? (typeof console !== 'undefined' ? console : {});
    const resolveMessageIndexer = (indexer) => indexer ?? null;
    const resolveTurnBookmarks = (bookmarks) => bookmarks ?? null;
    const ensureWarn = (logger) => typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop$2;
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

    const DEFAULT_PLAYER_MARK$2 = '⟦PLAYER⟧ ';
    const createGenitAdapter = ({ registry = adapterRegistry, playerMark = DEFAULT_PLAYER_MARK$2, getPlayerNames = () => [], isPrologueBlock = () => false, errorHandler, } = {}) => {
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
            }) ?? null;
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
            return nodes.find((node) => isScrollable(node)) ?? null;
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
            let name = nameNode?.getAttribute?.('data-author-name') ?? nameNode?.textContent ?? null;
            if (!name) {
                name =
                    group.getAttribute('data-author') ??
                        group.getAttribute('data-username') ??
                        group.getAttribute('data-name') ??
                        null;
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
            const knownLabels = new Set([collector?.defaults?.playerName, ...playerNames]
                .filter((name) => typeof name === 'string' && name.trim().length > 0)
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
            const collectorPlayerName = collector?.defaults?.playerName ?? playerGuess;
            const speaker = firstSpeakerPart?.speaker ||
                (role === 'player'
                    ? collectorPlayerName
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

    const DEFAULT_PLAYER_MARK$1 = '⟦PLAYER⟧ ';
    const createBabechatAdapter = ({ registry = adapterRegistry, playerMark = DEFAULT_PLAYER_MARK$1, getPlayerNames = () => [], errorHandler, } = {}) => {
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
        const adapterConfig = registryGet('babechat');
        const selectors = adapterConfig.selectors || {};
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
        const collectAll = (selList, root = document) => {
            const out = [];
            const seen = new Set();
            if (!selList?.length)
                return out;
            for (const sel of selList) {
                if (!sel)
                    continue;
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
        const textFromNode = (node) => {
            if (!node)
                return '';
            if (node instanceof HTMLElement) {
                return (node.innerText ?? node.textContent ?? '').trim();
            }
            return (node.textContent ?? '').trim();
        };
        const textSegmentsFromNode = (node) => {
            const text = textFromNode(node);
            if (!text)
                return [];
            return text
                .split(/\r?\n+/)
                .map((seg) => seg.trim())
                .filter(Boolean);
        };
        const findScrollableAncestor = (node) => {
            let current = node instanceof Element ? node : null;
            for (let depth = 0; depth < 10 && current; depth += 1) {
                if (isScrollable(current))
                    return current;
                current = current.parentElement;
            }
            return null;
        };
        const getChatContainer = (doc = document) => {
            // Try form > div.overflow-hidden > div structure
            const formContainer = doc.querySelector('form > div.overflow-hidden > div');
            if (formContainer)
                return formContainer;
            const overflowContainer = doc.querySelector('form > div.overflow-hidden');
            if (overflowContainer)
                return overflowContainer;
            // Fallback to form
            const form = doc.querySelector('form');
            if (form) {
                const scrollable = findScrollableAncestor(form);
                if (scrollable)
                    return scrollable;
                return form;
            }
            return null;
        };
        const getMessageBlocks = (root) => {
            const targetRoot = root || document;
            // Find the container first
            const container = targetRoot instanceof Document
                ? getChatContainer(targetRoot)
                : targetRoot;
            if (!container)
                return [];
            const blocks = [];
            const seen = new Set();
            // 1. Find system message area (div.px-5 without pt-4) - usually first
            const systemAreas = container.querySelectorAll('div.px-5:not(.pt-4)');
            systemAreas.forEach((area) => {
                // Verify it's a system area by checking for AI disclaimer or scenario content
                const hasDisclaimer = area.textContent?.includes('AI') || area.textContent?.includes('기술');
                const hasScenario = area.querySelector('[class*="363636"]') !== null;
                if ((hasDisclaimer || hasScenario) && !seen.has(area)) {
                    seen.add(area);
                    blocks.push(area);
                }
            });
            // 2. Find turn wrappers using selector
            const turns = collectAll(selectors.messageRoot, container);
            turns.forEach((turn) => {
                if (!seen.has(turn)) {
                    seen.add(turn);
                    blocks.push(turn);
                }
            });
            // 3. Fallback: find any element with user/AI content if no turns found
            if (blocks.length === 0) {
                const userMessages = container.querySelectorAll('.justify-end');
                const aiMessages = container.querySelectorAll('a[href*="/character/"]');
                userMessages.forEach((msg) => {
                    const parent = msg.closest('.flex.flex-col') || msg.parentElement;
                    if (parent && !seen.has(parent)) {
                        seen.add(parent);
                        blocks.push(parent);
                    }
                });
                aiMessages.forEach((msg) => {
                    const parent = msg.closest('.flex.flex-col') || msg.parentElement;
                    if (parent && !seen.has(parent)) {
                        seen.add(parent);
                        blocks.push(parent);
                    }
                });
            }
            return blocks;
        };
        const isSystemMessageArea = (block) => {
            // System message area is div.px-5 without pt-4
            return block.classList.contains('px-5') && !block.classList.contains('pt-4');
        };
        const detectRole = (block) => {
            if (!block)
                return 'unknown';
            // Check for system message area (first child with special structure)
            if (isSystemMessageArea(block)) {
                return 'system';
            }
            // Check for user message (has justify-end child)
            const hasJustifyEnd = block.querySelector('.justify-end') !== null;
            if (hasJustifyEnd) {
                // Make sure it's not a system message disguised
                const hasUserBubble = block.querySelector('[class*="B56576"]') !== null;
                if (hasUserBubble)
                    return 'player';
            }
            // Check for AI message (has avatar link)
            const hasAvatarLink = block.querySelector('a[href*="/character/"]') !== null;
            if (hasAvatarLink)
                return 'npc';
            // Check for system/narration only message
            const hasNarrationBg = block.querySelector('[class*="363636"]') !== null;
            if (hasNarrationBg && !hasAvatarLink)
                return 'system';
            return 'unknown';
        };
        const isStatusBlock = (text) => {
            // Status blocks contain emoji indicators like 🕐, 🌐, 😶, ❤️, 🎭, 🎒
            return /[🕐🌐😶❤️🎭🎒]/.test(text);
        };
        const extractCharacterName = (block) => {
            // Try to find character name from the small text element
            const nameNode = block.querySelector('.text-\\[0\\.75rem\\], [class*="text-[0.75rem]"]');
            if (nameNode) {
                const name = nameNode.textContent?.trim();
                if (name && name.length < 50)
                    return name;
            }
            // Fallback: extract from avatar link
            const avatarLink = block.querySelector('a[href*="/character/"]');
            if (avatarLink) {
                const href = avatarLink.getAttribute('href') || '';
                // Try to extract name from URL if possible
                const match = href.match(/\/character\/[^/]+\/([^/]+)/);
                if (match)
                    return decodeURIComponent(match[1]).slice(0, 40);
            }
            return 'NPC';
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
        const createStructuredCollector = (defaults = {}, context = {}) => {
            const parts = [];
            const snapshotDefaults = {
                playerName: defaults.playerName || '플레이어',
            };
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
        const buildStructuredPart = (node, context = {}, options = {}) => {
            const baseLines = Array.isArray(options.lines) ? options.lines.slice() : [];
            const part = {
                type: options.type || 'paragraph',
                flavor: context.flavor || 'speech',
                role: context.role || null,
                speaker: context.speaker || null,
                lines: baseLines,
                legacyFormat: options.legacyFormat || context.legacyFormat || null,
            };
            if (Array.isArray(options.legacyLines)) {
                part.legacyLines = options.legacyLines.slice();
            }
            if (!part.lines.length) {
                const fallbackLines = textSegmentsFromNode(node);
                part.lines = fallbackLines;
            }
            return part;
        };
        const emitPlayerLines = (block, pushLine, collector = null) => {
            const role = detectRole(block);
            if (role !== 'player')
                return;
            // Find all user message bubbles (pink background)
            const userBubbles = block.querySelectorAll('[class*="B56576"]');
            const partLines = [];
            const seenTexts = new Set();
            userBubbles.forEach((bubble) => {
                const text = textFromNode(bubble);
                if (!text || seenTexts.has(text))
                    return;
                seenTexts.add(text);
                pushLine(playerMark + text);
                partLines.push(text);
            });
            if (collector && partLines.length) {
                const playerName = collector.defaults?.playerName || '플레이어';
                const part = buildStructuredPart(block, {
                    flavor: 'speech',
                    role: 'player',
                    speaker: playerName,
                    legacyFormat: 'player',
                }, {
                    lines: partLines,
                    legacyFormat: 'player',
                });
                collector.push(part, { node: block });
            }
        };
        const emitNpcLines = (block, pushLine, collector = null) => {
            const role = detectRole(block);
            if (role !== 'npc')
                return;
            const characterName = extractCharacterName(block);
            const seenTexts = new Set();
            const dialogueLines = [];
            const narrationLines = [];
            // Collect all dialogue bubbles (dark background #262727)
            const dialogueBubbles = block.querySelectorAll('[class*="262727"]');
            dialogueBubbles.forEach((bubble) => {
                const text = textFromNode(bubble);
                if (!text || seenTexts.has(text) || isStatusBlock(text))
                    return;
                seenTexts.add(text);
                // Check if text has speaker prefix like "치류 | "
                const speakerMatch = text.match(/^(.+?)\s*\|\s*(.+)$/s);
                if (speakerMatch) {
                    const speaker = speakerMatch[1].trim();
                    const dialogue = speakerMatch[2].trim();
                    pushLine(`@${speaker}@ "${dialogue}"`);
                    dialogueLines.push(dialogue);
                }
                else {
                    pushLine(`@${characterName}@ "${text}"`);
                    dialogueLines.push(text);
                }
            });
            // Collect all narration blocks (gray background #363636)
            const narrationBlocks = block.querySelectorAll('[class*="363636"]');
            narrationBlocks.forEach((narration) => {
                const text = textFromNode(narration);
                if (!text || seenTexts.has(text) || isStatusBlock(text))
                    return;
                seenTexts.add(text);
                pushLine(text); // Narration without speaker prefix
                narrationLines.push(text);
            });
            // Add dialogue parts to collector
            if (collector && dialogueLines.length) {
                const part = buildStructuredPart(block, {
                    flavor: 'speech',
                    role: 'npc',
                    speaker: characterName,
                    legacyFormat: 'npc',
                }, {
                    lines: dialogueLines,
                    legacyFormat: 'npc',
                });
                collector.push(part, { node: block });
            }
            // Add narration parts to collector
            if (collector && narrationLines.length) {
                const part = buildStructuredPart(block, {
                    flavor: 'narration',
                    role: 'narration',
                    speaker: '내레이션',
                    legacyFormat: 'plain',
                }, {
                    lines: narrationLines,
                    legacyFormat: 'plain',
                });
                collector.push(part, { node: block });
            }
        };
        const emitSystemLines = (block, pushLine, collector = null) => {
            const role = detectRole(block);
            if (role !== 'system')
                return;
            const systemLines = [];
            const scenarioLines = [];
            const openingDialogueLines = [];
            const seenTexts = new Set();
            let openingCharacterName = null;
            // Check if this is the system message area (div.px-5)
            if (isSystemMessageArea(block)) {
                // Parse internal structure
                const wrapper = block.children[0];
                if (wrapper) {
                    Array.from(wrapper.children).forEach((child) => {
                        const text = textFromNode(child);
                        if (!text || seenTexts.has(text))
                            return;
                        const className = child.className || '';
                        // AI disclaimer message
                        if (text.includes('AI기술') || text.includes('AI 기술') || className.includes('mx-auto')) {
                            seenTexts.add(text);
                            pushLine(`[SYSTEM] ${text}`);
                            systemLines.push(text);
                        }
                        // Scenario/Prologue (bg-[#363636])
                        else if (className.includes('363636')) {
                            seenTexts.add(text);
                            pushLine(`[시나리오] ${text}`);
                            scenarioLines.push(text);
                        }
                        // Opening AI message (justify-start with dialogue)
                        else if (className.includes('justify-start')) {
                            const dialogueEl = child.querySelector('[class*="262727"]');
                            if (dialogueEl) {
                                const dialogueText = textFromNode(dialogueEl);
                                if (dialogueText && !seenTexts.has(dialogueText)) {
                                    seenTexts.add(dialogueText);
                                    // Extract character name from the opening message element itself
                                    const openingCharName = extractCharacterName(child) || 'NPC';
                                    // Store for collector use later
                                    if (!openingCharacterName) {
                                        openingCharacterName = openingCharName;
                                    }
                                    // Check for speaker prefix like "치류 | "
                                    const speakerMatch = dialogueText.match(/^(.+?)\s*\|\s*(.+)$/s);
                                    if (speakerMatch) {
                                        const speaker = speakerMatch[1].trim();
                                        const dialogue = speakerMatch[2].trim();
                                        if (!openingCharacterName || openingCharacterName === 'NPC') {
                                            openingCharacterName = speaker;
                                        }
                                        pushLine(`@${speaker}@ "${dialogue}"`);
                                        openingDialogueLines.push(dialogue);
                                    }
                                    else {
                                        pushLine(`@${openingCharName}@ "${dialogueText}"`);
                                        openingDialogueLines.push(dialogueText);
                                    }
                                }
                            }
                            // Also check for narration in opening
                            const narrationEl = child.querySelector('[class*="363636"]');
                            if (narrationEl) {
                                const narrationText = textFromNode(narrationEl);
                                if (narrationText && !seenTexts.has(narrationText) && !isStatusBlock(narrationText)) {
                                    seenTexts.add(narrationText);
                                    pushLine(narrationText);
                                    scenarioLines.push(narrationText);
                                }
                            }
                        }
                    });
                }
                // Add parts to collector
                if (collector && systemLines.length) {
                    const part = buildStructuredPart(block, {
                        flavor: 'meta',
                        role: 'system',
                        speaker: 'SYSTEM',
                        legacyFormat: 'meta',
                    }, { lines: systemLines, legacyFormat: 'meta' });
                    collector.push(part, { node: block });
                }
                if (collector && scenarioLines.length) {
                    const part = buildStructuredPart(block, {
                        flavor: 'narration',
                        role: 'narration',
                        speaker: '시나리오',
                        legacyFormat: 'plain',
                    }, { lines: scenarioLines, legacyFormat: 'plain' });
                    collector.push(part, { node: block });
                }
                if (collector && openingDialogueLines.length) {
                    // Use the character name extracted from opening message, not from system block
                    const characterName = openingCharacterName || 'NPC';
                    const part = buildStructuredPart(block, {
                        flavor: 'speech',
                        role: 'npc',
                        speaker: characterName,
                        legacyFormat: 'npc',
                    }, { lines: openingDialogueLines, legacyFormat: 'npc' });
                    collector.push(part, { node: block });
                }
                return;
            }
            // Fallback for other system messages (like standalone narration)
            const partLines = [];
            const text = textFromNode(block);
            if (text && !isStatusBlock(text)) {
                pushLine(`[SYSTEM] ${text}`);
                partLines.push(text);
            }
            if (collector && partLines.length) {
                const part = buildStructuredPart(block, {
                    flavor: 'meta',
                    role: 'system',
                    speaker: 'SYSTEM',
                    legacyFormat: 'meta',
                }, {
                    lines: partLines,
                    legacyFormat: 'meta',
                });
                collector.push(part, { node: block });
            }
        };
        const emitTranscriptLines = (block, pushLine, collector = null) => {
            emitPlayerLines(block, pushLine, collector);
            emitNpcLines(block, pushLine, collector);
            emitSystemLines(block, pushLine, collector);
        };
        const collectStructuredMessage = (block) => {
            if (!block)
                return null;
            const playerGuess = resolvePlayerNames()[0] || '플레이어';
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
                warnWithHandler(err, 'adapter', '[GMH] babechat structured emit failed');
                emitTranscriptLines(block, pushLine);
            }
            const parts = collector.list();
            const role = block?.getAttribute?.('data-gmh-message-role') || detectRole(block) || 'unknown';
            const ordinalAttr = Number(block?.getAttribute?.('data-gmh-message-ordinal'));
            const indexAttr = Number(block?.getAttribute?.('data-gmh-message-index'));
            const idAttr = block?.getAttribute?.('data-gmh-message-id') || null;
            const firstSpeakerPart = parts.find((part) => part?.speaker);
            const collectorPlayerName = collector?.defaults?.playerName ?? playerGuess;
            const speaker = firstSpeakerPart?.speaker ||
                (role === 'player'
                    ? collectorPlayerName
                    : role === 'npc'
                        ? extractCharacterName(block)
                        : null);
            const message = {
                id: idAttr,
                index: Number.isFinite(indexAttr) ? indexAttr : null,
                ordinal: Number.isFinite(ordinalAttr) ? ordinalAttr : null,
                role,
                channel: role === 'player' ? 'user' : role === 'npc' ? 'llm' : 'system',
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
            // babechat.ai doesn't expose player names in DOM easily
            return [];
        };
        const getPanelAnchor = (doc = document) => {
            const anchor = firstMatch(selectors.panelAnchor, doc);
            return anchor || doc.body;
        };
        const match = (loc) => /babechat\.ai/i.test(loc.hostname ?? '');
        const babechatAdapter = {
            id: 'babechat',
            label: 'BabeChat',
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
                // No info registry for babechat adapter
            },
            setPlayerNameAccessor(fn) {
                if (typeof fn === 'function') {
                    playerNameAccessor = fn;
                }
            },
        };
        return babechatAdapter;
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

    const PLAYER_NAME_FALLBACKS = ['플레이어'];
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
            if ((turn.role === 'player' || turn.role === 'npc') && typeof turn.speaker === 'string') {
                actorSet.add(turn.speaker);
            }
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
    const withPlayerNames = (getPlayerNames, exportFn) => {
        return (session, raw, options) => exportFn(session, raw, {
            playerNames: [...getPlayerNames()],
            ...(options ?? {}),
        });
    };

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
.gmh-memory-status__actions{display:flex;justify-content:flex-start;margin-top:10px;}
.gmh-memory-status__button{padding:6px 10px;border-radius:var(--gmh-radius-sm);border:1px solid var(--gmh-border);background:rgba(15,23,42,0.7);color:var(--gmh-fg);font-size:12px;font-weight:600;cursor:pointer;transition:background 0.15s ease,color 0.15s ease;}
.gmh-memory-status__button:hover{background:rgba(56,189,248,0.16);color:#e0f2fe;}
.gmh-memory-status__button:disabled{cursor:not-allowed;opacity:0.5;background:rgba(148,163,184,0.12);color:var(--gmh-muted);}
.gmh-block-viewer{display:grid;gap:16px;}
.gmh-block-viewer__status{margin:0;font-size:13px;color:var(--gmh-muted);text-align:center;}
.gmh-block-viewer__status--error{color:var(--gmh-danger);}
.gmh-block-viewer__header{display:flex;align-items:center;justify-content:space-between;}
.gmh-block-viewer__heading{margin:0;font-size:15px;font-weight:600;color:var(--gmh-fg);}
.gmh-block-viewer__list{display:grid;gap:12px;}
.gmh-block-viewer__item{border:1px solid var(--gmh-border);border-radius:var(--gmh-radius-sm);background:var(--gmh-surface-alt);padding:14px;display:grid;gap:10px;}
.gmh-block-viewer__item-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
.gmh-block-viewer__item-info{display:grid;gap:4px;}
.gmh-block-viewer__item-title{margin:0;font-weight:600;font-size:13px;color:var(--gmh-fg);}
.gmh-block-viewer__meta{margin:0;font-size:12px;color:var(--gmh-muted);}
.gmh-block-viewer__overlap{margin:0;font-size:12px;color:var(--gmh-accent);background:rgba(56,189,248,0.18);padding:2px 8px;border-radius:999px;width:max-content;}
.gmh-block-viewer__toggle{border:1px solid var(--gmh-border);background:rgba(15,23,42,0.72);color:var(--gmh-fg);border-radius:var(--gmh-radius-sm);padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;transition:background 0.15s ease,color 0.15s ease;}
.gmh-block-viewer__toggle:hover{background:rgba(56,189,248,0.16);color:#e0f2fe;}
.gmh-block-viewer__detail{margin-top:4px;padding-top:12px;border-top:1px dashed rgba(148,163,184,0.32);}
.gmh-block-viewer__messages{display:grid;gap:10px;}
.gmh-block-viewer__message{display:grid;gap:6px;padding:10px;border-radius:var(--gmh-radius-sm);background:rgba(15,23,42,0.6);border:1px solid rgba(148,163,184,0.2);}
.gmh-block-viewer__message-title{font-weight:600;font-size:12px;color:var(--gmh-accent);}
.gmh-block-viewer__message-body{font-size:13px;color:var(--gmh-fg);white-space:pre-wrap;word-break:break-word;}
.gmh-block-viewer__message-id{font-size:11px;color:var(--gmh-muted);}
@media (max-width:480px){.gmh-modal{width:100%;border-radius:12px;}.gmh-modal__actions{flex-direction:column;}.gmh-panel{right:12px;left:12px;bottom:12px;width:auto;max-height:76vh;}.gmh-panel::-webkit-scrollbar{width:6px;}.gmh-panel::-webkit-scrollbar-thumb{background:rgba(148,163,184,0.35);border-radius:999px;}#gmh-fab{width:48px;height:48px;right:12px;bottom:12px;font-size:12px;}}
@media (prefers-reduced-motion:reduce){.gmh-panel,.gmh-modal,.gmh-progress__fill,#gmh-fab{transition:none !important;animation-duration:0.001s !important;}}
`;
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
    /**
     * Creates the panel settings store with persistence, change notifications, and defaults.
     */
    function createPanelSettings({ clone, deepMerge, storage = typeof localStorage !== 'undefined' ? localStorage : null, logger = typeof console !== 'undefined' ? console : null, }) {
        if (typeof clone !== 'function' || typeof deepMerge !== 'function') {
            throw new Error('createPanelSettings requires clone and deepMerge helpers');
        }
        let settings = clone(DEFAULTS);
        const log = logger ?? { warn: () => { } };
        const settingsStore = storage ?? null;
        if (settingsStore) {
            try {
                const raw = settingsStore.getItem(PANEL_SETTINGS_STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    settings = deepMerge(clone(DEFAULTS), parsed);
                }
            }
            catch (error) {
                log?.warn?.('[GMH] failed to load panel settings', error);
                settings = clone(DEFAULTS);
            }
        }
        const listeners = new Set();
        const persist = () => {
            if (!settingsStore)
                return;
            try {
                settingsStore.setItem(PANEL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
            }
            catch (error) {
                log?.warn?.('[GMH] failed to persist panel settings', error);
            }
        };
        const notify = () => {
            const snapshot = clone(settings);
            listeners.forEach((listener) => {
                try {
                    listener(snapshot);
                }
                catch (error) {
                    log?.warn?.('[GMH] panel settings listener failed', error);
                }
            });
        };
        const controller = {
            STORAGE_KEY: PANEL_SETTINGS_STORAGE_KEY,
            defaults: clone(DEFAULTS),
            get() {
                return clone(settings);
            },
            update(patch) {
                if (!patch || typeof patch !== 'object')
                    return clone(settings);
                const nextSettings = deepMerge(settings, patch);
                const before = JSON.stringify(settings);
                const after = JSON.stringify(nextSettings);
                if (after === before)
                    return clone(settings);
                settings = nextSettings;
                persist();
                notify();
                return clone(settings);
            },
            reset() {
                const current = JSON.stringify(settings);
                const defaultsString = JSON.stringify(DEFAULTS);
                if (current === defaultsString) {
                    settings = clone(DEFAULTS);
                    return clone(settings);
                }
                settings = clone(DEFAULTS);
                persist();
                notify();
                return clone(settings);
            },
            onChange(listener) {
                if (typeof listener !== 'function')
                    return () => { };
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
        };
        return controller;
    }

    const toErrorMessage = (err) => err instanceof Error && typeof err.message === 'string' ? err.message : String(err);
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
                    : toErrorMessage(error);
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
            return blockIdRegistry.get(block) ?? null;
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
                errors.push(toErrorMessage(error));
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
                    errors.push(toErrorMessage(error));
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
            const { messageStartIndex, messageEndIndex, start, end } = baseRange;
            if (typeof messageStartIndex === 'number' &&
                Number.isFinite(messageStartIndex) &&
                typeof messageEndIndex === 'number' &&
                Number.isFinite(messageEndIndex)) {
                const lower = Math.min(messageStartIndex, messageEndIndex);
                const upper = Math.max(messageStartIndex, messageEndIndex);
                filtered = messages.filter((message) => {
                    const idx = Number(message?.index);
                    return Number.isFinite(idx) ? idx >= lower && idx <= upper : false;
                });
            }
            else if (typeof start === 'number' &&
                Number.isFinite(start) &&
                typeof end === 'number' &&
                Number.isFinite(end)) {
                const lowerOrdinal = Math.min(start, end);
                const upperOrdinal = Math.max(start, end);
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
        const isProfileKey = (value) => value === 'default' || value === 'stability' || value === 'fast';
        const resolveProfileKey = (value) => isProfileKey(value) ? value : 'default';
        const resolveStateKey = (value, fallback) => typeof value === 'string' && value.length > 0 ? value : fallback;
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
            const stamp = typeof summary.timestamp === 'number' && Number.isFinite(summary.timestamp)
                ? summary.timestamp
                : 'na';
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
                const currentRange = typeof exportRange?.getRange === 'function'
                    ? exportRange.getRange()
                    : { start: null, end: null };
                const hasRequestedRange = (typeof currentRange?.start === 'number' && Number.isFinite(currentRange.start) && currentRange.start > 0) ||
                    (typeof currentRange?.end === 'number' && Number.isFinite(currentRange.end) && currentRange.end > 0);
                if (!hasRequestedRange && (totalsShrank || userShrank || llmShrank || entryShrank)) {
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
            stateApi.setState(resolveStateKey(stateEnum.SCANNING, 'SCANNING'), payload);
        };
        const notifyDone = (payload) => {
            stateApi.setState(resolveStateKey(stateEnum.DONE, 'DONE'), payload);
        };
        const notifyError = (payload) => {
            stateApi.setState(resolveStateKey(stateEnum.ERROR, 'ERROR'), payload);
        };
        const notifyIdle = (payload) => {
            stateApi.setState(resolveStateKey(stateEnum.IDLE, 'IDLE'), payload);
        };
        async function autoLoadAll() {
            const profile = AUTO_PROFILES[resolveProfileKey(getProfile())];
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
            const profile = AUTO_PROFILES[resolveProfileKey(getProfile())];
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
                    if (AUTO_STATE.meterTimer !== null) {
                        clearIntervalFn(AUTO_STATE.meterTimer);
                        AUTO_STATE.meterTimer = null;
                    }
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
                    AUTO_CFG.profile = resolveProfileKey(opts.profile);
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
                    AUTO_CFG.profile = resolveProfileKey(profileName);
                }
                else {
                    AUTO_CFG.profile = resolveProfileKey(this.lastProfile || null);
                }
                this.lastProfile = AUTO_CFG.profile;
                notifyProfileChange();
                return this.start(this.lastMode, this.lastTarget);
            },
            setProfile(profileName) {
                const next = resolveProfileKey(profileName);
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

    function createAutoLoaderControls({ documentRef = typeof document !== 'undefined' ? document : null, autoLoader, autoState, setPanelStatus, startTurnMeter, getAutoProfile, subscribeProfileChange, downloadDomSnapshot, }) {
        if (!documentRef)
            throw new Error('createAutoLoaderControls requires document reference');
        if (!autoLoader)
            throw new Error('createAutoLoaderControls requires autoLoader');
        if (!autoState)
            throw new Error('createAutoLoaderControls requires autoState');
        if (!startTurnMeter)
            throw new Error('createAutoLoaderControls requires startTurnMeter');
        if (!getAutoProfile)
            throw new Error('createAutoLoaderControls requires getAutoProfile');
        if (!subscribeProfileChange) {
            throw new Error('createAutoLoaderControls requires subscribeProfileChange');
        }
        const doc = documentRef;
        const profileSelectElements = new Set();
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
        const registerProfileSelect = (select) => {
            if (!select)
                return;
            profileSelectElements.add(select);
            syncProfileSelects();
            select.addEventListener('change', (event) => {
                const target = event.target;
                autoLoader.setProfile(target.value);
            });
        };
        const toggleControls = (disabled, buttons) => {
            buttons.forEach((btn) => {
                if (!btn)
                    return;
                btn.disabled = disabled;
                btn.classList.toggle('gmh-disabled', disabled);
            });
        };
        const ensureAutoLoadControlsModern = (panel) => {
            if (!panel)
                return;
            let wrap = panel.querySelector('#gmh-autoload-controls');
            if (!wrap) {
                wrap = doc.createElement('div');
                wrap.id = 'gmh-autoload-controls';
                panel.appendChild(wrap);
            }
            if (wrap.dataset.ready === 'true')
                return;
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
            const disableControls = (disabled) => toggleControls(disabled, [btnAll, btnTurns]);
            btnAll?.addEventListener('click', async () => {
                if (autoState.running)
                    return;
                disableControls(true);
                try {
                    await autoLoader.start('all');
                }
                finally {
                    disableControls(false);
                }
            });
            btnTurns?.addEventListener('click', async () => {
                if (autoState.running)
                    return;
                const rawVal = inputTurns?.value?.trim();
                const target = Number.parseInt(rawVal || '0', 10);
                if (!Number.isFinite(target) || target <= 0) {
                    setPanelStatus?.('유저 메시지 수를 입력해주세요.', 'error');
                    return;
                }
                disableControls(true);
                try {
                    await autoLoader.start('turns', target);
                }
                finally {
                    disableControls(false);
                }
            });
            btnStop?.addEventListener('click', () => {
                if (!autoState.running) {
                    setPanelStatus?.('자동 로딩이 실행 중이 아닙니다.', 'muted');
                    return;
                }
                autoLoader.stop();
            });
            if (meter instanceof HTMLElement) {
                startTurnMeter(meter);
            }
        };
        const createStatusActionsMarkup = () => {
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
        };
        const bindStatusActions = (actions) => {
            const select = actions.querySelector('#gmh-profile-select');
            if (select)
                registerProfileSelect(select);
            const retryBtn = actions.querySelector('#gmh-btn-retry');
            retryBtn?.addEventListener('click', async () => {
                if (autoState.running) {
                    setPanelStatus?.('이미 자동 로딩이 진행 중입니다.', 'muted');
                    return;
                }
                await autoLoader.startCurrent();
            });
            const retryStableBtn = actions.querySelector('#gmh-btn-retry-stable');
            retryStableBtn?.addEventListener('click', async () => {
                if (autoState.running) {
                    setPanelStatus?.('이미 자동 로딩이 진행 중입니다.', 'muted');
                    return;
                }
                await autoLoader.startCurrent('stability');
            });
            const snapshotBtn = actions.querySelector('#gmh-btn-snapshot');
            snapshotBtn?.addEventListener('click', () => {
                void downloadDomSnapshot?.();
            });
        };
        const mountStatusActionsModern = (panel) => {
            if (!panel)
                return;
            let actions = panel.querySelector('#gmh-status-actions');
            if (!actions) {
                actions = doc.createElement('div');
                actions.id = 'gmh-status-actions';
                panel.appendChild(actions);
            }
            if (actions.dataset.ready === 'true')
                return;
            actions.dataset.ready = 'true';
            actions.innerHTML = createStatusActionsMarkup();
            bindStatusActions(actions);
        };
        return {
            ensureAutoLoadControlsModern,
            mountStatusActionsModern,
        };
    }

    const toNumber = (value) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    };
    const listMessageIdElements = (doc, messageId, cssEscape) => {
        if (!messageId)
            return [];
        try {
            const escaped = typeof cssEscape === 'function' ? cssEscape(messageId) : messageId.replace(/"/g, '\\"');
            const selector = `[data-gmh-message-id="${escaped}"]`;
            return Array.from(doc.querySelectorAll(selector));
        }
        catch {
            return [];
        }
    };
    function createRangeControls({ documentRef = typeof document !== 'undefined' ? document : null, windowRef = typeof window !== 'undefined' ? window : null, exportRange, turnBookmarks, messageIndexer, setPanelStatus, }) {
        if (!documentRef)
            throw new Error('createRangeControls requires document reference');
        if (!exportRange)
            throw new Error('createRangeControls requires exportRange');
        if (!turnBookmarks)
            throw new Error('createRangeControls requires turnBookmarks');
        if (!messageIndexer)
            throw new Error('createRangeControls requires messageIndexer');
        const doc = documentRef;
        const win = windowRef;
        const cssEscape = doc?.defaultView?.CSS?.escape ?? win?.CSS?.escape;
        let rangeUnsubscribe = null;
        let selectedBookmarkKey = '';
        let bookmarkSelectionPinned = false;
        const subscribeRange = (handler) => {
            if (typeof exportRange?.subscribe !== 'function')
                return;
            if (typeof rangeUnsubscribe === 'function')
                rangeUnsubscribe();
            rangeUnsubscribe = exportRange.subscribe((snapshot) => handler(snapshot));
        };
        const updateRangeSnapshot = (handler) => {
            if (typeof handler !== 'function')
                return;
            if (typeof exportRange?.snapshot === 'function') {
                handler(exportRange.snapshot());
                return;
            }
            if (typeof exportRange?.describe === 'function') {
                const bounds = exportRange.describe();
                const totals = typeof exportRange?.getTotals === 'function'
                    ? exportRange.getTotals()
                    : { message: 0, user: 0, llm: 0, entry: 0 };
                const range = typeof exportRange?.getRange === 'function'
                    ? exportRange.getRange()
                    : { start: null, end: null };
                handler({ bounds, totals, range });
            }
        };
        const syncBookmarkSelect = (select, entries = []) => {
            if (!select)
                return;
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
            }
            else if (entries.length) {
                nextValue = entries[0].key;
                bookmarkSelectionPinned = false;
            }
            select.value = nextValue;
            selectedBookmarkKey = nextValue || '';
            if (!nextValue && !entries.length) {
                select.selectedIndex = 0;
            }
        };
        const registerBookmarkSelect = (select) => {
            if (!select)
                return;
            if (select.dataset.gmhBookmarksReady === 'true')
                return;
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
        const bindRangeControls = (panel) => {
            if (!panel)
                return;
            const rangeStartInput = panel.querySelector('#gmh-range-start');
            const rangeEndInput = panel.querySelector('#gmh-range-end');
            const rangeClearBtn = panel.querySelector('#gmh-range-clear');
            const rangeMarkStartBtn = panel.querySelector('#gmh-range-mark-start');
            const rangeMarkEndBtn = panel.querySelector('#gmh-range-mark-end');
            const rangeSummary = panel.querySelector('#gmh-range-summary');
            const rangeBookmarkSelect = panel.querySelector('#gmh-range-bookmark-select');
            registerBookmarkSelect(rangeBookmarkSelect);
            const syncRangeControls = (snapshot) => {
                if (!snapshot)
                    return;
                const { bounds, totals, range } = snapshot;
                const messageTotal = totals.message ?? bounds.messageTotal ?? bounds.total ?? 0;
                const userTotal = totals.user ?? bounds.userTotal ?? 0;
                const llmTotal = totals.llm ?? bounds.llmTotal ?? 0;
                const resolvedStart = bounds.active ? bounds.start : null;
                const resolvedEnd = bounds.active ? bounds.end : null;
                if (rangeStartInput) {
                    if (messageTotal)
                        rangeStartInput.max = String(messageTotal);
                    else
                        rangeStartInput.removeAttribute('max');
                    rangeStartInput.dataset.gmhAxis = 'message';
                    rangeStartInput.value = resolvedStart ? String(resolvedStart) : '';
                    rangeStartInput.dataset.gmhRequested = range.start ? String(range.start) : '';
                }
                if (rangeEndInput) {
                    if (messageTotal)
                        rangeEndInput.max = String(messageTotal);
                    else
                        rangeEndInput.removeAttribute('max');
                    rangeEndInput.dataset.gmhAxis = 'message';
                    rangeEndInput.value = resolvedEnd ? String(resolvedEnd) : '';
                    rangeEndInput.dataset.gmhRequested = range.end ? String(range.end) : '';
                }
                if (rangeMarkStartBtn) {
                    if (messageTotal)
                        rangeMarkStartBtn.removeAttribute('disabled');
                    else
                        rangeMarkStartBtn.setAttribute('disabled', 'true');
                }
                if (rangeMarkEndBtn) {
                    if (messageTotal)
                        rangeMarkEndBtn.removeAttribute('disabled');
                    else
                        rangeMarkEndBtn.setAttribute('disabled', 'true');
                }
                if (rangeSummary) {
                    if (!messageTotal) {
                        rangeSummary.textContent = '로드된 메시지가 없습니다.';
                        rangeSummary.title = '';
                    }
                    else if (!bounds.active) {
                        let textLabel = `최근 메시지 ${messageTotal}개 전체`;
                        if (userTotal)
                            textLabel += ` · 유저 ${userTotal}개`;
                        if (llmTotal)
                            textLabel += ` · LLM ${llmTotal}개`;
                        rangeSummary.textContent = textLabel;
                        rangeSummary.title = '';
                    }
                    else {
                        let textLabel = `최근 메시지 ${bounds.start}-${bounds.end} · ${bounds.count}개 / 전체 ${bounds.total}개`;
                        if (userTotal)
                            textLabel += ` · 유저 ${userTotal}개`;
                        if (llmTotal)
                            textLabel += ` · LLM ${llmTotal}개`;
                        rangeSummary.textContent = textLabel;
                        rangeSummary.title = '';
                    }
                }
            };
            if (rangeStartInput || rangeEndInput || rangeSummary || rangeMarkStartBtn || rangeMarkEndBtn) {
                subscribeRange(syncRangeControls);
                updateRangeSnapshot(syncRangeControls);
                const handleStartChange = () => {
                    if (!rangeStartInput)
                        return;
                    if (!exportRange || typeof exportRange.setStart !== 'function') {
                        win?.console?.warn?.('[GMH] exportRange.setStart is not available');
                        return;
                    }
                    const value = toNumber(rangeStartInput.value);
                    if (value && value > 0) {
                        exportRange.setStart(value);
                    }
                    else {
                        exportRange.setStart(null);
                        rangeStartInput.value = '';
                    }
                };
                const handleEndChange = () => {
                    if (!rangeEndInput)
                        return;
                    if (!exportRange || typeof exportRange.setEnd !== 'function') {
                        win?.console?.warn?.('[GMH] exportRange.setEnd is not available');
                        return;
                    }
                    const value = toNumber(rangeEndInput.value);
                    if (value && value > 0) {
                        exportRange.setEnd(value);
                    }
                    else {
                        exportRange.setEnd(null);
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
                        if (rangeBookmarkSelect)
                            rangeBookmarkSelect.value = '';
                    });
                }
                const getActiveBookmark = () => {
                    if (rangeBookmarkSelect) {
                        const key = rangeBookmarkSelect.value || selectedBookmarkKey || '';
                        if (key && typeof turnBookmarks?.pick === 'function') {
                            const picked = turnBookmarks.pick(key);
                            if (picked)
                                return picked;
                        }
                    }
                    return typeof turnBookmarks?.latest === 'function' ? turnBookmarks.latest() : null;
                };
                const buildContextFromElement = (element) => {
                    if (!(element instanceof Element))
                        return null;
                    const messageEl = element.closest('[data-gmh-message-index]');
                    if (!messageEl)
                        return null;
                    const indexAttr = messageEl.getAttribute('data-gmh-message-index');
                    const messageIdAttr = messageEl.getAttribute('data-gmh-message-id') || messageEl.getAttribute('data-message-id');
                    const index = toNumber(indexAttr);
                    const lookupOrdinalByIndex = messageIndexer?.lookupOrdinalByIndex;
                    const lookupOrdinalByMessageId = messageIndexer?.lookupOrdinalByMessageId;
                    const numericIndex = typeof index === 'number' && Number.isFinite(index) ? index : null;
                    const resolvedOrdinal = [
                        numericIndex !== null && typeof lookupOrdinalByIndex === 'function'
                            ? lookupOrdinalByIndex(numericIndex)
                            : null,
                        messageIdAttr && typeof lookupOrdinalByMessageId === 'function'
                            ? lookupOrdinalByMessageId(messageIdAttr)
                            : null,
                        toNumber(messageEl.getAttribute('data-gmh-message-ordinal')),
                    ].find((value) => Number.isFinite(value) && value > 0);
                    return {
                        element: messageEl,
                        index: Number.isFinite(index) ? index : null,
                        ordinal: Number.isFinite(resolvedOrdinal) && resolvedOrdinal !== null
                            ? resolvedOrdinal
                            : null,
                        messageId: messageIdAttr || null,
                    };
                };
                const selectBestCandidate = (candidates, preferredIndex = null) => {
                    const elements = Array.from(new Set(candidates.filter((el) => el instanceof Element)));
                    if (!elements.length)
                        return null;
                    if (Number.isFinite(preferredIndex)) {
                        const exact = elements.find((el) => Number(el.getAttribute('data-gmh-message-index')) === preferredIndex);
                        if (exact)
                            return exact;
                    }
                    const withOrdinal = elements
                        .map((el) => ({
                        el,
                        ord: toNumber(el.getAttribute('data-gmh-message-ordinal')),
                        idx: toNumber(el.getAttribute('data-gmh-message-index')),
                    }))
                        .sort((a, b) => {
                        if (Number.isFinite(a.ord) && Number.isFinite(b.ord))
                            return a.ord - b.ord;
                        if (Number.isFinite(a.idx) && Number.isFinite(b.idx))
                            return b.idx - a.idx;
                        return 0;
                    });
                    return withOrdinal[0]?.el || elements[elements.length - 1];
                };
                const safeQueryById = (messageId, preferredIndex = null) => {
                    if (!messageId)
                        return null;
                    const candidates = listMessageIdElements(doc, messageId, cssEscape);
                    return selectBestCandidate(candidates, preferredIndex);
                };
                const getCandidateContext = () => {
                    const bookmark = getActiveBookmark();
                    if (bookmark) {
                        const fromBookmark = safeQueryById(bookmark.messageId, bookmark.index) ||
                            (Number.isFinite(bookmark.index)
                                ? selectBestCandidate(Array.from(doc.querySelectorAll(`[data-gmh-message-index="${bookmark.index}"]`)), bookmark.index)
                                : null);
                        const resolvedBookmark = buildContextFromElement(fromBookmark);
                        if (resolvedBookmark)
                            return resolvedBookmark;
                    }
                    const active = doc.activeElement;
                    const resolvedActive = buildContextFromElement(active instanceof Element ? active : null);
                    if (resolvedActive)
                        return resolvedActive;
                    const latest = doc.querySelector('[data-gmh-message-ordinal="1"]');
                    return buildContextFromElement(latest);
                };
                const doBookmark = (mode) => {
                    const context = getCandidateContext();
                    if (!context) {
                        setPanelStatus?.('메시지를 찾을 수 없습니다.', 'warning');
                        return;
                    }
                    try {
                        messageIndexer?.refresh?.({ immediate: true });
                    }
                    catch (error) {
                        win?.console?.warn?.('[GMH] ordinal refresh failed', error);
                    }
                    const reselectElement = () => {
                        if (context.element instanceof Element && context.element.isConnected) {
                            return context.element;
                        }
                        return (safeQueryById(context.messageId, context.index) ||
                            selectBestCandidate(Array.from(doc.querySelectorAll(`[data-gmh-message-index="${context.index ?? ''}"]`)), context.index));
                    };
                    const updatedContext = buildContextFromElement(reselectElement());
                    if (!updatedContext) {
                        setPanelStatus?.('메시지를 찾을 수 없습니다.', 'warning');
                        return;
                    }
                    if (mode === 'start') {
                        if (Number.isFinite(updatedContext.ordinal)) {
                            exportRange?.setStart?.(updatedContext.ordinal ?? null);
                        }
                    }
                    else if (mode === 'end') {
                        if (Number.isFinite(updatedContext.ordinal)) {
                            exportRange?.setEnd?.(updatedContext.ordinal ?? null);
                        }
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
        return { bindRangeControls };
    }

    function createPanelShortcuts({ windowRef = typeof window !== 'undefined' ? window : undefined, panelVisibility, autoLoader, autoState, configurePrivacyLists, modal, }) {
        if (!windowRef)
            throw new Error('createPanelShortcuts requires window reference');
        if (!panelVisibility)
            throw new Error('createPanelShortcuts requires panelVisibility');
        if (!autoLoader)
            throw new Error('createPanelShortcuts requires autoLoader');
        if (!autoState)
            throw new Error('createPanelShortcuts requires autoState');
        if (!configurePrivacyLists)
            throw new Error('createPanelShortcuts requires configurePrivacyLists');
        let shortcutsBound = false;
        const bindShortcuts = (panel) => {
            if (shortcutsBound || !panel)
                return;
            const win = windowRef;
            const handler = (event) => {
                if (!event.altKey || event.ctrlKey || event.metaKey || event.repeat)
                    return;
                const key = event.key?.toLowerCase();
                const target = event.target;
                if (target instanceof win.HTMLElement) {
                    const tag = target.tagName.toLowerCase();
                    const isInputLike = ['input', 'textarea', 'select'].includes(tag) || target.isContentEditable;
                    if (isInputLike && !['g', 'm', 's', 'p', 'e'].includes(key))
                        return;
                }
                if (modal?.isOpen?.())
                    return;
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
                        void configurePrivacyLists();
                        break;
                    case 'e':
                        event.preventDefault();
                        panel.querySelector('#gmh-export')?.click();
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
            exportRange: (value) => {
                const controller = value;
                return Boolean(controller?.setTotals);
            },
            'clipboard.set': (fn) => typeof fn === 'function',
            stateApi: (value) => {
                const api = value;
                return Boolean(api?.setState);
            },
            stateEnum: (value) => Boolean(value),
            confirmPrivacyGate: (fn) => typeof fn === 'function',
            getEntryOrigin: (fn) => typeof fn === 'function',
            collectSessionStats: (fn) => typeof fn === 'function',
        });
        const resolveStateKey = (value, fallback) => typeof value === 'string' && value.length > 0 ? value : fallback;
        const setState = (value, fallback, payload) => {
            stateApi.setState(resolveStateKey(value, fallback), payload);
        };
        const toErrorMessage = (err) => err instanceof Error && typeof err.message === 'string' ? err.message : String(err);
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
                setState(stateEnum.REDACTING, 'REDACTING', {
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
                    setState(stateEnum.ERROR, 'ERROR', {
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
                setState(stateEnum.PREVIEW, 'PREVIEW', {
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
                    setState(stateEnum.IDLE, 'IDLE', {
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
                const errorMsg = toErrorMessage(error);
                alertFn(`오류: ${errorMsg}`);
                setState(stateEnum.ERROR, 'ERROR', {
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
                setState(stateEnum.EXPORTING, 'EXPORTING', {
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
                    overallStats: overallStats ?? undefined,
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
                const messageTotalAvailable = rangeInfo?.messageTotal ?? sessionForExport.turns.length;
                const userTotalAvailable = rangeInfo?.userTotal ?? overallStats?.userMessages ?? stats.userMessages;
                const llmTotalAvailable = rangeInfo?.llmTotal ?? overallStats?.llmMessages ?? stats.llmMessages;
                let rangeNote;
                if (hasCustomRange && rangeInfo) {
                    const startLabel = rangeInfo.start ?? '?';
                    const endLabel = rangeInfo.end ?? '?';
                    const totalLabel = rangeInfo.total ?? '?';
                    rangeNote = ` · (선택) 메시지 ${startLabel}-${endLabel}/${totalLabel}`;
                }
                else {
                    rangeNote = ` · 전체 메시지 ${messageTotalAvailable}개`;
                }
                if (Number.isFinite(userTotalAvailable)) {
                    rangeNote += ` · 유저 ${stats.userMessages}개`;
                }
                if (Number.isFinite(llmTotalAvailable)) {
                    rangeNote += ` · LLM ${stats.llmMessages}개`;
                }
                const message = `${targetFormat.toUpperCase()} 내보내기 완료${rangeNote} · ${profileLabel} · ${summary}`;
                setState(stateEnum.DONE, 'DONE', {
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
                const errorMsg = toErrorMessage(error);
                alertFn(`오류: ${errorMsg}`);
                setState(stateEnum.ERROR, 'ERROR', {
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
                setState(stateEnum.EXPORTING, 'EXPORTING', {
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
                setState(stateEnum.DONE, 'DONE', {
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
                const errorMsg = toErrorMessage(error);
                alertFn(`오류: ${errorMsg}`);
                setState(stateEnum.ERROR, 'ERROR', {
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
                setState(stateEnum.EXPORTING, 'EXPORTING', {
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
                setState(stateEnum.DONE, 'DONE', {
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
                const errorMsg = toErrorMessage(error);
                alertFn(`오류: ${errorMsg}`);
                setState(stateEnum.ERROR, 'ERROR', {
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
                setState(stateEnum.REDACTING, 'REDACTING', {
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
                setState(stateEnum.DONE, 'DONE', {
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
                const errorMsg = toErrorMessage(error);
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

    const DEFAULT_BLOCK_SIZE = 5;
    const DEFAULT_BLOCK_OVERLAP = 2;
    const DEFAULT_SESSION_FALLBACK$1 = 'about:blank';
    const noop$1 = () => { };
    const selectConsole$2 = (consoleRef) => {
        if (consoleRef)
            return consoleRef;
        if (typeof console !== 'undefined')
            return console;
        return {
            warn: noop$1,
            error: noop$1,
        };
    };
    const selectClock = (clockRef) => {
        if (typeof clockRef === 'function')
            return clockRef;
        return () => Date.now();
    };
    const cloneStructuredMessage$2 = (message) => {
        if (!message || typeof message !== 'object') {
            return message;
        }
        if (typeof structuredClone === 'function') {
            try {
                const cloned = structuredClone(message);
                const legacyLines = Reflect.get(message, 'legacyLines');
                if (Array.isArray(legacyLines)) {
                    Object.defineProperty(cloned, 'legacyLines', {
                        value: legacyLines.slice(),
                        enumerable: false,
                        configurable: true,
                        writable: true,
                    });
                }
                return cloned;
            }
            catch {
                // fall through to JSON clone
            }
        }
        const jsonClone = JSON.parse(JSON.stringify(message ?? null));
        if (!jsonClone)
            return jsonClone;
        const legacyLines = Reflect.get(message, 'legacyLines');
        if (Array.isArray(legacyLines)) {
            Object.defineProperty(jsonClone, 'legacyLines', {
                value: legacyLines.slice(),
                enumerable: false,
                configurable: true,
                writable: true,
            });
        }
        return jsonClone;
    };
    const toNormalizedLines = (message, removeNarration) => {
        if (!message)
            return [];
        if (removeNarration && (message.role === 'narration' || message.channel === 'system')) {
            return [];
        }
        const lines = [];
        const seenLines = new Set();
        const pushLine = (value) => {
            if (typeof value !== 'string')
                return;
            const trimmed = value.trim();
            if (!trimmed)
                return;
            if (seenLines.has(trimmed))
                return;
            seenLines.add(trimmed);
            lines.push(trimmed);
        };
        let observedInfoPart = false;
        let observedNonInfoPart = false;
        if (Array.isArray(message.parts)) {
            message.parts.forEach((part) => {
                if (!part)
                    return;
                if (part.type === 'info' || part.speaker === 'INFO') {
                    observedInfoPart = true;
                    return;
                }
                if (removeNarration &&
                    (part.flavor === 'narration' || part.role === 'narration' || message.role === 'narration')) {
                    return;
                }
                observedNonInfoPart = true;
                pushLine(part.text);
                if (Array.isArray(part.lines)) {
                    part.lines.forEach((line) => {
                        pushLine(line);
                    });
                }
                if (Array.isArray(part.legacyLines)) {
                    part.legacyLines.forEach((line) => {
                        pushLine(line);
                    });
                }
                if (Array.isArray(part.items)) {
                    part.items.forEach((item) => {
                        if (item === null || item === undefined)
                            return;
                        const text = typeof item === 'string' ? item : String(item ?? '');
                        pushLine(text);
                    });
                }
            });
        }
        if (lines.length) {
            return lines;
        }
        if (observedInfoPart && !observedNonInfoPart) {
            return [];
        }
        const legacyLines = Reflect.get(message, 'legacyLines');
        if (Array.isArray(legacyLines) && legacyLines.length) {
            const firstLegacy = String(legacyLines[0] || '').trim().toUpperCase();
            if (firstLegacy === 'INFO') {
                return [];
            }
            legacyLines.forEach((line) => {
                if (typeof line !== 'string')
                    return;
                const trimmed = line.trim();
                if (!trimmed || trimmed.toUpperCase() === 'INFO')
                    return;
                pushLine(trimmed);
            });
            return lines;
        }
        return lines;
    };
    const buildRawText = (sequence, removeNarration) => {
        const sections = [];
        sequence.forEach(({ message }) => {
            const lines = toNormalizedLines(message, removeNarration);
            if (!lines.length)
                return;
            const speaker = message.speaker || message.role || message.channel || 'message';
            const head = lines[0];
            const tail = lines.slice(1);
            const formatted = [`${speaker}: ${head}`];
            tail.forEach((line) => {
                formatted.push(line);
            });
            sections.push(formatted.join('\n'));
        });
        return sections.join('\n\n');
    };
    const sanitizeSessionUrl = (value) => {
        if (!value)
            return null;
        const trimmed = String(value).trim();
        return trimmed.length ? trimmed : null;
    };
    const resolveOrdinal = (candidate, fallback) => {
        const numeric = Number(candidate);
        if (Number.isFinite(numeric) && numeric > 0) {
            return Math.floor(numeric);
        }
        return fallback;
    };
    const defaultBuildBlockId = ({ startOrdinal, endOrdinal, timestamp, counter, }) => {
        return `gmh-block-${startOrdinal}-${endOrdinal}-${timestamp}-${counter}`;
    };
    const createBlockBuilder = (options = {}) => {
        const blockSize = Math.max(1, Math.floor(options.blockSize ?? DEFAULT_BLOCK_SIZE));
        const overlapCandidate = Math.max(0, Math.floor(options.overlap ?? DEFAULT_BLOCK_OVERLAP));
        const overlap = Math.min(overlapCandidate, blockSize - 1);
        const removeNarration = options.removeNarration !== false;
        const logger = selectConsole$2(options.console ?? null);
        const clock = selectClock(options.clock ?? null);
        const buildBlockId = typeof options.buildBlockId === 'function' ? options.buildBlockId : defaultBuildBlockId;
        const onBlockReady = typeof options.onBlockReady === 'function' ? options.onBlockReady : null;
        const getSessionUrlOption = typeof options.getSessionUrl === 'function' ? options.getSessionUrl : null;
        let sessionUrlRef = sanitizeSessionUrl(options.sessionUrl ?? null);
        let ordinalCursor = 0;
        let blockCounter = 0;
        const buffer = [];
        const seenIds = new Set();
        const emitBlocks = (blocks) => {
            if (!blocks.length || !onBlockReady)
                return blocks;
            blocks.forEach((block) => {
                try {
                    onBlockReady(block);
                }
                catch (err) {
                    logger.warn?.('[GMH] block builder onBlockReady failed', err);
                }
            });
            return blocks;
        };
        const resetState = () => {
            buffer.length = 0;
            seenIds.clear();
            ordinalCursor = 0;
        };
        const ensureSessionUrl = (override) => {
            if (override !== undefined) {
                sessionUrlRef = sanitizeSessionUrl(override);
            }
            if (sessionUrlRef)
                return sessionUrlRef;
            if (getSessionUrlOption) {
                try {
                    const derived = sanitizeSessionUrl(getSessionUrlOption());
                    if (derived) {
                        sessionUrlRef = derived;
                        return sessionUrlRef;
                    }
                }
                catch (err) {
                    logger.warn?.('[GMH] block builder session resolver failed', err);
                }
            }
            return DEFAULT_SESSION_FALLBACK$1;
        };
        const resolveTimestamp = (override) => {
            if (Number.isFinite(override)) {
                return Math.floor(Number(override));
            }
            return clock();
        };
        const buildBlock = (slice, sessionUrl, timestamp) => {
            if (!slice.length) {
                throw new Error('Cannot build block without messages.');
            }
            const orderedSlice = slice.slice().sort((a, b) => a.ordinal - b.ordinal);
            const startOrdinal = orderedSlice[0]?.ordinal ?? 0;
            const endOrdinal = orderedSlice[orderedSlice.length - 1]?.ordinal ?? startOrdinal;
            blockCounter += 1;
            const blockId = buildBlockId({
                startOrdinal,
                endOrdinal,
                timestamp,
                counter: blockCounter,
            });
            const messages = orderedSlice.map((entry) => cloneStructuredMessage$2(entry.message));
            const raw = buildRawText(orderedSlice, removeNarration);
            const block = {
                id: blockId,
                sessionUrl,
                raw,
                messages,
                ordinalRange: [startOrdinal, endOrdinal],
                timestamp,
                meta: {
                    blockSize: slice.length,
                    configuredBlockSize: blockSize,
                    overlap,
                    sourceOrdinals: orderedSlice.map((entry) => entry.ordinal),
                },
            };
            return block;
        };
        const drain = ({ allowPartial = false, sessionOverride, timestampOverride, }) => {
            const produced = [];
            const sessionUrl = ensureSessionUrl(sessionOverride);
            const makeTimestamp = () => resolveTimestamp(timestampOverride);
            while (buffer.length >= blockSize) {
                const slice = buffer.slice(0, blockSize);
                const block = buildBlock(slice, sessionUrl, makeTimestamp());
                produced.push(block);
                const removeCount = blockSize - overlap;
                buffer.splice(0, removeCount);
                // no need to update seenIds; retain set to avoid duplicates for remainder of session
            }
            if (allowPartial && buffer.length > 0) {
                const slice = buffer.splice(0, buffer.length);
                const block = buildBlock(slice, sessionUrl, makeTimestamp());
                produced.push(block);
                buffer.length = 0;
            }
            return emitBlocks(produced);
        };
        const appendInternal = (message, optionsArg) => {
            if (!message || typeof message !== 'object')
                return [];
            const messageId = typeof message.id === 'string' && message.id.trim().length ? message.id.trim() : null;
            if (messageId && seenIds.has(messageId)) {
                return [];
            }
            const ordinal = resolveOrdinal(message.ordinal, ordinalCursor + 1);
            ordinalCursor = Math.max(ordinalCursor + 1, ordinal);
            const cloned = cloneStructuredMessage$2(message);
            buffer.push({
                message: cloned,
                ordinal,
            });
            if (messageId) {
                seenIds.add(messageId);
            }
            return drain({
                allowPartial: false,
                sessionOverride: optionsArg?.sessionUrl,
                timestampOverride: optionsArg?.timestamp,
            });
        };
        const appendManyInternal = (messages, optionsArg) => {
            if (!Array.isArray(messages) || !messages.length)
                return [];
            const produced = [];
            messages.forEach((entry) => {
                const blocks = appendInternal(entry, optionsArg);
                if (blocks.length) {
                    produced.push(...blocks);
                }
            });
            return produced;
        };
        const primeFromBlocksInternal = (blocks) => {
            if (!Array.isArray(blocks) || !blocks.length)
                return;
            let highestOrdinal = ordinalCursor;
            blocks.forEach((block) => {
                if (!block)
                    return;
                if (Array.isArray(block.messages)) {
                    block.messages.forEach((message) => {
                        const messageId = typeof message?.id === 'string' && message.id.trim().length ? message.id.trim() : null;
                        if (messageId) {
                            seenIds.add(messageId);
                        }
                    });
                }
                let blockEndOrdinal = Array.isArray(block.ordinalRange)
                    ? Number(block.ordinalRange[1])
                    : Number.NaN;
                if (!Number.isFinite(blockEndOrdinal)) {
                    const sourceOrdinals = Array.isArray(block.meta?.sourceOrdinals)
                        ? block.meta.sourceOrdinals
                        : [];
                    if (sourceOrdinals.length) {
                        blockEndOrdinal = Number(sourceOrdinals[sourceOrdinals.length - 1]);
                    }
                }
                if (Number.isFinite(blockEndOrdinal)) {
                    highestOrdinal = Math.max(highestOrdinal, Math.floor(blockEndOrdinal));
                }
            });
            ordinalCursor = Math.max(ordinalCursor, highestOrdinal);
        };
        return {
            append(message, optionsArg) {
                return appendInternal(message, optionsArg);
            },
            appendMany(messages, optionsArg) {
                return appendManyInternal(messages, optionsArg);
            },
            flush(optionsArg) {
                if (optionsArg?.includePartial) {
                    return drain({
                        allowPartial: true,
                        sessionOverride: optionsArg.sessionUrl,
                        timestampOverride: optionsArg.timestamp,
                    });
                }
                return drain({
                    allowPartial: false,
                    sessionOverride: optionsArg?.sessionUrl,
                    timestampOverride: optionsArg?.timestamp,
                });
            },
            clear() {
                resetState();
            },
            getBuffer() {
                return buffer.map((entry) => cloneStructuredMessage$2(entry.message));
            },
            getSessionUrl() {
                return sessionUrlRef ?? null;
            },
            setSessionUrl(next) {
                const normalized = sanitizeSessionUrl(next);
                if (sessionUrlRef && normalized && sessionUrlRef !== normalized) {
                    resetState();
                }
                else if (sessionUrlRef && !normalized) {
                    resetState();
                }
                sessionUrlRef = normalized ?? null;
            },
            primeFromBlocks(blocks) {
                primeFromBlocksInternal(blocks);
            },
        };
    };

    const DEFAULT_SESSION_FALLBACK = 'about:blank';
    const cloneValue$1 = (value) => {
        if (value === null || value === undefined)
            return value;
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            }
            catch {
                // fall through to JSON clone
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        }
        catch {
            return value;
        }
    };
    const cloneArrayBuffer$1 = (buffer) => {
        if (buffer instanceof ArrayBuffer && typeof buffer.slice === 'function') {
            return buffer.slice(0);
        }
        const copy = new Uint8Array(buffer.byteLength);
        copy.set(new Uint8Array(buffer));
        return copy.buffer;
    };
    const cloneEmbedding = (value) => {
        if (!value)
            return null;
        if (value instanceof ArrayBuffer) {
            return cloneArrayBuffer$1(value);
        }
        if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
            const view = value;
            return cloneArrayBuffer$1(view.buffer);
        }
        return null;
    };
    const cloneStructuredMessage$1 = (message) => {
        if (!message || typeof message !== 'object') {
            return message;
        }
        if (typeof structuredClone === 'function') {
            try {
                const cloned = structuredClone(message);
                const legacyLines = Reflect.get(message, 'legacyLines');
                if (Array.isArray(legacyLines)) {
                    Object.defineProperty(cloned, 'legacyLines', {
                        value: legacyLines.slice(),
                        enumerable: false,
                        configurable: true,
                        writable: true,
                    });
                }
                return cloned;
            }
            catch {
                // fall through to JSON clone
            }
        }
        const jsonClone = JSON.parse(JSON.stringify(message ?? null));
        if (!jsonClone)
            return jsonClone;
        const legacyLines = Reflect.get(message, 'legacyLines');
        if (Array.isArray(legacyLines)) {
            Object.defineProperty(jsonClone, 'legacyLines', {
                value: legacyLines.slice(),
                enumerable: false,
                configurable: true,
                writable: true,
            });
        }
        return jsonClone;
    };
    const cloneStructuredMessages = (messages) => messages.map((message) => cloneStructuredMessage$1(message));
    const collectMessageCandidates = (message) => {
        if (!message || typeof message !== 'object')
            return [];
        const collected = [];
        const legacyLines = Reflect.get(message, 'legacyLines');
        if (Array.isArray(legacyLines)) {
            legacyLines.forEach((line) => {
                if (typeof line === 'string' && line.trim()) {
                    collected.push(line.trim());
                }
            });
        }
        if (Array.isArray(message.parts)) {
            message.parts.forEach((part) => {
                if (!part)
                    return;
                if (typeof part.text === 'string' && part.text.trim()) {
                    collected.push(part.text.trim());
                }
                if (Array.isArray(part.lines)) {
                    part.lines.forEach((line) => {
                        if (typeof line === 'string' && line.trim()) {
                            collected.push(line.trim());
                        }
                    });
                }
                if (Array.isArray(part.legacyLines)) {
                    part.legacyLines.forEach((line) => {
                        if (typeof line === 'string' && line.trim()) {
                            collected.push(line.trim());
                        }
                    });
                }
                if (Array.isArray(part.items)) {
                    part.items.forEach((item) => {
                        const text = typeof item === 'string' ? item : String(item ?? '');
                        if (text.trim()) {
                            collected.push(text.trim());
                        }
                    });
                }
            });
        }
        return collected;
    };
    const selectPreviewText = (message) => {
        const candidates = collectMessageCandidates(message);
        if (candidates.length) {
            return candidates[0];
        }
        const fallbackSpeaker = message && typeof message.speaker === 'string' && message.speaker.trim()
            ? message.speaker.trim()
            : '';
        return fallbackSpeaker;
    };
    const formatBlockPreviewFromMessages = (messages) => {
        const firstMessage = messages.length ? messages[0] : null;
        if (!firstMessage)
            return '(no preview)';
        const speaker = typeof firstMessage?.speaker === 'string' && firstMessage.speaker.trim()
            ? `${firstMessage.speaker.trim()}: `
            : '';
        const text = selectPreviewText(firstMessage);
        const preview = `${speaker}${text}`.trim();
        if (!preview)
            return '(no preview)';
        return preview.length > 80 ? `${preview.slice(0, 77)}...` : preview;
    };
    const formatBlockPreview = (block) => {
        const messages = Array.isArray(block.messages) ? block.messages : [];
        return formatBlockPreviewFromMessages(messages);
    };
    const collectMessageIdsFromMessages = (messages, limit = 3) => messages.slice(0, Math.max(0, limit)).map((message) => {
        const id = typeof message?.id === 'string' && message.id.trim() ? message.id.trim() : null;
        return id ?? 'NO_ID';
    });
    const collectMessageIdsFromBlock = (block, limit = 3) => {
        const messages = Array.isArray(block.messages) ? block.messages : [];
        return collectMessageIdsFromMessages(messages, limit);
    };
    const normalizeOrdinalRange = (range) => {
        const startCandidate = Array.isArray(range) ? Number(range[0]) : Number.NaN;
        const endCandidate = Array.isArray(range) ? Number(range[1]) : Number.NaN;
        const start = Number.isFinite(startCandidate) ? Math.floor(startCandidate) : 0;
        const end = Number.isFinite(endCandidate) ? Math.floor(endCandidate) : start;
        return [start, end];
    };
    const normalizeId = (value) => {
        const text = typeof value === 'string' ? value : String(value ?? '');
        return text.trim();
    };
    const normalizeSessionUrl = (value) => {
        const text = typeof value === 'string' ? value : String(value ?? '');
        const trimmed = text.trim();
        return trimmed || DEFAULT_SESSION_FALLBACK;
    };
    const resolveTimestamp$1 = (value) => {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return Math.floor(numeric);
        }
        return Date.now();
    };
    const formatTimestampLabel = (value) => {
        if (!Number.isFinite(value))
            return '(invalid)';
        try {
            return new Date(value).toLocaleTimeString();
        }
        catch {
            return '(invalid)';
        }
    };
    const buildDebugBlockDetail = (block) => {
        const messages = Array.isArray(block.messages) ? cloneStructuredMessages(block.messages) : [];
        const ordinalRange = normalizeOrdinalRange(block.ordinalRange);
        const timestamp = resolveTimestamp$1(block.timestamp);
        const detail = {
            id: normalizeId(block.id),
            sessionUrl: normalizeSessionUrl(block.sessionUrl),
            ordinalRange,
            messageCount: messages.length,
            messageIds: collectMessageIdsFromMessages(messages),
            timestamp,
            timestampLabel: formatTimestampLabel(timestamp),
            preview: formatBlockPreviewFromMessages(messages),
            raw: typeof block.raw === 'string'
                ? block.raw
                : String(block.raw ?? ''),
            messages,
            meta: block.meta ? cloneValue$1(block.meta) : undefined,
            embedding: cloneEmbedding(block.embedding ?? null),
        };
        return detail;
    };
    const cloneDebugBlockDetail = (detail) => ({
        id: detail.id,
        sessionUrl: detail.sessionUrl,
        ordinalRange: [detail.ordinalRange[0], detail.ordinalRange[1]],
        messageCount: detail.messageCount,
        messageIds: detail.messageIds.slice(),
        timestamp: detail.timestamp,
        timestampLabel: detail.timestampLabel,
        preview: detail.preview,
        raw: detail.raw,
        messages: cloneStructuredMessages(detail.messages),
        meta: detail.meta ? cloneValue$1(detail.meta) : undefined,
        embedding: cloneEmbedding(detail.embedding ?? null),
    });
    const toDebugBlockSummary = (detail) => ({
        id: detail.id,
        sessionUrl: detail.sessionUrl,
        ordinalRange: [detail.ordinalRange[0], detail.ordinalRange[1]],
        messageCount: detail.messageCount,
        messageIds: detail.messageIds.slice(),
        timestamp: detail.timestamp,
        timestampLabel: detail.timestampLabel,
        preview: detail.preview,
    });

    const noop = () => { };
    const MESSAGE_EVENT_SETTLE_DELAY_MS = 8000;
    const MESSAGE_EVENT_RETRY_INTERVAL_MS = 3000;
    const MESSAGE_EVENT_MAX_ATTEMPTS = 12;
    const selectConsole$1 = (consoleRef) => {
        if (consoleRef)
            return consoleRef;
        if (typeof console !== 'undefined')
            return console;
        return {
            log: noop,
            warn: noop,
            error: noop,
        };
    };
    const isPromiseLike$2 = (value) => {
        return typeof value === 'object' && value !== null && 'then' in value;
    };
    const cloneStructuredMessage = (message) => {
        if (!message || typeof message !== 'object') {
            return message;
        }
        if (typeof structuredClone === 'function') {
            try {
                const cloned = structuredClone(message);
                const legacyLines = Reflect.get(message, 'legacyLines');
                if (Array.isArray(legacyLines)) {
                    Object.defineProperty(cloned, 'legacyLines', {
                        value: legacyLines.slice(),
                        enumerable: false,
                        configurable: true,
                        writable: true,
                    });
                }
                return cloned;
            }
            catch {
                // fallback to JSON clone below
            }
        }
        const cloned = JSON.parse(JSON.stringify(message ?? null));
        if (!cloned)
            return cloned;
        const legacyLines = Reflect.get(message, 'legacyLines');
        if (Array.isArray(legacyLines)) {
            Object.defineProperty(cloned, 'legacyLines', {
                value: legacyLines.slice(),
                enumerable: false,
                configurable: true,
                writable: true,
            });
        }
        return cloned;
    };
    const resolveTimestamp = (value) => {
        if (Number.isFinite(value)) {
            return Math.floor(Number(value));
        }
        return Date.now();
    };
    const createMessageStream = (options) => {
        const logger = selectConsole$1(options.console ?? null);
        const { messageIndexer, blockBuilder } = options;
        if (!messageIndexer || typeof messageIndexer.subscribeMessages !== 'function') {
            throw new Error('createMessageStream requires a messageIndexer with subscribeMessages support.');
        }
        if (!blockBuilder) {
            throw new Error('createMessageStream requires a blockBuilder instance.');
        }
        const blockListeners = new Set();
        const structuredListeners = new Set();
        const pendingMessageEvents = [];
        const delayedEventTimers = new Set();
        let running = false;
        let unsubscribeMessages = null;
        let storage = null;
        let storagePromise = null;
        let storageInitError = null;
        let saveChain = Promise.resolve();
        let primed = false;
        let primePromise = null;
        let currentPrimingSession = null;
        let lastPrimedSession = null;
        let primeGeneration = 0;
        if (options.blockStorage) {
            if (isPromiseLike$2(options.blockStorage)) {
                storagePromise = options.blockStorage.then((store) => {
                    storage = store;
                    return store;
                });
            }
            else {
                storage = options.blockStorage;
            }
        }
        const ensureStorage = async () => {
            if (storage)
                return storage;
            if (storageInitError)
                return null;
            if (storagePromise) {
                try {
                    storage = await storagePromise;
                    return storage;
                }
                catch (err) {
                    storageInitError = err;
                    logger.warn?.('[GMH] message stream storage unavailable', err);
                    return null;
                }
            }
            return null;
        };
        const logBlockReady = (block) => {
            const ordinalRange = Array.isArray(block.ordinalRange)
                ? block.ordinalRange
                : [Number.NaN, Number.NaN];
            const [startOrdinal, endOrdinal] = ordinalRange;
            const messageCount = Array.isArray(block.messages) ? block.messages.length : 0;
            const preview = formatBlockPreview(block);
            const messageIds = collectMessageIdsFromBlock(block);
            const timestampValue = Number(block.timestamp);
            const timestampLabel = formatTimestampLabel(timestampValue);
            logger.log?.('[GMH] block ready', {
                id: String(block.id ?? ''),
                ordinalRange: [startOrdinal, endOrdinal],
                messageCount,
                preview,
                messageIds,
                timestamp: timestampLabel,
            });
        };
        const notifyBlockListeners = (block) => {
            logBlockReady(block);
            blockListeners.forEach((listener) => {
                try {
                    listener(block);
                }
                catch (err) {
                    logger.warn?.('[GMH] block listener failed', err);
                }
            });
        };
        const notifyStructuredListeners = (message) => {
            structuredListeners.forEach((listener) => {
                try {
                    listener(cloneStructuredMessage(message));
                }
                catch (err) {
                    logger.warn?.('[GMH] message listener failed', err);
                }
            });
        };
        const persistBlocks = (blocks) => {
            if (!blocks.length)
                return saveChain;
            saveChain = saveChain
                .then(async () => {
                const store = await ensureStorage();
                if (!store) {
                    blocks.forEach((block) => notifyBlockListeners(block));
                    return;
                }
                for (const block of blocks) {
                    try {
                        await store.save(block);
                        notifyBlockListeners(block);
                    }
                    catch (err) {
                        logger.warn?.('[GMH] failed to persist memory block', err);
                    }
                }
            })
                .catch((err) => {
                logger.warn?.('[GMH] block persistence chain failed', err);
            });
            return saveChain;
        };
        const resolveSessionUrl = () => {
            const derived = typeof options.getSessionUrl === 'function' ? options.getSessionUrl() : null;
            const current = blockBuilder.getSessionUrl();
            if (derived && derived !== current) {
                blockBuilder.setSessionUrl(derived);
                const updated = blockBuilder.getSessionUrl();
                if (updated && updated !== lastPrimedSession && updated !== currentPrimingSession) {
                    schedulePrime(updated);
                }
                return updated;
            }
            if (!current && derived) {
                blockBuilder.setSessionUrl(derived);
                const updated = blockBuilder.getSessionUrl();
                if (updated && updated !== lastPrimedSession && updated !== currentPrimingSession) {
                    schedulePrime(updated);
                }
                return updated;
            }
            if (current && current !== lastPrimedSession && current !== currentPrimingSession) {
                schedulePrime(current);
            }
            return current ?? derived ?? null;
        };
        const messageHasRenderableContent = (message) => {
            if (!message)
                return false;
            if (Array.isArray(message.parts)) {
                const richPart = message.parts.some((part) => {
                    if (!part || part.type === 'info' || part.speaker === 'INFO')
                        return false;
                    if (typeof part.text === 'string' && part.text.trim().length > 0)
                        return true;
                    if (Array.isArray(part.lines) && part.lines.some((line) => typeof line === 'string' && line.trim().length > 0)) {
                        return true;
                    }
                    if (Array.isArray(part.items) &&
                        part.items.some((item) => {
                            const text = typeof item === 'string' ? item : String(item ?? '');
                            return text.trim().length > 0;
                        })) {
                        return true;
                    }
                    return false;
                });
                if (richPart)
                    return true;
            }
            const legacyLines = Reflect.get(message, 'legacyLines');
            if (Array.isArray(legacyLines)) {
                return legacyLines.some((line) => {
                    if (typeof line !== 'string')
                        return false;
                    const trimmed = line.trim();
                    if (!trimmed)
                        return false;
                    if (trimmed.toUpperCase() === 'INFO')
                        return false;
                    return true;
                });
            }
            return false;
        };
        const commitStructuredMessage = (structured, event) => {
            if (!structured.id && event.messageId) {
                structured.id = event.messageId;
            }
            if (event.index >= 0) {
                structured.ordinal = event.index + 1;
            }
            else {
                structured.ordinal = event.ordinal;
            }
            if (!structured.channel && event.channel) {
                structured.channel = event.channel;
            }
            if (structured.index === undefined || structured.index === null) {
                structured.index = event.index >= 0 ? event.index : null;
            }
            notifyStructuredListeners(structured);
            const sessionUrl = resolveSessionUrl();
            const blocks = blockBuilder.append(structured, {
                sessionUrl,
                timestamp: event.timestamp,
            });
            if (blocks.length) {
                void persistBlocks(blocks);
            }
        };
        const attemptProcessMessageEvent = (event, attempt) => {
            if (!running)
                return;
            let structured = null;
            try {
                structured = options.collectStructuredMessage(event.element);
            }
            catch (err) {
                logger.warn?.('[GMH] collectStructuredMessage failed', err);
                structured = null;
            }
            const hasRenderableContent = messageHasRenderableContent(structured);
            if ((!structured || !hasRenderableContent) && attempt < MESSAGE_EVENT_MAX_ATTEMPTS) {
                scheduleMessageEventProcessing(event, attempt + 1);
                return;
            }
            if (!structured)
                return;
            commitStructuredMessage(structured, event);
        };
        const scheduleMessageEventProcessing = (event, attempt = 0) => {
            if (!running)
                return;
            const delay = attempt === 0 ? MESSAGE_EVENT_SETTLE_DELAY_MS : MESSAGE_EVENT_RETRY_INTERVAL_MS;
            const timer = setTimeout(() => {
                delayedEventTimers.delete(timer);
                if (!running)
                    return;
                attemptProcessMessageEvent(event, attempt);
            }, delay);
            delayedEventTimers.add(timer);
        };
        const flushPendingEvents = () => {
            if (!primed || !pendingMessageEvents.length)
                return;
            const queue = pendingMessageEvents.splice(0, pendingMessageEvents.length);
            queue.forEach((event) => {
                scheduleMessageEventProcessing(event);
            });
        };
        const handleMessageEvent = (event) => {
            if (!primed) {
                pendingMessageEvents.push(event);
                return;
            }
            scheduleMessageEventProcessing(event);
        };
        const awaitPriming = async () => {
            if (primePromise) {
                try {
                    await primePromise;
                }
                catch {
                    // errors already logged in schedulePrime
                }
            }
            flushPendingEvents();
        };
        const primeFromStorage = async (sessionUrl) => {
            if (!sessionUrl)
                return;
            if (typeof blockBuilder.primeFromBlocks !== 'function')
                return;
            const store = await ensureStorage();
            if (!store)
                return;
            try {
                const existingBlocks = await store.getBySession(sessionUrl);
                if (Array.isArray(existingBlocks) && existingBlocks.length) {
                    blockBuilder.primeFromBlocks(existingBlocks);
                }
            }
            catch (err) {
                logger.warn?.('[GMH] failed to prime block builder from storage', err);
            }
        };
        const schedulePrime = (sessionUrl) => {
            if (!sessionUrl) {
                primed = true;
                flushPendingEvents();
                return;
            }
            if (sessionUrl === currentPrimingSession) {
                return;
            }
            if (sessionUrl === lastPrimedSession) {
                primed = true;
                flushPendingEvents();
                return;
            }
            currentPrimingSession = sessionUrl;
            primed = false;
            const generation = ++primeGeneration;
            primePromise = (async () => {
                await primeFromStorage(sessionUrl);
            })();
            primePromise
                ?.catch((err) => {
                logger.warn?.('[GMH] block priming failed', err);
            })
                .finally(() => {
                if (generation !== primeGeneration) {
                    return;
                }
                primePromise = null;
                lastPrimedSession = sessionUrl;
                currentPrimingSession = null;
                primed = true;
                flushPendingEvents();
            });
        };
        const start = () => {
            if (running)
                return;
            running = true;
            resolveSessionUrl();
            unsubscribeMessages = messageIndexer.subscribeMessages(handleMessageEvent);
            messageIndexer.refresh({ immediate: true });
            messageIndexer.start();
        };
        const stop = () => {
            if (!running)
                return;
            running = false;
            delayedEventTimers.forEach((timer) => {
                clearTimeout(timer);
            });
            delayedEventTimers.clear();
            pendingMessageEvents.length = 0;
            if (unsubscribeMessages) {
                unsubscribeMessages();
                unsubscribeMessages = null;
            }
            messageIndexer.stop();
        };
        const flush = async (optionsArg) => {
            await awaitPriming();
            const sessionUrl = optionsArg?.sessionUrl ?? resolveSessionUrl();
            const timestamp = resolveTimestamp(optionsArg?.timestamp);
            const blocks = blockBuilder.flush({
                includePartial: optionsArg?.includePartial,
                sessionUrl,
                timestamp,
            });
            await persistBlocks(blocks);
            return blocks.length;
        };
        const api = {
            start,
            stop,
            isRunning() {
                return running;
            },
            flush(optionsArg) {
                return flush(optionsArg);
            },
            getBuffer() {
                return blockBuilder.getBuffer();
            },
            getSessionUrl() {
                return blockBuilder.getSessionUrl();
            },
            setSessionUrl(next) {
                blockBuilder.setSessionUrl(next);
                schedulePrime(blockBuilder.getSessionUrl());
            },
            subscribeBlocks(listener) {
                if (typeof listener !== 'function')
                    return () => { };
                blockListeners.add(listener);
                return () => blockListeners.delete(listener);
            },
            subscribeMessages(listener) {
                if (typeof listener !== 'function')
                    return () => { };
                structuredListeners.add(listener);
                return () => structuredListeners.delete(listener);
            },
        };
        return api;
    };

    const SECTION_ID = 'gmh-section-memory';
    const SECTION_CLASS = 'gmh-panel__section';
    const DEFAULT_STATUS_TEXT = '상태: ⛔ 비활성화됨';
    const VIEWER_BUTTON_SELECTOR = '[data-action="open-block-viewer"]';
    const isPromiseLike$1 = (value) => typeof value === 'object' && value !== null && 'then' in value;
    const cloneMessage = (value) => {
        if (!value || typeof value !== 'object')
            return value;
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            }
            catch {
                // fall back to JSON clone
            }
        }
        return JSON.parse(JSON.stringify(value));
    };
    const formatRelativeTime = (timestamp, now) => {
        if (!timestamp)
            return '마지막 저장: 기록 없음';
        const diff = Math.max(0, now - timestamp);
        if (diff < 1000)
            return '마지막 저장: 방금 전';
        if (diff < 60000) {
            const seconds = Math.floor(diff / 1000);
            return `마지막 저장: ${seconds}초 전`;
        }
        if (diff < 3600000) {
            const minutes = Math.floor(diff / 60000);
            return `마지막 저장: ${minutes}분 전`;
        }
        if (diff < 86400000) {
            const hours = Math.floor(diff / 3600000);
            return `마지막 저장: ${hours}시간 전`;
        }
        const days = Math.floor(diff / 86400000);
        return `마지막 저장: ${days}일 전`;
    };
    const formatSessionLabel = (sessionUrl) => {
        if (!sessionUrl)
            return '현재 세션: -';
        try {
            const parsed = new URL(sessionUrl);
            const query = parsed.search ? parsed.search : '';
            const base = `${parsed.hostname}${parsed.pathname.replace(/\/$/, '') || ''}${query}`;
            if (base.length <= 64) {
                return `현재 세션: ${base}`;
            }
            return `현재 세션: ${base.slice(0, 61)}…`;
        }
        catch {
            return sessionUrl.length <= 64 ? `현재 세션: ${sessionUrl}` : `현재 세션: ${sessionUrl.slice(0, 61)}…`;
        }
    };
    const resolveBlockMessageCount = (block) => {
        if (Array.isArray(block.messages)) {
            return block.messages.length;
        }
        const metaSize = Number(block.meta?.blockSize);
        if (Number.isFinite(metaSize) && metaSize >= 0) {
            return Math.floor(metaSize);
        }
        return 0;
    };
    const createMemoryStatus = (options = {}) => {
        const doc = options.documentRef ?? (typeof document !== 'undefined' ? document : null);
        const win = options.windowRef ?? (typeof window !== 'undefined' ? window : null);
        const logger = options.console ?? (typeof console !== 'undefined' ? console : null);
        let enabled = Boolean(options.experimentalEnabled);
        const sessionTotals = new Map();
        const resolvingSessions = new Set();
        let snapshot = {
            enabled,
            totalBlocks: 0,
            totalMessages: 0,
            sessionUrl: null,
            sessionBlocks: 0,
            sessionMessages: 0,
            lastSavedAt: null,
        };
        let section = null;
        let stateField = null;
        let totalsField = null;
        let sessionField = null;
        let lastField = null;
        let viewerButton = null;
        let rafHandle = null;
        let pendingRender = false;
        let relativeTimer = null;
        let blockUnsubscribe = null;
        let storageResolved = null;
        let storagePromise = null;
        let storageError = null;
        let blockViewerResolver = typeof options.getBlockViewer === 'function' ? options.getBlockViewer : null;
        const messageStream = options.messageStream ?? null;
        const requestFrame = (callback) => {
            if (win && typeof win.requestAnimationFrame === 'function') {
                return win.requestAnimationFrame(callback);
            }
            return setTimeout(callback, 16);
        };
        const cancelFrame = (handle) => {
            if (handle === null)
                return;
            if (win && typeof win.cancelAnimationFrame === 'function') {
                win.cancelAnimationFrame(handle);
            }
            else {
                clearTimeout(handle);
            }
        };
        const ensureRelativeTimer = () => {
            if (!enabled || !snapshot.lastSavedAt) {
                if (relativeTimer) {
                    if (win && typeof win.clearInterval === 'function') {
                        win.clearInterval(relativeTimer);
                    }
                    else {
                        clearInterval(relativeTimer);
                    }
                    relativeTimer = null;
                }
                return;
            }
            if (relativeTimer)
                return;
            const handler = () => {
                if (!enabled || !snapshot.lastSavedAt) {
                    if (relativeTimer) {
                        if (win && typeof win.clearInterval === 'function') {
                            win.clearInterval(relativeTimer);
                        }
                        else {
                            clearInterval(relativeTimer);
                        }
                        relativeTimer = null;
                    }
                    return;
                }
                scheduleRender();
            };
            if (win && typeof win.setInterval === 'function') {
                relativeTimer = win.setInterval(handler, 1000);
            }
            else {
                relativeTimer = setInterval(handler, 1000);
            }
        };
        const resolveStorage = async () => {
            if (storageResolved)
                return storageResolved;
            if (storageError)
                return null;
            if (storagePromise)
                return storagePromise;
            const source = options.blockStorage;
            if (!source)
                return null;
            if (isPromiseLike$1(source)) {
                storagePromise = source
                    .then((store) => {
                    storageResolved = store;
                    return store;
                })
                    .catch((err) => {
                    storageError = err;
                    logger?.warn?.('[GMH] memory status storage unavailable', err);
                    return null;
                });
                return storagePromise;
            }
            storageResolved = source;
            return storageResolved;
        };
        const resolveBlockViewer = () => {
            if (!blockViewerResolver)
                return null;
            try {
                const viewer = blockViewerResolver();
                if (viewer && typeof viewer.open === 'function') {
                    return viewer;
                }
                return null;
            }
            catch (err) {
                logger?.warn?.('[GMH] block viewer resolver failed', err);
                return null;
            }
        };
        const setViewerButtonState = () => {
            if (!viewerButton)
                return;
            const viewer = resolveBlockViewer();
            viewerButton.disabled = !viewer;
        };
        const handleOpenViewer = async () => {
            if (!enabled)
                return;
            const viewer = resolveBlockViewer();
            if (!viewer) {
                logger?.warn?.('[GMH] block viewer unavailable');
                return;
            }
            if (viewerButton) {
                viewerButton.disabled = true;
            }
            try {
                await viewer.open();
            }
            catch (err) {
                logger?.warn?.('[GMH] failed to open block viewer', err);
            }
            finally {
                setViewerButtonState();
            }
        };
        const getCurrentSessionUrl = () => {
            if (options.getSessionUrl) {
                try {
                    const derived = options.getSessionUrl();
                    if (derived)
                        return derived;
                }
                catch (err) {
                    logger?.warn?.('[GMH] memory status session resolver failed', err);
                }
            }
            if (messageStream && typeof messageStream.getSessionUrl === 'function') {
                try {
                    return messageStream.getSessionUrl();
                }
                catch (err) {
                    logger?.warn?.('[GMH] memory status stream session lookup failed', err);
                }
            }
            return null;
        };
        const computeSessionTotals = (blocks) => {
            const totals = blocks.reduce((acc, block) => {
                const count = resolveBlockMessageCount(block);
                return {
                    blocks: acc.blocks + 1,
                    messages: acc.messages + count,
                };
            }, { blocks: 0, messages: 0 });
            return totals;
        };
        const ensureSessionStats = async (sessionUrl) => {
            if (!sessionUrl || sessionTotals.has(sessionUrl) || resolvingSessions.has(sessionUrl))
                return;
            resolvingSessions.add(sessionUrl);
            try {
                const store = await resolveStorage();
                if (!store)
                    return;
                const blocks = await store.getBySession(sessionUrl);
                sessionTotals.set(sessionUrl, computeSessionTotals(blocks));
                scheduleRender();
            }
            catch (err) {
                logger?.warn?.('[GMH] memory status session fetch failed', err);
            }
            finally {
                resolvingSessions.delete(sessionUrl);
            }
        };
        const refreshTotals = async () => {
            try {
                const store = await resolveStorage();
                if (!store)
                    return;
                const stats = await store.getStats();
                snapshot = {
                    ...snapshot,
                    totalBlocks: stats.totalBlocks ?? 0,
                    totalMessages: stats.totalMessages ?? 0,
                };
                const currentSession = getCurrentSessionUrl();
                snapshot = { ...snapshot, sessionUrl: currentSession };
                if (currentSession) {
                    await ensureSessionStats(currentSession);
                }
                scheduleRender();
            }
            catch (err) {
                logger?.warn?.('[GMH] memory status stats refresh failed', err);
            }
        };
        const scheduleRender = () => {
            if (!section)
                return;
            if (pendingRender)
                return;
            pendingRender = true;
            rafHandle = requestFrame(() => {
                pendingRender = false;
                render();
            });
        };
        const render = () => {
            if (!section)
                return;
            snapshot = {
                ...snapshot,
                enabled,
                sessionUrl: getCurrentSessionUrl(),
            };
            if (!stateField || !totalsField || !sessionField || !lastField)
                return;
            if (!enabled) {
                section.hidden = true;
                snapshot = {
                    ...snapshot,
                    sessionBlocks: 0,
                    sessionMessages: 0,
                };
                stateField.textContent = DEFAULT_STATUS_TEXT;
                totalsField.textContent = '저장된 블록: 0개 (0 메시지)';
                sessionField.textContent = '현재 세션: -';
                lastField.textContent = '마지막 저장: 기록 없음';
                if (viewerButton) {
                    viewerButton.disabled = true;
                }
                return;
            }
            section.hidden = false;
            stateField.textContent = '상태: ✅ 활성화됨';
            setViewerButtonState();
            const currentSession = snapshot.sessionUrl;
            if (currentSession && !sessionTotals.has(currentSession)) {
                void ensureSessionStats(currentSession);
            }
            const sessionCounts = currentSession
                ? sessionTotals.get(currentSession) ?? { blocks: 0, messages: 0 }
                : { blocks: 0, messages: 0 };
            snapshot = {
                ...snapshot,
                sessionBlocks: sessionCounts.blocks,
                sessionMessages: sessionCounts.messages,
            };
            totalsField.textContent = `저장된 블록: ${snapshot.totalBlocks}개 (${snapshot.totalMessages} 메시지)`;
            sessionField.textContent = `${formatSessionLabel(currentSession)} · ${sessionCounts.blocks}개 (${sessionCounts.messages} 메시지)`;
            const now = Date.now();
            lastField.textContent = formatRelativeTime(snapshot.lastSavedAt, now);
            if (snapshot.lastSavedAt) {
                ensureRelativeTimer();
            }
        };
        const ensureSection = (panel) => {
            if (!doc || !panel)
                return null;
            const existing = panel.querySelector(`#${SECTION_ID}`);
            if (existing) {
                section = existing;
            }
            else if (!section) {
                section = doc.createElement('section');
                section.id = SECTION_ID;
                section.className = SECTION_CLASS;
                section.innerHTML = `
        <div class="gmh-panel__section-title">
          <span aria-hidden="true">🧠</span>
          <span style="margin-left:6px;">Memory Index</span>
          <span style="margin-left:8px; font-size:11px; color:#93c5fd;">실험 기능</span>
        </div>
        <div class="gmh-memory-status__body">
          <p data-field="state" class="gmh-memory-status__line">${DEFAULT_STATUS_TEXT}</p>
          <p data-field="totals" class="gmh-memory-status__line">저장된 블록: 0개 (0 메시지)</p>
          <p data-field="session" class="gmh-memory-status__line">현재 세션: -</p>
          <p data-field="last" class="gmh-memory-status__line">마지막 저장: 기록 없음</p>
          <div class="gmh-memory-status__actions">
            <button type="button" class="gmh-memory-status__button" data-action="open-block-viewer">블록 상세 보기</button>
          </div>
        </div>
      `;
            }
            if (!section)
                return null;
            stateField = section.querySelector('[data-field="state"]');
            totalsField = section.querySelector('[data-field="totals"]');
            sessionField = section.querySelector('[data-field="session"]');
            lastField = section.querySelector('[data-field="last"]');
            const nextButton = section.querySelector(VIEWER_BUTTON_SELECTOR);
            if (viewerButton && viewerButton !== nextButton) {
                viewerButton.removeEventListener('click', handleOpenViewer);
            }
            viewerButton = nextButton;
            if (viewerButton) {
                viewerButton.addEventListener('click', handleOpenViewer);
                setViewerButtonState();
            }
            if (!section.parentElement) {
                const exportSection = panel.querySelector(`#gmh-section-export`);
                if (exportSection?.parentElement === panel) {
                    panel.insertBefore(section, exportSection);
                }
                else {
                    panel.insertBefore(section, panel.firstChild);
                }
            }
            return section;
        };
        const handleBlock = (block) => {
            const safeBlock = cloneMessage(block);
            snapshot = {
                ...snapshot,
                totalBlocks: snapshot.totalBlocks + 1,
                totalMessages: snapshot.totalMessages + resolveBlockMessageCount(safeBlock),
                lastSavedAt: Math.max(snapshot.lastSavedAt ?? 0, Number(safeBlock.timestamp) || Date.now()),
            };
            const current = sessionTotals.get(safeBlock.sessionUrl) ?? { blocks: 0, messages: 0 };
            const increment = resolveBlockMessageCount(safeBlock);
            sessionTotals.set(safeBlock.sessionUrl, {
                blocks: current.blocks + 1,
                messages: current.messages + increment,
            });
            scheduleRender();
        };
        const ensureSubscriptions = () => {
            if (!enabled)
                return;
            if (!messageStream || typeof messageStream.subscribeBlocks !== 'function')
                return;
            if (blockUnsubscribe)
                return;
            blockUnsubscribe = messageStream.subscribeBlocks((block) => handleBlock(block));
        };
        const teardownSubscriptions = () => {
            if (blockUnsubscribe) {
                blockUnsubscribe();
                blockUnsubscribe = null;
            }
            if (relativeTimer) {
                if (win && typeof win.clearInterval === 'function') {
                    win.clearInterval(relativeTimer);
                }
                else {
                    clearInterval(relativeTimer);
                }
                relativeTimer = null;
            }
        };
        const mount = (panel) => {
            if (!panel)
                return;
            const target = ensureSection(panel);
            if (!target)
                return;
            if (!enabled) {
                target.hidden = true;
                render();
                return;
            }
            target.hidden = false;
            ensureSubscriptions();
            void refreshTotals();
        };
        const setEnabled = (next) => {
            if (enabled === next)
                return;
            enabled = next;
            snapshot = { ...snapshot, enabled: next };
            if (!section)
                return;
            if (!enabled) {
                teardownSubscriptions();
                section.hidden = true;
                render();
                return;
            }
            ensureSubscriptions();
            void refreshTotals();
            section.hidden = false;
            scheduleRender();
        };
        const destroy = () => {
            teardownSubscriptions();
            cancelFrame(rafHandle);
            rafHandle = null;
            pendingRender = false;
            if (section?.parentElement) {
                section.parentElement.removeChild(section);
            }
            section = null;
            stateField = null;
            totalsField = null;
            sessionField = null;
            lastField = null;
            if (viewerButton) {
                viewerButton.removeEventListener('click', handleOpenViewer);
                viewerButton = null;
            }
        };
        const forceRefresh = async () => {
            await refreshTotals();
        };
        return {
            mount,
            setEnabled,
            destroy,
            forceRefresh,
            setBlockViewerResolver(getter) {
                blockViewerResolver = typeof getter === 'function' ? getter : null;
                setViewerButtonState();
            },
        };
    };

    const isPromiseLike = (value) => typeof value === 'object' && value !== null && 'then' in value;
    const safeNumber = (value) => {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return Math.floor(numeric);
        }
        return 0;
    };
    const collectMessageLines = (message) => {
        if (!message || typeof message !== 'object')
            return [];
        const seen = new Set();
        const mainLines = [];
        const infoLines = [];
        const pushLine = (line, bucket) => {
            if (typeof line !== 'string')
                return;
            const trimmed = line.trim();
            if (!trimmed)
                return;
            if (trimmed.toUpperCase() === 'INFO' && bucket === 'info') ;
            if (seen.has(trimmed))
                return;
            seen.add(trimmed);
            if (bucket === 'info') {
                infoLines.push(trimmed);
            }
            else {
                mainLines.push(trimmed);
            }
        };
        if (Array.isArray(message.parts)) {
            message.parts.forEach((part) => {
                if (!part)
                    return;
                const bucket = part.type === 'info' || part.speaker === 'INFO' ? 'info' : 'main';
                pushLine(part.text, bucket);
                if (Array.isArray(part.lines)) {
                    part.lines.forEach((line) => pushLine(line, bucket));
                }
                if (Array.isArray(part.legacyLines)) {
                    part.legacyLines.forEach((line) => pushLine(line, bucket));
                }
                if (Array.isArray(part.items)) {
                    part.items.forEach((item) => {
                        const text = typeof item === 'string' ? item : String(item ?? '');
                        pushLine(text, bucket);
                    });
                }
            });
        }
        const legacyLines = Reflect.get(message, 'legacyLines');
        if (Array.isArray(legacyLines)) {
            legacyLines.forEach((line) => {
                const trimmed = typeof line === 'string' ? line.trim() : '';
                if (!trimmed)
                    return;
                const bucket = trimmed.toUpperCase() === 'INFO' || trimmed.startsWith('기록코드') ? 'info' : 'main';
                pushLine(trimmed, bucket);
            });
        }
        return mainLines.concat(infoLines);
    };
    const summarizeMessageBody = (message) => {
        const lines = collectMessageLines(message);
        const full = lines.length ? lines.join('\n').trim() : '';
        if (!full) {
            return { full: '', excerpt: '(내용 없음)', truncated: false };
        }
        if (full.length > 150) {
            const excerpt = `${full.slice(0, 147).trimEnd()}…`;
            return { full, excerpt, truncated: true };
        }
        return { full, excerpt: full, truncated: false };
    };
    const normalizeMessageId = (message) => {
        if (typeof message?.id === 'string' && message.id.trim()) {
            return message.id.trim();
        }
        return 'NO_ID';
    };
    const selectDebugApi = (resolver) => {
        if (!resolver)
            return null;
        try {
            const api = resolver();
            if (api && typeof api.getSessionBlocks === 'function') {
                return api;
            }
            return null;
        }
        catch {
            return null;
        }
    };
    const createEntry = (summary, loader, preloaded) => {
        const entry = {
            summary,
            detail: preloaded ?? null,
            detailLoaded: Boolean(preloaded),
            detailLoading: false,
            detailError: null,
            overlap: null,
            async ensureDetail() {
                if (entry.detailLoaded && entry.detail) {
                    return entry.detail;
                }
                if (entry.detailLoading) {
                    return entry.detail;
                }
                entry.detailLoading = true;
                try {
                    const detail = await loader();
                    if (detail) {
                        entry.detail = detail;
                        entry.detailLoaded = true;
                        entry.detailError = null;
                        return detail;
                    }
                    entry.detail = null;
                    entry.detailLoaded = false;
                    entry.detailError = '블록을 불러올 수 없습니다';
                    return null;
                }
                catch (err) {
                    entry.detail = null;
                    entry.detailLoaded = false;
                    entry.detailError =
                        err instanceof Error && err.message ? err.message : '블록을 불러올 수 없습니다';
                    return null;
                }
                finally {
                    entry.detailLoading = false;
                }
            },
        };
        return entry;
    };
    const createBlockViewer = (options = {}) => {
        const doc = options.documentRef ?? (typeof document !== 'undefined' ? document : null);
        const modal = options.modal ?? null;
        const logger = options.logger ?? (typeof console !== 'undefined' ? console : null);
        if (!doc || !modal) {
            return {
                async open() {
                    logger?.warn?.('[GMH] block viewer unavailable');
                },
            };
        }
        let storageResolved = null;
        let storagePromise = null;
        let storageError = null;
        const ensureStorage = async () => {
            if (storageResolved)
                return storageResolved;
            if (storageError)
                return null;
            if (storagePromise)
                return storagePromise;
            const source = options.blockStorage;
            if (!source)
                return null;
            if (isPromiseLike(source)) {
                storagePromise = source
                    .then((store) => {
                    storageResolved = store;
                    return store;
                })
                    .catch((err) => {
                    storageError = err;
                    logger?.warn?.('[GMH] block viewer storage unavailable', err);
                    return null;
                });
                return storagePromise;
            }
            storageResolved = source;
            return storageResolved;
        };
        const resolveSessionUrl = () => {
            if (typeof options.getSessionUrl === 'function') {
                try {
                    const candidate = options.getSessionUrl();
                    return candidate ?? null;
                }
                catch (err) {
                    logger?.warn?.('[GMH] block viewer session resolver failed', err);
                }
            }
            return null;
        };
        const fetchEntries = async (sessionUrl) => {
            if (!sessionUrl) {
                return { entries: [], hadError: false };
            }
            const entries = new Map();
            let storageAttempted = false;
            let storageFailed = false;
            const debugApi = selectDebugApi(options.getDebugApi);
            if (debugApi) {
                try {
                    const summaries = debugApi.getSessionBlocks() ?? [];
                    summaries.forEach((summary) => {
                        if (!summary || typeof summary.id !== 'string')
                            return;
                        entries.set(summary.id, createEntry(summary, async () => debugApi.getBlockDetails(summary.id)));
                    });
                }
                catch (err) {
                    logger?.warn?.('[GMH] debug block fetch failed', err);
                }
            }
            try {
                storageAttempted = true;
                const store = await ensureStorage();
                if (!store) {
                    storageFailed = true;
                }
                else {
                    const records = await store.getBySession(sessionUrl);
                    records.forEach((record) => {
                        if (!record || typeof record.id !== 'string')
                            return;
                        if (entries.has(record.id))
                            return;
                        const detail = buildDebugBlockDetail(record);
                        const summary = toDebugBlockSummary(detail);
                        entries.set(record.id, createEntry(summary, async () => detail, detail));
                    });
                }
            }
            catch (err) {
                storageFailed = true;
                logger?.warn?.('[GMH] block viewer storage fetch failed', err);
            }
            const list = Array.from(entries.values());
            list.sort((a, b) => {
                const aStart = safeNumber(a.summary.ordinalRange?.[0]);
                const bStart = safeNumber(b.summary.ordinalRange?.[0]);
                if (aStart !== bStart)
                    return aStart - bStart;
                if (a.summary.timestamp !== b.summary.timestamp) {
                    return a.summary.timestamp - b.summary.timestamp;
                }
                return a.summary.id.localeCompare(b.summary.id);
            });
            let previous = null;
            list.forEach((entry) => {
                entry.overlap = null;
                if (previous) {
                    const prevStart = safeNumber(previous.summary.ordinalRange?.[0]);
                    const prevEnd = safeNumber(previous.summary.ordinalRange?.[1]);
                    const currentStart = safeNumber(entry.summary.ordinalRange?.[0]);
                    const currentEnd = safeNumber(entry.summary.ordinalRange?.[1]);
                    const overlapStart = Math.max(prevStart, currentStart);
                    const overlapEnd = Math.min(prevEnd, currentEnd);
                    if (overlapStart <= overlapEnd) {
                        entry.overlap = [overlapStart, overlapEnd];
                    }
                }
                previous = entry;
            });
            const hadError = list.length === 0 && storageAttempted && storageFailed;
            return { entries: list, hadError };
        };
        const createStatusElement = (docRef, text, tone = 'info') => {
            const node = docRef.createElement('p');
            node.className = 'gmh-block-viewer__status';
            if (tone === 'error') {
                node.classList.add('gmh-block-viewer__status--error');
            }
            node.textContent = text;
            return node;
        };
        const renderMessages = (docRef, detail) => {
            const wrapper = docRef.createElement('div');
            wrapper.className = 'gmh-block-viewer__messages';
            if (!Array.isArray(detail.messages) || !detail.messages.length) {
                const empty = docRef.createElement('p');
                empty.className = 'gmh-block-viewer__status';
                empty.textContent = '메시지가 없습니다';
                wrapper.appendChild(empty);
                return wrapper;
            }
            detail.messages.forEach((message, index) => {
                const item = docRef.createElement('div');
                item.className = 'gmh-block-viewer__message';
                const title = docRef.createElement('div');
                title.className = 'gmh-block-viewer__message-title';
                const speaker = typeof message?.speaker === 'string' && message.speaker.trim()
                    ? message.speaker.trim()
                    : typeof message?.role === 'string' && message.role.trim()
                        ? message.role.trim()
                        : '메시지';
                title.textContent = `[${index + 1}] ${speaker}`;
                item.appendChild(title);
                const summary = summarizeMessageBody(message);
                const body = docRef.createElement('div');
                body.className = 'gmh-block-viewer__message-body';
                body.textContent = summary.truncated ? summary.excerpt : summary.full;
                item.appendChild(body);
                if (summary.truncated) {
                    const toggle = docRef.createElement('button');
                    toggle.type = 'button';
                    toggle.className = 'gmh-block-viewer__message-toggle';
                    toggle.textContent = '더보기';
                    let expanded = false;
                    const applyState = () => {
                        body.textContent = expanded ? summary.full : summary.excerpt;
                        toggle.textContent = expanded ? '접기' : '더보기';
                    };
                    toggle.addEventListener('click', () => {
                        expanded = !expanded;
                        applyState();
                    });
                    applyState();
                    item.appendChild(toggle);
                }
                const idLine = docRef.createElement('div');
                idLine.className = 'gmh-block-viewer__message-id';
                idLine.textContent = `ID: ${normalizeMessageId(message)}`;
                item.appendChild(idLine);
                wrapper.appendChild(item);
            });
            return wrapper;
        };
        const buildBlockItem = (docRef, entry, index) => {
            const item = docRef.createElement('div');
            item.className = 'gmh-block-viewer__item';
            const header = docRef.createElement('div');
            header.className = 'gmh-block-viewer__item-header';
            const info = docRef.createElement('div');
            info.className = 'gmh-block-viewer__item-info';
            const [start, end] = entry.summary.ordinalRange;
            const title = docRef.createElement('p');
            title.className = 'gmh-block-viewer__item-title';
            title.textContent = `📦 블록 ${index + 1}: 메시지 ${start}-${end} (${entry.summary.messageCount}개)`;
            info.appendChild(title);
            const timestampLine = docRef.createElement('p');
            timestampLine.className = 'gmh-block-viewer__meta';
            timestampLine.textContent = `생성: ${entry.summary.timestampLabel}`;
            info.appendChild(timestampLine);
            if (entry.overlap) {
                const overlap = docRef.createElement('p');
                overlap.className = 'gmh-block-viewer__overlap';
                overlap.textContent = `overlap: ${entry.overlap[0]}-${entry.overlap[1]}`;
                info.appendChild(overlap);
            }
            header.appendChild(info);
            const toggle = docRef.createElement('button');
            toggle.type = 'button';
            toggle.className = 'gmh-block-viewer__toggle';
            toggle.textContent = '▼ 상세보기';
            header.appendChild(toggle);
            item.appendChild(header);
            const detail = docRef.createElement('div');
            detail.className = 'gmh-block-viewer__detail';
            detail.hidden = true;
            item.appendChild(detail);
            let expanded = false;
            const setToggleLabel = () => {
                toggle.textContent = expanded ? '▲ 접기' : '▼ 상세보기';
            };
            const showStatus = (text, tone = 'info') => {
                detail.innerHTML = '';
                detail.appendChild(createStatusElement(docRef, text, tone));
            };
            const ensureDetailRendered = async () => {
                const detailData = await entry.ensureDetail();
                detail.innerHTML = '';
                if (!detailData) {
                    const errorMessage = entry.detailError || '블록을 불러올 수 없습니다';
                    detail.appendChild(createStatusElement(docRef, errorMessage, 'error'));
                    return;
                }
                detail.appendChild(renderMessages(docRef, detailData));
            };
            toggle.addEventListener('click', async () => {
                expanded = !expanded;
                setToggleLabel();
                if (expanded) {
                    detail.hidden = false;
                    if (!entry.detailLoaded && !entry.detailLoading) {
                        showStatus('메시지를 불러오는 중...');
                        await ensureDetailRendered();
                    }
                    else if (entry.detailLoading) {
                        showStatus('메시지를 불러오는 중...');
                    }
                    else if (entry.detail) {
                        detail.innerHTML = '';
                        detail.appendChild(renderMessages(docRef, entry.detail));
                    }
                    else {
                        await ensureDetailRendered();
                    }
                }
                else {
                    detail.hidden = true;
                }
            });
            return item;
        };
        const renderEntries = (container, entries, hadError) => {
            container.innerHTML = '';
            if (hadError) {
                container.appendChild(createStatusElement(container.ownerDocument, '블록을 불러올 수 없습니다', 'error'));
                return;
            }
            if (!entries.length) {
                container.appendChild(createStatusElement(container.ownerDocument, '아직 저장된 블록이 없습니다'));
                return;
            }
            const header = container.ownerDocument.createElement('div');
            header.className = 'gmh-block-viewer__header';
            const title = container.ownerDocument.createElement('h3');
            title.className = 'gmh-block-viewer__heading';
            title.textContent = `💾 저장된 블록 (${entries.length}개)`;
            header.appendChild(title);
            container.appendChild(header);
            const list = container.ownerDocument.createElement('div');
            list.className = 'gmh-block-viewer__list';
            entries.forEach((entry, index) => {
                list.appendChild(buildBlockItem(container.ownerDocument, entry, index));
            });
            container.appendChild(list);
        };
        const renderError = (container) => {
            container.innerHTML = '';
            container.appendChild(createStatusElement(container.ownerDocument, '블록을 불러올 수 없습니다', 'error'));
        };
        const open = async () => {
            const container = doc.createElement('div');
            container.className = 'gmh-block-viewer';
            container.appendChild(createStatusElement(doc, '블록 불러오는 중...'));
            const sessionUrl = resolveSessionUrl();
            const modalPromise = modal.open({
                title: '💾 저장된 블록',
                content: container,
                size: 'large',
                actions: [{ label: '닫기', value: false, variant: 'secondary' }],
            });
            void fetchEntries(sessionUrl)
                .then(({ entries, hadError }) => {
                if (!container.isConnected)
                    return;
                renderEntries(container, entries, hadError);
            })
                .catch((err) => {
                logger?.warn?.('[GMH] block viewer failed to load entries', err);
                if (!container.isConnected)
                    return;
                renderError(container);
            });
            await modalPromise;
        };
        return {
            open,
        };
    };

    const DEFAULT_ALERT = (message) => {
        globalThis.alert?.(message);
    };
    function createPanelInteractions({ panelVisibility, setPanelStatus, setPrivacyProfile, getPrivacyProfile, privacyProfiles, configurePrivacyLists, openPanelSettings, ensureAutoLoadControlsModern, mountStatusActionsModern, mountMemoryStatusModern, bindRangeControls, bindShortcuts, bindGuideControls, prepareShare, performExport, copyRecentShare, copyAllShare, autoLoader, autoState, stateApi, stateEnum, alert: alertFn = DEFAULT_ALERT, logger = typeof console !== 'undefined' ? console : null, }) {
        if (!panelVisibility)
            throw new Error('createPanelInteractions requires panelVisibility');
        if (!setPrivacyProfile)
            throw new Error('createPanelInteractions requires setPrivacyProfile');
        if (!bindRangeControls)
            throw new Error('createPanelInteractions requires bindRangeControls');
        if (!bindShortcuts)
            throw new Error('createPanelInteractions requires bindShortcuts');
        if (!prepareShare || !performExport || !copyRecentShare || !copyAllShare) {
            throw new Error('createPanelInteractions requires share workflow helpers');
        }
        if (!stateApi || !stateEnum) {
            throw new Error('createPanelInteractions requires state helpers');
        }
        let privacySelect = null;
        const notify = (message, tone) => {
            if (typeof setPanelStatus === 'function' && message) {
                setPanelStatus(message, tone);
            }
        };
        const syncPrivacyProfileSelect = (profileKey) => {
            if (!privacySelect)
                return;
            const nextValue = profileKey ?? getPrivacyProfile?.();
            if (typeof nextValue === 'string' && privacySelect.value !== nextValue) {
                privacySelect.value = nextValue;
            }
        };
        const prepareShareWithDialog = (options) => prepareShare({
            confirmLabel: options?.confirmLabel,
            cancelStatusMessage: options?.cancelStatusMessage,
            blockedStatusMessage: options?.blockedStatusMessage,
        });
        const exportWithFormat = async (format, options = {}) => {
            const prepared = await prepareShareWithDialog({
                confirmLabel: options.confirmLabel,
                cancelStatusMessage: options.cancelStatusMessage,
                blockedStatusMessage: options.blockedStatusMessage,
            });
            if (!prepared)
                return;
            await performExport(prepared, format);
        };
        const copyRecent = () => copyRecentShare(prepareShareWithDialog);
        const copyAll = () => copyAllShare(prepareShareWithDialog);
        const isAutoRunning = () => Boolean(autoState?.running);
        const attachShareHandlers = (panel) => {
            const exportFormatSelect = panel.querySelector('#gmh-export-format');
            const quickExportBtn = panel.querySelector('#gmh-quick-export');
            const copyRecentBtn = panel.querySelector('#gmh-copy-recent');
            copyRecentBtn?.addEventListener('click', () => void copyRecent());
            const copyAllBtn = panel.querySelector('#gmh-copy-all');
            copyAllBtn?.addEventListener('click', () => void copyAll());
            const exportBtn = panel.querySelector('#gmh-export');
            exportBtn?.addEventListener('click', async () => {
                const format = exportFormatSelect?.value || 'json';
                await exportWithFormat(format, {
                    confirmLabel: '내보내기 진행',
                    cancelStatusMessage: '내보내기를 취소했습니다.',
                    blockedStatusMessage: '미성년자 민감 맥락으로 내보내기가 차단되었습니다.',
                });
            });
            if (quickExportBtn) {
                quickExportBtn.addEventListener('click', async () => {
                    if (!autoLoader || typeof autoLoader.start !== 'function') {
                        notify('자동 로더 기능을 사용할 수 없습니다.', 'warning');
                        return;
                    }
                    if (isAutoRunning()) {
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
                        await autoLoader.start('all');
                        const format = exportFormatSelect?.value || 'json';
                        await exportWithFormat(format, {
                            confirmLabel: `${format.toUpperCase()} 내보내기`,
                            cancelStatusMessage: '내보내기를 취소했습니다.',
                            blockedStatusMessage: '미성년자 민감 맥락으로 내보내기가 차단되었습니다.',
                        });
                    }
                    catch (error) {
                        const message = error && typeof error === 'object' && 'message' in error
                            ? String(error.message)
                            : String(error);
                        alertFn?.(`오류: ${message}`);
                        stateApi.setState(stateEnum.ERROR, {
                            label: '원클릭 실패',
                            message: '원클릭 내보내기 실패',
                            tone: 'error',
                            progress: { value: 1 },
                        });
                    }
                    finally {
                        quickExportBtn.disabled = false;
                        quickExportBtn.textContent = originalText ?? '';
                    }
                });
            }
        };
        const bindPanelInteractions = (panel) => {
            if (!panel || typeof panel.querySelector !== 'function') {
                logger?.warn?.('[GMH] panel interactions: invalid panel element');
                return;
            }
            panelVisibility.bind(panel);
            privacySelect = panel.querySelector('#gmh-privacy-profile');
            if (privacySelect) {
                syncPrivacyProfileSelect();
                privacySelect.addEventListener('change', (event) => {
                    const value = event.target.value;
                    setPrivacyProfile(value);
                    const label = privacyProfiles?.[value]?.label || value;
                    notify(`프라이버시 프로필이 ${label}로 설정되었습니다.`, 'info');
                });
            }
            const privacyConfigBtn = panel.querySelector('#gmh-privacy-config');
            privacyConfigBtn?.addEventListener('click', () => {
                void configurePrivacyLists?.();
            });
            const settingsBtn = panel.querySelector('#gmh-panel-settings');
            settingsBtn?.addEventListener('click', () => {
                openPanelSettings?.();
            });
            mountMemoryStatusModern?.(panel);
            ensureAutoLoadControlsModern?.(panel);
            mountStatusActionsModern?.(panel);
            bindRangeControls(panel);
            bindShortcuts(panel);
            bindGuideControls?.(panel);
            attachShareHandlers(panel);
        };
        return {
            bindPanelInteractions,
            syncPrivacyProfileSelect,
        };
    }

    function createModernPanel({ documentRef = typeof document !== 'undefined' ? document : null, ensureStyles, version = '0.0.0-dev', getActiveAdapter, attachStatusElement, stateView, bindPanelInteractions, panelId = 'genit-memory-helper-panel', logger = typeof console !== 'undefined' ? console : null, }) {
        const doc = documentRef;
        if (!doc)
            throw new Error('createModernPanel requires documentRef');
        if (typeof ensureStyles !== 'function')
            throw new Error('createModernPanel requires ensureStyles');
        if (typeof getActiveAdapter !== 'function')
            throw new Error('createModernPanel requires getActiveAdapter');
        if (!stateView || typeof stateView.bind !== 'function') {
            throw new Error('createModernPanel requires stateView with bind');
        }
        if (typeof bindPanelInteractions !== 'function') {
            throw new Error('createModernPanel requires bindPanelInteractions');
        }
        const log = logger || { warn: () => { } };
        const mount = () => {
            ensureStyles();
            const existing = doc.querySelector(`#${panelId}`);
            if (existing)
                return existing;
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
            attachStatusElement(statusEl ?? null);
            if (statusEl) {
                statusEl.setAttribute('role', 'status');
                statusEl.setAttribute('aria-live', 'polite');
            }
            const progressFill = panel.querySelector('#gmh-progress-fill');
            const progressLabel = panel.querySelector('#gmh-progress-label');
            stateView.bind({ progressFill, progressLabel });
            try {
                bindPanelInteractions(panel, { modern: true });
            }
            catch (error) {
                log?.warn?.('[GMH] panel interactions init failed', error);
            }
            return panel;
        };
        return { mount };
    }

    const DEFAULT_PREVIEW_LIMIT = 5;
    const ensureDocument = (documentRef) => {
        if (!documentRef || typeof documentRef.createElement !== 'function') {
            throw new Error('privacy gate requires a document reference');
        }
        return documentRef;
    };
    const defaultTruncate = (value, max = 220) => {
        const text = String(value ?? '').trim();
        if (text.length <= max)
            return text;
        return `${text.slice(0, max - 1)}…`;
    };
    const normalizeCounts = (counts) => {
        if (!counts)
            return {};
        if (typeof counts === 'object' &&
            'redactions' in counts &&
            counts.redactions &&
            typeof counts.redactions === 'object') {
            return counts.redactions;
        }
        return counts;
    };
    const buildTurns = ({ documentRef, previewTurns, previewLimit, rangeInfo, selectedIndices, selectedOrdinals, truncateText, }) => {
        const doc = ensureDocument(documentRef);
        const list = doc.createElement('ul');
        list.className = 'gmh-turn-list';
        const highlightActive = Boolean(rangeInfo?.active);
        const selectedIndexSet = new Set(selectedIndices ?? []);
        const ordinalLookup = new Map();
        (selectedIndices ?? []).forEach((index, i) => {
            const ordinal = selectedOrdinals?.[i] ?? null;
            ordinalLookup.set(index, ordinal);
        });
        const turns = Array.isArray(previewTurns) ? previewTurns : [];
        turns.slice(-previewLimit).forEach((turnRaw) => {
            if (!turnRaw)
                return;
            const turn = turnRaw;
            const item = doc.createElement('li');
            item.className = 'gmh-turn-list__item';
            item.tabIndex = 0;
            const turnData = turn;
            const sourceIndex = typeof turnData.__gmhIndex === 'number' ? turnData.__gmhIndex : null;
            if (sourceIndex !== null)
                item.dataset.turnIndex = String(sourceIndex);
            const playerOrdinal = typeof turnData.__gmhOrdinal === 'number'
                ? turnData.__gmhOrdinal
                : sourceIndex !== null && ordinalLookup.has(sourceIndex)
                    ? ordinalLookup.get(sourceIndex) ?? null
                    : null;
            if (typeof playerOrdinal === 'number') {
                item.dataset.playerTurn = String(playerOrdinal);
            }
            if (highlightActive && sourceIndex !== null && selectedIndexSet.has(sourceIndex)) {
                item.classList.add('gmh-turn-list__item--selected');
            }
            const speaker = doc.createElement('div');
            speaker.className = 'gmh-turn-list__speaker';
            const speakerLabel = doc.createElement('span');
            const speakerName = typeof turn.speaker === 'string' && turn.speaker.trim().length ? turn.speaker : '??';
            const roleLabel = typeof turn.role === 'string' ? turn.role : '';
            speakerLabel.textContent = `${speakerName} · ${roleLabel}`;
            speaker.appendChild(speakerLabel);
            if (typeof playerOrdinal === 'number' && playerOrdinal > 0) {
                const badge = doc.createElement('span');
                badge.className = 'gmh-turn-list__badge';
                badge.textContent = `메시지 ${playerOrdinal}`;
                speaker.appendChild(badge);
            }
            const text = doc.createElement('div');
            text.className = 'gmh-turn-list__text';
            const truncate = typeof truncateText === 'function' ? truncateText : defaultTruncate;
            const turnText = typeof turn.text === 'string'
                ? turn.text
                : typeof turn.text === 'string'
                    ? turn.text
                    : '';
            text.textContent = truncate(turnText || '');
            item.appendChild(speaker);
            item.appendChild(text);
            list.appendChild(item);
        });
        if (!list.children.length) {
            const empty = doc.createElement('li');
            empty.className = 'gmh-turn-list__item gmh-turn-list__empty';
            empty.textContent = '표시할 메시지가 없습니다. 상단 요약만 확인해주세요.';
            list.appendChild(empty);
        }
        return list;
    };
    const buildSummaryBox = ({ documentRef, formatRedactionCounts, privacyProfiles, profile, counts, stats, overallStats = null, rangeInfo, }) => {
        const doc = ensureDocument(documentRef);
        const summaryCounts = normalizeCounts(counts);
        const summary = typeof formatRedactionCounts === 'function' ? formatRedactionCounts(summaryCounts) : '';
        const profileLabel = privacyProfiles?.[profile]?.label ?? profile;
        const statsTotal = stats.totalMessages ?? stats.userMessages + stats.llmMessages;
        const overallTotal = overallStats?.totalMessages ?? overallStats?.userMessages ?? statsTotal;
        const turnsLabel = overallStats
            ? `유저 메시지 ${stats.userMessages}/${overallStats.userMessages} · 전체 메시지 ${statsTotal}/${overallTotal}`
            : `유저 메시지 ${stats.userMessages} · 전체 메시지 ${statsTotal}`;
        const container = doc.createElement('div');
        container.className = 'gmh-privacy-summary';
        const createRow = (labelText, valueText) => {
            const row = doc.createElement('div');
            row.className = 'gmh-privacy-summary__row';
            const labelEl = doc.createElement('span');
            labelEl.className = 'gmh-privacy-summary__label';
            labelEl.textContent = labelText;
            const valueEl = doc.createElement('span');
            valueEl.textContent = valueText;
            row.appendChild(labelEl);
            row.appendChild(valueEl);
            return row;
        };
        [
            createRow('프로필', profileLabel),
            createRow('메시지 수', turnsLabel),
            createRow('레다크션', summary),
        ].forEach((row) => container.appendChild(row));
        if (rangeInfo?.total) {
            const messageTotal = (typeof rangeInfo.messageTotal === 'number' && Number.isFinite(rangeInfo.messageTotal)
                ? rangeInfo.messageTotal
                : null) ?? rangeInfo.total;
            const rangeText = rangeInfo.active
                ? `메시지 ${rangeInfo.start}-${rangeInfo.end} · ${rangeInfo.count}/${messageTotal}`
                : `메시지 ${messageTotal}개 전체`;
            const extraParts = [];
            if (typeof rangeInfo.userTotal === 'number' && Number.isFinite(rangeInfo.userTotal)) {
                extraParts.push(`유저 ${rangeInfo.userTotal}개`);
            }
            if (typeof rangeInfo.llmTotal === 'number' && Number.isFinite(rangeInfo.llmTotal)) {
                extraParts.push(`LLM ${rangeInfo.llmTotal}개`);
            }
            const complement = extraParts.length ? ` · ${extraParts.join(' · ')}` : '';
            container.appendChild(createRow('범위', rangeText + complement));
        }
        return container;
    };
    function createModernPrivacyGate({ documentRef = typeof document !== 'undefined' ? document : null, formatRedactionCounts, privacyProfiles, ensureDesignSystemStyles, modal, truncateText = defaultTruncate, previewLimit = DEFAULT_PREVIEW_LIMIT, } = {}) {
        const doc = ensureDocument(documentRef);
        if (typeof ensureDesignSystemStyles !== 'function') {
            throw new Error('modern privacy gate requires ensureDesignSystemStyles');
        }
        if (!modal || typeof modal.open !== 'function') {
            throw new Error('modern privacy gate requires modal.open');
        }
        const confirm = async (options) => {
            const { profile, counts, stats, overallStats = null, rangeInfo = null, selectedIndices = [], selectedOrdinals = [], previewTurns = [], actionLabel = '계속', heading = '공유 전 확인', subheading = '외부로 공유하기 전에 민감정보가 없는지 확인하세요.', } = options;
            if (!profile)
                throw new Error('privacy gate confirm requires profile');
            if (!counts)
                throw new Error('privacy gate confirm requires counts');
            if (!stats)
                throw new Error('privacy gate confirm requires stats');
            ensureDesignSystemStyles();
            const stack = doc.createElement('div');
            stack.className = 'gmh-modal-stack';
            stack.appendChild(buildSummaryBox({
                documentRef: doc,
                formatRedactionCounts,
                privacyProfiles,
                profile,
                counts,
                stats,
                overallStats,
                rangeInfo,
            }));
            const previewList = Array.isArray(previewTurns) ? previewTurns : [];
            const previewTitle = doc.createElement('div');
            previewTitle.className = 'gmh-section-title';
            previewTitle.textContent = `미리보기 (${Math.min(previewList.length, previewLimit)}메시지)`;
            stack.appendChild(previewTitle);
            stack.appendChild(buildTurns({
                documentRef: doc,
                previewTurns: previewList,
                previewLimit,
                rangeInfo,
                selectedIndices,
                selectedOrdinals,
                truncateText,
            }));
            const footnote = doc.createElement('div');
            footnote.className = 'gmh-modal-footnote';
            footnote.textContent = subheading;
            stack.appendChild(footnote);
            const result = await modal.open({
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
            });
            return Boolean(result);
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

    function createGuideControls({ reparse, copySummaryGuide, copyResummaryGuide, logger = typeof console !== 'undefined' ? console : null, }) {
        if (typeof copySummaryGuide !== 'function' || typeof copyResummaryGuide !== 'function') {
            throw new Error('createGuideControls requires summary and resummary copy functions');
        }
        const bindGuideControls = (panel) => {
            if (!panel || typeof panel.querySelector !== 'function') {
                logger?.warn?.('[GMH] guide controls: panel missing querySelector');
                return;
            }
            const reparseBtn = panel.querySelector('#gmh-reparse');
            if (reparseBtn && typeof reparse === 'function') {
                reparseBtn.addEventListener('click', () => reparse());
            }
            const guideBtn = panel.querySelector('#gmh-guide');
            if (guideBtn) {
                guideBtn.addEventListener('click', () => {
                    void copySummaryGuide();
                });
            }
            const reguideBtn = panel.querySelector('#gmh-reguide');
            if (reguideBtn) {
                reguideBtn.addEventListener('click', () => {
                    void copyResummaryGuide();
                });
            }
        };
        return { bindGuideControls };
    }

    const ensureAdaptersNamespace = (GMH) => {
        if (!GMH.Adapters || typeof GMH.Adapters !== 'object') {
            GMH.Adapters = {};
        }
        return GMH.Adapters;
    };
    const ensureCoreNamespace = (GMH) => {
        if (!GMH.Core || typeof GMH.Core !== 'object') {
            GMH.Core = {};
        }
        return GMH.Core;
    };
    const registerGenitConfig = (registerAdapterConfig) => {
        const config = {
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
        };
        registerAdapterConfig('genit', config);
    };
    const registerBabechatConfig = (registerAdapterConfig) => {
        const config = {
            selectors: {
                chatContainers: [
                    'form > div.overflow-hidden > div',
                    'form > div.overflow-hidden',
                    'form',
                ],
                // Turn wrapper - each turn is wrapped in this
                messageRoot: [
                    'div.flex.flex-col.gap-3.px-5.pt-4',
                ],
                playerScopes: [
                    '.justify-end',
                ],
                playerText: [
                    '[class*="B56576"]',
                    '[class*="bg-[#B56576]"]',
                ],
                npcGroups: [
                    'a[href*="/character/"]',
                ],
                npcBubble: [
                    '[class*="262727"]',
                    '[class*="bg-[#262727]"]',
                ],
                narrationBlocks: [
                    '[class*="363636"]',
                    '[class*="bg-[#363636]"]',
                ],
                characterName: [
                    '.text-\\[0\\.75rem\\]',
                    '[class*="text-[0.75rem]"]',
                ],
                avatarLink: [
                    'a[href*="/character/"]',
                ],
                statusBlock: [
                // Status blocks contain emoji indicators
                ],
                panelAnchor: ['#__next', 'main', 'body'],
                textHints: ['메시지', '채팅'],
            },
        };
        registerAdapterConfig('babechat', config);
    };
    const isPrologueBlock = (element) => {
        let current = element instanceof Element ? element : null;
        let hops = 0;
        while (current && hops < 400) {
            if (current.hasAttribute?.('data-gmh-player-turn'))
                return false;
            if (current.previousElementSibling) {
                current = current.previousElementSibling;
            }
            else {
                current = current.parentElement;
            }
            hops += 1;
        }
        return true;
    };
    const createAdapterAPI = ({ GMH, errorHandler, PLAYER_NAME_FALLBACKS, setPlayerNames, getPlayerNames, defaultAdapter, }) => {
        const adapters = ensureAdaptersNamespace(GMH);
        const core = ensureCoreNamespace(GMH);
        adapters.Registry = adapters.Registry ?? null;
        adapters.register =
            adapters.register ?? ((_name, _config) => undefined);
        adapters.getSelectors =
            adapters.getSelectors ??
                ((_name) => {
                    return {};
                });
        adapters.getMetadata =
            adapters.getMetadata ??
                ((_name) => {
                    return {};
                });
        adapters.list = adapters.list ?? (() => []);
        const warnDetectFailure = (err) => {
            const level = errorHandler?.LEVELS?.WARN || 'warn';
            errorHandler?.handle?.(err, 'adapter/detect', level);
        };
        const pickAdapter = (loc = location, doc = document) => {
            const candidates = Array.isArray(core.adapters) ? core.adapters : [];
            for (const adapter of candidates) {
                try {
                    if (adapter?.match?.(loc, doc))
                        return adapter;
                }
                catch (err) {
                    warnDetectFailure(err);
                }
            }
            return adapters.genit ?? defaultAdapter;
        };
        core.pickAdapter = pickAdapter;
        let activeAdapter = null;
        const getActiveAdapter = () => {
            if (!activeAdapter) {
                activeAdapter = pickAdapter(location, document);
            }
            return activeAdapter;
        };
        core.getActiveAdapter = getActiveAdapter;
        const guessPlayerNamesFromDOM = () => {
            const adapter = getActiveAdapter();
            return adapter?.guessPlayerNames?.() || [];
        };
        const updatePlayerNames = () => {
            const uniqueNames = new Set([...PLAYER_NAME_FALLBACKS, ...guessPlayerNamesFromDOM()].filter((value) => typeof value === 'string' && value.length > 0));
            const names = Array.from(uniqueNames);
            setPlayerNames(names);
            adapters.genit?.setPlayerNameAccessor?.(() => getPlayerNames());
        };
        return {
            pickAdapter,
            getActiveAdapter,
            guessPlayerNamesFromDOM,
            updatePlayerNames,
            resetActiveAdapter: () => {
                activeAdapter = null;
            },
        };
    };
    /**
     * Registers available DOM adapters and exposes helper APIs for adapter selection.
     *
     * @param options Injection container.
     * @returns Adapter utilities bound to the GMH namespace.
     */
    const composeAdapters = ({ GMH, adapterRegistry, registerAdapterConfig, getAdapterSelectors, getAdapterMetadata, listAdapterNames, createGenitAdapter, createBabechatAdapter, errorHandler, getPlayerNames, setPlayerNames, PLAYER_NAME_FALLBACKS, }) => {
        const adapters = ensureAdaptersNamespace(GMH);
        const core = ensureCoreNamespace(GMH);
        adapters.Registry = adapterRegistry;
        adapters.register = (name, config) => registerAdapterConfig(name, config);
        adapters.getSelectors = (name) => getAdapterSelectors(name);
        adapters.getMetadata = (name) => getAdapterMetadata(name);
        adapters.list = () => listAdapterNames();
        // Register adapter configs
        registerGenitConfig(registerAdapterConfig);
        registerBabechatConfig(registerAdapterConfig);
        // Create genit adapter
        const genitAdapter = createGenitAdapter({
            registry: adapterRegistry,
            getPlayerNames,
            isPrologueBlock,
            errorHandler,
        });
        adapters.genit = genitAdapter;
        // Create babechat adapter if factory provided
        let babechatAdapter;
        if (createBabechatAdapter) {
            babechatAdapter = createBabechatAdapter({
                registry: adapterRegistry,
                getPlayerNames,
                errorHandler,
            });
            adapters.babechat = babechatAdapter;
        }
        // Register all adapters (babechat first for URL matching priority)
        core.adapters = babechatAdapter ? [babechatAdapter, genitAdapter] : [genitAdapter];
        const api = createAdapterAPI({
            GMH,
            errorHandler,
            PLAYER_NAME_FALLBACKS,
            setPlayerNames,
            getPlayerNames,
            defaultAdapter: genitAdapter,
        });
        api.updatePlayerNames();
        return {
            genitAdapter,
            babechatAdapter,
            ...api,
        };
    };

    /**
     * Builds the privacy configuration pipeline and persistence store.
     *
     * @param options Dependency container.
     * @returns Privacy helpers bound to runtime configuration.
     */
    const composePrivacy = ({ createPrivacyStore, createPrivacyPipeline, PRIVACY_PROFILES, DEFAULT_PRIVACY_PROFILE, collapseSpaces, privacyRedactText, hasMinorSexualContext, getPlayerNames, ENV, errorHandler, }) => {
        const privacyStore = createPrivacyStore({
            storage: ENV.localStorage ?? null,
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
        const pipelineRedactText = (text, profileKey, counts, _config, _profiles) => privacyRedactText(text, profileKey, counts, privacyConfig, PRIVACY_PROFILES);
        const boundRedactText = (text, profileKey, counts) => privacyRedactText(text, profileKey, counts, privacyConfig, PRIVACY_PROFILES);
        const { applyPrivacyPipeline } = createPrivacyPipeline({
            profiles: PRIVACY_PROFILES,
            getConfig: () => privacyConfig,
            redactText: pipelineRedactText,
            hasMinorSexualContext,
            getPlayerNames,
            logger: ENV.console ?? null,
            storage: ENV.localStorage ?? null,
        });
        return {
            privacyStore,
            privacyConfig,
            setPrivacyProfile,
            setCustomList,
            applyPrivacyPipeline,
            boundRedactText,
        };
    };

    const cloneSession = (session) => {
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
        const clonedSession = {
            turns: clonedTurns,
            meta: { ...(session?.meta || {}) },
            warnings: Array.isArray(session?.warnings) ? [...session.warnings] : [],
            source: session?.source,
        };
        if (Array.isArray(session?.player_names)) {
            clonedSession.player_names = [...session.player_names];
        }
        return clonedSession;
    };
    const collectSessionStats = (session) => {
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
    const composeShareWorkflow = ({ createShareWorkflow, ...options }) => {
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
            const resolvedBottom = layout.bottom ?? DEFAULT_LAYOUT.bottom ?? MIN_GAP;
            const bottom = Math.min(Math.max(MIN_GAP, resolvedBottom), bottomLimit);
            const horizontalLimit = Math.max(MIN_GAP, viewportWidth - MIN_GAP - 160);
            const resolvedOffset = layout.offset ?? DEFAULT_LAYOUT.offset ?? MIN_GAP;
            const offset = Math.min(Math.max(MIN_GAP, resolvedOffset), horizontalLimit);
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
            const horizontalRoom = Math.max(MIN_GAP, viewportWidth - (currentLayout.offset ?? DEFAULT_LAYOUT.offset ?? MIN_GAP) - MIN_GAP);
            const verticalRoom = Math.max(MIN_GAP, viewportHeight - (currentLayout.bottom ?? DEFAULT_LAYOUT.bottom ?? MIN_GAP) - MIN_GAP);
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
            const targetPanel = panelEl;
            if (!modernMode) {
                if (focus && typeof targetPanel.focus === 'function') {
                    requestAnimationFrame(() => targetPanel.focus({ preventScroll: true }));
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
        const bind = (panel) => {
            const panelElement = panel instanceof HTMLElement ? panel : null;
            if (panel && !panelElement) {
                if (logger?.warn) {
                    logger.warn('[GMH] panel visibility: ignored non-HTMLElement panel');
                }
            }
            panelEl = panelElement;
            panelListenersBound = false;
            modernMode = !!panelEl;
            if (!panelEl) {
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
            if (typeof value !== 'number' || !Number.isFinite(value))
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
    function createPrivacyConfigurator({ privacyConfig, setCustomList, parseListInput, setPanelStatus, modal, documentRef = typeof document !== 'undefined' ? document : null, }) {
        if (!documentRef)
            throw new Error('createPrivacyConfigurator requires document');
        const doc = documentRef;
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
         * Opens either the modern modal or legacy prompt workflow.
         */
        const configurePrivacyLists = async () => {
            await configurePrivacyListsModern();
        };
        return {
            configurePrivacyLists,
        };
    }

    /**
     * Provides the modal workflow for editing panel settings and privacy lists.
     */
    function createPanelSettingsController({ panelSettings, modal, setPanelStatus, configurePrivacyLists, documentRef = typeof document !== 'undefined' ? document : null, }) {
        if (!panelSettings)
            throw new Error('createPanelSettingsController requires panelSettings');
        if (!modal)
            throw new Error('createPanelSettingsController requires modal');
        if (!setPanelStatus)
            throw new Error('createPanelSettingsController requires setPanelStatus');
        if (!configurePrivacyLists) {
            throw new Error('createPanelSettingsController requires configurePrivacyLists');
        }
        if (!documentRef)
            throw new Error('createPanelSettingsController requires document');
        const doc = documentRef;
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
        const openPanelSettings = async () => {
            ensureDesignSystemStyles(doc);
            let keepOpen = true;
            while (keepOpen) {
                keepOpen = false;
                const settings = panelSettings.get();
                const behavior = {
                    autoHideEnabled: settings.behavior?.autoHideEnabled !== false,
                    autoHideDelayMs: Number(settings.behavior?.autoHideDelayMs) &&
                        Number(settings.behavior?.autoHideDelayMs) > 0
                        ? Math.round(Number(settings.behavior?.autoHideDelayMs))
                        : 10000,
                    collapseOnOutside: settings.behavior?.collapseOnOutside !== false,
                    collapseOnFocus: settings.behavior?.collapseOnFocus === true,
                    allowDrag: settings.behavior?.allowDrag !== false,
                    allowResize: settings.behavior?.allowResize !== false,
                };
                const grid = doc.createElement('div');
                grid.className = 'gmh-settings-grid';
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
                grid.appendChild(buildRow({
                    id: 'gmh-settings-collapse-outside',
                    label: '밖을 클릭하면 접기',
                    description: '패널 외부를 클릭하면 곧바로 접습니다. ⚠️ 모바일에서는 비활성화 권장',
                    control: collapseOutsideToggle,
                }).row);
                const focusModeToggle = doc.createElement('input');
                focusModeToggle.type = 'checkbox';
                focusModeToggle.checked = behavior.collapseOnFocus;
                grid.appendChild(buildRow({
                    id: 'gmh-settings-focus-collapse',
                    label: '집중 모드',
                    description: '입력 필드나 버튼에 포커스가 이동하면 패널을 접습니다.',
                    control: focusModeToggle,
                }).row);
                const dragToggle = doc.createElement('input');
                dragToggle.type = 'checkbox';
                dragToggle.checked = behavior.allowDrag;
                grid.appendChild(buildRow({
                    id: 'gmh-settings-drag',
                    label: '드래그 이동',
                    description: '상단 그립으로 패널 위치를 조정할 수 있습니다.',
                    control: dragToggle,
                }).row);
                const resizeToggle = doc.createElement('input');
                resizeToggle.type = 'checkbox';
                resizeToggle.checked = behavior.allowResize;
                grid.appendChild(buildRow({
                    id: 'gmh-settings-resize',
                    label: '크기 조절',
                    description: '우측 하단 손잡이로 패널 크기를 바꿉니다.',
                    control: resizeToggle,
                }).row);
                const modalResult = (await modal.open({
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
                }));
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
     * @param options Dependency container.
     * @returns Composed UI helpers.
     */
    const composeUI = ({ GMH, documentRef, windowRef, PanelSettings, stateManager, stateEnum, ENV, privacyConfig, privacyProfiles: _privacyProfiles, setCustomList, parseListInput, }) => {
        const modal = createModal({ documentRef, windowRef });
        GMH.UI.Modal = modal;
        const panelVisibility = createPanelVisibility({
            panelSettings: PanelSettings,
            stateEnum,
            stateApi: stateManager,
            modal,
            documentRef,
            windowRef,
            storage: ENV.localStorage ?? null,
            logger: ENV.console ?? null,
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
            documentRef,
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
    };

    /**
     * Sets up panel mounting, boot sequencing, teardown hooks, and mutation observer.
     *
     * @param options Dependency container.
     * @returns Mount/boot control helpers.
     */
    const setupBootstrap = ({ documentRef, windowRef, mountPanelModern, errorHandler, messageIndexer, bookmarkListener, }) => {
        const doc = documentRef;
        const win = windowRef;
        const MutationObserverCtor = win.MutationObserver || globalThis.MutationObserver;
        const requestFrame = typeof win.requestAnimationFrame === 'function'
            ? win.requestAnimationFrame.bind(win)
            : (callback) => (win.setTimeout?.(callback, 16) ?? setTimeout(callback, 16));
        let panelMounted = false;
        let bootInProgress = false;
        let observerScheduled = false;
        const mountPanel = () => {
            mountPanelModern();
        };
        const boot = () => {
            if (panelMounted || bootInProgress)
                return;
            bootInProgress = true;
            try {
                mountPanel();
                messageIndexer?.start?.();
                bookmarkListener?.start?.();
                panelMounted = Boolean(doc.querySelector('#genit-memory-helper-panel'));
            }
            catch (error) {
                const level = errorHandler.LEVELS?.ERROR || 'error';
                errorHandler.handle(error, 'ui/panel', level);
            }
            finally {
                bootInProgress = false;
            }
        };
        const registerReadyHook = () => {
            if (doc.readyState === 'complete' || doc.readyState === 'interactive') {
                setTimeout(boot, 1200);
            }
            else {
                win.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1200));
            }
        };
        const registerTeardown = () => {
            if (win.__GMHTeardownHook)
                return;
            const teardown = () => {
                panelMounted = false;
                bootInProgress = false;
                try {
                    bookmarkListener?.stop?.();
                }
                catch (err) {
                    const level = errorHandler.LEVELS?.WARN || 'warn';
                    errorHandler.handle(err, 'bookmark', level);
                }
                try {
                    messageIndexer?.stop?.();
                }
                catch (err) {
                    const level = errorHandler.LEVELS?.WARN || 'warn';
                    errorHandler.handle(err, 'adapter', level);
                }
            };
            win.addEventListener('pagehide', teardown);
            win.addEventListener('beforeunload', teardown);
            win.__GMHTeardownHook = true;
        };
        const registerMutationObserver = () => {
            if (!MutationObserverCtor)
                return;
            const target = doc.documentElement || doc.body;
            if (!target)
                return;
            const observer = new MutationObserverCtor(() => {
                if (observerScheduled || bootInProgress)
                    return;
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
            observer.observe(target, { subtree: true, childList: true });
        };
        registerReadyHook();
        registerTeardown();
        registerMutationObserver();
        return { boot, mountPanel };
    };

    const DEFAULT_DB_NAME = 'gmh-memory-blocks';
    const DEFAULT_STORE_NAME = 'blocks';
    const DEFAULT_DB_VERSION = 1;
    const compareRecords = (a, b) => {
        if (a.startOrdinal !== b.startOrdinal) {
            return a.startOrdinal - b.startOrdinal;
        }
        if (a.timestamp !== b.timestamp) {
            return a.timestamp - b.timestamp;
        }
        return a.id.localeCompare(b.id);
    };
    const isArrayBufferView = (value) => {
        return typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value);
    };
    const cloneArrayBuffer = (buffer) => {
        if (!buffer)
            return null;
        if (typeof buffer.slice === 'function') {
            return buffer.slice(0);
        }
        const copy = new Uint8Array(buffer.byteLength);
        copy.set(new Uint8Array(buffer));
        return copy.buffer;
    };
    const toArrayBuffer = (value) => {
        if (!value)
            return null;
        if (value instanceof ArrayBuffer) {
            return cloneArrayBuffer(value);
        }
        if (isArrayBufferView(value)) {
            const view = value;
            const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
            const copy = new Uint8Array(bytes);
            return copy.buffer;
        }
        throw new TypeError('Memory block embedding must be an ArrayBuffer or typed array view.');
    };
    const cloneValue = (value) => {
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            }
            catch (err) {
                // fall back to JSON clone below
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        }
        catch (err) {
            return value;
        }
    };
    const cloneRecord = (record) => {
        const copy = {
            id: record.id,
            sessionUrl: record.sessionUrl,
            raw: record.raw,
            messages: cloneValue(record.messages),
            ordinalRange: [record.ordinalRange[0], record.ordinalRange[1]],
            timestamp: record.timestamp,
            embedding: cloneArrayBuffer(record.embedding),
            messageCount: record.messageCount,
            startOrdinal: record.startOrdinal,
            endOrdinal: record.endOrdinal,
        };
        if (record.meta) {
            copy.meta = cloneValue(record.meta);
        }
        return copy;
    };
    const normalizeBlock = (block) => {
        if (!block || typeof block !== 'object') {
            throw new TypeError('Memory block payload must be an object.');
        }
        const id = typeof block.id === 'string' ? block.id.trim() : String(block.id ?? '').trim();
        if (!id) {
            throw new Error('Memory block requires a stable id.');
        }
        const sessionUrl = typeof block.sessionUrl === 'string' ? block.sessionUrl.trim() : String(block.sessionUrl ?? '').trim();
        if (!sessionUrl) {
            throw new Error('Memory block requires sessionUrl.');
        }
        const ordinalRangeCandidate = Array.isArray(block.ordinalRange) ? block.ordinalRange : [NaN, NaN];
        const ordinalStart = Number(ordinalRangeCandidate[0]);
        const ordinalEnd = Number(ordinalRangeCandidate[1]);
        if (!Number.isFinite(ordinalStart) || !Number.isFinite(ordinalEnd)) {
            throw new Error('Memory block requires a finite ordinalRange.');
        }
        const timestamp = Number(block.timestamp);
        if (!Number.isFinite(timestamp)) {
            throw new Error('Memory block requires a numeric timestamp.');
        }
        const messages = Array.isArray(block.messages) ? block.messages : [];
        const embedding = toArrayBuffer(block.embedding ?? null);
        const messageCount = messages.length;
        const record = {
            id,
            sessionUrl,
            raw: typeof block.raw === 'string' ? block.raw : String(block.raw ?? ''),
            messages,
            ordinalRange: [ordinalStart, ordinalEnd],
            timestamp,
            embedding,
            messageCount,
            startOrdinal: ordinalStart,
            endOrdinal: ordinalEnd,
        };
        if (block.meta) {
            record.meta = block.meta;
        }
        return record;
    };
    const sanitizeLoadedRecord = (record) => {
        const start = Number.isFinite(record.startOrdinal)
            ? record.startOrdinal
            : Number(record.ordinalRange?.[0]);
        const end = Number.isFinite(record.endOrdinal) ? record.endOrdinal : Number(record.ordinalRange?.[1]);
        const ordinalStart = Number.isFinite(start) ? start : 0;
        const ordinalEnd = Number.isFinite(end) ? end : ordinalStart;
        const embedding = record.embedding ? cloneArrayBuffer(record.embedding) : null;
        const messageCount = Number.isFinite(record.messageCount)
            ? record.messageCount
            : Array.isArray(record.messages)
                ? record.messages.length
                : 0;
        const sanitized = {
            id: String(record.id),
            sessionUrl: String(record.sessionUrl),
            raw: typeof record.raw === 'string' ? record.raw : String(record.raw ?? ''),
            messages: Array.isArray(record.messages) ? record.messages : [],
            ordinalRange: [ordinalStart, ordinalEnd],
            timestamp: Number.isFinite(record.timestamp) ? Number(record.timestamp) : Date.now(),
            embedding,
            messageCount,
            startOrdinal: ordinalStart,
            endOrdinal: ordinalEnd,
        };
        if (record.meta) {
            sanitized.meta = record.meta;
        }
        return sanitized;
    };
    const selectConsole = (consoleRef) => {
        if (consoleRef)
            return consoleRef;
        if (ENV.console)
            return ENV.console;
        if (typeof console !== 'undefined')
            return console;
        return null;
    };
    const selectIndexedDB = (factory) => {
        if (factory)
            return factory;
        const envWindow = ENV.window;
        if (envWindow?.indexedDB)
            return envWindow.indexedDB;
        if (typeof indexedDB !== 'undefined')
            return indexedDB;
        const globalFactory = globalThis.indexedDB;
        return globalFactory ?? null;
    };
    const requestToPromise = (request) => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
    const createMemoryEngine = () => {
        const buckets = new Map();
        return {
            async put(record) {
                buckets.set(record.id, cloneRecord(record));
            },
            async get(id) {
                const record = buckets.get(id);
                return record ? cloneRecord(record) : null;
            },
            async getBySession(sessionUrl) {
                const records = [];
                for (const entry of buckets.values()) {
                    if (entry.sessionUrl === sessionUrl) {
                        records.push(cloneRecord(entry));
                    }
                }
                records.sort(compareRecords);
                return records;
            },
            async delete(id) {
                return buckets.delete(id);
            },
            async clear(sessionUrl) {
                if (!sessionUrl) {
                    const removed = buckets.size;
                    buckets.clear();
                    return removed;
                }
                let removed = 0;
                for (const [key, record] of buckets.entries()) {
                    if (record.sessionUrl === sessionUrl) {
                        buckets.delete(key);
                        removed += 1;
                    }
                }
                return removed;
            },
            async getAll() {
                return Array.from(buckets.values(), (record) => cloneRecord(record));
            },
            async count() {
                return buckets.size;
            },
            close() {
                buckets.clear();
            },
        };
    };
    const openIndexedDB = (factory, config) => new Promise((resolve, reject) => {
        const request = factory.open(config.dbName, config.version);
        request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB for block storage.'));
        request.onupgradeneeded = (event) => {
            const db = request.result;
            const storeExists = db.objectStoreNames.contains(config.storeName);
            const oldVersion = Number(event.oldVersion || 0);
            if (!storeExists) {
                const store = db.createObjectStore(config.storeName, { keyPath: 'id' });
                store.createIndex('sessionUrl', 'sessionUrl', { unique: false });
                store.createIndex('startOrdinal', 'startOrdinal', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
            else if (oldVersion < 1) {
                const store = request.transaction?.objectStore(config.storeName);
                store?.createIndex?.('sessionUrl', 'sessionUrl', { unique: false });
                store?.createIndex?.('startOrdinal', 'startOrdinal', { unique: false });
                store?.createIndex?.('timestamp', 'timestamp', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
    });
    const runTransaction = async (dbPromise, config, mode, executor) => {
        const db = await dbPromise;
        const tx = db.transaction(config.storeName, mode);
        const store = tx.objectStore(config.storeName);
        const completion = new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
            tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        });
        try {
            const result = await executor(store);
            await completion;
            return result;
        }
        catch (err) {
            try {
                if (tx.readyState !== 'done') {
                    tx.abort();
                }
            }
            catch (abortErr) {
                config.console?.warn?.('[GMH] Failed to abort block storage transaction', abortErr);
            }
            await completion.catch(() => undefined);
            throw err;
        }
    };
    const createIndexedDBEngine = async (factory, config) => {
        const dbPromise = openIndexedDB(factory, config);
        return {
            async put(record) {
                await runTransaction(dbPromise, config, 'readwrite', async (store) => {
                    await requestToPromise(store.put(record));
                    return undefined;
                });
            },
            async get(id) {
                const record = await runTransaction(dbPromise, config, 'readonly', async (store) => {
                    const result = await requestToPromise(store.get(id));
                    return result ?? null;
                });
                return record ? sanitizeLoadedRecord(record) : null;
            },
            async getBySession(sessionUrl) {
                const records = await runTransaction(dbPromise, config, 'readonly', async (store) => {
                    const index = store.index('sessionUrl');
                    const result = await requestToPromise(index.getAll(sessionUrl));
                    return result ?? [];
                });
                const sanitized = records.map((record) => sanitizeLoadedRecord(record));
                sanitized.sort(compareRecords);
                return sanitized;
            },
            async delete(id) {
                return runTransaction(dbPromise, config, 'readwrite', async (store) => {
                    const existing = await requestToPromise(store.get(id));
                    if (!existing)
                        return false;
                    await requestToPromise(store.delete(id));
                    return true;
                });
            },
            async clear(sessionUrl) {
                if (!sessionUrl) {
                    return runTransaction(dbPromise, config, 'readwrite', async (store) => {
                        const total = await requestToPromise(store.count());
                        await requestToPromise(store.clear());
                        return total;
                    });
                }
                return runTransaction(dbPromise, config, 'readwrite', async (store) => {
                    const index = store.index('sessionUrl');
                    const keys = await requestToPromise(index.getAllKeys(sessionUrl));
                    let removed = 0;
                    for (const key of keys) {
                        await requestToPromise(store.delete(key));
                        removed += 1;
                    }
                    return removed;
                });
            },
            async getAll() {
                const records = await runTransaction(dbPromise, config, 'readonly', async (store) => {
                    const result = await requestToPromise(store.getAll());
                    return result ?? [];
                });
                return records.map((record) => sanitizeLoadedRecord(record));
            },
            async count() {
                return runTransaction(dbPromise, config, 'readonly', async (store) => {
                    const total = await requestToPromise(store.count());
                    return total;
                });
            },
            close() {
                dbPromise
                    .then((db) => db.close())
                    .catch((err) => {
                    config.console?.warn?.('[GMH] Failed to close block storage database', err);
                });
            },
        };
    };
    const createBlockStorage = async (options = {}) => {
        const consoleRef = selectConsole(options.console ?? null);
        const dbName = typeof options.dbName === 'string' && options.dbName.trim() ? options.dbName.trim() : DEFAULT_DB_NAME;
        const storeName = typeof options.storeName === 'string' && options.storeName.trim()
            ? options.storeName.trim()
            : DEFAULT_STORE_NAME;
        const versionCandidate = Number(options.version);
        const version = Number.isFinite(versionCandidate) && versionCandidate > 0 ? Math.floor(versionCandidate) : DEFAULT_DB_VERSION;
        const factory = selectIndexedDB(options.indexedDB ?? null);
        let engine;
        if (factory) {
            engine = await createIndexedDBEngine(factory, {
                dbName,
                storeName,
                version,
                console: consoleRef,
            });
        }
        else {
            consoleRef?.warn?.('[GMH] IndexedDB unavailable. Falling back to in-memory block storage.');
            engine = createMemoryEngine();
        }
        const controller = {
            async save(block) {
                const record = normalizeBlock(block);
                await engine.put(record);
            },
            async get(id) {
                const record = await engine.get(id);
                return record ? cloneRecord(record) : null;
            },
            async getBySession(sessionUrl) {
                const records = await engine.getBySession(sessionUrl);
                return records.map((record) => cloneRecord(record));
            },
            async delete(id) {
                return engine.delete(id);
            },
            async clear(sessionUrl) {
                return engine.clear(sessionUrl);
            },
            async getStats() {
                const records = await engine.getAll();
                const totalBlocks = records.length;
                let totalMessages = 0;
                const sessions = new Set();
                for (const record of records) {
                    sessions.add(record.sessionUrl);
                    totalMessages += Number.isFinite(record.messageCount) ? record.messageCount : 0;
                }
                return {
                    totalBlocks,
                    totalMessages,
                    sessions: sessions.size,
                };
            },
            close() {
                engine.close();
            },
        };
        return controller;
    };

    (function () {
        const { unsafeWindow: unsafeGlobalWindow } = globalThis;
        const fallbackWindow = typeof window !== 'undefined' ? window : undefined;
        const PAGE_WINDOW = (ENV.window ??
            unsafeGlobalWindow ??
            fallbackWindow ??
            globalThis);
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
        const toErrorMessage = (err) => err instanceof Error && typeof err.message === 'string' ? err.message : String(err);
        const { getActiveAdapter, updatePlayerNames, } = composeAdapters({
            GMH,
            adapterRegistry,
            registerAdapterConfig,
            getAdapterSelectors,
            getAdapterMetadata,
            listAdapterNames,
            createGenitAdapter,
            createBabechatAdapter,
            errorHandler: GMH.Core?.ErrorHandler,
            getPlayerNames,
            setPlayerNames,
            PLAYER_NAME_FALLBACKS: [...PLAYER_NAME_FALLBACKS],
        });
        updatePlayerNames();
        const buildExportBundle$1 = (session, normalizedRaw, format, stamp, options = {}) => buildExportBundle(session, normalizedRaw, format, stamp, {
            ...options,
            playerNames: options.playerNames ? [...options.playerNames] : [...getPlayerNames()],
            playerMark: options.playerMark ?? PLAYER_MARK,
        });
        const buildExportManifest$1 = (params) => buildExportManifest({ ...params, version: GMH.VERSION });
        const toJSONExportDefault = withPlayerNames(getPlayerNames, toJSONExport);
        const toJSONExportForShare = (session, options = {}) => toJSONExport(session, '', {
            playerNames: options.playerNames ? [...options.playerNames] : [...getPlayerNames()],
        });
        const toStructuredMarkdownDefault = (options = {}) => {
            const { playerNames, playerMark, ...rest } = options;
            return toStructuredMarkdown({
                ...rest,
                playerNames: playerNames ? [...playerNames] : [...getPlayerNames()],
                playerMark: playerMark ?? PLAYER_MARK,
            });
        };
        const toStructuredJSONDefault = (options = {}) => {
            const { playerNames, playerMark, ...rest } = options;
            return toStructuredJSON({
                ...rest,
                playerNames: playerNames ? [...playerNames] : [...getPlayerNames()]});
        };
        const toStructuredTXTDefault = (options = {}) => {
            const { playerNames, playerMark, ...rest } = options;
            return toStructuredTXT({
                ...rest,
                playerNames: playerNames ? [...playerNames] : [...getPlayerNames()]});
        };
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
        let getSnapshotEntryOrigin = null;
        const messageIndexer = createMessageIndexer({
            console: ENV.console,
            document,
            MutationObserver: typeof MutationObserver !== 'undefined' ? MutationObserver : undefined,
            requestAnimationFrame: typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined,
            exportRange,
            getActiveAdapter: () => getActiveAdapter(),
            getEntryOrigin: () => (getSnapshotEntryOrigin ? getSnapshotEntryOrigin() : []),
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
            }
            catch (err) {
                PAGE_WINDOW.__GMHBookmarkListener = bookmarkListener;
            }
        }
        const Flags = (() => {
            const storedKill = (() => {
                try {
                    return localStorage.getItem('gmh_kill');
                }
                catch (err) {
                    return null;
                }
            })();
            const killSwitch = storedKill === '1';
            return {
                killSwitch,
            };
        })();
        GMH.Flags = Flags;
        GMH.Experimental = GMHExperimental;
        if (Flags.killSwitch) {
            ENV.console?.warn?.('[GMH] Script disabled via kill switch');
            return;
        }
        const stateManager = createStateManager({
            console: ENV.console,
            debug: (...args) => {
                ENV.console?.debug?.('[GMH]', ...args);
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
        const blockStoragePromise = createBlockStorage({
            console: ENV.console,
        });
        blockStoragePromise
            .then((storage) => {
            if (storage) {
                GMH.Core.BlockStorage = storage;
            }
            return storage;
        })
            .catch((err) => {
            const level = errorHandler.LEVELS?.WARN || 'warn';
            errorHandler.handle?.(err, 'message-stream/storage', level);
            ENV.console?.warn?.('[GMH] block storage initialization failed', err);
            return null;
        });
        const blockBuilder = createBlockBuilder({
            console: ENV.console,
            removeNarration: false,
            overlap: 0,
            getSessionUrl: () => {
                try {
                    return PAGE_WINDOW?.location?.href ?? null;
                }
                catch (err) {
                    return null;
                }
            },
        });
        const messageStream = createMessageStream({
            messageIndexer,
            blockBuilder,
            blockStorage: blockStoragePromise,
            collectStructuredMessage: (element) => {
                const adapter = getActiveAdapter();
                const collector = adapter?.collectStructuredMessage;
                if (typeof collector === 'function') {
                    try {
                        return collector.call(adapter, element) ?? null;
                    }
                    catch (err) {
                        const level = errorHandler.LEVELS?.WARN || 'warn';
                        errorHandler.handle?.(err, 'message-stream/collect', level);
                        return null;
                    }
                }
                return null;
            },
            getSessionUrl: () => {
                try {
                    return PAGE_WINDOW?.location?.href ?? null;
                }
                catch (err) {
                    return null;
                }
            },
            console: ENV.console,
        });
        const createDebugStore = () => {
            const buckets = new Map();
            const listInternal = () => {
                const entries = Array.from(buckets.values());
                entries.sort((a, b) => {
                    if (a.timestamp !== b.timestamp) {
                        return a.timestamp - b.timestamp;
                    }
                    const aStart = a.ordinalRange[0];
                    const bStart = b.ordinalRange[0];
                    if (aStart !== bStart) {
                        return aStart - bStart;
                    }
                    return a.id.localeCompare(b.id);
                });
                return entries;
            };
            return {
                capture(block) {
                    try {
                        const detail = buildDebugBlockDetail(block);
                        if (!detail.id)
                            return;
                        buckets.set(detail.id, detail);
                    }
                    catch (err) {
                        ENV.console?.warn?.('[GMH] debug block capture failed', err);
                    }
                },
                list() {
                    return listInternal().map((detail) => toDebugBlockSummary(detail));
                },
                listBySession(sessionUrl) {
                    if (!sessionUrl)
                        return [];
                    return listInternal()
                        .filter((detail) => detail.sessionUrl === sessionUrl)
                        .map((detail) => toDebugBlockSummary(detail));
                },
                get(id) {
                    if (!id)
                        return null;
                    const detail = buckets.get(id);
                    if (!detail)
                        return null;
                    return cloneDebugBlockDetail(detail);
                },
            };
        };
        const debugStore = createDebugStore();
        const resolveDebugSessionUrl = () => {
            try {
                const sessionFromStream = typeof messageStream.getSessionUrl === 'function' ? messageStream.getSessionUrl() : null;
                if (sessionFromStream)
                    return sessionFromStream;
            }
            catch {
                // ignore errors when reading session from messageStream
            }
            if (typeof blockBuilder.getSessionUrl === 'function') {
                try {
                    return blockBuilder.getSessionUrl();
                }
                catch {
                    return null;
                }
            }
            return null;
        };
        const debugApi = {
            listBlocks() {
                return debugStore.list();
            },
            getSessionBlocks() {
                return debugStore.listBySession(resolveDebugSessionUrl());
            },
            getBlockDetails(id) {
                return debugStore.get(id);
            },
        };
        GMH.Debug = debugApi;
        messageStream.subscribeBlocks((block) => {
            debugStore.capture(block);
        });
        const memoryIndexEnabled = Boolean(GMH.Experimental?.MemoryIndex?.enabled);
        const memoryStatus = createMemoryStatus({
            documentRef: document,
            windowRef: PAGE_WINDOW,
            messageStream,
            blockStorage: blockStoragePromise,
            getSessionUrl: () => {
                try {
                    return PAGE_WINDOW?.location?.href ?? null;
                }
                catch (err) {
                    return null;
                }
            },
            experimentalEnabled: memoryIndexEnabled,
            console: ENV.console,
        });
        if (memoryIndexEnabled) {
            void memoryStatus.forceRefresh();
        }
        GMH.Core.BlockBuilder = blockBuilder;
        GMH.Core.MessageStream = messageStream;
        GMH.UI.MemoryStatus = memoryStatus;
        if (memoryIndexEnabled) {
            try {
                messageStream.start();
            }
            catch (err) {
                const level = errorHandler.LEVELS?.WARN || 'warn';
                errorHandler.handle?.(err, 'message-stream/start', level);
            }
        }
        // -------------------------------
        // 0) Privacy composition
        // -------------------------------
        const { privacyConfig: PRIVACY_CFG, setPrivacyProfile: setPrivacyProfileInternal, setCustomList: setCustomListInternal, applyPrivacyPipeline, boundRedactText, } = composePrivacy({
            createPrivacyStore,
            createPrivacyPipeline,
            PRIVACY_PROFILES,
            DEFAULT_PRIVACY_PROFILE,
            collapseSpaces,
            privacyRedactText: (value, profileKey, counts, config, profiles) => redactText(value, profileKey, counts ?? {}, config, profiles),
            hasMinorSexualContext,
            getPlayerNames,
            ENV,
            errorHandler,
        });
        let syncPrivacyProfileSelect = () => { };
        const setPrivacyProfile = (profileKey) => {
            setPrivacyProfileInternal(profileKey);
            syncPrivacyProfileSelect(profileKey);
        };
        const setCustomList = (type, items) => {
            setCustomListInternal(type, items);
        };
        const { modal, panelVisibility: PanelVisibility, setPanelStatus, attachStatusElement, stateView, configurePrivacyLists, openPanelSettings, } = composeUI({
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
        });
        GMH.UI.StateView = stateView;
        const blockViewer = createBlockViewer({
            documentRef: document,
            windowRef: PAGE_WINDOW,
            modal,
            blockStorage: blockStoragePromise,
            getSessionUrl: () => {
                try {
                    return PAGE_WINDOW?.location?.href ?? null;
                }
                catch {
                    return null;
                }
            },
            getDebugApi: () => GMH.Debug ?? null,
            logger: ENV.console,
        });
        GMH.UI.BlockViewer = blockViewer;
        memoryStatus.setBlockViewerResolver(() => blockViewer);
        const { describeNode, downloadDomSnapshot } = createSnapshotFeature({
            getActiveAdapter: () => getActiveAdapter(),
            triggerDownload,
            setPanelStatus,
            errorHandler,
            documentRef: document,
            locationRef: location,
        });
        const { captureStructuredSnapshot, readTranscriptText, projectStructuredMessages, readStructuredMessages, getEntryOrigin: structuredGetEntryOrigin, } = createStructuredSnapshotReader({
            getActiveAdapter,
            setEntryOriginProvider,
            documentRef: document,
        });
        getSnapshotEntryOrigin = structuredGetEntryOrigin;
        GMH.Core.getEntryOrigin = () => (getSnapshotEntryOrigin ? getSnapshotEntryOrigin() : []);
        const { autoLoader, autoState: AUTO_STATE, startTurnMeter, subscribeProfileChange, getProfile: getAutoProfile, } = createAutoLoader({
            stateApi: stateManager,
            stateEnum: GMH_STATE,
            errorHandler,
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
        const { ensureAutoLoadControlsModern, mountStatusActionsModern } = createAutoLoaderControls({
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
        const { confirm: confirmPrivacyGateModern } = createModernPrivacyGate({
            documentRef: document,
            formatRedactionCounts,
            privacyProfiles: PRIVACY_PROFILES,
            ensureDesignSystemStyles,
            modal,
            previewLimit: CONFIG.LIMITS.PREVIEW_TURN_LIMIT,
        });
        const confirmPrivacyGate = confirmPrivacyGateModern;
        const { prepareShare, performExport, copyRecent: copyRecentShare, copyAll: copyAllShare, reparse: reparseShare, collectSessionStats, } = composeShareWorkflow({
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
            toJSONExport: toJSONExportForShare,
            toTXTExport,
            toStructuredMarkdown: toStructuredMarkdownDefault,
            toStructuredJSON: toStructuredJSONDefault,
            toStructuredTXT: toStructuredTXTDefault,
            buildExportBundle: buildExportBundle$1,
            buildExportManifest: buildExportManifest$1,
            triggerDownload,
            clipboard: {
                set: (value, options) => ENV.GM_setClipboard(value, options),
            },
            stateApi: stateManager,
            stateEnum: GMH_STATE,
            confirmPrivacyGate: confirmPrivacyGate,
            getEntryOrigin: () => getSnapshotEntryOrigin?.() ?? [],
            logger: ENV.console,
        });
        const { copySummaryGuide, copyResummaryGuide } = createGuidePrompts({
            clipboard: {
                set: (value, options) => ENV.GM_setClipboard(value, options),
            },
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
            modal,
        });
        const { bindPanelInteractions, syncPrivacyProfileSelect: syncPrivacyProfileSelectFromUI, } = createPanelInteractions({
            panelVisibility: PanelVisibility,
            setPanelStatus,
            setPrivacyProfile,
            getPrivacyProfile: () => PRIVACY_CFG.profile,
            privacyProfiles: PRIVACY_PROFILES,
            configurePrivacyLists,
            openPanelSettings,
            ensureAutoLoadControlsModern,
            mountStatusActionsModern,
            mountMemoryStatusModern: (panel) => memoryStatus.mount(panel),
            bindRangeControls,
            bindShortcuts,
            bindGuideControls,
            prepareShare,
            performExport,
            copyRecentShare,
            copyAllShare,
            autoLoader,
            autoState: AUTO_STATE,
            stateApi: stateManager,
            stateEnum: GMH_STATE,
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
            stateView,
            bindPanelInteractions,
            logger: ENV.console,
        });
        const { mountPanel } = setupBootstrap({
            documentRef: document,
            windowRef: PAGE_WINDOW,
            mountPanelModern,
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
                        }
                        catch (error) {
                            const level = errorHandler.LEVELS?.ERROR || 'error';
                            errorHandler.handle(error, 'privacy/redact', level);
                            return { error: toErrorMessage(error) };
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
            toJSONExport: toJSONExportDefault,
            toTXTExport,
            toMarkdownExport,
            toStructuredJSON: toStructuredJSONDefault,
            toStructuredMarkdown: toStructuredMarkdownDefault,
            toStructuredTXT: toStructuredTXTDefault,
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
            }
            catch (err) {
                const level = errorHandler.LEVELS?.WARN || 'warn';
                errorHandler.handle(err, 'ui/panel', level);
            }
        }
    })();

    exports.ENV = ENV;
    exports.GMH = GMH;

    return exports;

})({});
