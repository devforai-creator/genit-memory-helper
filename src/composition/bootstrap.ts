import type { BookmarkListener, ErrorHandler, MessageIndexer } from '../types';

type BootstrapWindow = (Window & typeof globalThis) & { __GMHTeardownHook?: boolean };

type BootstrapFlags = {
  killSwitch?: boolean;
  [key: string]: unknown;
};

type RequestFrame = (callback: FrameRequestCallback) => number;

interface SetupBootstrapOptions {
  documentRef: Document;
  windowRef: BootstrapWindow;
  mountPanelModern: () => void;
  mountPanelLegacy: () => void;
  isModernUIActive: () => boolean;
  Flags: BootstrapFlags;
  errorHandler: ErrorHandler;
  messageIndexer: MessageIndexer | null;
  bookmarkListener: BookmarkListener | null;
}

interface SetupBootstrapResult {
  boot: () => void;
  mountPanel: () => void;
}

/**
 * Sets up panel mounting, boot sequencing, teardown hooks, and mutation observer.
 *
 * @param options Dependency container.
 * @returns Mount/boot control helpers.
 */
export const setupBootstrap = ({
  documentRef,
  windowRef,
  mountPanelModern,
  mountPanelLegacy,
  isModernUIActive,
  Flags,
  errorHandler,
  messageIndexer,
  bookmarkListener,
}: SetupBootstrapOptions): SetupBootstrapResult => {
  const doc = documentRef;
  const win = windowRef;
  const MutationObserverCtor: typeof MutationObserver | undefined =
    win.MutationObserver || globalThis.MutationObserver;
  const requestFrame: RequestFrame =
    typeof win.requestAnimationFrame === 'function'
      ? win.requestAnimationFrame.bind(win)
      : (callback: FrameRequestCallback) => (win.setTimeout?.(callback, 16) ?? setTimeout(callback, 16));

  let panelMounted = false;
  let bootInProgress = false;
  let observerScheduled = false;

  const mountPanel = (): void => {
    if (isModernUIActive()) {
      mountPanelModern();
      return;
    }

    if (Flags.killSwitch) {
      const level = errorHandler.LEVELS?.INFO || 'info';
      errorHandler.handle('modern UI disabled by kill switch', 'ui/panel', level);
    }
    mountPanelLegacy();
  };

  const boot = (): void => {
    if (panelMounted || bootInProgress) return;
    bootInProgress = true;
    try {
      mountPanel();
      messageIndexer?.start?.();
      bookmarkListener?.start?.();
      panelMounted = Boolean(doc.querySelector('#genit-memory-helper-panel'));
    } catch (error) {
      const level = errorHandler.LEVELS?.ERROR || 'error';
      errorHandler.handle(error, 'ui/panel', level);
    } finally {
      bootInProgress = false;
    }
  };

  const registerReadyHook = (): void => {
    if (doc.readyState === 'complete' || doc.readyState === 'interactive') {
      setTimeout(boot, 1200);
    } else {
      win.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1200));
    }
  };

  const registerTeardown = (): void => {
    if (win.__GMHTeardownHook) return;

    const teardown = (): void => {
      panelMounted = false;
      bootInProgress = false;
      try {
        bookmarkListener?.stop?.();
      } catch (err) {
        const level = errorHandler.LEVELS?.WARN || 'warn';
        errorHandler.handle(err, 'bookmark', level);
      }
      try {
        messageIndexer?.stop?.();
      } catch (err) {
        const level = errorHandler.LEVELS?.WARN || 'warn';
        errorHandler.handle(err, 'adapter', level);
      }
    };

    win.addEventListener('pagehide', teardown);
    win.addEventListener('beforeunload', teardown);
    win.__GMHTeardownHook = true;
  };

  const registerMutationObserver = (): void => {
    if (!MutationObserverCtor) return;
    const target = doc.documentElement || doc.body;
    if (!target) return;

    const observer = new MutationObserverCtor(() => {
      if (observerScheduled || bootInProgress) return;
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

export default setupBootstrap;
