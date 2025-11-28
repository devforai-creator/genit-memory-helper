import type {
  PanelSettingsBehavior,
  PanelSettingsController,
  PanelSettingsLayout,
  PanelSettingsValue,
  PanelStateApi,
  PanelVisibilityController,
  PanelVisibilityOptions,
} from '../types';

type LayoutInput = Partial<PanelSettingsLayout> | null | undefined;
type BehaviorInput = Partial<PanelSettingsBehavior> | null | undefined;

interface DragSession {
  pointerId?: number;
  startX: number;
  startY: number;
  rect: DOMRect;
}

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null;

interface ResizeSession {
  pointerId?: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
  left: number;
  top: number;
  nextWidth: number;
  nextHeight: number;
  nextLeft: number;
  nextTop: number;
  edge: ResizeEdge;
}

const COLLAPSED_CLASS = 'gmh-collapsed';
const OPEN_CLASS = 'gmh-panel-open';
const STORAGE_KEY = 'gmh_panel_collapsed';
const MIN_GAP = 12;
const EDGE_THRESHOLD = 10; // px from edge to trigger resize

const EDGE_CURSORS: Record<string, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
};

const normalizeState = (
  value: unknown,
  stateEnum: Record<string, string> & { IDLE?: string },
): string | null => {
  if (!value) return null;
  const next = String(value).toLowerCase();
  return Object.values(stateEnum).includes(next) ? next : null;
};

export function createPanelVisibility({
  panelSettings: panelSettingsRaw,
  stateEnum,
  stateApi: stateApiRaw,
  modal,
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? (window as Window & typeof globalThis) : null,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  logger = typeof console !== 'undefined' ? console : null,
}: PanelVisibilityOptions): PanelVisibilityController {
  const panelSettings: PanelSettingsController | undefined = panelSettingsRaw;
  const stateApi: PanelStateApi | undefined = stateApiRaw;
  const doc = documentRef ?? null;
  const win = windowRef ?? null;
  if (!panelSettings || !stateEnum || !stateApi || !doc || !win) {
    throw new Error('createPanelVisibility missing required dependencies');
  }

  const DEFAULT_LAYOUT: PanelSettingsLayout = (() => {
    const layout = (panelSettings.defaults?.layout ?? {}) as LayoutInput;
    return {
      anchor: layout?.anchor === 'left' ? 'left' : 'right',
      offset:
        Number.isFinite(Number(layout?.offset)) && Number(layout?.offset) > 0
          ? Math.max(MIN_GAP, Math.round(Number(layout?.offset)))
          : 16,
      bottom:
        Number.isFinite(Number(layout?.bottom)) && Number(layout?.bottom) > 0
          ? Math.max(MIN_GAP, Math.round(Number(layout?.bottom)))
          : 16,
      width: Number.isFinite(Number(layout?.width)) ? Math.round(Number(layout?.width)) : null,
      height: Number.isFinite(Number(layout?.height)) ? Math.round(Number(layout?.height)) : null,
    };
  })();

  const DEFAULT_BEHAVIOR: PanelSettingsBehavior = (() => {
    const behavior = (panelSettings.defaults?.behavior ?? {}) as BehaviorInput;
    return {
      autoHideEnabled:
        typeof behavior?.autoHideEnabled === 'boolean' ? behavior.autoHideEnabled : true,
      autoHideDelayMs: Number.isFinite(Number(behavior?.autoHideDelayMs))
        ? Math.max(2000, Math.round(Number(behavior?.autoHideDelayMs)))
        : 10000,
      collapseOnOutside:
        typeof behavior?.collapseOnOutside === 'boolean' ? behavior.collapseOnOutside : true,
      collapseOnFocus:
        typeof behavior?.collapseOnFocus === 'boolean' ? behavior.collapseOnFocus : false,
      allowDrag: typeof behavior?.allowDrag === 'boolean' ? behavior.allowDrag : true,
      allowResize: typeof behavior?.allowResize === 'boolean' ? behavior.allowResize : true,
    };
  })();

  const coerceLayout = (input: LayoutInput = {}): PanelSettingsLayout => {
    const layout = { ...DEFAULT_LAYOUT, ...(input ?? {}) } as PanelSettingsLayout;
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

  const coerceBehavior = (input: BehaviorInput = {}): PanelSettingsBehavior => {
    const behavior = { ...DEFAULT_BEHAVIOR, ...(input ?? {}) } as PanelSettingsBehavior;
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

  let panelEl: HTMLElement | null = null;
  let fabEl: HTMLButtonElement | null = null;
  let fabLastToggleAt = 0;
  let dragHandle: HTMLButtonElement | null = null;
  let modernMode = false;
  let idleTimer: number | null = null;
  let stateUnsubscribe: (() => void) | null = null;
  let outsidePointerHandler: ((event: PointerEvent) => void) | null = null;
  let focusCollapseHandler: ((event: FocusEvent) => void) | null = null;
  let escapeKeyHandler: ((event: KeyboardEvent) => void) | null = null;
  let panelListenersBound = false;
  let resizeScheduled = false;
  let currentState = stateEnum.IDLE || '';
  let userCollapsed = false;
  let persistedPreference: boolean | null = null;
  let lastFocusTarget: HTMLElement | null = null;
  let dragSession: DragSession | null = null;
  let resizeSession: ResizeSession | null = null;
  let currentEdge: ResizeEdge = null;
  let panelEdgeHandler: ((event: PointerEvent) => void) | null = null;
  let panelEdgeDownHandler: ((event: PointerEvent) => void) | null = null;
  let applyingSettings = false;
  let focusTimeouts: number[] = [];
  let focusAnimationFrame: number | null = null;

  let currentSettings: PanelSettingsValue = panelSettings.get();
  let currentLayout = coerceLayout(currentSettings.layout as LayoutInput);
  let currentBehavior = coerceBehavior(currentSettings.behavior as BehaviorInput);

  panelSettings.onChange((next: PanelSettingsValue) => {
    currentSettings = next;
    currentLayout = coerceLayout(next.layout as LayoutInput);
    currentBehavior = coerceBehavior(next.behavior as BehaviorInput);
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

  const getRoot = (): HTMLElement => doc.documentElement;
  const isModernActive = (): boolean => modernMode && !!panelEl;

  const isCollapsed = (): boolean => {
    if (!isModernActive()) return false;
    return getRoot().classList.contains(COLLAPSED_CLASS);
  };

  const loadPersistedCollapsed = (): boolean | null => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw === '1') return true;
      if (raw === '0') return false;
    } catch (err) {
      logger?.warn?.('[GMH] failed to read panel state', err);
    }
    return null;
  };

  const persistCollapsed = (value: boolean | null): void => {
    if (!storage) return;
    persistedPreference = value;
    try {
      if (value === null) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch (err) {
      logger?.warn?.('[GMH] failed to persist panel state', err);
    }
  };

  const rememberFocus = (): void => {
    const active = doc.activeElement;
    if (!active || active === doc.body) return;
    if (!(active instanceof HTMLElement)) return;
    if (panelEl && panelEl.contains(active)) return;
    lastFocusTarget = active;
  };

  const clearFocusSchedules = (): void => {
    if (focusAnimationFrame) {
      cancelAnimationFrame(focusAnimationFrame);
      focusAnimationFrame = null;
    }
    if (focusTimeouts.length) {
      focusTimeouts.forEach((id) => win.clearTimeout(id));
      focusTimeouts = [];
    }
  };

  const clearFocusMemory = (): void => {
    lastFocusTarget = null;
  };

  const restoreFocus = (): void => {
    const target = lastFocusTarget;
    if (!target) return;
    lastFocusTarget = null;
    requestAnimationFrame(() => {
      try {
        target.focus({ preventScroll: true });
      } catch (err) {
        logger?.warn?.('[GMH] focus restore failed', err);
      }
    });
  };

  const focusPanelElement = (): void => {
    const panelElement = panelEl;
    if (!panelElement || typeof panelElement.focus !== 'function') return;
    const attempt = () => {
      try {
        panelElement.focus({ preventScroll: true });
      } catch {
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

  const clearIdleTimer = (): void => {
    if (idleTimer) {
      win.clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const getAutoHideDelay = (): number | null => {
    if (!currentBehavior.autoHideEnabled) return null;
    return currentBehavior.autoHideDelayMs || 10000;
  };

  const applyRootState = (collapsed: boolean): void => {
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

  const syncAria = (collapsed: boolean): void => {
    if (!panelEl) return;
    panelEl.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    if (fabEl) fabEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  };

  const scheduleIdleClose = (): void => {
    if (!isModernActive()) return;
    clearIdleTimer();
    if (isCollapsed()) return;
    if (currentState !== (stateEnum.IDLE || '')) return;
    const delay = getAutoHideDelay();
    if (!delay) return;
    idleTimer = win.setTimeout(() => {
      if (!isModernActive()) return;
      if (currentState !== (stateEnum.IDLE || '')) return;
      close('idle');
    }, delay);
  };

  const resetIdleTimer = (): void => {
    if (!isModernActive()) return;
    if (isCollapsed()) return;
    scheduleIdleClose();
  };

  const applyLayout = (): void => {
    if (!panelEl) return;
    const layout = coerceLayout(currentLayout);
    const viewportWidth = win.innerWidth || doc.documentElement.clientWidth || 1280;
    const viewportHeight = win.innerHeight || doc.documentElement.clientHeight || 720;

    const maxWidth = Math.max(MIN_GAP, viewportWidth - MIN_GAP * 2);
    const maxHeight = Math.max(MIN_GAP, viewportHeight - MIN_GAP * 2);

    const width = layout.width ? Math.min(Math.max(260, layout.width), maxWidth) : null;
    const height = layout.height ? Math.min(Math.max(240, layout.height), maxHeight) : null;

    panelEl.style.width = width ? `${width}px` : '';
    if (height) {
      panelEl.style.height = `${height}px`;
      panelEl.style.maxHeight = `${height}px`;
    } else {
      panelEl.style.height = '';
      panelEl.style.maxHeight = '70vh';
    }

    const rect = panelEl.getBoundingClientRect();
    const effectiveHeight = height || rect.height || 320;

    const bottomLimit = Math.max(MIN_GAP, viewportHeight - effectiveHeight - MIN_GAP);
    const resolvedBottom = layout.bottom ?? DEFAULT_LAYOUT.bottom ?? MIN_GAP;
    const bottom = Math.min(Math.max(MIN_GAP, resolvedBottom), bottomLimit);

    const horizontalLimit = Math.max(MIN_GAP, viewportWidth - MIN_GAP - 160);
    const resolvedOffset = layout.offset ?? DEFAULT_LAYOUT.offset ?? MIN_GAP;
    const offset = Math.min(Math.max(MIN_GAP, resolvedOffset), horizontalLimit);

    if (layout.anchor === 'left') {
      panelEl.style.left = `${offset}px`;
      panelEl.style.right = 'auto';
    } else {
      panelEl.style.left = 'auto';
      panelEl.style.right = `${offset}px`;
    }
    panelEl.style.bottom = `${bottom}px`;
    panelEl.style.top = 'auto';

    const finalLayout: PanelSettingsLayout = { ...layout, offset, bottom, width, height };
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

  const refreshOutsideHandler = (): void => {
    if (outsidePointerHandler) {
      doc.removeEventListener('pointerdown', outsidePointerHandler);
      outsidePointerHandler = null;
    }
    if (!currentBehavior.collapseOnOutside) return;
    outsidePointerHandler = (event: PointerEvent) => {
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

  const refreshFocusCollapseHandler = (): void => {
    if (focusCollapseHandler) {
      doc.removeEventListener('focusin', focusCollapseHandler, true);
      focusCollapseHandler = null;
    }
    if (!currentBehavior.collapseOnFocus) return;
    focusCollapseHandler = (event: FocusEvent) => {
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

  const updateHandleAccessibility = (): void => {
    if (dragHandle) {
      dragHandle.disabled = !currentBehavior.allowDrag;
      dragHandle.setAttribute('aria-disabled', currentBehavior.allowDrag ? 'false' : 'true');
    }
  };

  const refreshBehavior = (): void => {
    if (!panelEl || !modernMode) return;
    refreshOutsideHandler();
    refreshFocusCollapseHandler();
    updateHandleAccessibility();
    if (!isCollapsed()) scheduleIdleClose();
  };

  const handleViewportResize = (): void => {
    if (!panelEl || !modernMode) return;
    if (resizeScheduled) return;
    resizeScheduled = true;
    requestAnimationFrame(() => {
      resizeScheduled = false;
      applyLayout();
    });
  };

  win.addEventListener('resize', handleViewportResize);

  const ensureFab = (): HTMLButtonElement | null => {
    if (!modernMode) return null;
    if (!fabEl || !fabEl.isConnected) {
      fabEl = doc.getElementById('gmh-fab') as HTMLButtonElement | null;
    }
    if (!fabEl || !fabEl.isConnected) {
      fabEl = doc.createElement('button');
      fabEl.id = 'gmh-fab';
      fabEl.type = 'button';
      fabEl.textContent = 'GMH';
      fabEl.setAttribute('aria-label', 'Genit Memory Helper 토글');
      fabEl.setAttribute('aria-controls', 'genit-memory-helper-panel');
      doc.body.appendChild(fabEl);
    }
    fabEl.onclick = (event: MouseEvent) => {
      const now = typeof performance?.now === 'function' ? performance.now() : Date.now();
      if (now - fabLastToggleAt < 350) return;

      event.preventDefault();
      fabLastToggleAt = now;
      toggle();
    };
    fabEl.setAttribute('aria-expanded', isCollapsed() ? 'false' : 'true');
    return fabEl;
  };

  const attachPanelListeners = (): void => {
    if (!isModernActive() || panelListenersBound || !panelEl) return;
    const passiveReset = () => resetIdleTimer();
    panelEl.addEventListener('pointerdown', passiveReset, { passive: true });
    panelEl.addEventListener('pointermove', passiveReset, { passive: true });
    panelEl.addEventListener('wheel', passiveReset, { passive: true });
    panelEl.addEventListener('touchstart', passiveReset, { passive: true });
    panelEl.addEventListener('keydown', resetIdleTimer);
    panelEl.addEventListener('focusin', resetIdleTimer);
    panelListenersBound = true;
  };

  const ensureEscapeHandler = (): void => {
    if (escapeKeyHandler) return;
    escapeKeyHandler = (event: KeyboardEvent) => {
      if (!isModernActive()) return;
      if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey) return;
      if (modal?.isOpen?.()) return;
      if (isCollapsed()) return;
      close('user');
      event.preventDefault();
    };
    win.addEventListener('keydown', escapeKeyHandler);
  };

  const ensureStateSubscription = (): void => {
    if (stateUnsubscribe || typeof stateApi?.subscribe !== 'function') return;
    stateUnsubscribe = stateApi.subscribe((next) => {
      currentState = normalizeState(next, stateEnum) || stateEnum.IDLE || '';
      if (!modernMode) return;
      if (currentState !== (stateEnum.IDLE || '')) {
        if (!userCollapsed) open({ focus: false });
        clearIdleTimer();
      } else {
        userCollapsed = false;
        scheduleIdleClose();
      }
    });
  };

  const detectEdge = (event: PointerEvent): ResizeEdge => {
    if (!panelEl) return null;
    const rect = panelEl.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;

    const nearLeft = x >= rect.left && x <= rect.left + EDGE_THRESHOLD;
    const nearRight = x >= rect.right - EDGE_THRESHOLD && x <= rect.right;
    const nearTop = y >= rect.top && y <= rect.top + EDGE_THRESHOLD;
    const nearBottom = y >= rect.bottom - EDGE_THRESHOLD && y <= rect.bottom;

    if (nearTop && nearLeft) return 'nw';
    if (nearTop && nearRight) return 'ne';
    if (nearBottom && nearLeft) return 'sw';
    if (nearBottom && nearRight) return 'se';
    if (nearTop) return 'n';
    if (nearBottom) return 's';
    if (nearLeft) return 'w';
    if (nearRight) return 'e';
    return null;
  };

  const updateEdgeCursor = (edge: ResizeEdge): void => {
    if (!panelEl) return;
    if (edge && currentBehavior.allowResize) {
      panelEl.style.cursor = EDGE_CURSORS[edge] || '';
    } else {
      panelEl.style.cursor = '';
    }
  };

  const handlePanelEdgeMove = (event: PointerEvent): void => {
    if (!panelEl || !modernMode || resizeSession || dragSession) return;
    if (!currentBehavior.allowResize) return;
    const edge = detectEdge(event);
    if (edge !== currentEdge) {
      currentEdge = edge;
      updateEdgeCursor(edge);
    }
  };

  const handlePanelEdgeDown = (event: PointerEvent): void => {
    if (!panelEl || !modernMode) return;
    if (!currentBehavior.allowResize) return;
    if (event.button && event.button !== 0) return;

    const edge = detectEdge(event);
    if (!edge) return;

    // Don't start resize if clicking on interactive elements
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.closest('button, input, select, textarea, a, [role="button"]')) return;
      if (target.closest('#gmh-panel-drag-handle')) return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = panelEl.getBoundingClientRect();
    resizeSession = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
      nextWidth: rect.width,
      nextHeight: rect.height,
      nextLeft: rect.left,
      nextTop: rect.top,
      edge,
    };
    panelEl.classList.add('gmh-panel--resizing');
    clearIdleTimer();

    try {
      panelEl.setPointerCapture(event.pointerId);
    } catch {
      /* noop */
    }

    win.addEventListener('pointermove', handleEdgeResizeMove);
    win.addEventListener('pointerup', handleEdgeResizeEnd);
    win.addEventListener('pointercancel', handleEdgeResizeCancel);
  };

  const handleEdgeResizeMove = (event: PointerEvent): void => {
    if (!resizeSession || !panelEl) return;
    const { edge, startX, startY, width, height, left, top } = resizeSession;
    if (!edge) return;

    const viewportWidth = win.innerWidth || doc.documentElement.clientWidth || 1280;
    const viewportHeight = win.innerHeight || doc.documentElement.clientHeight || 720;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    let nextWidth = width;
    let nextHeight = height;
    let nextLeft = left;
    let nextTop = top;

    // Handle horizontal resizing
    if (edge.includes('e')) {
      nextWidth = Math.max(260, Math.min(width + dx, viewportWidth - left - MIN_GAP));
    }
    if (edge.includes('w')) {
      const newWidth = Math.max(260, width - dx);
      const maxDx = width - 260;
      const actualDx = Math.min(dx, maxDx);
      nextWidth = width - actualDx;
      nextLeft = Math.max(MIN_GAP, left + actualDx);
    }

    // Handle vertical resizing
    if (edge.includes('s')) {
      nextHeight = Math.max(240, Math.min(height + dy, viewportHeight - top - MIN_GAP));
    }
    if (edge.includes('n')) {
      const newHeight = Math.max(240, height - dy);
      const maxDy = height - 240;
      const actualDy = Math.min(dy, maxDy);
      nextHeight = height - actualDy;
      nextTop = Math.max(MIN_GAP, top + actualDy);
    }

    resizeSession.nextWidth = Math.round(nextWidth);
    resizeSession.nextHeight = Math.round(nextHeight);
    resizeSession.nextLeft = Math.round(nextLeft);
    resizeSession.nextTop = Math.round(nextTop);

    panelEl.style.width = `${resizeSession.nextWidth}px`;
    panelEl.style.height = `${resizeSession.nextHeight}px`;
    panelEl.style.maxHeight = `${resizeSession.nextHeight}px`;
    panelEl.style.left = `${resizeSession.nextLeft}px`;
    panelEl.style.top = `${resizeSession.nextTop}px`;
    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
  };

  const stopEdgeResizeTracking = (): void => {
    if (!resizeSession) return;
    win.removeEventListener('pointermove', handleEdgeResizeMove);
    win.removeEventListener('pointerup', handleEdgeResizeEnd);
    win.removeEventListener('pointercancel', handleEdgeResizeCancel);
    if (panelEl && resizeSession.pointerId !== undefined) {
      try {
        panelEl.releasePointerCapture(resizeSession.pointerId);
      } catch {
        /* noop */
      }
    }
    panelEl?.classList.remove('gmh-panel--resizing');
    currentEdge = null;
    updateEdgeCursor(null);
    resizeSession = null;
  };

  const finalizeEdgeResizeLayout = (): void => {
    if (!panelEl || !resizeSession) return;
    const { nextWidth, nextHeight, nextLeft, nextTop } = resizeSession;
    const viewportWidth = win.innerWidth || doc.documentElement.clientWidth || 1280;
    const viewportHeight = win.innerHeight || doc.documentElement.clientHeight || 720;

    // Determine anchor based on panel center position
    const panelCenterX = nextLeft + nextWidth / 2;
    const anchor = panelCenterX <= viewportWidth / 2 ? 'left' : 'right';
    const offset = anchor === 'left' ? nextLeft : viewportWidth - nextLeft - nextWidth;
    const bottom = viewportHeight - nextTop - nextHeight;

    panelSettings.update({
      layout: {
        anchor,
        offset: Math.max(MIN_GAP, Math.round(offset)),
        bottom: Math.max(MIN_GAP, Math.round(bottom)),
        width: nextWidth,
        height: nextHeight,
      },
    });
  };

  const handleEdgeResizeEnd = (): void => {
    if (!resizeSession) return;
    finalizeEdgeResizeLayout();
    stopEdgeResizeTracking();
  };

  const handleEdgeResizeCancel = (): void => {
    stopEdgeResizeTracking();
    applyLayout();
  };

  const bindEdgeHandlers = (): void => {
    if (!panelEl) return;

    // Remove old handlers if they exist
    if (panelEdgeHandler) {
      panelEl.removeEventListener('pointermove', panelEdgeHandler);
    }
    if (panelEdgeDownHandler) {
      panelEl.removeEventListener('pointerdown', panelEdgeDownHandler);
    }

    panelEdgeHandler = handlePanelEdgeMove;
    panelEdgeDownHandler = handlePanelEdgeDown;

    panelEl.addEventListener('pointermove', panelEdgeHandler);
    panelEl.addEventListener('pointerdown', panelEdgeDownHandler);
  };

  const bindHandles = (): void => {
    if (!panelEl) return;
    const nextDragHandle = panelEl.querySelector('#gmh-panel-drag-handle') as HTMLButtonElement | null;
    if (dragHandle && dragHandle !== nextDragHandle) {
      dragHandle.removeEventListener('pointerdown', handleDragStart);
    }
    dragHandle = nextDragHandle;
    if (dragHandle) dragHandle.addEventListener('pointerdown', handleDragStart);

    // Bind edge resize handlers
    bindEdgeHandlers();

    updateHandleAccessibility();
  };

  const stopDragTracking = (): void => {
    if (!dragSession) return;
    win.removeEventListener('pointermove', handleDragMove);
    win.removeEventListener('pointerup', handleDragEnd);
    win.removeEventListener('pointercancel', handleDragCancel);
    if (dragHandle && dragSession.pointerId !== undefined) {
      try {
        dragHandle.releasePointerCapture(dragSession.pointerId);
      } catch {
        /* noop */
      }
    }
    panelEl?.classList.remove('gmh-panel--dragging');
    dragSession = null;
  };

  const handleDragStart = (event: PointerEvent): void => {
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
    } catch {
      /* noop */
    }
    win.addEventListener('pointermove', handleDragMove);
    win.addEventListener('pointerup', handleDragEnd);
    win.addEventListener('pointercancel', handleDragCancel);
  };

  const handleDragMove = (event: PointerEvent): void => {
    if (!dragSession || !panelEl) return;
    const dx = event.clientX - dragSession.startX;
    const dy = event.clientY - dragSession.startY;
    const { rect } = dragSession;
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

  const finalizeDragLayout = (): void => {
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

  const handleDragEnd = (): void => {
    if (!dragSession) return;
    stopDragTracking();
    finalizeDragLayout();
  };

  const handleDragCancel = (): void => {
    stopDragTracking();
    applyLayout();
  };

  const open = ({ focus = false, persist = false } = {}): boolean => {
    if (!panelEl) return false;
    const targetPanel = panelEl;
    if (!modernMode) {
      if (focus && typeof targetPanel.focus === 'function') {
        requestAnimationFrame(() => targetPanel.focus({ preventScroll: true }));
      }
      return true;
    }
    const wasCollapsed = isCollapsed();
    applyRootState(false);
    syncAria(false);
    if (fabEl) fabEl.setAttribute('aria-expanded', 'true');
    if (persist) persistCollapsed(false);
    userCollapsed = false;
    applyLayout();
    refreshBehavior();
    if (focus) {
      rememberFocus();
      focusPanelElement();
    }
    if (currentState === (stateEnum.IDLE || '')) scheduleIdleClose();
    else clearIdleTimer();
    return wasCollapsed;
  };

  const close = (reason: string = 'user'): boolean => {
    if (!panelEl || !modernMode) return false;
    if (isCollapsed()) return false;
    applyRootState(true);
    syncAria(true);
    if (fabEl) fabEl.setAttribute('aria-expanded', 'false');
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

  const toggle = (): boolean => {
    if (!panelEl || !modernMode) return false;
    if (isCollapsed()) {
      open({ focus: true, persist: true });
      return true;
    }
    close('user');
    return false;
  };

  const bind = (panel: Element | null): void => {
    const panelElement = panel instanceof HTMLElement ? panel : null;
    if (panel && !panelElement) {
      if (logger?.warn) {
        logger.warn('[GMH] panel visibility: ignored non-HTMLElement panel');
      }
    }
    panelEl = panelElement;
    panelListenersBound = false;
    modernMode = !!panelEl;
    if (!panelEl) {
      if (fabEl && fabEl.isConnected) {
        fabEl.remove();
        fabEl = null;
      }
      applyRootState(false);
      syncAria(false);
      return;
    }
    ensureStateSubscription();
    currentState = normalizeState(stateApi?.getState?.(), stateEnum) || stateEnum.IDLE || '';
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

  const onStatusUpdate = ({ tone }: { tone?: string | null } = {}): void => {
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
