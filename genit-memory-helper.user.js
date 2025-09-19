// ==UserScript==
// @name         Genit Memory Helper
// @namespace    local.dev
// @version      0.6
// @description  Genit 대화로그 JSON 추출 + 요약/재요약 프롬프트 복사 기능
// @author       devforai-creator
// @match        https://genit.ai/*
// @match        https://www.genit.ai/*
// @grant        GM_setClipboard
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/devforai-creator/genit-memory-helper/main/genit-memory-helper.user.js
// @updateURL    https://raw.githubusercontent.com/devforai-creator/genit-memory-helper/main/genit-memory-helper.user.js
// @license      MIT
// ==/UserScript==


(function () {
  'use strict';

  // -------------------------------
  // 0) Utils
  // -------------------------------
  const PLAYER_MARK = '⟦PLAYER⟧ ';
  const HEADER_RE =
    /^(\d+월\s*\d+일.*?\d{1,2}:\d{2})\s*\|\s*([^|]+?)\s*\|\s*📍\s*([^|]+)\s*\|?(.*)$/;
  const CODE_RE = /^([A-J])\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/i;
  const INFO_LABEL = 'INFO';

  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  const toNum = (v, d = 0) => {
    const m = String(v ?? '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : d;
  };

  const stripTicks = (s) => s.replace(/```/g, '');
  const normNL = (s) => s.replace(/\r\n?/g, '\n');

  const normalizeKey = (k) =>
    String(k)
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'tag';
  const stripBrackets = (v) => String(v).replace(/^\[|\]$/g, '').trim();
  const isInfoLabel = (line) => stripBrackets(line).toUpperCase() === INFO_LABEL;

  // -------------------------------
  // NEW) Role tagging & dialogue helpers
  // -------------------------------
  // 플레이어 이름(수동 설정 + DOM 추정)
  function guessPlayerNamesFromDOM() {
    const cands = new Set();
    const sel = [
      '[data-username]',
      '[data-profile-name]',
      '.profile-name',
      '.user-name',
      'header [class*="name"]',
      'nav [class*="name"]',
    ];
    for (const s of sel) {
      qsa(s).forEach((n) => {
        const t = n.textContent?.trim();
        if (t && /^[\w가-힣][\w가-힣 _.-]{1,20}$/.test(t)) cands.add(t);
      });
    }
    return Array.from(cands);
  }

  const PLAYER_NAME_FALLBACKS = ['소중한코알라5299'];
  const PLAYER_NAMES = Array.from(
    new Set([...PLAYER_NAME_FALLBACKS, ...guessPlayerNamesFromDOM()])
  );

  const LINE_SAY_RE = /^@([^@]+)@\s*"([\s\S]+)"\s*$/;
  const NAME_ONLY_RE = /^[가-힣A-Za-z0-9_]{2,20}$/;
  const LABELS = new Set(['INFO', '[등장]', '지도', '기록코드', '[기록코드]', '메시지 이미지']);
  const isLabel = (s) => LABELS.has(String(s).trim());
  const looksSecondPersonNarr = (s) => /^(당신|너는)\s/.test(s);

  function buildNpcNameSet(actors, existingTurns = []) {
    const set = new Set((actors || []).map((a) => a.name));
    for (const t of existingTurns || []) {
      if (t.speaker && !PLAYER_NAMES.includes(t.speaker)) set.add(t.speaker);
    }
    PLAYER_NAMES.forEach((n) => set.delete(n));
    return set;
  }

  function parseDialogueLines(allLines, npcSet) {
    const turns = [];
    let lastSpeaker = null;
    let lastRole = 'narration';

    const roleOf = (name) =>
      PLAYER_NAMES.includes(name) ? 'player' : npcSet.has(name) ? 'npc' : 'npc';

    const push = (speaker, text, role) => {
      if (!text) return;
      const r = role || (speaker ? roleOf(speaker) : 'narration');
      turns.push({ speaker: speaker || '내레이션', text: text.trim(), role: r });
      if (speaker) {
        lastSpeaker = speaker;
        lastRole = r;
      }
    };

    const LINE_SAY_RE = /^@([^@]+)@\s*"([\s\S]+)"\s*$/;

    for (let i = 0; i < allLines.length; i++) {
      let line = (allLines[i] ?? '').trim();
      if (!line) continue;

      let forcePlayer = false;
      while (line.startsWith(PLAYER_MARK)) {
        forcePlayer = true;
        line = line.slice(PLAYER_MARK.length).trim();
      }
      const forcePushPlayer = (txt) => push(PLAYER_NAMES[0] || '플레이어', txt, 'player');

      let m = line.match(LINE_SAY_RE);
      if (m) {
        const name = m[1].trim();
        const txt = m[2].trim();
        push(name, txt, roleOf(name));
        continue;
      }

      if (forcePlayer) {
        if (NAME_ONLY_RE.test(line)) {
          const buf = [];
          for (let j = i + 1; j < allLines.length; j++) {
            let t = (allLines[j] || '').trim();
            while (t.startsWith(PLAYER_MARK)) t = t.slice(PLAYER_MARK.length).trim();
            if (!t || isLabel(t) || NAME_ONLY_RE.test(t) || HEADER_RE.test(t)) break;
            buf.push(t);
            break;
          }
          if (buf.length) {
            forcePushPlayer(buf.join(' '));
            i += buf.length;
          } else {
            forcePushPlayer(line);
          }
          continue;
        }
        forcePushPlayer(line);
        continue;
      }

      if (line === '메시지 이미지') {
        const name = (allLines[i + 1] || '').trim();
        const buf = [];
        for (let j = i + 2; j < allLines.length; j++) {
          let t = (allLines[j] || '').trim();
          if (t.startsWith(PLAYER_MARK)) t = t.slice(PLAYER_MARK.length).trim();
          if (!t || isLabel(t) || NAME_ONLY_RE.test(t) || HEADER_RE.test(t)) break;
          buf.push(t);
        }
        if (NAME_ONLY_RE.test(name) && buf.length) push(name, buf.join(' '), roleOf(name));
        i += 1 + buf.length + (NAME_ONLY_RE.test(name) ? 1 : 0);
        continue;
      }

      if (NAME_ONLY_RE.test(line)) {
        const name = line;
        const isQuoteLine = (s) => /^["“『(]/.test(s) || /["”』)\]]$/.test(s);
        const buf = [];
        for (let j = i + 1; j < allLines.length; j++) {
          let t = (allLines[j] || '').trim();
          if (t.startsWith(PLAYER_MARK)) t = t.slice(PLAYER_MARK.length).trim();
          if (!t || isLabel(t) || NAME_ONLY_RE.test(t) || HEADER_RE.test(t)) break;
          if (buf.length >= 1 && !isQuoteLine(t)) break;
          buf.push(t);
          break;
        }
        if (buf.length) {
          push(name, buf.join(' '), roleOf(name));
          i += buf.length;
        } else {
          lastSpeaker = name;
          lastRole = roleOf(name);
        }
        continue;
      }

      if (line.length <= 30 && /[!?…]$/.test(line) && !isLabel(line)) {
        push(lastSpeaker, line, lastRole);
        continue;
      }

      if (looksSecondPersonNarr(line)) {
        push(null, line, 'narration');
        continue;
      }

      if (!isLabel(line) && !HEADER_RE.test(line)) push(null, line, 'narration');
    }

    return turns;
  }

  function extractDialogueArea(chunk, actors, existingTurns = []) {
    const L = chunk.split('\n').map((s) => s.trim());
    const candidate = [];
    let afterBoundary = false;
    let playerMonoBudget = 2;

    for (let i = 0; i < L.length; i++) {
      let s = L[i];
      if (!s) continue;
      if (HEADER_RE.test(s)) {
        afterBoundary = true;
        continue;
      }
      const stripped = stripBrackets(s);
      if (isLabel(stripped)) {
        if (/기록코드/.test(stripped)) afterBoundary = true;
        continue;
      }

      if (/^(🍄|🏟️)\s/.test(s)) continue;
      if (/^\S+\s*\|\s*❤️/.test(s)) continue;
      if (/[A-J]\/\d+\/\d+\/\d+\/\d+/i.test(s)) continue;
      if (s.includes('|') && /중앙 광장|마법사의 탑|대회장|기사단|사교장/.test(s)) continue;

      if (afterBoundary && playerMonoBudget > 0) {
        const looksName = NAME_ONLY_RE.test(s);
        const looksSecond = looksSecondPersonNarr(s);
        const looksHeaderish = HEADER_RE.test(s) || isLabel(stripBrackets(s));
        const looksActorStat = /^\S+\s*\|\s*❤️/.test(s);
        if (!looksName && !looksSecond && !looksHeaderish && !looksActorStat && s.length <= 80) {
          s = PLAYER_MARK + s;
          playerMonoBudget--;
        }
        afterBoundary = false;
      }

      candidate.push(s);
    }
    const npcSet = buildNpcNameSet(actors, existingTurns);
    return parseDialogueLines(candidate, npcSet);
  }

  // -------------------------------
  // 1) Split raw transcript into scene chunks (multi-INFO aware)
  // -------------------------------
  function splitIntoSceneChunks(rawAll) {
    const raw = stripTicks(normNL(rawAll));
    const lines = raw.split('\n').map((s) => s.trim());

    const headers = [];
    for (let i = 0; i < lines.length; i++) {
      const m = HEADER_RE.exec(lines[i]);
      if (!m) continue;
      const [, time, modeRaw, placeRaw] = m;
      headers.push({ idx: i, sig: `${time}|${modeRaw}|${placeRaw}` });
    }
    if (!headers.length) {
      const fallback = raw.trim();
      return fallback ? [fallback] : [];
    }

    const NEAR = 80;
    const headerIdx = [];
    const lastBySig = new Map();
    for (const h of headers) {
      const last = lastBySig.get(h.sig);
      if (last != null && h.idx - last <= NEAR) continue;
      headerIdx.push(h.idx);
      lastBySig.set(h.sig, h.idx);
    }
    if (!headerIdx.length) return [];

    const chunks = [];
    for (let k = 0; k < headerIdx.length; k++) {
      const headerStart = headerIdx[k];
      const s = k === 0 ? Math.max(0, headerStart - 30) : headerStart;
      const e = k + 1 < headerIdx.length ? headerIdx[k + 1] : lines.length;

      const s2 = headerStart > 0 && isInfoLabel(lines[headerStart - 1]) ? headerStart - 1 : s;
      const piece = lines.slice(s2, e).join('\n').trim();
      if (piece) chunks.push(piece);
    }
    return chunks;
  }

  // -------------------------------
  // 2) Parse one scene chunk
  // -------------------------------
  function tokenizeTag(token) {
    if (!token) return [null, null];
    const cleaned = token.replace(/^[^\w가-힣]+/, '').trim();
    if (!cleaned) return [null, null];
    const m = cleaned.match(/[:=]/);
    if (m) {
      const idx = m.index ?? cleaned.indexOf(':');
      return [cleaned.slice(0, idx).trim(), cleaned.slice(idx + 1).trim() || null];
    }
    const parts = cleaned.split(/\s+/);
    if (parts.length < 2) return [null, null];
    return [parts[0], parts.slice(1).join(' ')];
  }

  function parseHeader(line, tailLinesForExtraTags = []) {
    const m = HEADER_RE.exec(line);
    if (!m) throw new Error('Failed to parse INFO header line');
    const [, time, modeRaw, placeRaw, rest] = m;
    const header = {
      time: time.trim(),
      mode: modeRaw.trim(),
      place: placeRaw.trim(),
      tags: { arena: placeRaw.trim() },
    };
    const tokens = String(rest || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const t of tokens) {
      const [k, v] = tokenizeTag(t);
      if (!k || !v) continue;
      header.tags[normalizeKey(k)] = toNum(v, v);
    }
    for (const line2 of tailLinesForExtraTags) {
      const frags = line2.split('|').map((s) => s.trim()).filter(Boolean);
      for (const f of frags) {
        const [k, v] = tokenizeTag(f);
        if (!k || !v) continue;
        header.tags[normalizeKey(k)] = toNum(v, v);
      }
    }
    return header;
  }

  function parseActors(lines) {
    const actors = [];
    for (const line of lines) {
      const cells = line.split('|').map((s) => s.trim()).filter(Boolean);
      if (!cells.length) continue;
      const name = cells[0];
      let feeling = '';
      let like = 0;
      let sweat = 0;
      let gauge = 0;
      const actionParts = [];
      for (const c of cells.slice(1)) {
        if (c.includes('💗')) like = toNum(c, 0);
        else if (c.includes('💦')) sweat = toNum(c, 0);
        else if (c.includes('🪣')) gauge = toNum(c, 0);
        else if (c.includes('❤️')) feeling = c.replace(/❤️/g, '').trim();
        else actionParts.push(c.trim());
      }
      actors.push({
        name,
        feeling,
        like,
        sweat,
        gauge,
        action: actionParts.join(' ').trim(),
      });
    }
    return actors;
  }

  function parseMap(lines) {
    return Array.from(
      new Set(lines.flatMap((l) => l.split('|')).map((s) => s.trim()).filter(Boolean))
    );
  }

  function parseRecordCodes(lines) {
    const start = lines.findIndex((l) => /기록코드/.test(stripBrackets(l)));
    if (start === -1) return { items: [], warnings: [] };
    const items = [];
    const seen = new Map();
    const warnings = [];

    for (let i = start + 1; i < lines.length; i++) {
      const v = (lines[i] || '').trim();
      if (!v) continue;
      if (!/[A-J]\/(\d+)\/(\d+)\/(\d+)\/(\d+)/i.test(v)) break;
      const entries = v
        .split('|')
        .map((x) => x.replace(/\|/g, '').trim())
        .filter(Boolean);
      for (const e of entries) {
        const m = CODE_RE.exec(e.replace(/\s+/g, ''));
        if (!m) continue;
        const [, slotRaw, n1, n2, n3, n4] = m;
        const slot = slotRaw.toUpperCase();
        const code = { slot, n1: +n1, n2: +n2, n3: +n3, n4: +n4 };
        if (seen.has(slot)) {
          warnings.push(`Duplicate slot ${slot} encountered; keeping all (debug).`);
        }
        seen.set(slot, (seen.get(slot) || 0) + 1);
        items.push(code);
      }
    }
    items.sort((a, b) => a.slot.localeCompare(b.slot));
    return { items, warnings };
  }

  function dedupeCodesKeepLast(codes) {
    const map = new Map();
    for (const c of codes || []) map.set(c.slot, c);
    return Array.from(map.values()).sort((a, b) => a.slot.localeCompare(b.slot));
  }

  function parseSceneChunk(chunk) {
    const lines = chunk.split('\n').map((s) => s.trim()).filter(Boolean);
    const hi = lines.findIndex((l) => HEADER_RE.test(l));
    const sceneWarnings = [];
    const hasHeader = hi !== -1;
    if (!hasHeader) sceneWarnings.push('INFO header missing; fallback header used.');

    const after = hasHeader ? lines.slice(hi + 1) : lines.slice();
    const idxActors = after.findIndex((l) => stripBrackets(l).replace(/\s+/g, '') === '등장');
    const idxMap = after.findIndex((l) => (l || '').startsWith('지도'));

    const extraTagLines = hasHeader
      ? after.slice(0, Math.max(0, idxActors)).filter(Boolean)
      : [];
    const header = hasHeader
      ? parseHeader(lines[hi], extraTagLines)
      : {
          time: '(unknown time)',
          mode: 'unknown',
          place: 'unknown',
          tags: {},
        };

    let actorLines = [];
    if (idxActors !== -1) {
      const endActors = idxMap === -1 ? after.length : idxMap;
      actorLines = after.slice(idxActors + 1, endActors).filter(Boolean);
    } else {
      for (let i = 0; i < Math.min(after.length, 20); i++) {
        const s = (after[i] || '').trim();
        if (/^\S+\s*\|\s*❤️/.test(s)) actorLines.push(s);
        if (/^지도/.test(s)) break;
      }
    }
    const actors = parseActors(actorLines);
    if (!actors.length) sceneWarnings.push('No actors parsed; using empty actor list.');

    const mapLines = (() => {
      const out = [];
      if (idxMap !== -1) {
        for (let i = idxMap; i < after.length; i++) {
          const v = (after[i] || '').trim();
          if (!v) continue;
          const cleaned = v.replace(/^지도[:\s]*/, '').trim();
          out.push(cleaned);
          if (v.includes('|')) break;
        }
      }
      return out.length ? out : [];
    })();
    const map = parseMap(mapLines);

    const { items: codesRaw, warnings: codeWarnings } = parseRecordCodes(after);
    if (codeWarnings.length) sceneWarnings.push(...codeWarnings);
    const codes = codesRaw.length ? dedupeCodesKeepLast(codesRaw) : null;

    let turns = extractDialogueArea(chunk, actors);
    const prio = { player: 3, npc: 2, narration: 1 };
    const best = new Map();
    turns.forEach((t, i) => {
      const key = t.text.trim();
      const prev = best.get(key);
      if (!prev || prio[t.role] > prio[prev.role]) best.set(key, { role: t.role, idx: i });
    });
    turns = turns.filter((t, i) => {
      const b = best.get(t.text.trim());
      return b && b.role === t.role && b.idx === i;
    });

    const infoLabelIdx = hasHeader && hi > 0 && isInfoLabel(lines[hi - 1]) ? hi - 1 : -1;
    const rawInfo = hasHeader
      ? (infoLabelIdx !== -1 ? lines[infoLabelIdx] + '\n' : '') + lines[hi]
      : lines.slice(0, Math.min(4, lines.length)).join('\n');

    return {
      header,
      actors,
      map,
      codes,
      warnings: sceneWarnings,
      raw: { info: rawInfo },
      turns,
    };
  }

  // -------------------------------
  // 3) Build Memory Block (turns는 JSON 내보내기에서만 사용)
  // -------------------------------
  function buildMemoryBlockFromScene(scene) {
    const { header, actors, map, codes } = scene;
    const tagsShort = header.tags
      ? Object.entries(header.tags)
          .slice(0, 4)
          .map(([k, v]) => `${k}:${v}`)
          .join(', ')
      : '';

    const codesLine = codes && codes.length
      ? codes.map((c) => `${c.slot}:${c.n1}/${c.n2}/${c.n3}/${c.n4}`).join(' | ')
      : '(no-codes)';

    const actorLines = actors.slice(0, 3).map((a) => {
      const mood = a.feeling ? `❤️ ${a.feeling}` : '';
      return `- ${a.name} (${mood} 💗${a.like} 🪣${a.gauge}${
        a.sweat ? ` 💦${a.sweat}` : ''
      }) ${a.action ? `— ${a.action}` : ''}`;
    });

    return [
      '[STATE CARD]',
      `- 시간/장소: ${header.time}, ${header.place}`,
      `- 모드: ${header.mode}${tagsShort ? ` (${tagsShort})` : ''}`,
      '',
      '[ACTORS ≤3]',
      ...actorLines,
      '',
      '[MAP]',
      `- ${map.join(' | ')}`,
      '',
      '[CODES]',
      codesLine,
    ].join('\n');
  }

  // -------------------------------
  // 4) DOM Reader
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
  // 5) UI Panel
  // -------------------------------
  function mountPanel() {
    if (qs('#genit-memory-helper-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'genit-memory-helper-panel';
    panel.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 999999;
      background: #0b1020; color: #fff; padding: 10px 12px; border-radius: 10px;
      font: 12px/1.3 ui-sans-serif, system-ui; box-shadow: 0 8px 20px rgba(0,0,0,.4);
      display: grid; gap: 8px; min-width: 240px;
    `;
    panel.innerHTML = `
      <div style="font-weight:600">Genit Memory Helper</div>
      <div style="display:flex; gap:8px;">
        <button id="gmh-copy-last" style="flex:1; background:#22c55e; border:0; color:#051; border-radius:8px; padding:8px; cursor:pointer;">마지막 씬 복사</button>
        <button id="gmh-export" style="flex:1; background:#2dd4bf; border:0; color:#052; border-radius:8px; padding:8px; cursor:pointer;">JSON 내보내기</button>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="gmh-copy-all" style="flex:1; background:#60a5fa; border:0; color:#031; border-radius:8px; padding:8px; cursor:pointer;">모든 씬 요약</button>
        <button id="gmh-reparse" style="flex:1; background:#f59e0b; border:0; color:#210; border-radius:8px; padding:8px; cursor:pointer;">재파싱</button>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="gmh-guide" style="flex:1; background:#a78bfa; border:0; color:#210; border-radius:8px; padding:8px; cursor:pointer;">요약 가이드</button>
        <button id="gmh-reguide" style="flex:1; background:#fbbf24; border:0; color:#210; border-radius:8px; padding:8px; cursor:pointer;">재요약 가이드</button>
      </div>
      <div id="gmh-status" style="opacity:.85"></div>
    `;
    document.body.appendChild(panel);

    const setStatus = (msg, color = '#9ca3af') => {
      const el = qs('#gmh-status');
      if (el) {
        el.textContent = msg;
        el.style.color = color;
      }
    };

    const parseAll = () => {
      const raw = readTranscriptText();
      const chunks = splitIntoSceneChunks(raw);
      if (!chunks.length) throw new Error('INFO 씬을 찾을 수 없습니다.');
      const parsed = [];
      const warnings = [];
      for (const c of chunks) {
        try {
          const s = parseSceneChunk(c);
          parsed.push(s);
          if (s.warnings?.length) warnings.push(...s.warnings);
        } catch (e) {
          warnings.push(`씬 파싱 실패: ${(e && e.message) || e}`);
        }
      }
      if (!parsed.length) throw new Error('모든 씬 파싱에 실패했습니다.');
      return { parsed, warnings, raw };
    };

    qs('#gmh-copy-last').onclick = () => {
      try {
        const { parsed, warnings } = parseAll();
        const scene = parsed[parsed.length - 1];
        const block = buildMemoryBlockFromScene(scene);
        GM_setClipboard(block, { type: 'text', mimetype: 'text/plain' });
        setStatus(`마지막 씬 메모리 블록 복사 완료. 경고 ${warnings.length}건.`, '#a7f3d0');
        if (warnings.length) console.warn('[GMH] warnings:', warnings);
      } catch (e) {
        alert(`오류: ${(e && e.message) || e}`);
        setStatus('복사 실패', '#fecaca');
      }
    };

    qs('#gmh-export').onclick = () => {
      try {
        const { parsed, warnings, raw } = parseAll();
        const data = {
          scenes: parsed,
          warnings,
          source: 'genit-memory-helper',
          raw_excerpt: raw.slice(0, 2000),
          player_names: PLAYER_NAMES,
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: 'application/json',
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `genit_scenes_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        setStatus(`JSON 내보내기 완료. 씬 ${parsed.length}개, 경고 ${warnings.length}건.`, '#d1fae5');
      } catch (e) {
        alert(`오류: ${(e && e.message) || e}`);
        setStatus('내보내기 실패', '#fecaca');
      }
    };

    qs('#gmh-copy-all').onclick = () => {
      try {
        const { parsed, warnings } = parseAll();
        const blocks = parsed
          .map((s, i) => `# 씬 ${i + 1}\n` + buildMemoryBlockFromScene(s))
          .join('\n\n---\n\n');
        GM_setClipboard(blocks, { type: 'text', mimetype: 'text/plain' });
        setStatus(`모든 씬 요약 블록 복사 완료. 씬 ${parsed.length}개.`, '#bfdbfe');
        if (warnings.length) console.warn('[GMH] warnings:', warnings);
      } catch (e) {
        alert(`오류: ${(e && e.message) || e}`);
        setStatus('복사 실패', '#fecaca');
      }
    };

    qs('#gmh-reparse').onclick = () => {
      try {
        const { parsed, warnings } = parseAll();
        setStatus(`재파싱 완료: 씬 ${parsed.length}개. 경고 ${warnings.length}건.`, '#fde68a');
        if (warnings.length) console.warn('[GMH] warnings:', warnings);
      } catch (e) {
        alert(`오류: ${(e && e.message) || e}`);
        setStatus('재파싱 실패', '#fecaca');
      }
    };

    qs('#gmh-guide').onclick = () => {
      const prompt = `
당신은 "장기기억 보관용 사서"입니다.
아래 JSON은 캐릭터 채팅 로그를 정형화한 것입니다.
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

    qs('#gmh-reguide').onclick = () => {
      const prompt = `
아래에는 [이전 요약본]과 [새 JSON 파싱 결과]가 있습니다.
이 둘을 통합하여, 2000자 이내의 "최신 장기기억 요약본"을 만드세요.

규칙:
- 이전 요약본에서 이미 있는 사실은 유지하되, 새 JSON에 나온 사건/관계 변화로 업데이트.
- 모순되면 "최근 사건"을 우선.
- 출력 구조는 [전체 줄거리 요약] / [주요 관계 변화] / [핵심 테마].
- 길이는 1200~1800자.
`;
      GM_setClipboard(prompt, { type: 'text', mimetype: 'text/plain' });
      setStatus('✅ 재요약 프롬프트가 클립보드에 복사되었습니다.', '#fcd34d');
    };
  }

  // -------------------------------
  // 6) Boot
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
    if (!qs('#genit-memory-helper-panel')) boot();
  });
  mo.observe(document.documentElement, { subtree: true, childList: true });
})();
