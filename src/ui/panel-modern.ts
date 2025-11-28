import type { GenitAdapter } from '../types';

interface StateViewBindings {
  progressFill?: HTMLElement | null;
  progressLabel?: HTMLElement | null;
}

interface StateViewApi {
  bind(bindings?: StateViewBindings): void;
}

interface ModernPanelOptions {
  documentRef?: Document | null;
  ensureStyles: () => void;
  version?: string;
  getActiveAdapter: () => GenitAdapter | null | undefined;
  attachStatusElement: (element: HTMLElement | null) => void;
  stateView: StateViewApi;
  bindPanelInteractions: (panel: Element, options?: { modern?: boolean }) => void;
  panelId?: string;
  logger?: Console | { warn?: (...args: unknown[]) => void } | null;
}

export function createModernPanel({
  documentRef = typeof document !== 'undefined' ? document : null,
  ensureStyles,
  version = '0.0.0-dev',
  getActiveAdapter,
  attachStatusElement,
  stateView,
  bindPanelInteractions,
  panelId = 'genit-memory-helper-panel',
  logger = typeof console !== 'undefined' ? console : null,
}: ModernPanelOptions): { mount: () => Element | null } {
  const doc = documentRef;
  if (!doc) throw new Error('createModernPanel requires documentRef');
  if (typeof ensureStyles !== 'function') throw new Error('createModernPanel requires ensureStyles');
  if (typeof getActiveAdapter !== 'function') throw new Error('createModernPanel requires getActiveAdapter');
  if (!stateView || typeof stateView.bind !== 'function') {
    throw new Error('createModernPanel requires stateView with bind');
  }
  if (typeof bindPanelInteractions !== 'function') {
    throw new Error('createModernPanel requires bindPanelInteractions');
  }

  const log = logger || { warn: () => {} };

  const mount = (): Element | null => {
    ensureStyles();
    const existing = doc.querySelector(`#${panelId}`);
    if (existing) return existing;

    const panel = doc.createElement('div');
    panel.id = panelId;
    panel.className = 'gmh-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'General Memory Helper');
    panel.tabIndex = -1;
    panel.dataset.version = version;
    panel.innerHTML = `
      <div class="gmh-panel__header">
        <button
          id="gmh-panel-drag-handle"
          class="gmh-panel__drag-handle"
          type="button"
          aria-label="패널 이동"
          title="패널 끌어서 이동"
        >
          <span class="gmh-panel__drag-icon" aria-hidden="true">⋮⋮</span>
        </button>
        <div class="gmh-panel__headline">
          <div class="gmh-panel__title">General Memory Helper</div>
          <div class="gmh-panel__tag">v${version}</div>
        </div>
        <button id="gmh-panel-settings" class="gmh-small-btn gmh-small-btn--muted" title="설정">⚙</button>
      </div>
      <div class="gmh-progress">
        <div class="gmh-progress__track">
          <div id="gmh-progress-fill" class="gmh-progress__fill" data-indeterminate="false"></div>
        </div>
        <div id="gmh-progress-label" class="gmh-progress__label">대기 중</div>
      </div>
      <div id="gmh-status" class="gmh-status-line"></div>
      <section class="gmh-panel__section" id="gmh-section-privacy">
        <div class="gmh-panel__section-title">Privacy</div>
        <div class="gmh-field-row">
          <select id="gmh-privacy-profile" class="gmh-select">
            <option value="safe">SAFE (권장)</option>
            <option value="standard">STANDARD</option>
            <option value="research">RESEARCH</option>
          </select>
          <button id="gmh-privacy-config" class="gmh-small-btn gmh-small-btn--accent">민감어</button>
        </div>
      </section>
      <section class="gmh-panel__section" id="gmh-section-autoload">
        <div class="gmh-panel__section-title">Auto Load</div>
        <div id="gmh-autoload-controls"></div>
      </section>
      <section class="gmh-panel__section" id="gmh-section-export">
        <div class="gmh-panel__section-title">Export</div>
        <div class="gmh-field-row gmh-field-row--wrap">
          <label for="gmh-range-start" class="gmh-field-label">메시지 범위</label>
          <div class="gmh-range-controls">
            <input
              id="gmh-range-start"
              class="gmh-input gmh-input--compact"
              type="number"
              min="1"
              inputmode="numeric"
              pattern="[0-9]*"
              placeholder="시작 메시지"
            />
            <span class="gmh-range-sep" aria-hidden="true">~</span>
            <input
              id="gmh-range-end"
              class="gmh-input gmh-input--compact"
              type="number"
              min="1"
              inputmode="numeric"
              pattern="[0-9]*"
              placeholder="끝 메시지"
            />
            <div class="gmh-bookmark-controls">
              <button id="gmh-range-mark-start" type="button" class="gmh-small-btn gmh-small-btn--muted" title="현재 메시지를 시작으로 지정">시작지정</button>
              <button id="gmh-range-mark-end" type="button" class="gmh-small-btn gmh-small-btn--muted" title="현재 메시지를 끝으로 지정">끝지정</button>
            </div>
            <button id="gmh-range-clear" type="button" class="gmh-small-btn gmh-small-btn--muted">전체</button>
          </div>
        </div>
        <div class="gmh-field-row gmh-field-row--wrap">
          <label for="gmh-range-bookmark-select" class="gmh-field-label">최근 북마크</label>
          <div class="gmh-bookmark-select">
            <select id="gmh-range-bookmark-select" class="gmh-select gmh-select--compact">
              <option value="">최근 클릭한 메시지가 없습니다</option>
            </select>
          </div>
        </div>
        <div id="gmh-range-summary" class="gmh-helper-text">범위 전체 내보내기</div>
        <div class="gmh-field-row">
          <select id="gmh-export-format" class="gmh-select">
            <option value="structured-md" selected>Rich Markdown (.md) — 추천</option>
            <option value="structured-json">Rich JSON (.json)</option>
            <option value="structured-txt">Rich TXT (.txt)</option>
            <optgroup label="Classic (경량/호환)">
              <option value="json">Classic JSON (.json)</option>
              <option value="md">Classic Markdown (.md)</option>
              <option value="txt">Classic TXT (.txt)</option>
            </optgroup>
          </select>
          <button id="gmh-export" class="gmh-small-btn gmh-small-btn--accent">내보내기</button>
        </div>
        <button id="gmh-quick-export" class="gmh-panel-btn gmh-panel-btn--accent">원클릭 내보내기</button>
        <button id="gmh-export-html" class="gmh-panel-btn gmh-panel-btn--neutral" title="실험적 기능: 현재 화면에 보이는 메시지만 백업됩니다">🧪 HTML 백업 (실험적)</button>
      </section>
      <section class="gmh-panel__section" id="gmh-section-guides">
        <div class="gmh-panel__section-title">Guides & Tools</div>
        <div class="gmh-field-row">
          <button id="gmh-reparse" class="gmh-small-btn gmh-small-btn--muted">재파싱</button>
          <button id="gmh-guide" class="gmh-small-btn gmh-small-btn--muted">요약 가이드</button>
          <button id="gmh-reguide" class="gmh-small-btn gmh-small-btn--muted">재요약 가이드</button>
        </div>
        <div id="gmh-status-actions"></div>
      </section>
    `;

    const adapter = getActiveAdapter();
    const anchor = adapter?.getPanelAnchor?.(doc) || doc.body;
    if (!anchor) {
      log?.warn?.('[GMH] modern panel anchor missing');
      return null;
    }
    anchor.appendChild(panel);

    const statusEl = panel.querySelector<HTMLElement>('#gmh-status');
    attachStatusElement(statusEl ?? null);
    if (statusEl) {
      statusEl.setAttribute('role', 'status');
      statusEl.setAttribute('aria-live', 'polite');
    }

    const progressFill = panel.querySelector<HTMLElement>('#gmh-progress-fill');
    const progressLabel = panel.querySelector<HTMLElement>('#gmh-progress-label');
    stateView.bind({ progressFill, progressLabel });

    try {
      bindPanelInteractions(panel, { modern: true });
    } catch (error) {
      log?.warn?.('[GMH] panel interactions init failed', error);
    }

    return panel;
  };

  return { mount };
}

export default createModernPanel;
