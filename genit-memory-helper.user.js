// ==UserScript==
// @name         Genit Memory Helper
// @namespace    local.dev
// @version      1.1.0
// @description  Genit 대화로그 JSON/TXT/MD 추출 + 요약/재요약 프롬프트 복사 기능
// @author       devforai-creator
// @match        https://genit.ai/*
// @match        https://www.genit.ai/*
// @grant        GM_setClipboard
// @run-at       document-idle
// @updateURL    https://github.com/devforai-creator/genit-memory-helper/raw/main/genit-memory-helper.user.js
// @downloadURL  https://github.com/devforai-creator/genit-memory-helper/raw/main/genit-memory-helper.user.js
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '1.1.0';

  try {
    const killSwitchEnabled = localStorage.getItem('gmh_kill') === '1';
    if (!killSwitchEnabled) {
      const currentValue = localStorage.getItem('gmh_flag_newUI');
      if (currentValue !== '1') {
        localStorage.setItem('gmh_flag_newUI', '1');
      }
    }
  } catch (err) {
    console.warn('[GMH] failed to set default UI flag', err);
  }

  const GMH = {
    VERSION: SCRIPT_VERSION,
    Util: {},
    Privacy: {},
    Export: {},
    UI: {},
    Core: {},
    Adapters: {},
  };

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

  const dbg = (...args) => {
    if (isModernUIActive) console.debug('[GMH]', ...args);
  };

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

  const VALID_STATES = new Set(Object.values(GMH_STATE));
  const stateSubscribers = new Set();

  function normalizeState(value) {
    if (!value) return null;
    const next = String(value).toLowerCase();
    return VALID_STATES.has(next) ? next : null;
  }

  GMH.Core.STATE = GMH_STATE;
  GMH.Core.State = {
    current: GMH_STATE.IDLE,
    previous: null,
    payload: null,
    getState() {
      return this.current;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      stateSubscribers.add(listener);
      return () => {
        stateSubscribers.delete(listener);
      };
    },
    setState(nextState, payload) {
      const next = normalizeState(nextState);
      if (!next) {
        console.warn('[GMH] unknown state requested', nextState);
        return false;
      }
      const allowed = STATE_TRANSITIONS[this.current]?.includes(next);
      if (!allowed) {
        console.warn('[GMH] invalid state transition', this.current, '→', next);
        return false;
      }
      this.previous = this.current;
      this.current = next;
      this.payload = payload ?? null;
      dbg('state →', this.current, this.payload);
      stateSubscribers.forEach((listener) => {
        try {
          listener(this.current, {
            previous: this.previous,
            payload: this.payload,
          });
        } catch (err) {
          console.error('[GMH] state listener failed', err);
        }
      });
      return true;
    },
    reset() {
      this.setState(GMH_STATE.IDLE, null);
    },
  };

  // -------------------------------
  // 0) Constants & utils
  // -------------------------------
  const PAGE_WINDOW =
    typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const PLAYER_MARK = '⟦PLAYER⟧ ';
  const HEADER_RE =
    /^(\d+월\s*\d+일.*?\d{1,2}:\d{2})\s*\|\s*([^|]+?)\s*\|\s*📍\s*([^|]+)\s*\|?(.*)$/;
  const CODE_RE = /^([A-J])\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/i;
  const META_KEYWORDS = [
    '지도',
    '등장',
    'Actors',
    '배우',
    '기록코드',
    'Codes',
    'SCENE',
  ];
  const PLAYER_NAME_FALLBACKS = ['플레이어', '소중한코알라5299'];
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

  const PRIVACY_CFG = loadPrivacySettings();

  function loadPrivacySettings() {
    const profile = localStorage.getItem(STORAGE_KEYS.privacyProfile) || 'safe';
    let blacklist = [];
    let whitelist = [];
    try {
      const rawBlack = localStorage.getItem(STORAGE_KEYS.privacyBlacklist);
      if (rawBlack) blacklist = JSON.parse(rawBlack);
    } catch (err) {
      console.warn('[GMH] privacy blacklist load failed', err);
    }
    try {
      const rawWhite = localStorage.getItem(STORAGE_KEYS.privacyWhitelist);
      if (rawWhite) whitelist = JSON.parse(rawWhite);
    } catch (err) {
      console.warn('[GMH] privacy whitelist load failed', err);
    }
    const normalizedBlack = Array.isArray(blacklist)
      ? blacklist.map((item) => collapseSpaces(item)).filter(Boolean)
      : [];
    const normalizedWhite = Array.isArray(whitelist)
      ? whitelist.map((item) => collapseSpaces(item)).filter(Boolean)
      : [];
    const profileKey = PRIVACY_PROFILES[profile] ? profile : 'safe';
    return {
      profile: profileKey,
      blacklist: normalizedBlack,
      whitelist: normalizedWhite,
    };
  }

  function persistPrivacySettings() {
    try {
      localStorage.setItem(STORAGE_KEYS.privacyProfile, PRIVACY_CFG.profile);
      localStorage.setItem(
        STORAGE_KEYS.privacyBlacklist,
        JSON.stringify(PRIVACY_CFG.blacklist || []),
      );
      localStorage.setItem(
        STORAGE_KEYS.privacyWhitelist,
        JSON.stringify(PRIVACY_CFG.whitelist || []),
      );
    } catch (err) {
      console.warn('[GMH] privacy settings persist failed', err);
    }
  }

  function setPrivacyProfile(profileKey) {
    PRIVACY_CFG.profile = PRIVACY_PROFILES[profileKey] ? profileKey : 'safe';
    persistPrivacySettings();
    syncPrivacyProfileSelect();
  }

  function setCustomList(type, items) {
    if (!Array.isArray(items)) return;
    const normalized = items
      .map((item) => collapseSpaces(item))
      .filter(Boolean);
    if (type === 'blacklist') PRIVACY_CFG.blacklist = normalized;
    if (type === 'whitelist') PRIVACY_CFG.whitelist = normalized;
    persistPrivacySettings();
  }

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

  function luhnValid(value) {
    const digits = String(value || '').replace(/[^\d]/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let shouldDouble = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let digit = parseInt(digits[i], 10);
      if (Number.isNaN(digit)) return false;
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
  }

  function escapeForRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function createRedactionRules(profileKey) {
    const rules = [
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
    const profile = PRIVACY_PROFILES[profileKey] || PRIVACY_PROFILES.safe;
    if (profile.maskAddressHints) {
      rules.push({
        name: 'ADDR',
        rx: REDACTION_PATTERNS.addressHint,
        mask: () => '[REDACTED:ADDR]',
      });
    }
    return rules;
  }

  function protectWhitelist(text, whitelist) {
    if (!Array.isArray(whitelist) || !whitelist.length)
      return { text, tokens: [] };
    let output = text;
    const tokens = [];
    whitelist.forEach((term, index) => {
      if (!term) return;
      const token = `§WL${index}_${term.length}§`;
      const rx = new RegExp(escapeForRegex(term), 'gi');
      let replaced = false;
      output = output.replace(rx, () => {
        replaced = true;
        return token;
      });
      if (replaced) tokens.push({ token, value: term });
    });
    return { text: output, tokens };
  }

  function restoreWhitelist(text, tokens) {
    if (!tokens?.length) return text;
    let output = text;
    tokens.forEach(({ token, value }) => {
      const rx = new RegExp(escapeForRegex(token), 'g');
      output = output.replace(rx, value);
    });
    return output;
  }

  function applyRules(text, rules, counts) {
    let output = text;
    for (const rule of rules) {
      if (!rule || !rule.rx) continue;
      output = output.replace(rule.rx, (match) => {
        if (rule.validator && !rule.validator(match)) return match;
        counts[rule.name] = (counts[rule.name] || 0) + 1;
        return typeof rule.mask === 'function' ? rule.mask(match) : rule.mask;
      });
    }
    return output;
  }

  function applyCustomBlacklist(text, blacklist, counts) {
    if (!Array.isArray(blacklist) || !blacklist.length) return text;
    let output = text;
    blacklist.forEach((term) => {
      if (!term) return;
      const rx = new RegExp(escapeForRegex(term), 'gi');
      output = output.replace(rx, () => {
        counts.CUSTOM = (counts.CUSTOM || 0) + 1;
        return '[REDACTED:CUSTOM]';
      });
    });
    return output;
  }

  const MINOR_KEYWORDS =
    /(미성년|중학생|고등학생|나이\s*1[0-7]|소년|소녀|minor|under\s*18)/i;
  const SEXUAL_KEYWORDS =
    /(성관계|성적|섹스|sex|음란|선정|야한|야스|삽입|자위|강간|에로)/i;

  function hasMinorSexualContext(text) {
    if (!text) return false;
    return MINOR_KEYWORDS.test(text) && SEXUAL_KEYWORDS.test(text);
  }

  function redactText(text, profileKey, counts) {
    const profile = PRIVACY_PROFILES[profileKey] || PRIVACY_PROFILES.safe;
    const rules = createRedactionRules(profile.key);
    const baseCounts = counts || {};
    const { text: protectedText, tokens } = protectWhitelist(
      String(text || ''),
      PRIVACY_CFG.whitelist,
    );
    let result = applyRules(protectedText, rules, baseCounts);
    result = applyCustomBlacklist(result, PRIVACY_CFG.blacklist, baseCounts);
    result = restoreWhitelist(result, tokens);
    if (profile.maskNarrativeSensitive) {
      result = result.replace(/(자살|자해|강간|폭행|살해)/gi, () => {
        baseCounts.SENSITIVE = (baseCounts.SENSITIVE || 0) + 1;
        return '[REDACTED:SENSITIVE]';
      });
    }
    return result;
  }

  function cloneSession(session) {
    return {
      meta: { ...(session?.meta || {}) },
      turns: Array.isArray(session?.turns)
        ? session.turns.map((turn) => ({ ...turn }))
        : [],
      warnings: Array.isArray(session?.warnings) ? [...session.warnings] : [],
      source: session?.source,
    };
  }

  function applyPrivacyPipeline(session, rawText, profileKey) {
    const profile = PRIVACY_PROFILES[profileKey] ? profileKey : 'safe';
    const counts = {};
    const sanitizedSession = cloneSession(session);
    sanitizedSession.turns = sanitizedSession.turns.map((turn) => {
      const next = { ...turn };
      next.text = redactText(turn.text, profile, counts);
      if (next.speaker)
        next.speaker = redactText(next.speaker, profile, counts);
      return next;
    });
    const sanitizedMeta = {};
    Object.entries(sanitizedSession.meta || {}).forEach(([key, value]) => {
      if (typeof value === 'string') {
        sanitizedMeta[key] = redactText(value, profile, counts);
      } else if (Array.isArray(value)) {
        sanitizedMeta[key] = value.map((item) =>
          typeof item === 'string' ? redactText(item, profile, counts) : item,
        );
      } else {
        sanitizedMeta[key] = value;
      }
    });
    sanitizedSession.meta = sanitizedMeta;
    sanitizedSession.warnings = sanitizedSession.warnings.map((warning) =>
      typeof warning === 'string'
        ? redactText(warning, profile, counts)
        : warning,
    );
    const sanitizedPlayers = PLAYER_NAMES.map((name) =>
      redactText(name, profile, counts),
    );
    sanitizedSession.player_names = sanitizedPlayers;
    const sanitizedRaw = redactText(rawText, profile, counts);
    const aggregatedCounts = counts;
    const totalRedactions = Object.values(aggregatedCounts).reduce(
      (sum, value) => sum + (value || 0),
      0,
    );
    const minorBlocked = hasMinorSexualContext(rawText);
    return {
      profile,
      sanitizedSession,
      sanitizedRaw,
      playerNames: sanitizedPlayers,
      counts: aggregatedCounts,
      totalRedactions,
      blocked: minorBlocked,
    };
  }

  function formatRedactionCounts(counts) {
    const entries = Object.entries(counts || {}).filter(
      ([, value]) => value > 0,
    );
    if (!entries.length) return '레다크션 없음';
    return entries.map(([key, value]) => `${key}:${value}`).join(', ');
  }

  function collectSessionStats(session) {
    if (!session) return { playerTurns: 0, totalTurns: 0, warnings: 0 };
    const playerTurns =
      session.turns?.filter((turn) => turn.role === 'player')?.length || 0;
    const totalTurns = session.turns?.length || 0;
    const warnings = session.warnings?.length || 0;
    return { playerTurns, totalTurns, warnings };
  }

  const PREVIEW_TURN_LIMIT = 5;

  function ensureLegacyPreviewStyles() {
    if (document.getElementById('gmh-preview-style')) return;
    const style = document.createElement('style');
    style.id = 'gmh-preview-style';
    style.textContent = `
.gmh-preview-overlay{position:fixed;inset:0;background:rgba(15,23,42,0.72);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:24px;}
.gmh-preview-card{background:#0f172a;color:#e2e8f0;border-radius:14px;box-shadow:0 18px 48px rgba(8,15,30,0.55);width:min(520px,94vw);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;font:13px/1.5 'Inter',system-ui,sans-serif;}
.gmh-preview-header{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid rgba(148,163,184,0.25);font-weight:600;}
.gmh-preview-body{padding:18px 20px;overflow:auto;display:grid;gap:16px;}
.gmh-preview-summary{display:grid;gap:8px;border:1px solid rgba(148,163,184,0.25);border-radius:10px;padding:12px;background:rgba(30,41,59,0.65);}
.gmh-preview-summary div{display:flex;justify-content:space-between;gap:12px;}
.gmh-preview-summary strong{color:#bfdbfe;}
.gmh-preview-turns{list-style:none;margin:0;padding:0;display:grid;gap:10px;}
.gmh-preview-turn{background:rgba(30,41,59,0.55);border-radius:10px;padding:10px 12px;border:1px solid rgba(59,130,246,0.12);}
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
    document.head.appendChild(style);
  }

  function ensureDesignSystemStyles() {
    if (document.getElementById('gmh-design-system-style')) return;
    const style = document.createElement('style');
    style.id = 'gmh-design-system-style';
    style.textContent = `
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
.gmh-turn-list__speaker{font-weight:600;color:var(--gmh-accent-soft);margin-bottom:4px;font-size:12px;}
.gmh-turn-list__text{color:var(--gmh-fg);font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;}
.gmh-turn-list__empty{color:var(--gmh-muted);text-align:center;}
.gmh-panel{position:fixed;right:16px;bottom:16px;z-index:2147483000;background:var(--gmh-bg);color:var(--gmh-fg);padding:16px;border-radius:18px;box-shadow:var(--gmh-panel-shadow);display:grid;gap:14px;width:min(320px,92vw);font:var(--gmh-font);max-height:70vh;overflow:auto;transform:translateY(0);opacity:1;visibility:visible;transition:transform 0.2s ease,opacity 0.15s ease,visibility 0.15s ease;will-change:transform,opacity;}
html.gmh-collapsed #genit-memory-helper-panel{transform:translateY(calc(100% + 24px));opacity:0;visibility:hidden;pointer-events:none;}
html.gmh-panel-open #genit-memory-helper-panel{pointer-events:auto;}
#gmh-fab{position:fixed;right:16px;bottom:16px;width:52px;height:52px;border-radius:50%;border:0;display:grid;place-items:center;font:700 13px/1 var(--gmh-font);background:var(--gmh-accent);color:#041016;cursor:pointer;box-shadow:0 10px 28px rgba(8,15,30,0.45);z-index:2147483001;transition:transform 0.2s ease,box-shadow 0.2s ease,opacity 0.15s ease;touch-action:manipulation;}
#gmh-fab:hover{box-shadow:0 14px 32px rgba(8,15,30,0.55);transform:translateY(-2px);}
#gmh-fab:active{transform:translateY(0);box-shadow:0 6px 18px rgba(8,15,30,0.45);}
html.gmh-panel-open #gmh-fab{transform:translateY(-4px);box-shadow:0 12px 30px rgba(8,15,30,0.5);}
.gmh-panel__header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;}
.gmh-panel__title{font-size:15px;font-weight:600;margin:0;}
.gmh-panel__tag{font-size:11px;color:var(--gmh-muted);margin-top:2px;}
.gmh-panel__section{border-top:1px solid var(--gmh-border);padding-top:12px;display:grid;gap:10px;}
.gmh-panel__section:first-of-type{border-top:none;padding-top:0;}
.gmh-panel__section-title{font-size:12px;color:var(--gmh-muted);font-weight:600;letter-spacing:0.08em;text-transform:uppercase;}
.gmh-field-row{display:flex;gap:10px;align-items:center;width:100%;}
.gmh-input,.gmh-select{flex:1;background:#111827;color:var(--gmh-fg);border:1px solid var(--gmh-border);border-radius:var(--gmh-radius-sm);padding:8px 10px;font:inherit;}
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
`;
    document.head.appendChild(style);
  }

  GMH.UI.Modal = (() => {
    let activeModal = null;
    let modalIdCounter = 0;

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
      if (!root) return [];
      return Array.from(root.querySelectorAll(focusableSelector)).filter(
        (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          return style.visibility !== 'hidden' && style.display !== 'none';
        },
      );
    };

    function buildButton(action, finalize) {
      const button = document.createElement('button');
      button.type = action.type || 'button';
      button.className = 'gmh-button';
      if (action.variant) button.classList.add(`gmh-button--${action.variant}`);
      if (action.attrs && typeof action.attrs === 'object') {
        Object.entries(action.attrs).forEach(([key, value]) => {
          button.setAttribute(key, value);
        });
      }
      if (action.disabled) button.disabled = true;
      button.textContent = action.label || '확인';
      button.addEventListener('click', (event) => {
        if (button.disabled) return;
        if (typeof action.onSelect === 'function') {
          const shouldClose = action.onSelect(event);
          if (shouldClose === false) return;
        }
        finalize(action.value);
      });
      return button;
    }

    function closeActive(result) {
      if (activeModal && typeof activeModal.close === 'function') {
        activeModal.close(result, true);
      }
    }

    function open(options = {}) {
      ensureDesignSystemStyles();
      closeActive(false);

      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'gmh-modal-overlay';
        const dialog = document.createElement('div');
        dialog.className = 'gmh-modal';
        if (options.size === 'small') dialog.classList.add('gmh-modal--sm');
        if (options.size === 'large') dialog.classList.add('gmh-modal--lg');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('tabindex', '-1');
        modalIdCounter += 1;
        const modalId = `gmh-modal-${modalIdCounter}`;
        const titleId = `${modalId}-title`;
        const descId = options.description ? `${modalId}-desc` : '';
        dialog.id = modalId;

        const header = document.createElement('div');
        header.className = 'gmh-modal__header';
        const headerRow = document.createElement('div');
        headerRow.className = 'gmh-modal__header-row';

        const title = document.createElement('h2');
        title.className = 'gmh-modal__title';
        title.textContent = options.title || '';
        title.id = titleId;
        headerRow.appendChild(title);

        let closeBtn = null;
        if (options.dismissible !== false) {
          closeBtn = document.createElement('button');
          closeBtn.type = 'button';
          closeBtn.className = 'gmh-modal__close';
          closeBtn.setAttribute('aria-label', '닫기');
          closeBtn.innerHTML = '&times;';
          headerRow.appendChild(closeBtn);
        }

        header.appendChild(headerRow);

        if (options.description) {
          const desc = document.createElement('p');
          desc.className = 'gmh-modal__description';
          desc.textContent = options.description;
          desc.id = descId;
          header.appendChild(desc);
        }

        dialog.setAttribute('aria-labelledby', titleId);
        if (options.description)
          dialog.setAttribute('aria-describedby', descId);
        else dialog.removeAttribute('aria-describedby');

        const body = document.createElement('div');
        body.className = 'gmh-modal__body gmh-modal__body--scroll';
        if (options.bodyClass) body.classList.add(options.bodyClass);
        if (options.content instanceof Node) {
          body.appendChild(options.content);
        } else if (typeof options.content === 'string') {
          body.innerHTML = options.content;
        }

        const footer = document.createElement('div');
        footer.className = 'gmh-modal__footer';
        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'gmh-modal__actions';
        const actions =
          Array.isArray(options.actions) && options.actions.length
            ? options.actions
            : [];

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
        if (actionsWrap.childElementCount) dialog.appendChild(footer);
        overlay.appendChild(dialog);

        const bodyEl = document.body;
        const prevOverflow = bodyEl.style.overflow;
        const restoreTarget =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
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
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        };

        const cleanup = (result) => {
          if (!overlay.isConnected) return;
          document.removeEventListener('keydown', onKeydown, true);
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
            if (event.target === overlay) cleanup(false);
          });
          if (closeBtn)
            closeBtn.addEventListener('click', () => cleanup(false));
        }

        document.addEventListener('keydown', onKeydown, true);

        const initialSelector = options.initialFocus || '.gmh-button--primary';
        let focusTarget = initialSelector
          ? dialog.querySelector(initialSelector)
          : null;
        if (!(focusTarget instanceof HTMLElement)) {
          const focusables = getFocusable(dialog);
          focusTarget = focusables[0] || closeBtn;
        }
        window.setTimeout(() => {
          if (focusTarget && typeof focusTarget.focus === 'function')
            focusTarget.focus();
        }, 20);

        activeModal = {
          close: cleanup,
        };
      });
    }

    return {
      open,
      close: closeActive,
      isOpen: () => Boolean(activeModal),
    };
  })();

  function truncateText(value, max = 220) {
    const text = String(value || '').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
  }

  function confirmPrivacyGateLegacy({
    profile,
    counts,
    stats,
    previewTurns = [],
    actionLabel = '계속',
    heading = '공유 전 확인',
    subheading = '외부로 공유하기 전에 민감정보가 없는지 확인하세요.',
  }) {
    ensureLegacyPreviewStyles();
    const profileLabel = PRIVACY_PROFILES[profile]?.label || profile;
    const summary = formatRedactionCounts(counts);
    const overlay = document.createElement('div');
    overlay.className = 'gmh-preview-overlay';
    const card = document.createElement('div');
    card.className = 'gmh-preview-card';
    overlay.appendChild(card);

    const header = document.createElement('div');
    header.className = 'gmh-preview-header';
    header.innerHTML = `<span>${heading}</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'gmh-preview-close';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.textContent = '✕';
    header.appendChild(closeBtn);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'gmh-preview-body';
    const summaryBox = document.createElement('div');
    summaryBox.className = 'gmh-preview-summary';
    const rowProfile = document.createElement('div');
    rowProfile.innerHTML = `<strong>프로필</strong><span>${profileLabel}</span>`;
    const rowTurns = document.createElement('div');
    rowTurns.innerHTML = `<strong>턴 수</strong><span>플레이어 ${stats.playerTurns} / 전체 ${stats.totalTurns}</span>`;
    const rowCounts = document.createElement('div');
    rowCounts.innerHTML = `<strong>레다크션</strong><span>${summary}</span>`;
    summaryBox.appendChild(rowProfile);
    summaryBox.appendChild(rowTurns);
    summaryBox.appendChild(rowCounts);
    body.appendChild(summaryBox);

    const previewTitle = document.createElement('div');
    previewTitle.style.fontWeight = '600';
    previewTitle.style.color = '#cbd5f5';
    previewTitle.textContent = `미리보기 (${Math.min(previewTurns.length, PREVIEW_TURN_LIMIT)}턴)`;
    body.appendChild(previewTitle);

    const turnList = document.createElement('ul');
    turnList.className = 'gmh-preview-turns';
    previewTurns.slice(-PREVIEW_TURN_LIMIT).forEach((turn) => {
      if (!turn) return;
      const item = document.createElement('li');
      item.className = 'gmh-preview-turn';
      const speaker = document.createElement('div');
      speaker.className = 'gmh-preview-turn-speaker';
      speaker.textContent = `${turn.speaker || '??'} · ${turn.role}`;
      const text = document.createElement('div');
      text.className = 'gmh-preview-turn-text';
      text.textContent = truncateText(turn.text || '');
      item.appendChild(speaker);
      item.appendChild(text);
      turnList.appendChild(item);
    });
    if (!turnList.children.length) {
      const empty = document.createElement('div');
      empty.className = 'gmh-preview-turn';
      const text = document.createElement('div');
      text.className = 'gmh-preview-turn-text';
      text.textContent = '표시할 턴이 없습니다. 상단 요약만 확인해주세요.';
      empty.appendChild(text);
      turnList.appendChild(empty);
    }
    body.appendChild(turnList);

    const footnote = document.createElement('div');
    footnote.className = 'gmh-preview-footnote';
    footnote.textContent = subheading;
    body.appendChild(footnote);

    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'gmh-preview-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'gmh-preview-cancel';
    cancelBtn.textContent = '취소';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'gmh-preview-confirm';
    confirmBtn.textContent = actionLabel;
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    card.appendChild(actions);

    const bodyEl = document.body;
    const prevOverflow = bodyEl.style.overflow;
    bodyEl.style.overflow = 'hidden';
    bodyEl.appendChild(overlay);

    return new Promise((resolve) => {
      const cleanup = (result) => {
        bodyEl.style.overflow = prevOverflow;
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      };

      const onKey = (event) => {
        if (event.key === 'Escape') cleanup(false);
      };
      document.addEventListener('keydown', onKey);

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) cleanup(false);
      });
      closeBtn.addEventListener('click', () => cleanup(false));
      cancelBtn.addEventListener('click', () => cleanup(false));
      confirmBtn.addEventListener('click', () => cleanup(true));
    });
  }

  function confirmPrivacyGateModern({
    profile,
    counts,
    stats,
    previewTurns = [],
    actionLabel = '계속',
    heading = '공유 전 확인',
    subheading = '외부로 공유하기 전에 민감정보가 없는지 확인하세요.',
  }) {
    ensureDesignSystemStyles();
    const profileLabel = PRIVACY_PROFILES[profile]?.label || profile;
    const summary = formatRedactionCounts(counts);

    const stack = document.createElement('div');
    stack.className = 'gmh-modal-stack';

    const summaryBox = document.createElement('div');
    summaryBox.className = 'gmh-privacy-summary';

    const rowProfile = document.createElement('div');
    rowProfile.className = 'gmh-privacy-summary__row';
    rowProfile.innerHTML = `<span class="gmh-privacy-summary__label">프로필</span><span>${profileLabel}</span>`;
    const rowTurns = document.createElement('div');
    rowTurns.className = 'gmh-privacy-summary__row';
    rowTurns.innerHTML = `<span class="gmh-privacy-summary__label">턴 수</span><span>플레이어 ${stats.playerTurns} / 전체 ${stats.totalTurns}</span>`;
    const rowCounts = document.createElement('div');
    rowCounts.className = 'gmh-privacy-summary__row';
    rowCounts.innerHTML = `<span class="gmh-privacy-summary__label">레다크션</span><span>${summary}</span>`;
    summaryBox.appendChild(rowProfile);
    summaryBox.appendChild(rowTurns);
    summaryBox.appendChild(rowCounts);
    stack.appendChild(summaryBox);

    const previewTitle = document.createElement('div');
    previewTitle.className = 'gmh-section-title';
    previewTitle.textContent = `미리보기 (${Math.min(previewTurns.length, PREVIEW_TURN_LIMIT)}턴)`;
    stack.appendChild(previewTitle);

    const turnList = document.createElement('ul');
    turnList.className = 'gmh-turn-list';
    previewTurns.slice(-PREVIEW_TURN_LIMIT).forEach((turn) => {
      if (!turn) return;
      const item = document.createElement('li');
      item.className = 'gmh-turn-list__item';
      const speaker = document.createElement('div');
      speaker.className = 'gmh-turn-list__speaker';
      speaker.textContent = `${turn.speaker || '??'} · ${turn.role}`;
      const text = document.createElement('div');
      text.className = 'gmh-turn-list__text';
      text.textContent = truncateText(turn.text || '');
      item.appendChild(speaker);
      item.appendChild(text);
      turnList.appendChild(item);
    });
    if (!turnList.children.length) {
      const empty = document.createElement('li');
      empty.className = 'gmh-turn-list__item gmh-turn-list__empty';
      empty.textContent = '표시할 턴이 없습니다. 상단 요약만 확인해주세요.';
      turnList.appendChild(empty);
    }
    stack.appendChild(turnList);

    const footnote = document.createElement('div');
    footnote.className = 'gmh-modal-footnote';
    footnote.textContent = subheading;
    stack.appendChild(footnote);

    return GMH.UI.Modal.open({
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
    }).then((result) => Boolean(result));
  }

  function confirmPrivacyGate(options) {
    return isModernUIActive
      ? confirmPrivacyGateModern(options)
      : confirmPrivacyGateLegacy(options);
  }

  function buildExportManifest({
    profile,
    counts,
    stats,
    format,
    warnings,
    source,
  }) {
    return {
      tool: 'Genit Memory Helper',
      version: SCRIPT_VERSION,
      generated_at: new Date().toISOString(),
      profile,
      counts,
      stats,
      format,
      warnings,
      source,
    };
  }

  async function configurePrivacyListsModern() {
    ensureDesignSystemStyles();
    const stack = document.createElement('div');
    stack.className = 'gmh-modal-stack';

    const intro = document.createElement('p');
    intro.className = 'gmh-subtext';
    intro.textContent =
      '쉼표 또는 줄바꿈으로 여러 항목을 구분하세요. 블랙리스트는 강제 마스킹, 화이트리스트는 예외 처리됩니다.';
    stack.appendChild(intro);

    const blackLabel = document.createElement('div');
    blackLabel.className = 'gmh-field-label';
    blackLabel.textContent = `블랙리스트 (${PRIVACY_CFG.blacklist?.length || 0})`;
    stack.appendChild(blackLabel);

    const blackTextarea = document.createElement('textarea');
    blackTextarea.id = 'gmh-privacy-blacklist';
    blackTextarea.className = 'gmh-textarea';
    blackTextarea.placeholder = '예: 서울시, 010-1234-5678';
    blackTextarea.value = PRIVACY_CFG.blacklist?.join('\n') || '';
    stack.appendChild(blackTextarea);

    const whiteLabel = document.createElement('div');
    whiteLabel.className = 'gmh-field-label';
    whiteLabel.textContent = `화이트리스트 (${PRIVACY_CFG.whitelist?.length || 0})`;
    stack.appendChild(whiteLabel);

    const whiteTextarea = document.createElement('textarea');
    whiteTextarea.id = 'gmh-privacy-whitelist';
    whiteTextarea.className = 'gmh-textarea';
    whiteTextarea.placeholder = '예: 공식 길드명, 공개 닉네임';
    whiteTextarea.value = PRIVACY_CFG.whitelist?.join('\n') || '';
    stack.appendChild(whiteTextarea);

    const result = await GMH.UI.Modal.open({
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
    });

    if (!result) {
      setPanelStatus('프라이버시 설정 변경을 취소했습니다.', 'muted');
      return;
    }

    setCustomList('blacklist', parseListInput(blackTextarea.value));
    setCustomList('whitelist', parseListInput(whiteTextarea.value));
    setPanelStatus('프라이버시 사용자 목록을 저장했습니다.', 'success');
  }

  function configurePrivacyListsLegacy() {
    const currentBlack = PRIVACY_CFG.blacklist?.join('\n') || '';
    const nextBlack = window.prompt(
      '레다크션 강제 대상(블랙리스트)을 줄바꿈 또는 쉼표로 구분해 입력하세요.\n비워두면 목록을 초기화합니다.',
      currentBlack,
    );
    if (nextBlack !== null) {
      setCustomList('blacklist', parseListInput(nextBlack));
    }
    const currentWhite = PRIVACY_CFG.whitelist?.join('\n') || '';
    const nextWhite = window.prompt(
      '레다크션 예외 대상(화이트리스트)을 줄바꿈 또는 쉼표로 구분해 입력하세요.\n비워두면 목록을 초기화합니다.',
      currentWhite,
    );
    if (nextWhite !== null) {
      setCustomList('whitelist', parseListInput(nextWhite));
    }
    setPanelStatus('프라이버시 사용자 목록을 저장했습니다.', 'info');
  }

  async function configurePrivacyLists() {
    if (isModernUIActive) return configurePrivacyListsModern();
    return configurePrivacyListsLegacy();
  }

  function normNL(s) {
    return String(s ?? '').replace(/\r\n?|\u2028|\u2029/g, '\n');
  }

  function stripTicks(s) {
    return String(s ?? '').replace(/```+/g, '');
  }

  function collapseSpaces(s) {
    return String(s ?? '')
      .replace(/\s+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function stripQuotes(s) {
    return String(s ?? '')
      .replace(/^['"“”『「《【]+/, '')
      .replace(/['"“”』」》】]+$/, '')
      .trim();
  }

  function stripBrackets(v) {
    return String(v ?? '')
      .replace(/^\[|\]$/g, '')
      .trim();
  }

  function sanitizeText(s) {
    return collapseSpaces(normNL(s).replace(/[\t\v\f\u00a0\u200b]/g, ' '));
  }

  function parseListInput(raw) {
    if (!raw) return [];
    return normNL(raw)
      .split(/[,\n]/)
      .map((item) => collapseSpaces(item))
      .filter(Boolean);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function triggerDownload(blob, filename) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function isScrollable(el) {
    if (!el) return false;
    if (el === document.body || el === document.documentElement) {
      const target = el === document.body ? document.documentElement : el;
      return target.scrollHeight > target.clientHeight + 4;
    }
    if (!(el instanceof Element)) return false;
    const cs = getComputedStyle(el);
    const oy = cs.overflowY;
    const scrollableStyle =
      oy === 'auto' || oy === 'scroll' || oy === 'overlay';
    return scrollableStyle && el.scrollHeight > el.clientHeight + 4;
  }

  function looksLikeName(raw) {
    const s = String(raw ?? '')
      .replace(/^[\-•\s]+/, '')
      .trim();
    if (!s) return false;
    if (/^(INFO|메시지 이미지)$/i.test(s)) return false;
    return /^[가-힣A-Za-z][\w가-힣 .,'’]{0,24}$/.test(s);
  }

  function looksNarrative(line) {
    const s = line.trim();
    if (!s) return false;
    if (/^[\[\(].*[\]\)]$/.test(s)) return true;
    if (/^(...|···|…)/.test(s)) return true;
    if (/^(당신|너는|그는|그녀는)\s/.test(s)) return true;
    if (/[.!?"']$/.test(s)) return true;
    if (
      /[가-힣]{2,}(은|는|이|가|을|를|으로|로|에게|에서|하며|면서|라고)\s/.test(
        s,
      )
    )
      return true;
    if (s.includes(' ')) {
      const words = s.split(/\s+/);
      if (words.length >= 4) return true;
    }
    return false;
  }

  function isActorStatsLine(line) {
    return /\|/.test(line) && /❤️|💗|💦|🪣/.test(line);
  }

  function isMetaLine(line) {
    const stripped = stripBrackets(line);
    if (!stripped) return true;
    if (/^INFO$/i.test(stripped)) return true;
    if (isActorStatsLine(stripped)) return true;
    if (/^메시지 이미지$/i.test(stripped)) return true;
    if (CODE_RE.test(stripped.replace(/\s+/g, ''))) return true;
    for (const keyword of META_KEYWORDS) {
      if (stripped.startsWith(keyword)) return true;
    }
    if (/^[-=]{3,}$/.test(stripped)) return true;
    return false;
  }

  GMH.Adapters.genit = (() => {
    const selectors = {
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
        '[data-role="user"] .markdown-content',
        '.markdown-content.text-right',
        '.p-4.rounded-xl.bg-background p',
      ],
      npcGroups: ['[data-role="assistant"]', '.flex.flex-col.w-full.group'],
      npcName: [
        '[data-author-name]',
        '[data-author]',
        '[data-username]',
        '.text-sm.text-muted-foreground.mb-1.ml-1',
      ],
      npcBubble: [
        '.p-4.rounded-xl.bg-background p',
        '.markdown-content:not(.text-right)',
      ],
      narrationBlocks: [
        '.markdown-content.text-muted-foreground',
        '.text-muted-foreground.text-sm',
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
    };

    const playerScopeSelector = selectors.playerScopes
      .filter(Boolean)
      .join(',');
    const npcScopeSelector = selectors.npcGroups.filter(Boolean).join(',');

    const collectAll = (selList, root = document) => {
      const out = [];
      const seen = new Set();
      if (!selList?.length) return out;
      for (const sel of selList) {
        if (!sel) continue;
        let nodes;
        try {
          nodes = root.querySelectorAll(sel);
        } catch (e) {
          continue;
        }
        nodes.forEach((node) => {
          if (!node || seen.has(node)) return;
          seen.add(node);
          out.push(node);
        });
      }
      return out;
    };

    const firstMatch = (selList, root = document) => {
      if (!selList?.length) return null;
      for (const sel of selList) {
        if (!sel) continue;
        try {
          const node = root.querySelector(sel);
          if (node) return node;
        } catch (e) {
          continue;
        }
      }
      return null;
    };

    const textSegmentsFromNode = (node) => {
      if (!node) return [];
      const text = node.innerText ?? node.textContent ?? '';
      if (!text) return [];
      return text
        .split(/\r?\n+/)
        .map((seg) => seg.trim())
        .filter(Boolean);
    };

    const findScrollableAncestor = (node) => {
      let current = node instanceof Element ? node : null;
      for (let depth = 0; depth < 6 && current; depth += 1) {
        if (isScrollable(current)) return current;
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
      if (!hints.length) return null;
      const nodes = collectAll(['main', 'section', 'article'], root).filter(
        (node) => {
          if (!node || node.childElementCount < 3) return false;
          const text = (node.textContent || '').trim();
          if (!text || text.length > 400) return false;
          return hints.some((hint) => text.includes(hint));
        },
      );
      return nodes.find((node) => isScrollable(node));
    };

    const getChatContainer = (doc = document) => {
      const direct = firstMatch(selectors.chatContainers, doc);
      if (direct && isScrollable(direct)) return direct;

      const roleMatch = findByRole(doc);
      if (roleMatch) return roleMatch;

      const block = firstMatch(selectors.messageRoot, doc);
      if (block) {
        const scrollable = findScrollableAncestor(block.parentElement);
        if (scrollable) return scrollable;
      }

      const hintMatch = findByTextHint(doc);
      if (hintMatch) return hintMatch;

      return null;
    };

    const getMessageBlocks = (root) => {
      const targetRoot = root || document;
      const blocks = collectAll(selectors.messageRoot, targetRoot);
      if (blocks.length) return blocks;
      if (targetRoot !== document) {
        const fallback = collectAll(selectors.messageRoot, document);
        if (fallback.length) return fallback;
      }
      return [];
    };

    const emitInfo = (block, pushLine) => {
      const infoNode = firstMatch(selectors.infoCode, block);
      if (!infoNode) return;
      pushLine('INFO');
      textSegmentsFromNode(infoNode).forEach((seg) => pushLine(seg));
    };

    const emitPlayerLines = (block, pushLine) => {
      const scopes = collectAll(selectors.playerScopes, block);
      if (!scopes.length) return;
      const textNodes = [];
      const nodeSeen = new Set();
      for (const scope of scopes) {
        collectAll(selectors.playerText, scope).forEach((node) => {
          if (!nodeSeen.has(node)) {
            nodeSeen.add(node);
            textNodes.push(node);
          }
        });
      }
      const targets = textNodes.length ? textNodes : scopes;
      const seenSegments = new Set();
      targets.forEach((node) => {
        textSegmentsFromNode(node).forEach((seg) => {
          if (!seg) return;
          if (seenSegments.has(seg)) return;
          seenSegments.add(seg);
          pushLine(PLAYER_MARK + seg);
        });
      });
    };

    const extractNameFromGroup = (group) => {
      const nameNode = firstMatch(selectors.npcName, group);
      let name =
        nameNode?.getAttribute?.('data-author-name') || nameNode?.textContent;
      if (!name) {
        name =
          group.getAttribute('data-author') ||
          group.getAttribute('data-username') ||
          group.getAttribute('data-name');
      }
      return stripQuotes(collapseSpaces(name || '')).slice(0, 40);
    };

    const emitNpcLines = (block, pushLine) => {
      const groups = collectAll(selectors.npcGroups, block);
      if (!groups.length) return;
      groups.forEach((group) => {
        if (playerScopeSelector && group.closest(playerScopeSelector)) return;
        const nameRaw = extractNameFromGroup(group);
        const name = nameRaw || 'NPC';
        const bubbleNodes = collectAll(selectors.npcBubble, group);
        const targets = bubbleNodes.length ? bubbleNodes : [group];
        targets.forEach((node) => {
          textSegmentsFromNode(node).forEach((seg) => {
            if (!seg) return;
            pushLine(`@${name}@ "${seg}"`);
          });
        });
      });
    };

    const emitNarrationLines = (block, pushLine) => {
      const nodes = collectAll(selectors.narrationBlocks, block);
      if (!nodes.length) return;
      nodes.forEach((node) => {
        if (playerScopeSelector && node.closest(playerScopeSelector)) return;
        if (npcScopeSelector && node.closest(npcScopeSelector)) return;
        textSegmentsFromNode(node).forEach((seg) => {
          if (!seg) return;
          pushLine(seg);
        });
      });
    };

    const emitTranscriptLines = (block, pushLine) => {
      emitInfo(block, pushLine);
      emitPlayerLines(block, pushLine);
      emitNpcLines(block, pushLine);
      emitNarrationLines(block, pushLine);
    };

    const guessPlayerNames = () => {
      const results = new Set();
      collectAll(selectors.playerNameHints).forEach((node) => {
        const text = node?.textContent?.trim();
        if (text) results.add(stripQuotes(text));
        const attrNames = [
          'data-username',
          'data-user-name',
          'data-display-name',
        ];
        for (const attr of attrNames) {
          const val = node.getAttribute?.(attr);
          if (val) results.add(stripQuotes(val));
        }
      });
      collectAll(selectors.playerScopes).forEach((scope) => {
        const attrNames = ['data-username', 'data-user-name', 'data-author'];
        for (const attr of attrNames) {
          const val = scope.getAttribute?.(attr);
          if (val) results.add(stripQuotes(val));
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

    const match = (loc) => /genit\.ai/i.test(loc.hostname);

    return {
      id: 'genit',
      label: 'Genit',
      match,
      findContainer: (doc = document) => getChatContainer(doc),
      listMessageBlocks: (root) => getMessageBlocks(root),
      emitTranscriptLines,
      guessPlayerNames,
      getPanelAnchor,
      dumpSelectors: () => selectors,
    };
  })();

  GMH.Core.adapters = [GMH.Adapters.genit];

  GMH.Core.pickAdapter = function pickAdapter(loc = location, doc = document) {
    const candidates = Array.isArray(GMH.Core.adapters)
      ? GMH.Core.adapters
      : [];
    for (const adapter of candidates) {
      try {
        if (adapter?.match?.(loc, doc)) return adapter;
      } catch (err) {
        console.warn('[GMH] adapter match error', err);
      }
    }
    return GMH.Adapters.genit;
  };

  let ACTIVE_ADAPTER = null;

  function getActiveAdapter() {
    if (!ACTIVE_ADAPTER) {
      ACTIVE_ADAPTER = GMH.Core.pickAdapter(location, document);
    }
    return ACTIVE_ADAPTER;
  }

  let STATUS_ELEMENT = null;
  let PROFILE_SELECT_ELEMENT = null;
  let PRIVACY_SELECT_ELEMENT = null;

  const PanelVisibility = (() => {
    const COLLAPSED_CLASS = 'gmh-collapsed';
    const OPEN_CLASS = 'gmh-panel-open';
    const AUTO_HIDE_DELAY = 10000;
    const STORAGE_KEY = 'gmh_panel_collapsed';
    let panelEl = null;
    let fabEl = null;
    let modernMode = false;
    let idleTimer = null;
    let stateUnsubscribe = null;
    let outsidePointerHandler = null;
    let escapeKeyHandler = null;
    let panelListenersBound = false;
    let currentState = GMH_STATE.IDLE;
    let userCollapsed = false;
    let persistedPreference = null;

    const loadPersistedCollapsed = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === '1') return true;
        if (raw === '0') return false;
      } catch (err) {
        console.warn('[GMH] failed to read panel state', err);
      }
      return null;
    };

    const persistCollapsed = (value) => {
      persistedPreference = value;
      try {
        if (value === null) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
      } catch (err) {
        console.warn('[GMH] failed to persist panel state', err);
      }
    };

    const getRoot = () => document.documentElement;

    const isModernActive = () => modernMode && !!panelEl;

    const isCollapsed = () => {
      if (!isModernActive()) return false;
      return getRoot().classList.contains(COLLAPSED_CLASS);
    };

    const clearIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
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
      } else {
        root.classList.add(OPEN_CLASS);
        root.classList.remove(COLLAPSED_CLASS);
      }
    };

    const syncAria = (collapsed) => {
      if (!panelEl) return;
      panelEl.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
      if (fabEl)
        fabEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    };

    const scheduleIdleClose = () => {
      if (!isModernActive()) return;
      clearIdleTimer();
      if (isCollapsed()) return;
      if (currentState !== GMH_STATE.IDLE) return;
      idleTimer = window.setTimeout(() => {
        if (!isModernActive()) return;
        if (currentState !== GMH_STATE.IDLE) return;
        close('idle');
      }, AUTO_HIDE_DELAY);
    };

    const resetIdleTimer = () => {
      if (!isModernActive()) return;
      if (isCollapsed()) return;
      scheduleIdleClose();
    };

    const ensureFab = () => {
      if (!modernMode) return null;
      if (!fabEl || !fabEl.isConnected) {
        fabEl = document.getElementById('gmh-fab');
      }
      if (!fabEl || !fabEl.isConnected) {
        fabEl = document.createElement('button');
        fabEl.id = 'gmh-fab';
        fabEl.type = 'button';
        fabEl.textContent = 'GMH';
        fabEl.setAttribute('aria-label', 'Genit Memory Helper 토글');
        fabEl.setAttribute('aria-controls', 'genit-memory-helper-panel');
        document.body.appendChild(fabEl);
      }
      fabEl.onclick = (event) => {
        event.preventDefault();
        toggle();
      };
      fabEl.setAttribute('aria-expanded', isCollapsed() ? 'false' : 'true');
      return fabEl;
    };

    const attachPanelListeners = () => {
      if (!isModernActive() || panelListenersBound) return;
      const passiveReset = () => resetIdleTimer();
      panelEl.addEventListener('pointerdown', passiveReset, { passive: true });
      panelEl.addEventListener('pointermove', passiveReset, { passive: true });
      panelEl.addEventListener('wheel', passiveReset, { passive: true });
      panelEl.addEventListener('touchstart', passiveReset, { passive: true });
      panelEl.addEventListener('keydown', resetIdleTimer);
      panelEl.addEventListener('focusin', resetIdleTimer);
      panelListenersBound = true;
    };

    const ensureOutsideHandler = () => {
      if (outsidePointerHandler) return;
      outsidePointerHandler = (event) => {
        if (!isModernActive()) return;
        if (isCollapsed()) return;
        const target = event.target;
        if (panelEl && panelEl.contains(target)) return;
        if (fabEl && fabEl.contains(target)) return;
        if (GMH.UI.Modal?.isOpen?.()) return;
        close('user');
      };
      document.addEventListener('pointerdown', outsidePointerHandler);
    };

    const ensureEscapeHandler = () => {
      if (escapeKeyHandler) return;
      escapeKeyHandler = (event) => {
        if (!isModernActive()) return;
        if (
          event.key !== 'Escape' ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        if (GMH.UI.Modal?.isOpen?.()) return;
        if (isCollapsed()) return;
        close('user');
        event.preventDefault();
      };
      window.addEventListener('keydown', escapeKeyHandler);
    };

    const ensureStateSubscription = () => {
      if (stateUnsubscribe || typeof GMH?.Core?.State?.subscribe !== 'function')
        return;
      stateUnsubscribe = GMH.Core.State.subscribe((next) => {
        currentState = next || GMH_STATE.IDLE;
        if (!modernMode) return;
        if (currentState !== GMH_STATE.IDLE) {
          if (!userCollapsed) open({ focus: false });
          clearIdleTimer();
        } else {
          userCollapsed = false;
          scheduleIdleClose();
        }
      });
    };

    const open = ({ focus = false, persist = false } = {}) => {
      if (!panelEl) return false;
      if (!modernMode) {
        if (focus && typeof panelEl.focus === 'function') {
          requestAnimationFrame(() => panelEl.focus({ preventScroll: true }));
        }
        return true;
      }
      const wasCollapsed = isCollapsed();
      applyRootState(false);
      syncAria(false);
      if (persist) persistCollapsed(false);
      userCollapsed = false;
      if (focus && typeof panelEl.focus === 'function') {
        requestAnimationFrame(() => panelEl.focus({ preventScroll: true }));
      }
      if (currentState === GMH_STATE.IDLE) scheduleIdleClose();
      else clearIdleTimer();
      return wasCollapsed;
    };

    const close = (reason = 'user') => {
      if (!panelEl || !modernMode) return false;
      if (isCollapsed()) return false;
      applyRootState(true);
      syncAria(true);
      clearIdleTimer();
      if (reason === 'user') {
        userCollapsed = true;
        persistCollapsed(true);
      }
      if (reason === 'idle') userCollapsed = false;
      return true;
    };

    const toggle = () => {
      if (!panelEl || !modernMode) return false;
      if (isCollapsed()) {
        open({ focus: true, persist: true });
        return true;
      }
      close('user');
      return false;
    };

    const bind = (panel, { modern } = {}) => {
      panelEl = panel || null;
      panelListenersBound = false;
      modernMode = !!modern && !!panelEl;
      if (!panelEl) return;
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
      currentState =
        normalizeState(GMH.Core.State?.getState?.()) || GMH_STATE.IDLE;
      ensureFab();
      attachPanelListeners();
      ensureOutsideHandler();
      ensureEscapeHandler();
      persistedPreference = loadPersistedCollapsed();
      const shouldCollapse = (() => {
        if (typeof persistedPreference === 'boolean')
          return persistedPreference;
        const mq = window.matchMedia?.('(max-width: 768px)');
        if (mq?.matches) return true;
        if (typeof window.innerWidth === 'number')
          return window.innerWidth <= 768;
        return false;
      })();
      applyRootState(shouldCollapse);
      syncAria(shouldCollapse);
      userCollapsed = shouldCollapse;
      if (!shouldCollapse) scheduleIdleClose();
    };

    const onStatusUpdate = ({ tone } = {}) => {
      if (!isModernActive()) return;
      if (
        tone &&
        ['error', 'warning', 'progress'].includes(tone) &&
        isCollapsed()
      ) {
        open({ focus: false });
      }
      if (!isCollapsed()) scheduleIdleClose();
    };

    return {
      bind,
      open,
      close,
      toggle,
      isCollapsed,
      onStatusUpdate,
    };
  })();

  const STATUS_TONES = {
    success: { color: '#34d399', icon: '✅' },
    info: { color: '#93c5fd', icon: 'ℹ️' },
    progress: { color: '#facc15', icon: '⏳' },
    warning: { color: '#f97316', icon: '⚠️' },
    error: { color: '#f87171', icon: '❌' },
    muted: { color: '#cbd5f5', icon: '' },
  };

  function attachStatusElement(el) {
    STATUS_ELEMENT = el || null;
  }

  function setPanelStatus(message, toneOrColor = 'info') {
    if (!STATUS_ELEMENT) return;
    const text = String(message || '');
    let icon = '';
    let color = '#9ca3af';
    let tone = toneOrColor;

    if (typeof toneOrColor === 'string' && toneOrColor.startsWith('#')) {
      color = toneOrColor;
      tone = null;
    } else if (typeof toneOrColor === 'string' && STATUS_TONES[toneOrColor]) {
      tone = toneOrColor;
    } else if (!toneOrColor) {
      tone = 'info';
    }

    if (tone && STATUS_TONES[tone]) {
      color = STATUS_TONES[tone].color;
      icon = STATUS_TONES[tone].icon || '';
    }

    STATUS_ELEMENT.textContent = icon ? `${icon} ${text}` : text;
    STATUS_ELEMENT.style.color = color;
    if (tone) STATUS_ELEMENT.dataset.tone = tone;
    else delete STATUS_ELEMENT.dataset.tone;
    PanelVisibility.onStatusUpdate({ tone });
  }

  const STATE_PRESETS = {
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

  GMH.UI.StateView = (() => {
    let progressFillEl = null;
    let progressLabelEl = null;
    let unsubscribe = null;

    const clamp = (value) => {
      if (!Number.isFinite(value)) return 0;
      if (value < 0) return 0;
      if (value > 1) return 1;
      return value;
    };

    const applyState = (stateKey, meta = {}) => {
      const payload = meta?.payload || {};
      const preset = STATE_PRESETS[stateKey] || STATE_PRESETS.idle;
      const label = payload.label || preset.label || '';
      const tone = payload.tone || preset.tone || 'info';
      const message = payload.message || preset.message || label || '';
      const progress = payload.progress || preset.progress || null;

      if (progressLabelEl) progressLabelEl.textContent = label || ' ';

      if (progressFillEl) {
        if (progress?.indeterminate) {
          progressFillEl.dataset.indeterminate = 'true';
          progressFillEl.style.width = '40%';
          progressFillEl.setAttribute('aria-valuenow', '0');
        } else {
          progressFillEl.dataset.indeterminate = 'false';
          const value = clamp(progress?.value);
          progressFillEl.style.width = `${Math.round(value * 100)}%`;
          progressFillEl.setAttribute('aria-valuenow', String(value));
        }
        progressFillEl.dataset.state = stateKey || 'idle';
        if (label) progressFillEl.setAttribute('aria-valuetext', label);
      }

      if (message) setPanelStatus(message, tone);
    };

    const bind = ({ progressFill, progressLabel } = {}) => {
      progressFillEl = progressFill || null;
      progressLabelEl = progressLabel || null;
      if (typeof unsubscribe === 'function') unsubscribe();
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
      unsubscribe = GMH.Core.State.subscribe((state, meta) => {
        applyState(state, meta);
      });
      const current = GMH.Core.State.getState();
      applyState(current, { payload: STATE_PRESETS[current] || {} });
    };

    return { bind };
  })();

  function syncPrivacyProfileSelect() {
    if (PRIVACY_SELECT_ELEMENT) {
      PRIVACY_SELECT_ELEMENT.value = PRIVACY_CFG.profile;
    }
  }

  const AUTO_PROFILES = {
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
  };

  const AUTO_CFG = {
    profile: 'default',
  };

  function getAutoProfile() {
    return AUTO_PROFILES[AUTO_CFG.profile] || AUTO_PROFILES.default;
  }

  function syncProfileSelect() {
    if (PROFILE_SELECT_ELEMENT) {
      PROFILE_SELECT_ELEMENT.value = AUTO_CFG.profile;
    }
  }

  function describeNode(node) {
    if (!node || !(node instanceof Element)) return null;
    const parts = [];
    let current = node;
    let depth = 0;
    while (current && depth < 5) {
      let part = current.tagName.toLowerCase();
      if (current.id) part += `#${current.id}`;
      if (current.classList?.length)
        part += `.${Array.from(current.classList).slice(0, 3).join('.')}`;
      parts.unshift(part);
      current = current.parentElement;
      depth += 1;
    }
    return parts.join(' > ');
  }

  function downloadDomSnapshot() {
    try {
      const adapter = getActiveAdapter();
      const container = adapter?.findContainer?.(document);
      const blocks = adapter?.listMessageBlocks?.(container || document) || [];
      const snapshot = {
        url: location.href,
        captured_at: new Date().toISOString(),
        profile: AUTO_CFG.profile,
        container_path: describeNode(container),
        block_count: blocks.length,
        selector_strategies: adapter?.dumpSelectors?.(),
        container_html_sample: container
          ? (container.innerHTML || '').slice(0, 40000)
          : null,
      };
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: 'application/json',
      });
      triggerDownload(blob, `genit-snapshot-${Date.now()}.json`);
      setPanelStatus('DOM 스냅샷이 저장되었습니다.', 'success');
    } catch (error) {
      console.error('[GMH] snapshot error', error);
      setPanelStatus(
        `스냅샷 실패: ${(error && error.message) || error}`,
        'error',
      );
    }
  }

  const autoLoader = {
    lastMode: null,
    lastTarget: null,
    lastProfile: AUTO_CFG.profile,
    async start(mode, target, opts = {}) {
      if (AUTO_STATE.running) {
        setPanelStatus('이미 자동 로딩이 진행 중입니다.', 'muted');
        return null;
      }
      if (opts.profile) {
        AUTO_CFG.profile = AUTO_PROFILES[opts.profile]
          ? opts.profile
          : 'default';
        syncProfileSelect();
      }
      this.lastMode = mode;
      this.lastProfile = AUTO_CFG.profile;
      try {
        if (mode === 'all') {
          this.lastTarget = null;
          GMH.Core.State.setState(GMH.Core.STATE.SCANNING, {
            label: '위로 끝까지 로딩',
            message: '위로 불러오는 중...',
            tone: 'progress',
            progress: { indeterminate: true },
          });
          return await autoLoadAll();
        }
        if (mode === 'turns') {
          const numericTarget = Number(target);
          const goal = Number.isFinite(numericTarget)
            ? numericTarget
            : Number(target) || 0;
          if (!goal || goal <= 0) {
            setPanelStatus('플레이어 턴 목표가 올바르지 않습니다.', 'error');
            return null;
          }
          this.lastTarget = goal;
          GMH.Core.State.setState(GMH.Core.STATE.SCANNING, {
            label: '턴 확보 중',
            message: `플레이어 턴 0/${goal}`,
            tone: 'progress',
            progress: { value: 0 },
          });
          return await autoLoadUntilPlayerTurns(goal);
        }
      } catch (error) {
        console.error('[GMH] auto loader error', error);
        GMH.Core.State.setState(GMH.Core.STATE.ERROR, {
          label: '자동 로딩 오류',
          message: `자동 로딩 오류: ${(error && error.message) || error}`,
          tone: 'error',
          progress: { value: 1 },
        });
        throw error;
      }
      return null;
    },
    async startCurrent(profileName) {
      if (!this.lastMode) {
        setPanelStatus('재시도할 이전 작업이 없습니다.', 'muted');
        return null;
      }
      if (profileName) {
        AUTO_CFG.profile = AUTO_PROFILES[profileName] ? profileName : 'default';
      } else {
        AUTO_CFG.profile = this.lastProfile || 'default';
      }
      syncProfileSelect();
      return this.start(this.lastMode, this.lastTarget);
    },
    setProfile(profileName) {
      const next = AUTO_PROFILES[profileName] ? profileName : 'default';
      AUTO_CFG.profile = next;
      this.lastProfile = next;
      setPanelStatus(`프로파일이 '${next}'로 설정되었습니다.`, 'info');
      syncProfileSelect();
    },
    stop() {
      stopAutoLoad();
    },
  };

  function guessPlayerNamesFromDOM() {
    const adapter = getActiveAdapter();
    return adapter?.guessPlayerNames?.() || [];
  }

  const PLAYER_NAMES = Array.from(
    new Set(
      [...PLAYER_NAME_FALLBACKS, ...guessPlayerNamesFromDOM()].filter(Boolean),
    ),
  );

  const PLAYER_ALIASES = new Set(
    PLAYER_NAMES.map((n) => n.toLowerCase()).concat([
      'player',
      '플레이어',
      '유저',
      '나',
    ]),
  );

  function normalizeSpeakerName(name) {
    const stripped = collapseSpaces(name)
      .replace(/[\[\]{}()]+/g, '')
      .replace(/^[-•]+/, '')
      .trim();
    if (!stripped) return '내레이션';
    const lower = stripped.toLowerCase();
    if (PLAYER_ALIASES.has(lower)) return PLAYER_NAMES[0] || '플레이어';
    if (/^(system|시스템|내레이션|narration)$/i.test(lower)) return '내레이션';
    return stripped;
  }

  function roleForSpeaker(name) {
    if (name === '내레이션') return 'narration';
    if (PLAYER_NAMES.includes(name)) return 'player';
    return 'npc';
  }

  function normalizeTranscript(raw) {
    return stripTicks(normNL(raw)).replace(/[\t\u00a0\u200b]/g, ' ');
  }

  // -------------------------------
  // 1) Turns-first parser
  // -------------------------------
  function parseTurns(raw) {
    const lines = normalizeTranscript(raw).split('\n');
    const turns = [];
    const warnings = [];
    const metaHints = { header: null, codes: [], titles: [] };

    let currentSceneId = 1;
    let pendingSpeaker = null;

    const pushTurn = (speaker, text, roleOverride) => {
      const textClean = sanitizeText(text);
      if (!textClean) return;
      const speakerName = normalizeSpeakerName(speaker || '내레이션');
      const role = roleOverride || roleForSpeaker(speakerName);
      if (role === 'player' && turns.length) {
        currentSceneId += 1;
      }
      const last = turns[turns.length - 1];
      if (last && last.speaker === speakerName && last.role === role) {
        last.text = `${last.text} ${textClean}`.trim();
        return;
      }
      turns.push({
        speaker: speakerName,
        role,
        text: textClean,
        sceneId: currentSceneId,
      });
    };

    for (let i = 0; i < lines.length; i++) {
      let original = lines[i] ?? '';
      if (!original) continue;
      let line = original.trim();
      if (!line) continue;

      const headerMatch = HEADER_RE.exec(line);
      if (headerMatch) {
        if (!metaHints.header) metaHints.header = headerMatch;
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
      if (!line) continue;

      if (isMetaLine(line)) {
        pendingSpeaker = null;
        continue;
      }

      let m = line.match(/^@([^@]{1,40})@\s*["“]?([\s\S]+?)["”]?\s*$/);
      if (m) {
        const speaker = normalizeSpeakerName(m[1]);
        pushTurn(speaker, m[2], roleForSpeaker(speaker));
        pendingSpeaker = speaker;
        continue;
      }

      if (forcedPlayer) {
        const speaker = PLAYER_NAMES[0] || '플레이어';
        pushTurn(speaker, stripQuotes(line), 'player');
        pendingSpeaker = speaker;
        continue;
      }

      m = line.match(/^([^:@—\-]{1,40})\s*[:\-—]\s*(.+)$/);
      if (m && looksLikeName(m[1])) {
        const speaker = normalizeSpeakerName(m[1]);
        pushTurn(speaker, stripQuotes(m[2]), roleForSpeaker(speaker));
        pendingSpeaker = speaker;
        continue;
      }

      if (looksNarrative(line) || /^".+"$/.test(line) || /^“.+”$/.test(line)) {
        pushTurn('내레이션', stripQuotes(line), 'narration');
        pendingSpeaker = null;
        continue;
      }

      if (looksLikeName(line)) {
        const speaker = normalizeSpeakerName(line);
        let textBuf = [];
        let j = i + 1;
        while (j < lines.length) {
          let peek = (lines[j] || '').trim();
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
          if (
            HEADER_RE.test(peek) ||
            stripBrackets(peek).toUpperCase() === 'INFO'
          )
            break;
          if (isMetaLine(peek)) break;
          if (peekForced) break;
          if (looksLikeName(peek) || /^@[^@]+@/.test(peek)) break;
          textBuf.push(peek);
          j += 1;
          if (!/["”]$/.test(peek)) break;
        }
        if (textBuf.length) {
          pushTurn(
            speaker,
            stripQuotes(textBuf.join(' ')),
            roleForSpeaker(speaker),
          );
          pendingSpeaker = speaker;
          i = j - 1;
          continue;
        }
        pendingSpeaker = speaker;
        continue;
      }

      if (pendingSpeaker) {
        pushTurn(
          pendingSpeaker,
          stripQuotes(line),
          roleForSpeaker(pendingSpeaker),
        );
        continue;
      }

      if (line.length <= 30 && /[!?…]$/.test(line) && turns.length) {
        const last = turns[turns.length - 1];
        last.text = `${last.text} ${line}`.trim();
        continue;
      }

      pushTurn('내레이션', line, 'narration');
      pendingSpeaker = null;
    }

    return { turns, warnings, metaHints };
  }

  function deriveMeta(metaHints, turns) {
    const meta = {};
    if (metaHints.header) {
      const [, time, modeRaw, placeRaw] = metaHints.header;
      if (time) meta.date = time.trim();
      if (modeRaw) meta.mode = modeRaw.trim();
      if (placeRaw) meta.place = placeRaw.trim();
    }
    const title = metaHints.titles.find(Boolean);
    if (title) meta.title = title;

    const actorSet = new Set();
    for (const t of turns) {
      if (t.role === 'player' || t.role === 'npc') actorSet.add(t.speaker);
    }
    meta.actors = Array.from(actorSet);
    if (!meta.title && meta.place) meta.title = `${meta.place} 세션`;
    meta.player = PLAYER_NAMES[0] || '플레이어';
    meta.turn_count = turns.filter((t) => t.role === 'player').length;
    return meta;
  }

  function buildSession(raw) {
    const { turns, warnings, metaHints } = parseTurns(raw);
    const meta = deriveMeta(metaHints, turns);
    return {
      meta,
      turns,
      warnings,
      source: 'genit-memory-helper',
    };
  }

  // -------------------------------
  // 2) Writers (JSON / TXT / Markdown)
  // -------------------------------
  function toJSONExport(session, normalizedRaw) {
    const payload = {
      version: '1.0',
      generated_at: new Date().toISOString(),
      source: session.source,
      player_names: session.player_names || PLAYER_NAMES,
      meta: session.meta,
      turns: session.turns,
      warnings: session.warnings,
      raw_excerpt: (normalizedRaw || '').slice(0, 2000),
    };
    return JSON.stringify(payload, null, 2);
  }

  function toTXTExport(session, opts = {}) {
    const turns = opts.turns || session.turns;
    const includeMeta = opts.includeMeta !== false;
    const lines = [];
    if (includeMeta) {
      if (session.meta.title) lines.push(`# TITLE: ${session.meta.title}`);
      if (session.meta.date) lines.push(`# DATE: ${session.meta.date}`);
      if (session.meta.place) lines.push(`# PLACE: ${session.meta.place}`);
      if (session.meta.actors?.length)
        lines.push(`# ACTORS: ${session.meta.actors.join(', ')}`);
      lines.push('');
    }
    for (const t of turns) {
      const speaker = t.role === 'narration' ? '내레이션' : t.speaker;
      lines.push(`@${speaker}@ ${t.text}`);
    }
    return lines.join('\n').trim();
  }

  function toMarkdownExport(session, opts = {}) {
    const turns = opts.turns || session.turns;
    const heading = opts.heading || '# 대화 로그';
    const includeMeta = opts.includeMeta !== false;
    const lines = [heading];
    if (includeMeta) {
      const metaLines = [];
      if (session.meta.date) metaLines.push(`- 날짜: ${session.meta.date}`);
      if (session.meta.place) metaLines.push(`- 장소: ${session.meta.place}`);
      if (session.meta.mode) metaLines.push(`- 모드: ${session.meta.mode}`);
      if (session.meta.actors?.length)
        metaLines.push(`- 참여자: ${session.meta.actors.join(', ')}`);
      if (metaLines.length) {
        lines.push(metaLines.join('\n'));
        lines.push('');
      }
    } else {
      lines.push('');
    }
    for (const t of turns) {
      if (t.role === 'narration') {
        lines.push(`> **내레이션**: ${t.text}`);
      } else {
        lines.push(`- **${t.speaker}**: ${t.text}`);
      }
    }
    return lines.join('\n').trim();
  }

  function buildExportBundle(session, normalizedRaw, format, stamp) {
    const stampToken = stamp || new Date().toISOString().replace(/[:.]/g, '-');
    const base = `genit_turns_${stampToken}`;
    if (format === 'md') {
      return {
        filename: `${base}.md`,
        mime: 'text/markdown',
        content: toMarkdownExport(session),
        stamp: stampToken,
      };
    }
    if (format === 'txt') {
      return {
        filename: `${base}.txt`,
        mime: 'text/plain',
        content: toTXTExport(session),
        stamp: stampToken,
      };
    }
    return {
      filename: `${base}.json`,
      mime: 'application/json',
      content: toJSONExport(session, normalizedRaw),
      stamp: stampToken,
    };
  }

  // -------------------------------
  // 3) DOM Reader
  // -------------------------------
  function readTranscriptText() {
    const adapter = getActiveAdapter();
    const container = adapter?.findContainer?.(document);
    const blocks = adapter?.listMessageBlocks?.(container || document) || [];
    if (!container && !blocks.length)
      throw new Error('채팅 컨테이너를 찾을 수 없습니다.');
    if (!blocks.length) return '';

    const seenLine = new Set();
    const out = [];

    const pushLine = (line) => {
      const s = (line || '').trim();
      if (!s) return;
      if (seenLine.has(s)) return;
      seenLine.add(s);
      out.push(s);
    };

    for (const block of blocks) {
      adapter?.emitTranscriptLines?.(block, pushLine);
    }

    return out.join('\n');
  }

  // -------------------------------
  // 3.5) Scroll auto loader & turn stats
  // -------------------------------
  const AUTO_STATE = {
    running: false,
    container: null,
    meterTimer: null,
  };

  function ensureScrollContainer() {
    const adapter = getActiveAdapter();
    const adapterContainer = adapter?.findContainer?.(document);
    if (adapterContainer) {
      if (isScrollable(adapterContainer)) return adapterContainer;
      if (adapterContainer instanceof Element) {
        let ancestor = adapterContainer.parentElement;
        for (let depth = 0; depth < 6 && ancestor; depth += 1) {
          if (isScrollable(ancestor)) return ancestor;
          ancestor = ancestor.parentElement;
        }
      }
      return adapterContainer;
    }
    const messageBlocks = adapter?.listMessageBlocks?.(document) || [];
    if (messageBlocks.length) {
      let ancestor = messageBlocks[0]?.parentElement || null;
      for (let depth = 0; depth < 6 && ancestor; depth += 1) {
        if (isScrollable(ancestor)) return ancestor;
        ancestor = ancestor.parentElement;
      }
    }
    return (
      document.scrollingElement || document.documentElement || document.body
    );
  }

  function waitForGrowth(el, startHeight, timeout) {
    return new Promise((resolve) => {
      let finished = false;
      const obs = new MutationObserver(() => {
        if (el.scrollHeight > startHeight + 4) {
          finished = true;
          obs.disconnect();
          resolve(true);
        }
      });
      obs.observe(el, { childList: true, subtree: true });
      setTimeout(() => {
        if (!finished) {
          obs.disconnect();
          resolve(false);
        }
      }, timeout);
    });
  }

  async function scrollUpCycle(container, profile) {
    if (!container) return { grew: false, before: 0, after: 0 };
    const before = container.scrollHeight;
    container.scrollTop = 0;
    const grew = await waitForGrowth(
      container,
      before,
      profile.settleTimeoutMs,
    );
    return { grew, before, after: container.scrollHeight };
  }

  function collectTurnStats() {
    try {
      const raw = readTranscriptText();
      const normalized = normalizeTranscript(raw);
      const session = buildSession(normalized);
      const playerTurns = session.turns.filter(
        (t) => t.role === 'player',
      ).length;
      return {
        session,
        playerTurns,
        totalTurns: session.turns.length,
      };
    } catch (error) {
      return { session: null, playerTurns: 0, totalTurns: 0, error };
    }
  }

  async function autoLoadAll() {
    const profile = getAutoProfile();
    const container = ensureScrollContainer();
    if (!container) {
      GMH.Core.State.setState(GMH.Core.STATE.ERROR, {
        label: '자동 로딩 실패',
        message: '채팅 컨테이너를 찾을 수 없습니다.',
        tone: 'error',
        progress: { value: 1 },
      });
      return { error: new Error('container missing') };
    }
    AUTO_STATE.running = true;
    AUTO_STATE.container = container;
    let stableRounds = 0;
    let guard = 0;

    while (AUTO_STATE.running && guard < profile.guardLimit) {
      guard += 1;
      GMH.Core.State.setState(GMH.Core.STATE.SCANNING, {
        label: '위로 끝까지 로딩',
        message: `추가 수집 중 (${guard}/${profile.guardLimit})`,
        tone: 'progress',
        progress: { indeterminate: true },
      });
      const { grew, before, after } = await scrollUpCycle(container, profile);
      if (!AUTO_STATE.running) break;
      const delta = after - before;
      if (!grew || delta < 6) stableRounds += 1;
      else stableRounds = 0;
      if (stableRounds >= profile.maxStableRounds) break;
      await sleep(profile.cycleDelayMs);
    }

    AUTO_STATE.running = false;
    const stats = collectTurnStats();
    if (stats.error) {
      GMH.Core.State.setState(GMH.Core.STATE.ERROR, {
        label: '자동 로딩 실패',
        message: '스크롤 후 파싱 실패',
        tone: 'error',
        progress: { value: 1 },
      });
    } else {
      GMH.Core.State.setState(GMH.Core.STATE.DONE, {
        label: '자동 로딩 완료',
        message: `플레이어 턴 ${stats.playerTurns}개 확보`,
        tone: 'success',
        progress: { value: 1 },
      });
    }
    return stats;
  }

  async function autoLoadUntilPlayerTurns(target) {
    const profile = getAutoProfile();
    const container = ensureScrollContainer();
    if (!container) {
      GMH.Core.State.setState(GMH.Core.STATE.ERROR, {
        label: '자동 로딩 실패',
        message: '채팅 컨테이너를 찾을 수 없습니다.',
        tone: 'error',
        progress: { value: 1 },
      });
      return { error: new Error('container missing') };
    }
    AUTO_STATE.running = true;
    AUTO_STATE.container = container;
    let stableRounds = 0;
    let stagnantRounds = 0;
    let loopCount = 0;
    let prevPlayerTurns = -1;

    while (AUTO_STATE.running && loopCount < profile.guardLimit) {
      loopCount += 1;
      const stats = collectTurnStats();
      if (stats.error) {
        GMH.Core.State.setState(GMH.Core.STATE.ERROR, {
          label: '자동 로딩 실패',
          message: '파싱 실패 - DOM 변화를 감지하지 못했습니다.',
          tone: 'error',
          progress: { value: 1 },
        });
        break;
      }
      if (stats.playerTurns >= target) {
        GMH.Core.State.setState(GMH.Core.STATE.DONE, {
          label: '자동 로딩 완료',
          message: `목표 달성 · 플레이어 턴 ${stats.playerTurns}개 확보`,
          tone: 'success',
          progress: { value: 1 },
        });
        break;
      }

      const ratio = target > 0 ? Math.min(1, stats.playerTurns / target) : 0;
      GMH.Core.State.setState(GMH.Core.STATE.SCANNING, {
        label: '턴 확보 중',
        message: `플레이어 턴 ${stats.playerTurns}/${target}`,
        tone: 'progress',
        progress: { value: ratio },
      });

      const { grew, before, after } = await scrollUpCycle(container, profile);
      if (!AUTO_STATE.running) break;
      const delta = after - before;
      if (!grew || delta < 6) stableRounds += 1;
      else stableRounds = 0;

      stagnantRounds =
        stats.playerTurns === prevPlayerTurns ? stagnantRounds + 1 : 0;
      prevPlayerTurns = stats.playerTurns;

      if (
        stableRounds >= profile.maxStableRounds ||
        stagnantRounds >= profile.guardLimit
      ) {
        GMH.Core.State.setState(GMH.Core.STATE.DONE, {
          label: '자동 로딩 종료',
          message:
            '추가 데이터를 불러오지 못했습니다. 더 이상 기록이 없거나 막혀있습니다.',
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
      GMH.Core.State.setState(GMH.Core.STATE.ERROR, {
        label: '자동 로딩 실패',
        message: '턴 정보를 수집하지 못했습니다.',
        tone: 'error',
        progress: { value: 1 },
      });
      return finalStats;
    }
    if (GMH.Core.State.getState() === GMH.Core.STATE.SCANNING) {
      const ratio =
        target > 0 ? Math.min(1, finalStats.playerTurns / target) : 0;
      GMH.Core.State.setState(GMH.Core.STATE.DONE, {
        label: '자동 로딩 종료',
        message: `플레이어 턴 ${finalStats.playerTurns}/${target}`,
        tone: 'warning',
        progress: { value: ratio },
      });
    }
    return finalStats;
  }

  function stopAutoLoad() {
    if (!AUTO_STATE.running) return;
    AUTO_STATE.running = false;
    GMH.Core.State.setState(GMH.Core.STATE.IDLE, {
      label: '대기 중',
      message: '자동 로딩을 중지했습니다.',
      tone: 'info',
      progress: { value: 0 },
    });
  }

  function startTurnMeter(meter) {
    if (!meter) return;
    const render = () => {
      const stats = collectTurnStats();
      if (stats.error) {
        meter.textContent = '턴 측정 실패: DOM을 읽을 수 없습니다.';
        return;
      }
      meter.textContent = `턴 현황 · 플레이어 ${stats.playerTurns}턴`;
    };
    render();
    if (AUTO_STATE.meterTimer) return;
    AUTO_STATE.meterTimer = window.setInterval(() => {
      if (!meter.isConnected) {
        clearInterval(AUTO_STATE.meterTimer);
        AUTO_STATE.meterTimer = null;
        return;
      }
      render();
    }, 1500);
  }

  function ensureAutoLoadControlsModern(panel) {
    if (!panel) return;
    let wrap = panel.querySelector('#gmh-autoload-controls');
    if (!wrap) {
      wrap = document.createElement('div');
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
        <input id="gmh-autoload-turns" class="gmh-input" type="number" min="1" step="1" placeholder="최근 플레이어 턴 N" />
        <button id="gmh-autoload-turns-btn" class="gmh-small-btn gmh-small-btn--accent">턴 확보</button>
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
      if (AUTO_STATE.running) return;
      toggleControls(true);
      try {
        await autoLoader.start('all');
      } finally {
        toggleControls(false);
      }
    };

    btnTurns.onclick = async () => {
      if (AUTO_STATE.running) return;
      const rawVal = inputTurns?.value?.trim();
      const target = Number.parseInt(rawVal || '0', 10);
      if (!Number.isFinite(target) || target <= 0) {
        setPanelStatus('플레이어 턴 수를 입력해주세요.', 'error');
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
      if (!AUTO_STATE.running) {
        setPanelStatus('자동 로딩이 실행 중이 아닙니다.', 'muted');
        return;
      }
      autoLoader.stop();
    };

    startTurnMeter(meter);
  }

  function ensureAutoLoadControlsLegacy(panel) {
    if (!panel || panel.querySelector('#gmh-autoload-controls')) return;

    const wrap = document.createElement('div');
    wrap.id = 'gmh-autoload-controls';
    wrap.style.cssText =
      'display:grid; gap:6px; border-top:1px solid #1f2937; padding-top:6px;';
    wrap.innerHTML = `
      <div style="display:flex; gap:8px;">
        <button id="gmh-autoload-all" style="flex:1; background:#38bdf8; border:0; color:#041; border-radius:8px; padding:6px; cursor:pointer;">위로 끝까지 로딩</button>
        <button id="gmh-autoload-stop" style="width:88px; background:#ef4444; border:0; color:#fff; border-radius:8px; padding:6px; cursor:pointer;">정지</button>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <input id="gmh-autoload-turns" type="number" min="1" step="1" placeholder="최근 플레이어 턴 N" style="flex:1; background:#111827; color:#f1f5f9; border:1px solid #1f2937; border-radius:8px; padding:6px;" />
        <button id="gmh-autoload-turns-btn" style="width:96px; background:#34d399; border:0; color:#041; border-radius:8px; padding:6px; cursor:pointer;">턴 확보</button>
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
      if (AUTO_STATE.running) return;
      toggleControls(true);
      try {
        await autoLoader.start('all');
      } finally {
        toggleControls(false);
      }
    };

    btnTurns.onclick = async () => {
      if (AUTO_STATE.running) return;
      const rawVal = inputTurns?.value?.trim();
      const target = Number.parseInt(rawVal || '0', 10);
      if (!Number.isFinite(target) || target <= 0) {
        setPanelStatus('플레이어 턴 수를 입력해주세요.', 'error');
        return;
      }
      toggleControls(true);
      try {
        const stats = await autoLoader.start('turns', target);
        if (stats && !stats.error) {
          setPanelStatus(
            `현재 플레이어 턴 ${stats.playerTurns}개 확보.`,
            'success',
          );
        }
      } finally {
        toggleControls(false);
      }
    };

    btnStop.onclick = () => {
      if (!AUTO_STATE.running) {
        setPanelStatus('자동 로딩이 실행 중이 아닙니다.', 'muted');
        return;
      }
      autoLoader.stop();
      setPanelStatus('자동 로딩 중지를 요청했습니다.', 'warning');
    };

    startTurnMeter(meter);
  }

  function mountStatusActionsModern(panel) {
    if (!panel) return;
    let actions = panel.querySelector('#gmh-status-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.id = 'gmh-status-actions';
      panel.appendChild(actions);
    }
    if (actions.dataset.ready === 'true') return;
    actions.dataset.ready = 'true';
    actions.innerHTML = `
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
      </div>
    `;

    PROFILE_SELECT_ELEMENT = actions.querySelector('#gmh-profile-select');
    if (PROFILE_SELECT_ELEMENT) {
      PROFILE_SELECT_ELEMENT.value = AUTO_CFG.profile;
      PROFILE_SELECT_ELEMENT.onchange = (event) => {
        autoLoader.setProfile(event.target.value);
      };
    }
    syncProfileSelect();

    const retryBtn = actions.querySelector('#gmh-btn-retry');
    if (retryBtn) {
      retryBtn.onclick = async () => {
        if (AUTO_STATE.running) {
          setPanelStatus('이미 자동 로딩이 진행 중입니다.', 'muted');
          return;
        }
        await autoLoader.startCurrent();
      };
    }

    const retryStableBtn = actions.querySelector('#gmh-btn-retry-stable');
    if (retryStableBtn) {
      retryStableBtn.onclick = async () => {
        if (AUTO_STATE.running) {
          setPanelStatus('이미 자동 로딩이 진행 중입니다.', 'muted');
          return;
        }
        await autoLoader.startCurrent('stability');
      };
    }

    const snapshotBtn = actions.querySelector('#gmh-btn-snapshot');
    if (snapshotBtn) {
      snapshotBtn.onclick = () => downloadDomSnapshot();
    }

    panel.appendChild(actions);
  }

  function mountStatusActionsLegacy(panel) {
    if (!panel || panel.querySelector('#gmh-status-actions')) return;

    const actions = document.createElement('div');
    actions.id = 'gmh-status-actions';
    actions.style.cssText =
      'display:grid; gap:6px; border-top:1px solid rgba(148,163,184,0.25); padding-top:6px;';
    actions.innerHTML = `
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
      </div>
    `;

    PROFILE_SELECT_ELEMENT = actions.querySelector('#gmh-profile-select');
    if (PROFILE_SELECT_ELEMENT) {
      PROFILE_SELECT_ELEMENT.value = AUTO_CFG.profile;
      PROFILE_SELECT_ELEMENT.onchange = (event) => {
        autoLoader.setProfile(event.target.value);
      };
    }
    syncProfileSelect();

    const retryBtn = actions.querySelector('#gmh-btn-retry');
    if (retryBtn) {
      retryBtn.onclick = async () => {
        if (AUTO_STATE.running) {
          setPanelStatus('이미 자동 로딩이 진행 중입니다.', 'muted');
          return;
        }
        await autoLoader.startCurrent();
      };
    }

    const retryStableBtn = actions.querySelector('#gmh-btn-retry-stable');
    if (retryStableBtn) {
      retryStableBtn.onclick = async () => {
        if (AUTO_STATE.running) {
          setPanelStatus('이미 자동 로딩이 진행 중입니다.', 'muted');
          return;
        }
        await autoLoader.startCurrent('stability');
      };
    }

    const snapshotBtn = actions.querySelector('#gmh-btn-snapshot');
    if (snapshotBtn) {
      snapshotBtn.onclick = () => downloadDomSnapshot();
    }

    panel.appendChild(actions);
  }

  function setupPanelInteractions(panel, { modern = false } = {}) {
    PanelVisibility.bind(panel, { modern });
    PRIVACY_SELECT_ELEMENT = panel.querySelector('#gmh-privacy-profile');
    if (PRIVACY_SELECT_ELEMENT) {
      PRIVACY_SELECT_ELEMENT.value = PRIVACY_CFG.profile;
      PRIVACY_SELECT_ELEMENT.onchange = (event) => {
        const value = event.target.value;
        setPrivacyProfile(value);
        setPanelStatus(
          `프라이버시 프로필이 ${PRIVACY_PROFILES[value]?.label || value}로 설정되었습니다.`,
          'info',
        );
      };
    }

    const privacyConfigBtn = panel.querySelector('#gmh-privacy-config');
    if (privacyConfigBtn) {
      privacyConfigBtn.onclick = () => configurePrivacyLists();
    }

    const settingsBtn = panel.querySelector('#gmh-panel-settings');
    if (settingsBtn) {
      settingsBtn.onclick = () => configurePrivacyLists();
    }

    if (modern) {
      ensureAutoLoadControlsModern(panel);
      mountStatusActionsModern(panel);
    } else {
      ensureAutoLoadControlsLegacy(panel);
      mountStatusActionsLegacy(panel);
    }

    if (modern && !PAGE_WINDOW.__GMHShortcutsBound) {
      const shortcutHandler = (event) => {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.repeat)
          return;
        const target = event.target;
        if (target instanceof HTMLElement) {
          const tag = target.tagName.toLowerCase();
          if (['input', 'textarea', 'select'].includes(tag)) return;
          if (target.isContentEditable) return;
        }
        if (GMH.UI.Modal?.isOpen?.()) return;
        const key = event.key?.toLowerCase();
        switch (key) {
          case 'g':
            event.preventDefault();
            PanelVisibility.open({ focus: true, persist: true });
            break;
          case 'm':
            event.preventDefault();
            PanelVisibility.toggle();
            break;
          case 's':
            event.preventDefault();
            if (!AUTO_STATE.running)
              autoLoader
                .start('all')
                .catch((error) => console.warn('[GMH] auto shortcut', error));
            break;
          case 'p':
            event.preventDefault();
            configurePrivacyLists();
            break;
          case 'e':
            event.preventDefault();
            panel.querySelector('#gmh-export')?.click();
            break;
          default:
            break;
        }
      };
      window.addEventListener('keydown', shortcutHandler);
      PAGE_WINDOW.__GMHShortcutsBound = true;
    }

    const parseAll = () => {
      const raw = readTranscriptText();
      const normalized = normalizeTranscript(raw);
      const session = buildSession(normalized);
      if (!session.turns.length) throw new Error('대화 턴을 찾을 수 없습니다.');
      return { session, raw: normalized };
    };

    const exportFormatSelect = panel.querySelector('#gmh-export-format');
    const quickExportBtn = panel.querySelector('#gmh-quick-export');

    async function prepareShare({
      confirmLabel,
      cancelStatusMessage,
      blockedStatusMessage,
    }) {
      try {
        GMH.Core.State.setState(GMH.Core.STATE.REDACTING, {
          label: '민감정보 마스킹 중',
          message: '레다크션 파이프라인 적용 중...',
          tone: 'progress',
          progress: { indeterminate: true },
        });
        const { session, raw } = parseAll();
        const privacy = applyPrivacyPipeline(session, raw, PRIVACY_CFG.profile);
        if (privacy.blocked) {
          alert('미성년자 성적 맥락이 감지되어 작업을 중단했습니다.');
          GMH.Core.State.setState(GMH.Core.STATE.ERROR, {
            label: '작업 차단',
            message:
              blockedStatusMessage ||
              '미성년자 민감 맥락으로 작업이 차단되었습니다.',
            tone: 'error',
            progress: { value: 1 },
          });
          return null;
        }
        const stats = collectSessionStats(privacy.sanitizedSession);
        const previewTurns =
          privacy.sanitizedSession.turns.slice(-PREVIEW_TURN_LIMIT);
        GMH.Core.State.setState(GMH.Core.STATE.PREVIEW, {
          label: '미리보기 준비 완료',
          message: '레다크션 결과를 검토하세요.',
          tone: 'info',
          progress: { value: 0.75 },
        });
        const ok = await confirmPrivacyGate({
          profile: privacy.profile,
          counts: privacy.counts,
          stats,
          previewTurns,
          actionLabel: confirmLabel || '계속',
        });
        if (!ok) {
          GMH.Core.State.setState(GMH.Core.STATE.IDLE, {
            label: '대기 중',
            message: cancelStatusMessage || '작업을 취소했습니다.',
            tone: cancelStatusMessage ? 'muted' : 'info',
            progress: { value: 0 },
          });
          if (cancelStatusMessage) setPanelStatus(cancelStatusMessage, 'muted');
          return null;
        }
        return { session, raw, privacy, stats };
      } catch (error) {
        alert(`오류: ${(error && error.message) || error}`);
        GMH.Core.State.setState(GMH.Core.STATE.ERROR, {
          label: '작업 실패',
          message: '작업 준비 중 오류가 발생했습니다.',
          tone: 'error',
          progress: { value: 1 },
        });
        return null;
      }
    }

    async function performExport(prepared, format) {
      if (!prepared) return false;
      try {
        GMH.Core.State.setState(GMH.Core.STATE.EXPORTING, {
          label: '내보내기 진행 중',
          message: `${format.toUpperCase()} 내보내기를 준비하는 중입니다...`,
          tone: 'progress',
          progress: { indeterminate: true },
        });
        const { privacy, stats } = prepared;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const bundle = buildExportBundle(
          privacy.sanitizedSession,
          privacy.sanitizedRaw,
          format,
          stamp,
        );
        const fileBlob = new Blob([bundle.content], { type: bundle.mime });
        triggerDownload(fileBlob, bundle.filename);

        const manifest = buildExportManifest({
          profile: privacy.profile,
          counts: { ...privacy.counts },
          stats,
          format,
          warnings: privacy.sanitizedSession.warnings,
          source: privacy.sanitizedSession.source,
        });
        const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], {
          type: 'application/json',
        });
        const manifestName = `${bundle.filename.replace(/\.[^.]+$/, '')}.manifest.json`;
        triggerDownload(manifestBlob, manifestName);

        const summary = formatRedactionCounts(privacy.counts);
        const profileLabel =
          PRIVACY_PROFILES[privacy.profile]?.label || privacy.profile;
        const message = `${format.toUpperCase()} 내보내기 완료 · 플레이어 턴 ${stats.playerTurns}개 · ${profileLabel} · ${summary}`;
        GMH.Core.State.setState(GMH.Core.STATE.DONE, {
          label: '내보내기 완료',
          message,
          tone: 'success',
          progress: { value: 1 },
        });
        if (privacy.sanitizedSession.warnings.length)
          console.warn('[GMH] warnings:', privacy.sanitizedSession.warnings);
        return true;
      } catch (error) {
        alert(`오류: ${(error && error.message) || error}`);
        GMH.Core.State.setState(GMH.Core.STATE.ERROR, {
          label: '내보내기 실패',
          message: '내보내기 실패',
          tone: 'error',
          progress: { value: 1 },
        });
        return false;
      }
    }

    const copyRecentBtn = panel.querySelector('#gmh-copy-recent');
    if (copyRecentBtn) {
      copyRecentBtn.onclick = async () => {
        const prepared = await prepareShare({
          confirmLabel: '복사 계속',
          cancelStatusMessage: '복사를 취소했습니다.',
          blockedStatusMessage: '미성년자 민감 맥락으로 복사가 차단되었습니다.',
        });
        if (!prepared) return;
        try {
          GMH.Core.State.setState(GMH.Core.STATE.EXPORTING, {
            label: '복사 진행 중',
            message: '최근 15턴을 복사하는 중입니다...',
            tone: 'progress',
            progress: { indeterminate: true },
          });
          const { privacy, stats } = prepared;
          const turns = privacy.sanitizedSession.turns.slice(-15);
          const md = toMarkdownExport(privacy.sanitizedSession, {
            turns,
            includeMeta: false,
            heading: '## 최근 15턴',
          });
          GM_setClipboard(md, { type: 'text', mimetype: 'text/plain' });
          const summary = formatRedactionCounts(privacy.counts);
          const profileLabel =
            PRIVACY_PROFILES[privacy.profile]?.label || privacy.profile;
          const message = `최근 15턴 복사 완료 · 플레이어 턴 ${stats.playerTurns}개 · ${profileLabel} · ${summary}`;
          GMH.Core.State.setState(GMH.Core.STATE.DONE, {
            label: '복사 완료',
            message,
            tone: 'success',
            progress: { value: 1 },
          });
          if (privacy.sanitizedSession.warnings.length)
            console.warn('[GMH] warnings:', privacy.sanitizedSession.warnings);
        } catch (error) {
          alert(`오류: ${(error && error.message) || error}`);
          GMH.Core.State.setState(GMH.Core.STATE.ERROR, {
            label: '복사 실패',
            message: '복사 실패',
            tone: 'error',
            progress: { value: 1 },
          });
        }
      };
    }

    const copyAllBtn = panel.querySelector('#gmh-copy-all');
    if (copyAllBtn) {
      copyAllBtn.onclick = async () => {
        const prepared = await prepareShare({
          confirmLabel: '복사 계속',
          cancelStatusMessage: '복사를 취소했습니다.',
          blockedStatusMessage: '미성년자 민감 맥락으로 복사가 차단되었습니다.',
        });
        if (!prepared) return;
        try {
          GMH.Core.State.setState(GMH.Core.STATE.EXPORTING, {
            label: '복사 진행 중',
            message: '전체 Markdown을 복사하는 중입니다...',
            tone: 'progress',
            progress: { indeterminate: true },
          });
          const { privacy, stats } = prepared;
          const md = toMarkdownExport(privacy.sanitizedSession);
          GM_setClipboard(md, { type: 'text', mimetype: 'text/plain' });
          const summary = formatRedactionCounts(privacy.counts);
          const profileLabel =
            PRIVACY_PROFILES[privacy.profile]?.label || privacy.profile;
          const message = `전체 Markdown 복사 완료 · 플레이어 턴 ${stats.playerTurns}개 · ${profileLabel} · ${summary}`;
          GMH.Core.State.setState(GMH.Core.STATE.DONE, {
            label: '복사 완료',
            message,
            tone: 'success',
            progress: { value: 1 },
          });
          if (privacy.sanitizedSession.warnings.length)
            console.warn('[GMH] warnings:', privacy.sanitizedSession.warnings);
        } catch (error) {
          alert(`오류: ${(error && error.message) || error}`);
          GMH.Core.State.setState(GMH.Core.STATE.ERROR, {
            label: '복사 실패',
            message: '복사 실패',
            tone: 'error',
            progress: { value: 1 },
          });
        }
      };
    }

    const exportBtn = panel.querySelector('#gmh-export');
    if (exportBtn) {
      exportBtn.onclick = async () => {
        const format = exportFormatSelect?.value || 'json';
        const prepared = await prepareShare({
          confirmLabel: '내보내기 진행',
          cancelStatusMessage: '내보내기를 취소했습니다.',
          blockedStatusMessage:
            '미성년자 민감 맥락으로 내보내기가 차단되었습니다.',
        });
        if (!prepared) return;
        await performExport(prepared, format);
      };
    }

    if (quickExportBtn) {
      quickExportBtn.onclick = async () => {
        if (AUTO_STATE.running) {
          setPanelStatus('이미 자동 로딩이 진행 중입니다.', 'muted');
          return;
        }
        const originalText = quickExportBtn.textContent;
        quickExportBtn.disabled = true;
        quickExportBtn.textContent = '진행 중...';
        try {
          GMH.Core.State.setState(GMH.Core.STATE.SCANNING, {
            label: '원클릭 내보내기',
            message: '전체 로딩 중...',
            tone: 'progress',
            progress: { indeterminate: true },
          });
          await autoLoader.start('all');
          const format = exportFormatSelect?.value || 'json';
          const prepared = await prepareShare({
            confirmLabel: `${format.toUpperCase()} 내보내기`,
            cancelStatusMessage: '내보내기를 취소했습니다.',
            blockedStatusMessage:
              '미성년자 민감 맥락으로 내보내기가 차단되었습니다.',
          });
          if (!prepared) return;
          await performExport(prepared, format);
        } catch (error) {
          alert(`오류: ${(error && error.message) || error}`);
          GMH.Core.State.setState(GMH.Core.STATE.ERROR, {
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

    const reparseBtn = panel.querySelector('#gmh-reparse');
    if (reparseBtn) {
      reparseBtn.onclick = () => {
        try {
          GMH.Core.State.setState(GMH.Core.STATE.REDACTING, {
            label: '재파싱 중',
            message: '대화 로그를 다시 분석하는 중입니다...',
            tone: 'progress',
            progress: { indeterminate: true },
          });
          const { session, raw } = parseAll();
          const privacy = applyPrivacyPipeline(
            session,
            raw,
            PRIVACY_CFG.profile,
          );
          const stats = collectSessionStats(privacy.sanitizedSession);
          const summary = formatRedactionCounts(privacy.counts);
          const profileLabel =
            PRIVACY_PROFILES[privacy.profile]?.label || privacy.profile;
          const extra = privacy.blocked ? ' · ⚠️ 미성년자 맥락 감지' : '';
          const message = `재파싱 완료 · 플레이어 턴 ${stats.playerTurns}개 · 경고 ${privacy.sanitizedSession.warnings.length}건 · ${profileLabel} · ${summary}${extra}`;
          GMH.Core.State.setState(GMH.Core.STATE.DONE, {
            label: '재파싱 완료',
            message,
            tone: 'info',
            progress: { value: 1 },
          });
          if (privacy.sanitizedSession.warnings.length)
            console.warn('[GMH] warnings:', privacy.sanitizedSession.warnings);
        } catch (e) {
          alert(`오류: ${(e && e.message) || e}`);
          GMH.Core.State.setState(GMH.Core.STATE.ERROR, {
            label: '재파싱 실패',
            message: '재파싱 실패',
            tone: 'error',
            progress: { value: 1 },
          });
        }
      };
    }

    const guideBtn = panel.querySelector('#gmh-guide');
    if (guideBtn) {
      guideBtn.onclick = () => {
        const prompt = `
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
        GM_setClipboard(prompt, { type: 'text', mimetype: 'text/plain' });
        setPanelStatus('요약 프롬프트가 클립보드에 복사되었습니다.', 'success');
      };
    }

    const reguideBtn = panel.querySelector('#gmh-reguide');
    if (reguideBtn) {
      reguideBtn.onclick = () => {
        const prompt = `
아래에는 [이전 요약본]과 [새 로그 파일]이 있습니다.
이 둘을 통합하여, 2000자 이내의 "최신 장기기억 요약본"을 만드세요.

규칙:
- 이전 요약본에서 이미 있는 사실은 유지하되, 새 로그 파일에 나온 사건/관계 변화로 업데이트.
- 모순되면 "최근 사건"을 우선.
- 출력 구조는 [전체 줄거리 요약] / [주요 관계 변화] / [핵심 테마].
- 길이는 1200~1800자.
`;
        GM_setClipboard(prompt, { type: 'text', mimetype: 'text/plain' });
        setPanelStatus(
          '재요약 프롬프트가 클립보드에 복사되었습니다.',
          'success',
        );
      };
    }
  }

  // -------------------------------
  // 4) UI Panel
  // -------------------------------
  function mountPanelModern() {
    ensureDesignSystemStyles();
    if (document.querySelector('#genit-memory-helper-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'genit-memory-helper-panel';
    panel.className = 'gmh-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Genit Memory Helper');
    panel.tabIndex = -1;
    panel.innerHTML = `
      <div class="gmh-panel__header">
        <div>
          <div class="gmh-panel__title">Genit Memory Helper</div>
          <div class="gmh-panel__tag">v${SCRIPT_VERSION}</div>
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
          <button id="gmh-copy-recent" class="gmh-panel-btn gmh-panel-btn--neutral">최근 15턴 복사</button>
          <button id="gmh-copy-all" class="gmh-panel-btn gmh-panel-btn--neutral">전체 MD 복사</button>
        </div>
        <div class="gmh-field-row">
          <select id="gmh-export-format" class="gmh-select">
            <option value="json">JSON (.json)</option>
            <option value="txt">TXT (.txt)</option>
            <option value="md">Markdown (.md)</option>
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
    `;
    const adapter = getActiveAdapter();
    const anchor = adapter?.getPanelAnchor?.(document) || document.body;
    anchor.appendChild(panel);

    const statusEl = panel.querySelector('#gmh-status');
    attachStatusElement(statusEl);
    if (statusEl) {
      statusEl.setAttribute('role', 'status');
      statusEl.setAttribute('aria-live', 'polite');
    }
    const progressFill = panel.querySelector('#gmh-progress-fill');
    const progressLabel = panel.querySelector('#gmh-progress-label');
    GMH.UI.StateView.bind({ progressFill, progressLabel });
    setupPanelInteractions(panel, { modern: true });
  }

  function mountPanelLegacy() {
    if (document.querySelector('#genit-memory-helper-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'genit-memory-helper-panel';
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
        <button id="gmh-copy-recent" style="flex:1; background:#22c55e; border:0; color:#051; border-radius:8px; padding:8px; cursor:pointer;">최근 15턴 복사</button>
        <button id="gmh-copy-all" style="flex:1; background:#60a5fa; border:0; color:#031; border-radius:8px; padding:8px; cursor:pointer;">전체 MD 복사</button>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <select id="gmh-export-format" style="flex:1; background:#111827; color:#f1f5f9; border:1px solid #1f2937; border-radius:8px; padding:8px;">
          <option value="json">JSON (.json)</option>
          <option value="txt">TXT (.txt)</option>
          <option value="md">Markdown (.md)</option>
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
    const anchor = adapter?.getPanelAnchor?.(document) || document.body;
    anchor.appendChild(panel);

    const statusEl = panel.querySelector('#gmh-status');
    attachStatusElement(statusEl);
    setPanelStatus('준비 완료', 'info');
    GMH.UI.StateView.bind();
    setupPanelInteractions(panel, { modern: false });
  }

  function mountPanel() {
    if (isModernUIActive) {
      mountPanelModern();
    } else {
      if (Flags.killSwitch)
        console.info('[GMH] modern UI disabled by kill switch');
      mountPanelLegacy();
    }
  }

  // -------------------------------
  // 5) Boot
  // -------------------------------
  function boot() {
    try {
      mountPanel();
    } catch (e) {
      console.error('[GMH] mount error', e);
    }
  }

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    setTimeout(boot, 1200);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1200));
  }

  let moScheduled = false;
  const mo = new MutationObserver(() => {
    if (moScheduled) return;
    moScheduled = true;
    requestAnimationFrame(() => {
      moScheduled = false;
      if (!document.querySelector('#genit-memory-helper-panel')) boot();
    });
  });
  mo.observe(document.documentElement, { subtree: true, childList: true });

  if (!PAGE_WINDOW.__GMHTest) {
    Object.defineProperty(PAGE_WINDOW, '__GMHTest', {
      value: {
        runPrivacyCheck(rawText, profileKey = 'safe') {
          try {
            const normalized = normalizeTranscript(rawText || '');
            const session = buildSession(normalized);
            return applyPrivacyPipeline(session, normalized, profileKey);
          } catch (error) {
            console.error('[GMH] runPrivacyCheck error', error);
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
    redactText,
    hasMinorSexualContext,
    formatRedactionCounts,
  });

  Object.assign(GMH.Export, {
    toJSONExport,
    toTXTExport,
    toMarkdownExport,
    buildExportBundle,
    buildExportManifest,
  });

  Object.assign(GMH.UI, {
    mountPanel,
    setPanelStatus,
    configurePrivacyLists,
    openPanel: (options) => PanelVisibility.open(options),
    closePanel: (reason) => PanelVisibility.close(reason),
    togglePanel: () => PanelVisibility.toggle(),
    isPanelCollapsed: () => PanelVisibility.isCollapsed(),
  });

  Object.assign(GMH.Core, {
    getAdapter: getActiveAdapter,
    readTranscriptText,
    normalizeTranscript,
    parseTurns,
    buildSession,
    collectSessionStats,
    autoLoader,
  });

  if (!PAGE_WINDOW.GMH) {
    try {
      Object.defineProperty(PAGE_WINDOW, 'GMH', {
        value: GMH,
        writable: false,
        configurable: false,
      });
    } catch (err) {
      console.warn('[GMH] expose GMH failed', err);
    }
  }
})();
