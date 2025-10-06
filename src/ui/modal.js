import { ensureDesignSystemStyles } from './styles.js';

/**
 * @typedef {import('../../types/api').ModalController} ModalController
 * @typedef {import('../../types/api').ModalOpenOptions} ModalOpenOptions
 */

/**
 * Creates the shared modal controller used across classic/modern panels.
 *
 * @param {{ documentRef?: Document | null; windowRef?: (Window & typeof globalThis) | null }} [options]
 * @returns {ModalController}
 */
export function createModal({ documentRef = typeof document !== 'undefined' ? document : null, windowRef = typeof window !== 'undefined' ? /** @type {Window & typeof globalThis} */ (window) : null } = {}) {
  const doc = documentRef;
  const win = /** @type {(Window & typeof globalThis) | null} */ (windowRef);
  if (!doc || !win) {
    return {
      open: async () => false,
      close: () => {},
      isOpen: () => false,
    };
  }

  const HTMLElementCtor = /** @type {typeof HTMLElement | null} */ (
    win.HTMLElement || (typeof HTMLElement !== 'undefined' ? HTMLElement : null)
  );
  const NodeCtor = /** @type {typeof Node | null} */ (
    win.Node || (typeof Node !== 'undefined' ? Node : null)
  );

  let activeModal = null;
  let modalIdCounter = 0;

  /**
   * Sanitises markup snippets before injecting them into the modal body.
   *
   * @param {string} markup
   * @returns {DocumentFragment}
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
        if (name === 'srcdoc') element.removeAttribute(attr.name);
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

  /**
   * @param {Element | null} root
   * @returns {HTMLElement[]}
   */
  const getFocusable = (root) => {
    if (!root) return [];
    return /** @type {HTMLElement[]} */ (
      Array.from(root.querySelectorAll(focusableSelector)).filter((el) => {
        if (!(HTMLElementCtor && el instanceof HTMLElementCtor)) return false;
        const style = win.getComputedStyle(el);
        return style.visibility !== 'hidden' && style.display !== 'none';
      })
    );
  };

  function buildButton(action, finalize) {
    const button = doc.createElement('button');
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

  /**
   * Opens a modal dialog with sanitized markup and focus trapping.
   *
   * @param {ModalOpenOptions} [options]
   * @returns {Promise<unknown>}
   */
  function open(options = /** @type {ModalOpenOptions} */ ({})) {
    ensureDesignSystemStyles();
    closeActive(false);

    return new Promise((resolve) => {
      const overlay = doc.createElement('div');
      overlay.className = 'gmh-modal-overlay';
      const dialog = doc.createElement('div');
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
      if (options.description) dialog.setAttribute('aria-describedby', descId);
      else dialog.removeAttribute('aria-describedby');

      const body = doc.createElement('div');
      body.className = 'gmh-modal__body gmh-modal__body--scroll';
      if (options.bodyClass) body.classList.add(options.bodyClass);
      if (NodeCtor && options.content instanceof NodeCtor) {
        body.appendChild(options.content);
      } else if (typeof options.content === 'string') {
        body.appendChild(sanitizeMarkupFragment(options.content));
      }

      const footer = doc.createElement('div');
      footer.className = 'gmh-modal__footer';
      const actionsWrap = doc.createElement('div');
      actionsWrap.className = 'gmh-modal__actions';
      const actions =
        Array.isArray(options.actions) && options.actions.length ? options.actions : [];

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

      const bodyEl = doc.body;
      const prevOverflow = bodyEl.style.overflow;
      const restoreTarget =
        HTMLElementCtor && doc.activeElement instanceof HTMLElementCtor
          ? /** @type {HTMLElement} */ (doc.activeElement)
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
          } else if (!event.shiftKey && doc.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      };

      const cleanup = (result) => {
        if (!overlay.isConnected) return;
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
          if (event.target === overlay) cleanup(false);
        });
        if (closeBtn) closeBtn.addEventListener('click', () => cleanup(false));
      }

      doc.addEventListener('keydown', onKeydown, true);

      const initialSelector = options.initialFocus || '.gmh-button--primary';
      let focusTarget = /** @type {HTMLElement | null} */ (
        initialSelector ? dialog.querySelector(initialSelector) : null
      );
      if (!(focusTarget && HTMLElementCtor && focusTarget instanceof HTMLElementCtor)) {
        const focusables = getFocusable(dialog);
        focusTarget = focusables[0] || closeBtn;
      }
      win.setTimeout(() => {
        if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
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
}
