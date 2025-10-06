/**
 * Mounts the legacy panel layout for older styling.
 */
export function createLegacyPanel({
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

export default createLegacyPanel;
