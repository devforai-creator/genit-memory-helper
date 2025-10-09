/**
 * Manages panel open/collapse state, coordinating with storage and modal overlays.
 *
 * @typedef {import('../types').PanelVisibilityOptions} PanelVisibilityOptions
 * @typedef {import('../types').PanelVisibilityController} PanelVisibilityController
 * @typedef {import('../types').PanelSettingsController} PanelSettingsController
 * @typedef {import('../types').PanelSettingsLayout} PanelSettingsLayout
 * @typedef {import('../types').PanelSettingsBehavior} PanelSettingsBehavior
 * @typedef {import('../types').PanelStateApi} PanelStateApi
 * @typedef {import('../types').ModalController} ModalController
 * @param {PanelVisibilityOptions} [options]
 * @returns {PanelVisibilityController}
 */
export function createPanelVisibility({
  panelSettings: panelSettingsRaw,
  stateEnum,
  stateApi: stateApiRaw,
  modal,
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? window : null,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  logger = typeof console !== 'undefined' ? console : null,
} = /** @type {PanelVisibilityOptions} */ ({})) {
  /** @type {PanelSettingsController | undefined} */
  const panelSettings = panelSettingsRaw;
  /** @type {PanelStateApi | undefined} */
  const stateApi = stateApiRaw;
  const doc = documentRef;
  const win = windowRef;
  if (!panelSettings || !stateEnum || !stateApi || !doc || !win) {
    throw new Error('createPanelVisibility missing required dependencies');
  }

  const COLLAPSED_CLASS = 'gmh-collapsed';
  const OPEN_CLASS = 'gmh-panel-open';
  const STORAGE_KEY = 'gmh_panel_collapsed';
  const MIN_GAP = 12;

  /**
   * @param {unknown} value
   * @returns {string | null}
   */
  const normalizeState = (value) => {
    if (!value) return null;
    const next = String(value).toLowerCase();
    return Object.values(stateEnum).includes(next) ? next : null;
  };

  /** @type {PanelSettingsLayout} */
  const DEFAULT_LAYOUT = (() => {
    const layout = panelSettings.defaults?.layout || {};
    return {
      anchor: layout.anchor === 'left' ? 'left' : 'right',
      offset:
        Number.isFinite(Number(layout.offset)) && Number(layout.offset) > 0
          ? Math.max(MIN_GAP, Math.round(Number(layout.offset)))
          : 16,
      bottom:
        Number.isFinite(Number(layout.bottom)) && Number(layout.bottom) > 0
          ? Math.max(MIN_GAP, Math.round(Number(layout.bottom)))
          : 16,
      width: Number.isFinite(Number(layout.width)) ? Math.round(Number(layout.width)) : null,
      height: Number.isFinite(Number(layout.height)) ? Math.round(Number(layout.height)) : null,
    };
  })();

  /** @type {PanelSettingsBehavior} */
  const DEFAULT_BEHAVIOR = (() => {
    const behavior = panelSettings.defaults?.behavior || {};
    return {
      autoHideEnabled:
        typeof behavior.autoHideEnabled === 'boolean' ? behavior.autoHideEnabled : true,
      autoHideDelayMs: Number.isFinite(Number(behavior.autoHideDelayMs))
        ? Math.max(2000, Math.round(Number(behavior.autoHideDelayMs)))
        : 10000,
      collapseOnOutside:
        typeof behavior.collapseOnOutside === 'boolean' ? behavior.collapseOnOutside : true,
      collapseOnFocus:
        typeof behavior.collapseOnFocus === 'boolean' ? behavior.collapseOnFocus : false,
      allowDrag: typeof behavior.allowDrag === 'boolean' ? behavior.allowDrag : true,
      allowResize: typeof behavior.allowResize === 'boolean' ? behavior.allowResize : true,
    };
  })();

  /**
   * @param {PanelSettingsLayout | null | undefined} [input]
   * @returns {PanelSettingsLayout}
   */
  const coerceLayout = (input = {}) => {
    const layout = { ...DEFAULT_LAYOUT, ...(input || {}) };
    return {
      anchor: layout.anchor === 'left' ? 'left' : 'right',
      offset: Number.isFinite(Number(layout.offset))
        ? Math.max(MIN_GAP, Math.round(Number(layout.offset)))
        : DEFAULT_LAYOUT.offset,
      bottom: Number.isFinite(Number(layout.bottom))
        ? Math.max(MIN_GAP, Math.round(Number(layout.bottom)))
        : DEFAULT_LAYOUT.bottom,
      width: Number.isFinite(Number(layout.width))
        ? Math.max(240, Math.round(Number(layout.width)))
        : null,
      height: Number.isFinite(Number(layout.height))
        ? Math.max(220, Math.round(Number(layout.height)))
        : null,
    };
  };

  /**
   * @param {PanelSettingsBehavior | null | undefined} [input]
   * @returns {PanelSettingsBehavior}
   */
  const coerceBehavior = (input = {}) => {
    const behavior = { ...DEFAULT_BEHAVIOR, ...(input || {}) };
    behavior.autoHideEnabled =
      typeof behavior.autoHideEnabled === 'boolean'
        ? behavior.autoHideEnabled
        : DEFAULT_BEHAVIOR.autoHideEnabled;
    behavior.autoHideDelayMs = Number.isFinite(Number(behavior.autoHideDelayMs))
      ? Math.max(2000, Math.round(Number(behavior.autoHideDelayMs)))
      : DEFAULT_BEHAVIOR.autoHideDelayMs;
    behavior.collapseOnOutside =
      typeof behavior.collapseOnOutside === 'boolean'
        ? behavior.collapseOnOutside
        : DEFAULT_BEHAVIOR.collapseOnOutside;
    behavior.collapseOnFocus =
      typeof behavior.collapseOnFocus === 'boolean'
        ? behavior.collapseOnFocus
        : DEFAULT_BEHAVIOR.collapseOnFocus;
    behavior.allowDrag =
      typeof behavior.allowDrag === 'boolean' ? behavior.allowDrag : DEFAULT_BEHAVIOR.allowDrag;
    behavior.allowResize =
      typeof behavior.allowResize === 'boolean'
        ? behavior.allowResize
        : DEFAULT_BEHAVIOR.allowResize;
    return behavior;
  };

  /** @type {HTMLElement | null} */
  let panelEl = null;
  /** @type {HTMLButtonElement | null} */
  let fabEl = null;
  let fabLastToggleAt = 0;
  /** @type {HTMLButtonElement | null} */
  let dragHandle = null;
  /** @type {HTMLElement | null} */
  let resizeHandle = null;
  let modernMode = false;
  /** @type {number | null} */
  let idleTimer = null;
  /** @type {(() => void) | null} */
  let stateUnsubscribe = null;
  /** @type {((event: PointerEvent) => void) | null} */
  let outsidePointerHandler = null;
  /** @type {((event: FocusEvent) => void) | null} */
  let focusCollapseHandler = null;
  /** @type {((event: KeyboardEvent) => void) | null} */
  let escapeKeyHandler = null;
  let panelListenersBound = false;
  let resizeScheduled = false;
  let currentState = stateEnum.IDLE;
  let userCollapsed = false;
  /** @type {boolean | null} */
  let persistedPreference = null;
  /** @type {HTMLElement | null} */
  let lastFocusTarget = null;
  /** @type {{ pointerId?: number; startX: number; startY: number; rect: DOMRect } | null} */
  let dragSession = null;
  /** @type {{ pointerId?: number; startX: number; startY: number; width: number; height: number; nextWidth: number; nextHeight: number } | null} */
  let resizeSession = null;
  let applyingSettings = false;
  /** @type {number[]} */
  let focusTimeouts = [];
  /** @type {number | null} */
  let focusAnimationFrame = null;

  /** @type {import('../types').PanelSettingsValue} */
  let currentSettings = panelSettings.get();
  let currentLayout = coerceLayout(currentSettings.layout);
  let currentBehavior = coerceBehavior(currentSettings.behavior);

  panelSettings.onChange((next) => {
    currentSettings = next;
    currentLayout = coerceLayout(next.layout);
    currentBehavior = coerceBehavior(next.behavior);
    if (panelEl && modernMode) {
      applyingSettings = true;
      try {
        applyLayout();
        refreshBehavior();
      } finally {
        applyingSettings = false;
      }
    }
  });

  const getRoot = () => doc.documentElement;

  const isModernActive = () => modernMode && !!panelEl;

  const isCollapsed = () => {
    if (!isModernActive()) return false;
    return getRoot().classList.contains(COLLAPSED_CLASS);
  };

  const loadPersistedCollapsed = () => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw === '1') return true;
      if (raw === '0') return false;
    } catch (err) {
      logger.warn('[GMH] failed to read panel state', err);
    }
    return null;
  };

  const persistCollapsed = (value) => {
    if (!storage) return;
    persistedPreference = value;
    try {
      if (value === null) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch (err) {
      logger.warn('[GMH] failed to persist panel state', err);
    }
  };

  const rememberFocus = () => {
    const active = doc.activeElement;
    if (!active || active === doc.body) return;
    if (!(active instanceof HTMLElement)) return;
    if (panelEl && panelEl.contains(active)) return;
    lastFocusTarget = active;
  };

  const clearFocusSchedules = () => {
    if (focusAnimationFrame) {
      cancelAnimationFrame(focusAnimationFrame);
      focusAnimationFrame = null;
    }
    if (focusTimeouts.length) {
      focusTimeouts.forEach((id) => win.clearTimeout(id));
      focusTimeouts = [];
    }
  };

  const clearFocusMemory = () => {
    lastFocusTarget = null;
  };

  const restoreFocus = () => {
    const target = lastFocusTarget;
    if (!target) return;
    lastFocusTarget = null;
    requestAnimationFrame(() => {
      try {
        if (typeof target.focus === 'function') target.focus({ preventScroll: true });
      } catch (err) {
        logger.warn('[GMH] focus restore failed', err);
      }
    });
  };

  const focusPanelElement = () => {
    const panelElement = panelEl;
    if (!panelElement || typeof panelElement.focus !== 'function') return;
    const attempt = () => {
      try {
        panelElement.focus({ preventScroll: true });
      } catch (err) {
        /* noop */
      }
    };
    clearFocusSchedules();
    attempt();
    focusAnimationFrame = requestAnimationFrame(() => {
      focusAnimationFrame = null;
      attempt();
    });
    focusTimeouts = [win.setTimeout(attempt, 0), win.setTimeout(attempt, 50)];
  };

  const clearIdleTimer = () => {
    if (idleTimer) {
      win.clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const getAutoHideDelay = () => {
    if (!currentBehavior.autoHideEnabled) return null;
    return currentBehavior.autoHideDelayMs || 10000;
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
    if (fabEl) fabEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  };

  const scheduleIdleClose = () => {
    if (!isModernActive()) return;
    clearIdleTimer();
    if (isCollapsed()) return;
    if (currentState !== stateEnum.IDLE) return;
    const delay = getAutoHideDelay();
    if (!delay) return;
    idleTimer = win.setTimeout(() => {
      if (!isModernActive()) return;
      if (currentState !== stateEnum.IDLE) return;
      close('idle');
    }, delay);
  };

  const resetIdleTimer = () => {
    if (!isModernActive()) return;
    if (isCollapsed()) return;
    scheduleIdleClose();
  };

  const applyLayout = () => {
    if (!panelEl) return;
    const layout = coerceLayout(currentLayout);
    const viewportWidth = win.innerWidth || doc.documentElement.clientWidth || 1280;
    const viewportHeight = win.innerHeight || doc.documentElement.clientHeight || 720;

    const maxWidth = Math.max(MIN_GAP, viewportWidth - MIN_GAP * 2);
    const maxHeight = Math.max(MIN_GAP, viewportHeight - MIN_GAP * 2);

    const width = layout.width ? Math.min(Math.max(260, layout.width), maxWidth) : null;
    const height = layout.height ? Math.min(Math.max(240, layout.height), maxHeight) : null;

    if (width) panelEl.style.width = `${width}px`;
    else panelEl.style.width = '';

    if (height) {
      panelEl.style.height = `${height}px`;
      panelEl.style.maxHeight = `${height}px`;
    } else {
      panelEl.style.height = '';
      panelEl.style.maxHeight = '70vh';
    }

    // Re-measure after size adjustments
    const rect = panelEl.getBoundingClientRect();
    const effectiveHeight = height || rect.height || 320;

    const bottomLimit = Math.max(MIN_GAP, viewportHeight - effectiveHeight - MIN_GAP);
    const bottom = Math.min(Math.max(MIN_GAP, layout.bottom), bottomLimit);

    const horizontalLimit = Math.max(MIN_GAP, viewportWidth - MIN_GAP - 160);
    const offset = Math.min(Math.max(MIN_GAP, layout.offset), horizontalLimit);

    if (layout.anchor === 'left') {
      panelEl.style.left = `${offset}px`;
      panelEl.style.right = 'auto';
    } else {
      panelEl.style.left = 'auto';
      panelEl.style.right = `${offset}px`;
    }
    panelEl.style.bottom = `${bottom}px`;
    panelEl.style.top = 'auto';

    const finalLayout = { ...layout, offset, bottom, width, height };
    const changed =
      finalLayout.anchor !== currentLayout.anchor ||
      finalLayout.offset !== currentLayout.offset ||
      finalLayout.bottom !== currentLayout.bottom ||
      finalLayout.width !== currentLayout.width ||
      finalLayout.height !== currentLayout.height;
    currentLayout = finalLayout;
    if (changed && !applyingSettings) {
      panelSettings.update({ layout: finalLayout });
    }
  };

  const refreshOutsideHandler = () => {
    if (outsidePointerHandler) {
      doc.removeEventListener('pointerdown', outsidePointerHandler);
      outsidePointerHandler = null;
    }
    if (!currentBehavior.collapseOnOutside) return;
    outsidePointerHandler = (event) => {
      if (!isModernActive()) return;
      if (isCollapsed()) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelEl && panelEl.contains(target)) return;
      if (fabEl && fabEl.contains(target)) return;
      if (modal?.isOpen?.()) return;
      clearFocusMemory();
      close('user');
    };
    doc.addEventListener('pointerdown', outsidePointerHandler);
  };

  const refreshFocusCollapseHandler = () => {
    if (focusCollapseHandler) {
      doc.removeEventListener('focusin', focusCollapseHandler, true);
      focusCollapseHandler = null;
    }
    if (!currentBehavior.collapseOnFocus) return;
    focusCollapseHandler = (event) => {
      if (!isModernActive() || isCollapsed()) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelEl && panelEl.contains(target)) return;
      if (fabEl && fabEl.contains(target)) return;
      if (modal?.isOpen?.()) return;
      close('focus');
    };
    doc.addEventListener('focusin', focusCollapseHandler, true);
  };

  const updateHandleAccessibility = () => {
    if (dragHandle) {
      dragHandle.disabled = !currentBehavior.allowDrag;
      dragHandle.setAttribute('aria-disabled', currentBehavior.allowDrag ? 'false' : 'true');
    }
    if (resizeHandle) {
      resizeHandle.style.display = currentBehavior.allowResize ? '' : 'none';
    }
  };

  const refreshBehavior = () => {
    if (!panelEl || !modernMode) return;
    refreshOutsideHandler();
    refreshFocusCollapseHandler();
    updateHandleAccessibility();
    if (!isCollapsed()) scheduleIdleClose();
  };

  const handleViewportResize = () => {
    if (!panelEl || !modernMode) return;
    if (resizeScheduled) return;
    resizeScheduled = true;
    requestAnimationFrame(() => {
      resizeScheduled = false;
      applyLayout();
    });
  };

  win.addEventListener('resize', handleViewportResize);

  const ensureFab = () => {
    if (!modernMode) return null;
    if (!fabEl || !fabEl.isConnected) {
      fabEl = /** @type {HTMLButtonElement | null} */ (doc.getElementById('gmh-fab'));
    }
    if (!fabEl || !fabEl.isConnected) {
      fabEl = /** @type {HTMLButtonElement} */ (doc.createElement('button'));
      fabEl.id = 'gmh-fab';
      fabEl.type = 'button';
      fabEl.textContent = 'GMH';
      fabEl.setAttribute('aria-label', 'Genit Memory Helper 토글');
      fabEl.setAttribute('aria-controls', 'genit-memory-helper-panel');
      doc.body.appendChild(fabEl);
    }
    fabEl.onclick = (event) => {
      const now = typeof performance?.now === 'function' ? performance.now() : Date.now();
      if (now - fabLastToggleAt < 350) return;

      event.preventDefault();
      fabLastToggleAt = now;
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

  const ensureEscapeHandler = () => {
    if (escapeKeyHandler) return;
    escapeKeyHandler = (event) => {
      if (!isModernActive()) return;
      if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey) return;
      if (modal?.isOpen?.()) return;
      if (isCollapsed()) return;
      close('user');
      event.preventDefault();
    };
    win.addEventListener('keydown', escapeKeyHandler);
  };

  const ensureStateSubscription = () => {
    if (stateUnsubscribe || typeof stateApi?.subscribe !== 'function') return;
    stateUnsubscribe = stateApi.subscribe((next) => {
      currentState = normalizeState(next) || stateEnum.IDLE;
      if (!modernMode) return;
      if (currentState !== stateEnum.IDLE) {
        if (!userCollapsed) open({ focus: false });
        clearIdleTimer();
      } else {
        userCollapsed = false;
        scheduleIdleClose();
      }
    });
  };

  const bindHandles = () => {
    if (!panelEl) return;
    const nextDragHandle = /** @type {HTMLButtonElement | null} */ (
      panelEl.querySelector('#gmh-panel-drag-handle')
    );
    if (dragHandle && dragHandle !== nextDragHandle)
      dragHandle.removeEventListener('pointerdown', handleDragStart);
    dragHandle = nextDragHandle;
    if (dragHandle) dragHandle.addEventListener('pointerdown', handleDragStart);

    const nextResizeHandle = /** @type {HTMLElement | null} */ (
      panelEl.querySelector('#gmh-panel-resize-handle')
    );
    if (resizeHandle && resizeHandle !== nextResizeHandle)
      resizeHandle.removeEventListener('pointerdown', handleResizeStart);
    resizeHandle = nextResizeHandle;
    if (resizeHandle) resizeHandle.addEventListener('pointerdown', handleResizeStart);

    updateHandleAccessibility();
  };

  const stopDragTracking = () => {
    if (!dragSession) return;
    win.removeEventListener('pointermove', handleDragMove);
    win.removeEventListener('pointerup', handleDragEnd);
    win.removeEventListener('pointercancel', handleDragCancel);
    if (dragHandle && dragSession.pointerId !== undefined) {
      try {
        dragHandle.releasePointerCapture(dragSession.pointerId);
      } catch (err) {
        /* noop */
      }
    }
    panelEl?.classList.remove('gmh-panel--dragging');
    dragSession = null;
  };

  /**
   * @param {PointerEvent} event
   * @returns {void}
   */
  const handleDragStart = (event) => {
    if (!panelEl || !modernMode) return;
    if (!currentBehavior.allowDrag) return;
    if (event.button && event.button !== 0) return;
    event.preventDefault();
    dragSession = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rect: panelEl.getBoundingClientRect(),
    };
    panelEl.classList.add('gmh-panel--dragging');
    clearIdleTimer();
    try {
      dragHandle?.setPointerCapture(event.pointerId);
    } catch (err) {
      /* noop */
    }
    win.addEventListener('pointermove', handleDragMove);
    win.addEventListener('pointerup', handleDragEnd);
    win.addEventListener('pointercancel', handleDragCancel);
  };

  /**
   * @param {PointerEvent} event
   * @returns {void}
   */
  const handleDragMove = (event) => {
    if (!dragSession || !panelEl) return;
    const dx = event.clientX - dragSession.startX;
    const dy = event.clientY - dragSession.startY;
    const rect = dragSession.rect;
    const viewportWidth = win.innerWidth || doc.documentElement.clientWidth || 1280;
    const viewportHeight = win.innerHeight || doc.documentElement.clientHeight || 720;

    let nextLeft = rect.left + dx;
    let nextTop = rect.top + dy;
    const maxLeft = viewportWidth - rect.width - MIN_GAP;
    const maxTop = viewportHeight - rect.height - MIN_GAP;
    nextLeft = Math.min(Math.max(MIN_GAP, nextLeft), Math.max(MIN_GAP, maxLeft));
    nextTop = Math.min(Math.max(MIN_GAP, nextTop), Math.max(MIN_GAP, maxTop));

    panelEl.style.left = `${Math.round(nextLeft)}px`;
    panelEl.style.top = `${Math.round(nextTop)}px`;
    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
  };

  /**
   * @returns {void}
   */
  const finalizeDragLayout = () => {
    if (!panelEl) return;
    const rect = panelEl.getBoundingClientRect();
    const viewportWidth = win.innerWidth || doc.documentElement.clientWidth || 1280;
    const viewportHeight = win.innerHeight || doc.documentElement.clientHeight || 720;
    const anchor = rect.left + rect.width / 2 <= viewportWidth / 2 ? 'left' : 'right';
    const offset =
      anchor === 'left'
        ? Math.round(Math.max(MIN_GAP, rect.left))
        : Math.round(Math.max(MIN_GAP, viewportWidth - rect.right));
    const bottom = Math.round(Math.max(MIN_GAP, viewportHeight - rect.bottom));
    panelSettings.update({ layout: { anchor, offset, bottom } });
  };

  /**
   * @returns {void}
   */
  const handleDragEnd = () => {
    if (!dragSession) return;
    stopDragTracking();
    finalizeDragLayout();
  };

  /**
   * @returns {void}
   */
  const handleDragCancel = () => {
    stopDragTracking();
    applyLayout();
  };

  /**
   * @returns {void}
   */
  const stopResizeTracking = () => {
    if (!resizeSession) return;
    win.removeEventListener('pointermove', handleResizeMove);
    win.removeEventListener('pointerup', handleResizeEnd);
    win.removeEventListener('pointercancel', handleResizeCancel);
    if (resizeHandle && resizeSession.pointerId !== undefined) {
      try {
        resizeHandle.releasePointerCapture(resizeSession.pointerId);
      } catch (err) {
        /* noop */
      }
    }
    panelEl?.classList.remove('gmh-panel--resizing');
    resizeSession = null;
  };

  /**
   * @param {PointerEvent} event
   * @returns {void}
   */
  const handleResizeStart = (event) => {
    if (!panelEl || !modernMode) return;
    if (!currentBehavior.allowResize) return;
    if (event.button && event.button !== 0) return;
    event.preventDefault();
    const rect = panelEl.getBoundingClientRect();
    resizeSession = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
      nextWidth: rect.width,
      nextHeight: rect.height,
    };
    panelEl.classList.add('gmh-panel--resizing');
    clearIdleTimer();
    try {
      resizeHandle?.setPointerCapture(event.pointerId);
    } catch (err) {
      /* noop */
    }
    win.addEventListener('pointermove', handleResizeMove);
    win.addEventListener('pointerup', handleResizeEnd);
    win.addEventListener('pointercancel', handleResizeCancel);
  };

  /**
   * @param {PointerEvent} event
   * @returns {void}
   */
  const handleResizeMove = (event) => {
    if (!resizeSession || !panelEl) return;
    const viewportWidth = win.innerWidth || doc.documentElement.clientWidth || 1280;
    const viewportHeight = win.innerHeight || doc.documentElement.clientHeight || 720;

    const dx = event.clientX - resizeSession.startX;
    const dy = event.clientY - resizeSession.startY;

    const horizontalRoom = Math.max(MIN_GAP, viewportWidth - currentLayout.offset - MIN_GAP);
    const verticalRoom = Math.max(MIN_GAP, viewportHeight - currentLayout.bottom - MIN_GAP);

    let nextWidth = resizeSession.width + dx;
    let nextHeight = resizeSession.height + dy;

    nextWidth = Math.min(Math.max(260, nextWidth), horizontalRoom);
    nextHeight = Math.min(Math.max(240, nextHeight), verticalRoom);

    resizeSession.nextWidth = Math.round(nextWidth);
    resizeSession.nextHeight = Math.round(nextHeight);

    panelEl.style.width = `${resizeSession.nextWidth}px`;
    panelEl.style.height = `${resizeSession.nextHeight}px`;
    panelEl.style.maxHeight = `${resizeSession.nextHeight}px`;
  };

  /**
   * @returns {void}
   */
  const handleResizeEnd = () => {
    if (!resizeSession) return;
    const { nextWidth, nextHeight } = resizeSession;
    stopResizeTracking();
    panelSettings.update({
      layout: {
        width: nextWidth,
        height: nextHeight,
      },
    });
  };

  /**
   * @returns {void}
   */
  const handleResizeCancel = () => {
    stopResizeTracking();
    applyLayout();
  };

  /**
   * @param {{ focus?: boolean; persist?: boolean }} [options]
   * @returns {boolean}
   */
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
    fabEl && fabEl.setAttribute('aria-expanded', 'true');
    if (persist) persistCollapsed(false);
    userCollapsed = false;
    applyLayout();
    refreshBehavior();
    if (focus) {
      rememberFocus();
      focusPanelElement();
    }
    if (currentState === stateEnum.IDLE) scheduleIdleClose();
    else clearIdleTimer();
    return wasCollapsed;
  };

  /**
   * @param {'user' | 'idle' | 'focus' | string} [reason='user']
   * @returns {boolean}
   */
  const close = (reason = 'user') => {
    if (!panelEl || !modernMode) return false;
    if (isCollapsed()) return false;
    applyRootState(true);
    syncAria(true);
    fabEl && fabEl.setAttribute('aria-expanded', 'false');
    clearIdleTimer();
    clearFocusSchedules();
    if (reason === 'user') {
      userCollapsed = true;
      persistCollapsed(true);
      if (lastFocusTarget) restoreFocus();
    }
    if (reason === 'idle') userCollapsed = false;
    if (reason !== 'user') clearFocusMemory();
    return true;
  };

  /**
   * @returns {boolean}
   */
  const toggle = () => {
    if (!panelEl || !modernMode) return false;
    if (isCollapsed()) {
      open({ focus: true, persist: true });
      return true;
    }
    close('user');
    return false;
  };

  /**
   * @param {Element | null} panel
   * @param {{ modern?: boolean }} [options]
   * @returns {void}
   */
  const bind = (panel, { modern } = {}) => {
    const panelElement = panel instanceof HTMLElement ? panel : null;
    if (panel && !panelElement) {
      if (logger?.warn) {
        logger.warn('[GMH] panel visibility: ignored non-HTMLElement panel');
      }
    }
    panelEl = panelElement;
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
    currentState = normalizeState(stateApi?.getState?.()) || stateEnum.IDLE;
    ensureFab();
    attachPanelListeners();
    ensureEscapeHandler();
    bindHandles();
    persistedPreference = loadPersistedCollapsed();
    const shouldCollapse = (() => {
      if (typeof persistedPreference === 'boolean') return persistedPreference;
      const mq = win.matchMedia?.('(max-width: 768px)');
      if (mq?.matches) return true;
      if (typeof win.innerWidth === 'number') return win.innerWidth <= 768;
      return false;
    })();
    if (!shouldCollapse) applyLayout();
    applyRootState(shouldCollapse);
    syncAria(shouldCollapse);
    userCollapsed = shouldCollapse;
    refreshBehavior();
    if (!shouldCollapse) scheduleIdleClose();
  };

  /**
   * @param {{ tone?: string | null }} [update]
   * @returns {void}
   */
  const onStatusUpdate = ({ tone } = {}) => {
    if (!isModernActive()) return;
    if (tone && ['error', 'warning', 'progress'].includes(tone) && isCollapsed()) {
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
}
