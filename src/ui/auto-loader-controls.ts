import type { AutoLoaderController, AutoLoaderExports } from '../types';

interface AutoLoaderControlsOptions {
  documentRef?: Document | null;
  autoLoader: AutoLoaderController;
  autoState: AutoLoaderExports['autoState'];
  setPanelStatus?: (message: string, tone?: string | null) => void;
  startTurnMeter: (meter: HTMLElement) => void;
  getAutoProfile: () => string;
  subscribeProfileChange: (listener: () => void) => void | (() => void);
}

interface AutoLoaderControls {
  ensureAutoLoadControlsModern(panel: Element | null): void;
  mountStatusActionsModern(panel: Element | null): void;
}

type AutoLoaderMode = 'all' | 'turns';

export function createAutoLoaderControls({
  documentRef = typeof document !== 'undefined' ? document : null,
  autoLoader,
  autoState,
  setPanelStatus,
  startTurnMeter,
  getAutoProfile,
  subscribeProfileChange,
}: AutoLoaderControlsOptions): AutoLoaderControls {
  if (!documentRef) throw new Error('createAutoLoaderControls requires document reference');
  if (!autoLoader) throw new Error('createAutoLoaderControls requires autoLoader');
  if (!autoState) throw new Error('createAutoLoaderControls requires autoState');
  if (!startTurnMeter) throw new Error('createAutoLoaderControls requires startTurnMeter');
  if (!getAutoProfile) throw new Error('createAutoLoaderControls requires getAutoProfile');
  if (!subscribeProfileChange) {
    throw new Error('createAutoLoaderControls requires subscribeProfileChange');
  }

  const doc = documentRef;
  const profileSelectElements = new Set<HTMLSelectElement>();

  const syncProfileSelects = (): void => {
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

  const registerProfileSelect = (select: HTMLSelectElement | null): void => {
    if (!select) return;
    profileSelectElements.add(select);
    syncProfileSelects();
    select.addEventListener('change', (event) => {
      const target = event.target as HTMLSelectElement;
      autoLoader.setProfile(target.value);
    });
  };

  const toggleControls = (disabled: boolean, buttons: (HTMLButtonElement | null)[]): void => {
    buttons.forEach((btn) => {
      if (!btn) return;
      btn.disabled = disabled;
      btn.classList.toggle('gmh-disabled', disabled);
    });
  };

  const ensureAutoLoadControlsModern = (panel: Element | null): void => {
    if (!panel) return;
    let wrap = panel.querySelector<HTMLDivElement>('#gmh-autoload-controls');
    if (!wrap) {
      wrap = doc.createElement('div');
      wrap.id = 'gmh-autoload-controls';
      panel.appendChild(wrap);
    }
    if (wrap.dataset.ready === 'true') return;
    wrap.dataset.ready = 'true';
    wrap.innerHTML = `
      <div class="gmh-field-row">
        <button id="gmh-autoload-all" class="gmh-panel-btn gmh-panel-btn--accent">메시지 수집</button>
        <button id="gmh-autoload-stop" class="gmh-panel-btn gmh-panel-btn--warn gmh-panel-btn--compact">정지</button>
      </div>
      <div class="gmh-subtext" style="margin-bottom:8px;">💡 백업 전에 먼저 눌러주세요</div>
      <div class="gmh-field-row">
        <input id="gmh-autoload-turns" class="gmh-input" type="number" min="1" step="1" placeholder="최근 유저 메시지 N" />
        <button id="gmh-autoload-turns-btn" class="gmh-small-btn gmh-small-btn--accent">메시지 확보</button>
      </div>
      <div id="gmh-turn-meter" class="gmh-subtext"></div>
    `;

    const btnAll = wrap.querySelector<HTMLButtonElement>('#gmh-autoload-all');
    const btnStop = wrap.querySelector<HTMLButtonElement>('#gmh-autoload-stop');
    const btnTurns = wrap.querySelector<HTMLButtonElement>('#gmh-autoload-turns-btn');
    const inputTurns = wrap.querySelector<HTMLInputElement>('#gmh-autoload-turns');
    const meter = wrap.querySelector<HTMLElement>('#gmh-turn-meter');

    const disableControls = (disabled: boolean) =>
      toggleControls(disabled, [btnAll, btnTurns]);

    btnAll?.addEventListener('click', async () => {
      if (autoState.running) return;
      disableControls(true);
      try {
        await autoLoader.start('all');
      } finally {
        disableControls(false);
      }
    });

    btnTurns?.addEventListener('click', async () => {
      if (autoState.running) return;
      const rawVal = inputTurns?.value?.trim();
      const target = Number.parseInt(rawVal || '0', 10);
      if (!Number.isFinite(target) || target <= 0) {
        setPanelStatus?.('유저 메시지 수를 입력해주세요.', 'error');
        return;
      }
      disableControls(true);
      try {
        await autoLoader.start('turns', target);
      } finally {
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

  const createStatusActionsMarkup = (): string => {
    return `
      <div class="gmh-field-row">
        <label for="gmh-profile-select" class="gmh-subtext gmh-field-label--inline">프로파일</label>
        <select id="gmh-profile-select" class="gmh-select">
          <option value="default">기본</option>
          <option value="stability">안정</option>
          <option value="fast">빠름</option>
        </select>
      </div>
    `;
  };

  const bindStatusActions = (actions: HTMLElement): void => {
    const select = actions.querySelector<HTMLSelectElement>('#gmh-profile-select');
    if (select) registerProfileSelect(select);
  };

  const mountStatusActionsModern = (panel: Element | null): void => {
    if (!panel) return;
    let actions = panel.querySelector<HTMLDivElement>('#gmh-status-actions');
    if (!actions) {
      actions = doc.createElement('div');
      actions.id = 'gmh-status-actions';
      panel.appendChild(actions);
    }
    if (actions.dataset.ready === 'true') return;
    actions.dataset.ready = 'true';
    actions.innerHTML = createStatusActionsMarkup();
    bindStatusActions(actions);
  };

  return {
    ensureAutoLoadControlsModern,
    mountStatusActionsModern,
  };
}
