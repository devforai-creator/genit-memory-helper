/**
 * Dual Memory Controls - 청크 생성 및 프롬프트 복사 UI 컨트롤러
 *
 * Memory Panel의 "GMH에 담기" 버튼과 청크 목록 UI를 연결합니다.
 */

import type { ChunkerResult, MemoryChunk } from '../features/memory-chunker';
import { createChunks } from '../features/memory-chunker';
import {
  buildSummaryPrompt,
  buildFactsPrompt,
  formatChunkRange,
  getChunkPreview,
} from '../features/memory-prompts';
import type { StructuredSnapshotMessage, TranscriptTurn } from '../types';

/** Dual Memory 컨트롤러 옵션 */
export interface DualMemoryControlsOptions {
  /** document 참조 */
  documentRef?: Document | null;
  /** 메시지 수집 함수 (autoLoader 등에서 가져옴) */
  getMessages?: () => StructuredSnapshotMessage[] | TranscriptTurn[] | null;
  /** 세션 URL */
  getSessionUrl?: () => string | null;
  /** 클립보드 복사 함수 */
  copyToClipboard?: (text: string) => Promise<void>;
  /** 상태 메시지 표시 함수 */
  showStatus?: (message: string, tone?: 'info' | 'success' | 'error' | 'progress') => void;
  /** 로거 */
  logger?: Console | { warn?: (...args: unknown[]) => void; log?: (...args: unknown[]) => void } | null;
}

/** Dual Memory 컨트롤러 */
export interface DualMemoryController {
  /** 패널에 마운트 */
  mount(panel: Element | null): void;
  /** 청크 생성 실행 */
  loadChunks(): void;
  /** 현재 청크 결과 가져오기 */
  getChunkResult(): ChunkerResult | null;
  /** 정리 */
  destroy(): void;
}

/**
 * HTML 이스케이프
 */
const escapeHtml = (text: string, doc: Document): string => {
  const div = doc.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

/**
 * Dual Memory Controls 생성
 */
export function createDualMemoryControls(
  options: DualMemoryControlsOptions = {},
): DualMemoryController {
  const {
    documentRef = typeof document !== 'undefined' ? document : null,
    getMessages,
    getSessionUrl,
    copyToClipboard,
    showStatus,
    logger = typeof console !== 'undefined' ? console : null,
  } = options;

  if (!documentRef) {
    throw new Error('createDualMemoryControls requires documentRef');
  }

  const doc = documentRef;
  let currentResult: ChunkerResult | null = null;
  let contentEl: HTMLElement | null = null;
  let loadBtn: HTMLButtonElement | null = null;
  let isLoading = false;

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
        <div class="gmh-memory-chunk__preview">${escapeHtml(preview, doc)}</div>
        <div class="gmh-memory-chunk__actions">
          <button class="gmh-small-btn gmh-small-btn--accent gmh-copy-summary" type="button" title="요약 프롬프트 복사">
            📋 요약
          </button>
          <button class="gmh-small-btn gmh-small-btn--accent gmh-copy-facts" type="button" title="Facts 프롬프트 복사">
            📋 Facts
          </button>
        </div>
        <div class="gmh-memory-chunk__detail" hidden>
          <pre class="gmh-memory-chunk__raw">${escapeHtml(chunk.raw, doc)}</pre>
        </div>
      </div>
    `;
  };

  /**
   * 청크 목록 렌더링
   */
  const renderChunks = (): void => {
    if (!contentEl || !currentResult) return;

    const { chunks } = currentResult;
    if (chunks.length === 0) {
      renderEmpty();
      return;
    }

    const chunksHtml = chunks.map(renderChunkItem).join('');
    contentEl.innerHTML = `
      <div class="gmh-memory-stats">
        총 ${chunks.length}개 청크 생성됨 (${currentResult.totalMessages}개 메시지)
      </div>
      <div class="gmh-memory-chunks">
        ${chunksHtml}
      </div>
    `;

    // 이벤트 바인딩
    bindChunkEvents();
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
    if (!contentEl || !currentResult) return;

    const { chunks } = currentResult;

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
        const chunk = chunks.find((c) => c.id === chunkId);
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
        const chunk = chunks.find((c) => c.id === chunkId);
        if (!chunk) return;

        const prompt = buildFactsPrompt(chunk);
        void doCopy(prompt, 'Facts');
      });
    });
  };

  /**
   * 청크 생성 실행
   */
  const loadChunks = (): void => {
    if (isLoading) return;

    const messages = getMessages?.();
    if (!messages || messages.length === 0) {
      showStatus?.('수집된 메시지가 없습니다. 먼저 Auto Load를 실행해주세요.', 'error');
      return;
    }

    isLoading = true;
    if (loadBtn) {
      loadBtn.disabled = true;
      loadBtn.textContent = '청크 생성 중...';
    }
    renderLoading();
    showStatus?.('청크 생성 중...', 'progress');

    // 비동기로 청크 생성 (UI 블로킹 방지)
    setTimeout(() => {
      try {
        currentResult = createChunks(messages, {
          sessionUrl: getSessionUrl?.() ?? undefined,
        });

        renderChunks();
        showStatus?.(
          `${currentResult.chunks.length}개 청크가 생성되었습니다. 프롬프트를 복사해서 LLM에 붙여넣으세요.`,
          'success',
        );
        logger?.log?.('[GMH] Chunks created:', currentResult.chunks.length);
      } catch (err) {
        showStatus?.('청크 생성에 실패했습니다.', 'error');
        logger?.warn?.('[GMH] Chunk creation failed', err);
        renderEmpty();
      } finally {
        isLoading = false;
        if (loadBtn) {
          loadBtn.disabled = false;
          loadBtn.textContent = 'GMH에 담기';
        }
      }
    }, 0);
  };

  /**
   * 패널에 마운트
   */
  const mount = (panel: Element | null): void => {
    if (!panel) return;

    contentEl = panel.querySelector<HTMLElement>('#gmh-dual-memory-content');
    loadBtn = panel.querySelector<HTMLButtonElement>('#gmh-memory-load');

    if (loadBtn) {
      loadBtn.addEventListener('click', loadChunks);
    }

    // 초기 상태 렌더링
    if (contentEl && !currentResult) {
      renderEmpty();
    } else if (contentEl && currentResult) {
      renderChunks();
    }
  };

  /**
   * 정리
   */
  const destroy = (): void => {
    currentResult = null;
    contentEl = null;
    loadBtn = null;
    isLoading = false;
  };

  return {
    mount,
    loadChunks,
    getChunkResult: () => currentResult,
    destroy,
  };
}

export default createDualMemoryControls;
