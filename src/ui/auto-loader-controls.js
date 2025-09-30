export function createAutoLoaderControls({
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
    if (!select) return;
    profileSelectElements.add(select);
    syncProfileSelects();
    select.onchange = (event) => {
      autoLoader.setProfile(event.target.value);
    };
  };

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
    bindStatusActions(actions, true);
  };

  const mountStatusActionsLegacy = (panel) => {
    if (!panel || panel.querySelector('#gmh-status-actions')) return;
    const actions = doc.createElement('div');
    actions.id = 'gmh-status-actions';
    actions.style.cssText =
      'display:grid; gap:6px; border-top:1px solid rgba(148,163,184,0.25); padding-top:6px;';
    actions.innerHTML = createStatusActionsMarkup(false);
    bindStatusActions(actions, false);
    panel.appendChild(actions);
  };

  return {
    ensureAutoLoadControlsModern,
    ensureAutoLoadControlsLegacy,
    mountStatusActionsModern,
    mountStatusActionsLegacy,
  };
}
