import { ensureDesignSystemStyles } from './styles.ts';

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
export function createPanelSettingsController({
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
