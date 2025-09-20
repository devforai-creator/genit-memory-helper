// ==UserScript==
// @name         Genit Memory Helper
// @namespace    local.dev
// @version      0.7
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

  // -------------------------------
  // 0) Constants & utils
  // -------------------------------
  const PLAYER_MARK = '⟦PLAYER⟧ ';
  const HEADER_RE =
    /^(\d+월\s*\d+일.*?\d{1,2}:\d{2})\s*\|\s*([^|]+?)\s*\|\s*📍\s*([^|]+)\s*\|?(.*)$/;
  const CODE_RE = /^([A-J])\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/i;
  const META_KEYWORDS = ['지도', '등장', 'Actors', '배우', '기록코드', 'Codes', 'SCENE'];
  const PLAYER_NAME_FALLBACKS = ['플레이어', '소중한코알라5299'];

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
    return String(v ?? '').replace(/^\[|\]$/g, '').trim();
  }

  function sanitizeText(s) {
    return collapseSpaces(normNL(s).replace(/[\t\v\f\u00a0\u200b]/g, ' '));
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

  function guessPlayerNamesFromDOM() {
    const cands = new Set();
    const selectors = [
      '[data-username]',
      '[data-profile-name]',
      '.profile-name',
      '.user-name',
      'header [class*="name"]',
      'nav [class*="name"]',
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((node) => {
        const text = node.textContent?.trim();
        if (text && /^[\w가-힣][\w가-힣 _.-]{1,20}$/.test(text)) cands.add(text);
      });
    }
    return Array.from(cands);
  }

  const PLAYER_NAMES = Array.from(
    new Set([...PLAYER_NAME_FALLBACKS, ...guessPlayerNamesFromDOM()].filter(Boolean))
  );

  const PLAYER_ALIASES = new Set(
    PLAYER_NAMES.map((n) => n.toLowerCase()).concat(['player', '플레이어', '유저', '나'])
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
          if (HEADER_RE.test(peek) || stripBrackets(peek).toUpperCase() === 'INFO') break;
          if (isMetaLine(peek)) break;
          if (peekForced) break;
          if (looksLikeName(peek) || /^@[^@]+@/.test(peek)) break;
          textBuf.push(peek);
          j += 1;
          if (!/["”]$/.test(peek)) break;
        }
        if (textBuf.length) {
          pushTurn(speaker, stripQuotes(textBuf.join(' ')), roleForSpeaker(speaker));
          pendingSpeaker = speaker;
          i = j - 1;
          continue;
        }
        pendingSpeaker = speaker;
        continue;
      }

      if (looksNarrative(line) || /^".+"$/.test(line) || /^“.+”$/.test(line)) {
        pushTurn('내레이션', stripQuotes(line), 'narration');
        pendingSpeaker = null;
        continue;
      }

      if (pendingSpeaker) {
        pushTurn(pendingSpeaker, stripQuotes(line), roleForSpeaker(pendingSpeaker));
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
    meta.turn_count = turns.length;
    meta.scene_count = new Set(turns.map((t) => t.sceneId)).size;
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
      player_names: PLAYER_NAMES,
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
      if (session.meta.actors?.length) lines.push(`# ACTORS: ${session.meta.actors.join(', ')}`);
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

  function buildExportBundle(session, normalizedRaw, format) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `genit_turns_${stamp}`;
    if (format === 'md') {
      return {
        filename: `${base}.md`,
        mime: 'text/markdown',
        content: toMarkdownExport(session),
      };
    }
    if (format === 'txt') {
      return {
        filename: `${base}.txt`,
        mime: 'text/plain',
        content: toTXTExport(session),
      };
    }
    return {
      filename: `${base}.json`,
      mime: 'application/json',
      content: toJSONExport(session, normalizedRaw),
    };
  }

  // -------------------------------
  // 3) DOM Reader
  // -------------------------------
  const CHAT_CONTAINER_SEL = '.flex-1.min-h-0.overflow-y-auto';
  const MSG_ROOT_SEL = '[data-message-id]';

  function readTranscriptText() {
    const root = document.querySelector(CHAT_CONTAINER_SEL);
    if (!root) throw new Error('채팅 컨테이너를 찾을 수 없습니다.');

    const blocks = Array.from(root.querySelectorAll(MSG_ROOT_SEL));
    const seenLine = new Set();
    const out = [];

    const pushLine = (line) => {
      const s = (line || '').trim();
      if (!s) return;
      if (seenLine.has(s)) return;
      seenLine.add(s);
      out.push(s);
    };

    for (const b of blocks) {
      const infoCode = b.querySelector('code.language-INFO');
      if (infoCode) {
        pushLine('INFO');
        infoCode.textContent
          .split(/\r?\n/)
          .map((s) => s.trimEnd())
          .forEach((s) => pushLine(s));
      }

      const userScopes = b.querySelectorAll(
        '.flex.w-full.justify-end, .flex.flex-col.items-end'
      );
      for (const scope of userScopes) {
        scope.querySelectorAll('.p-4.rounded-xl.bg-background p').forEach((p) => {
          const txt = p.innerText?.trim();
          if (!txt) return;
          pushLine(PLAYER_MARK + txt);
        });
        scope.querySelectorAll('.markdown-content.text-right').forEach((md) => {
          const t = md.innerText?.trim();
          if (!t) return;
          t.split(/\n+/).forEach((row) => pushLine(PLAYER_MARK + row.trim()));
        });
      }

      b.querySelectorAll('.flex.flex-col.w-full.group').forEach((group) => {
        const name = group.querySelector(
          '.text-sm.text-muted-foreground.mb-1.ml-1'
        )?.innerText?.trim();
        const bubblePs = group.querySelectorAll('.p-4.rounded-xl.bg-background p');
        if (!name || !bubblePs.length) return;
        if (group.closest('.justify-end, .items-end')) return;

        bubblePs.forEach((p) => {
          const txt = p.innerText?.trim();
          if (!txt) return;
          pushLine(`@${name}@ "${txt}"`);
        });
      });

      b.querySelectorAll('.markdown-content.text-muted-foreground.text-sm').forEach(
        (md) => {
          if (md.closest('.justify-end, .items-end, .text-right')) return;
          const t = md.innerText?.trim();
          if (!t) return;
          t.split(/\n+/).forEach((row) => pushLine(row.trim()));
        }
      );
    }

    return out.join('\n');
  }

  // -------------------------------
  // 4) UI Panel
  // -------------------------------
  function mountPanel() {
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
        <button id="gmh-reparse" style="flex:1; background:#f59e0b; border:0; color:#210; border-radius:8px; padding:8px; cursor:pointer;">재파싱</button>
        <button id="gmh-guide" style="flex:1; background:#a78bfa; border:0; color:#210; border-radius:8px; padding:8px; cursor:pointer;">요약 가이드</button>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="gmh-reguide" style="flex:1; background:#fbbf24; border:0; color:#210; border-radius:8px; padding:8px; cursor:pointer;">재요약 가이드</button>
      </div>
      <div id="gmh-status" style="opacity:.85"></div>
    `;
    document.body.appendChild(panel);

    const statusEl = panel.querySelector('#gmh-status');
    const setStatus = (msg, color = '#9ca3af') => {
      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.style.color = color;
      }
    };

    const parseAll = () => {
      const raw = readTranscriptText();
      const normalized = normalizeTranscript(raw);
      const session = buildSession(normalized);
      if (!session.turns.length) throw new Error('대화 턴을 찾을 수 없습니다.');
      return { session, raw: normalized };
    };

    panel.querySelector('#gmh-copy-recent').onclick = () => {
      try {
        const { session } = parseAll();
        const turns = session.turns.slice(-15);
        const md = toMarkdownExport(session, {
          turns,
          includeMeta: false,
          heading: '## 최근 15턴',
        });
        GM_setClipboard(md, { type: 'text', mimetype: 'text/plain' });
        setStatus(`최근 15턴 복사 완료. 총 턴 ${session.turns.length}개.`, '#a7f3d0');
        if (session.warnings.length) console.warn('[GMH] warnings:', session.warnings);
      } catch (e) {
        alert(`오류: ${(e && e.message) || e}`);
        setStatus('복사 실패', '#fecaca');
      }
    };

    panel.querySelector('#gmh-copy-all').onclick = () => {
      try {
        const { session } = parseAll();
        const md = toMarkdownExport(session);
        GM_setClipboard(md, { type: 'text', mimetype: 'text/plain' });
        setStatus(`전체 Markdown 복사 완료. 턴 ${session.turns.length}개.`, '#bfdbfe');
        if (session.warnings.length) console.warn('[GMH] warnings:', session.warnings);
      } catch (e) {
        alert(`오류: ${(e && e.message) || e}`);
        setStatus('복사 실패', '#fecaca');
      }
    };

    panel.querySelector('#gmh-export').onclick = () => {
      try {
        const { session, raw } = parseAll();
        const select = panel.querySelector('#gmh-export-format');
        const format = select?.value || 'json';
        const bundle = buildExportBundle(session, raw, format);
        const blob = new Blob([bundle.content], { type: bundle.mime });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = bundle.filename;
        a.click();
        URL.revokeObjectURL(a.href);
        setStatus(`${format.toUpperCase()} 내보내기 완료. 턴 ${session.turns.length}개.`, '#d1fae5');
        if (session.warnings.length) console.warn('[GMH] warnings:', session.warnings);
      } catch (e) {
        alert(`오류: ${(e && e.message) || e}`);
        setStatus('내보내기 실패', '#fecaca');
      }
    };

    panel.querySelector('#gmh-reparse').onclick = () => {
      try {
        const { session } = parseAll();
        setStatus(`재파싱 완료: 턴 ${session.turns.length}개. 경고 ${session.warnings.length}건.`, '#fde68a');
        if (session.warnings.length) console.warn('[GMH] warnings:', session.warnings);
      } catch (e) {
        alert(`오류: ${(e && e.message) || e}`);
        setStatus('재파싱 실패', '#fecaca');
      }
    };

    panel.querySelector('#gmh-guide').onclick = () => {
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
      setStatus('✅ 요약 프롬프트가 클립보드에 복사되었습니다.', '#c4b5fd');
    };

    panel.querySelector('#gmh-reguide').onclick = () => {
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
      setStatus('✅ 재요약 프롬프트가 클립보드에 복사되었습니다.', '#fcd34d');
    };
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

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 1200);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1200));
  }

  const mo = new MutationObserver(() => {
    if (!document.querySelector('#genit-memory-helper-panel')) boot();
  });
  mo.observe(document.documentElement, { subtree: true, childList: true });
})();
