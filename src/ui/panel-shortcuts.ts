import type { PanelShortcutsOptions } from '../types';

interface BindOptions {
  modern?: boolean;
}

export function createPanelShortcuts({
  windowRef = typeof window !== 'undefined' ? window : (undefined as unknown as Window & typeof globalThis),
  panelVisibility,
  autoLoader,
  autoState,
  configurePrivacyLists,
  modal,
}: PanelShortcutsOptions): { bindShortcuts: (panel: Element | null, options?: BindOptions) => void } {
  if (!windowRef) throw new Error('createPanelShortcuts requires window reference');
  if (!panelVisibility) throw new Error('createPanelShortcuts requires panelVisibility');
  if (!autoLoader) throw new Error('createPanelShortcuts requires autoLoader');
  if (!autoState) throw new Error('createPanelShortcuts requires autoState');
  if (!configurePrivacyLists) throw new Error('createPanelShortcuts requires configurePrivacyLists');

  let shortcutsBound = false;

  const bindShortcuts = (panel: Element | null, { modern }: BindOptions = {}): void => {
    if (!modern || shortcutsBound) return;
    if (!panel) return;

    const win = windowRef;
    const handler = (event: KeyboardEvent): void => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const key = event.key?.toLowerCase();
      const target = event.target;

      if (target instanceof win.HTMLElement) {
        const tag = target.tagName.toLowerCase();
        const isInputLike =
          ['input', 'textarea', 'select'].includes(tag) || target.isContentEditable;
        if (isInputLike && !['g', 'm', 's', 'p', 'e'].includes(key)) return;
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
          void configurePrivacyLists();
          break;
        case 'e':
          event.preventDefault();
          panel.querySelector<HTMLButtonElement>('#gmh-export')?.click();
          break;
        default:
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

export default createPanelShortcuts;
