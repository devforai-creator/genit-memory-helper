/**
 * Memory Panel - Dual Memory UI 컴포넌트
 *
 * 청크 목록을 표시하고 요약/Facts 프롬프트 복사 기능을 제공합니다.
 */

import type { MemoryChunk, ChunkerResult } from '../features/memory-chunker';
import {
  buildSummaryPrompt,
  buildFactsPrompt,
  formatChunkRange,
  getChunkPreview,
} from '../features/memory-prompts';

/** Memory Panel 옵션 */
export interface MemoryPanelOptions {
  /** document 참조 */
  documentRef?: Document | null;
  /** 클립보드 복사 함수 */
  copyToClipboard?: (text: string) => Promise<void>;
  /** 상태 메시지 표시 함수 */
  showStatus?: (message: string, tone?: 'info' | 'success' | 'error') => void;
  /** 로거 */
  logger?: Console | { warn?: (...args: unknown[]) => void; log?: (...args: unknown[]) => void } | null;
}

/** Memory Panel 컨트롤러 */
export interface MemoryPanelController {
  /** 패널 DOM 요소 반환 */
  getElement(): HTMLElement;
  /** 청크 데이터 업데이트 */
  setChunks(result: ChunkerResult): void;
  /** 청크 데이터 초기화 */
  clear(): void;
  /** 로딩 상태 설정 */
  setLoading(loading: boolean): void;
}

/**
 * Memory Panel 생성
 */
export function createMemoryPanel(options: MemoryPanelOptions = {}): MemoryPanelController {
  const {
    documentRef = typeof document !== 'undefined' ? document : null,
    copyToClipboard,
    showStatus,
    logger = typeof console !== 'undefined' ? console : null,
  } = options;

  if (!documentRef) {
    throw new Error('createMemoryPanel requires documentRef');
  }

  const doc = documentRef;
  let currentChunks: MemoryChunk[] = [];
  let isLoading = false;

  // 패널 요소 생성
  const section = doc.createElement('section');
  section.className = 'gmh-panel__section';
  section.id = 'gmh-section-memory';
  section.innerHTML = `
    <div class="gmh-panel__section-title">Memory</div>
    <div id="gmh-memory-content">
      <div class="gmh-memory-empty">
        <p>메시지를 수집한 후 "GMH에 담기" 버튼을 눌러주세요.</p>
      </div>
    </div>
    <div class="gmh-field-row">
      <button id="gmh-memory-load" class="gmh-panel-btn gmh-panel-btn--accent" type="button">
        GMH에 담기
      </button>
    </div>
  `;

  const contentEl = section.querySelector<HTMLElement>('#gmh-memory-content');
  const loadBtn = section.querySelector<HTMLButtonElement>('#gmh-memory-load');

  /**
   * 빈 상태 렌더링
   */
  const renderEmpty = (): void => {
    if (!contentEl) return;
    contentEl.innerHTML = `
      <div class="gmh-memory-empty">
        <p>메시지를 수집한 후 "GMH에 담기" 버튼을 눌러주세요.</p>
      </div>
    `;
  };

  /**
   * 로딩 상태 렌더링
   */
  const renderLoading = (): void => {
    if (!contentEl) return;
    contentEl.innerHTML = `
      <div class="gmh-memory-loading">
        <p>청크 생성 중...</p>
      </div>
    `;
  };

  /**
   * 청크 아이템 HTML 생성
   */
  const renderChunkItem = (chunk: MemoryChunk): string => {
    const range = formatChunkRange(chunk);
    const preview = getChunkPreview(chunk, 80);
    const messageCount = chunk.messages.length;

    return `
      <div class="gmh-memory-chunk" data-chunk-id="${chunk.id}">
        <div class="gmh-memory-chunk__header">
          <span class="gmh-memory-chunk__range">${range}</span>
          <span class="gmh-memory-chunk__count">${messageCount}개</span>
          <button class="gmh-memory-chunk__toggle" type="button" aria-expanded="false">
            펼치기 ▼
          </button>
        </div>
        <div class="gmh-memory-chunk__preview">${escapeHtml(preview)}</div>
        <div class="gmh-memory-chunk__actions">
          <button class="gmh-small-btn gmh-small-btn--accent gmh-copy-summary" type="button" title="요약 프롬프트 복사">
            📋 요약
          </button>
          <button class="gmh-small-btn gmh-small-btn--accent gmh-copy-facts" type="button" title="Facts 프롬프트 복사">
            📋 Facts
          </button>
        </div>
        <div class="gmh-memory-chunk__detail" hidden>
          <pre class="gmh-memory-chunk__raw">${escapeHtml(chunk.raw)}</pre>
        </div>
      </div>
    `;
  };

  /**
   * 청크 목록 렌더링
   */
  const renderChunks = (): void => {
    if (!contentEl) return;

    if (currentChunks.length === 0) {
      renderEmpty();
      return;
    }

    const chunksHtml = currentChunks.map(renderChunkItem).join('');
    contentEl.innerHTML = `
      <div class="gmh-memory-stats">
        총 ${currentChunks.length}개 청크 생성됨
      </div>
      <div class="gmh-memory-chunks">
        ${chunksHtml}
      </div>
    `;

    // 이벤트 바인딩
    bindChunkEvents();
  };

  /**
   * HTML 이스케이프
   */
  const escapeHtml = (text: string): string => {
    const div = doc.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  /**
   * 클립보드 복사 실행
   */
  const doCopy = async (text: string, label: string): Promise<void> => {
    try {
      if (copyToClipboard) {
        await copyToClipboard(text);
      } else if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('클립보드 API를 사용할 수 없습니다.');
      }
      showStatus?.(`${label} 프롬프트가 복사되었습니다.`, 'success');
      logger?.log?.(`[GMH] ${label} prompt copied`);
    } catch (err) {
      showStatus?.('복사에 실패했습니다.', 'error');
      logger?.warn?.('[GMH] copy failed', err);
    }
  };

  /**
   * 청크별 이벤트 바인딩
   */
  const bindChunkEvents = (): void => {
    if (!contentEl) return;

    // 토글 버튼
    contentEl.querySelectorAll<HTMLButtonElement>('.gmh-memory-chunk__toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const chunkEl = btn.closest('.gmh-memory-chunk');
        const detailEl = chunkEl?.querySelector<HTMLElement>('.gmh-memory-chunk__detail');
        if (!detailEl) return;

        const isExpanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!isExpanded));
        btn.textContent = isExpanded ? '펼치기 ▼' : '접기 ▲';
        detailEl.hidden = isExpanded;
      });
    });

    // 요약 복사 버튼
    contentEl.querySelectorAll<HTMLButtonElement>('.gmh-copy-summary').forEach((btn) => {
      btn.addEventListener('click', () => {
        const chunkEl = btn.closest('.gmh-memory-chunk');
        const chunkId = chunkEl?.getAttribute('data-chunk-id');
        const chunk = currentChunks.find((c) => c.id === chunkId);
        if (!chunk) return;

        const prompt = buildSummaryPrompt(chunk);
        void doCopy(prompt, '요약');
      });
    });

    // Facts 복사 버튼
    contentEl.querySelectorAll<HTMLButtonElement>('.gmh-copy-facts').forEach((btn) => {
      btn.addEventListener('click', () => {
        const chunkEl = btn.closest('.gmh-memory-chunk');
        const chunkId = chunkEl?.getAttribute('data-chunk-id');
        const chunk = currentChunks.find((c) => c.id === chunkId);
        if (!chunk) return;

        const prompt = buildFactsPrompt(chunk);
        void doCopy(prompt, 'Facts');
      });
    });
  };

  // Controller 반환
  return {
    getElement(): HTMLElement {
      return section;
    },

    setChunks(result: ChunkerResult): void {
      currentChunks = result.chunks;
      isLoading = false;
      renderChunks();
    },

    clear(): void {
      currentChunks = [];
      isLoading = false;
      renderEmpty();
    },

    setLoading(loading: boolean): void {
      isLoading = loading;
      if (loading) {
        renderLoading();
      } else if (currentChunks.length === 0) {
        renderEmpty();
      }
    },
  };
}

export default createMemoryPanel;
