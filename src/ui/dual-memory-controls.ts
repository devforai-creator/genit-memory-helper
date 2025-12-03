/**
 * Dual Memory Controls - 청크 생성, 저장, 결과 입력 UI 컨트롤러
 *
 * Phase 2: IndexedDB 저장/로드, 요약/Facts 결과 입력, 유저노트 복사
 */

import type { ChunkerResult, MemoryChunk } from '../features/memory-chunker';
import { createChunks, chunkToBlockInit, blockRecordToChunk } from '../features/memory-chunker';
import {
  buildSummaryPrompt,
  buildFactsPrompt,
  buildMetaSummaryPrompt,
  groupChunksForMeta,
  formatChunkRange,
  getChunkPreview,
} from '../features/memory-prompts';
import type {
  StructuredSnapshotMessage,
  TranscriptTurn,
  BlockStorageController,
  MemoryBlockRecord,
  MetaSummaryRecord,
  MetaSummaryInit,
} from '../types';

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
  /** BlockStorage 컨트롤러 getter (Promise 대응) */
  getBlockStorage?: () => BlockStorageController | null;
  /** 로거 */
  logger?: Console | { warn?: (...args: unknown[]) => void; log?: (...args: unknown[]) => void } | null;
}

/** Dual Memory 컨트롤러 */
export interface DualMemoryController {
  /** 패널에 마운트 */
  mount(panel: Element | null): void;
  /** 청크 생성 실행 */
  loadChunks(): void;
  /** 저장된 청크 로드 */
  loadSavedChunks(): Promise<void>;
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
    getBlockStorage,
    logger = typeof console !== 'undefined' ? console : null,
  } = options;

  if (!documentRef) {
    throw new Error('createDualMemoryControls requires documentRef');
  }

  const doc = documentRef;
  let currentResult: ChunkerResult | null = null;
  let savedRecords: MemoryBlockRecord[] = [];
  let savedMetaRecords: MetaSummaryRecord[] = [];
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
        <p class="gmh-memory-hint">저장된 메모리가 있으면 자동으로 불러옵니다.</p>
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
  const renderChunkItem = (chunk: MemoryChunk, isSaved: boolean): string => {
    const range = formatChunkRange(chunk);
    const preview = getChunkPreview(chunk, 80);
    const messageCount = chunk.messages.length;
    const hasSummary = !!chunk.summary?.trim();
    const hasFacts = !!chunk.facts?.trim();
    const statusBadge = hasSummary && hasFacts
      ? '<span class="gmh-memory-badge gmh-memory-badge--complete">완료</span>'
      : hasSummary || hasFacts
        ? '<span class="gmh-memory-badge gmh-memory-badge--partial">진행중</span>'
        : '<span class="gmh-memory-badge gmh-memory-badge--empty">미완료</span>';

    return `
      <div class="gmh-memory-chunk ${isSaved ? 'gmh-memory-chunk--saved' : ''}" data-chunk-id="${chunk.id}">
        <div class="gmh-memory-chunk__header">
          <span class="gmh-memory-chunk__range">${range}</span>
          <span class="gmh-memory-chunk__count">${messageCount}개</span>
          ${statusBadge}
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
          <div class="gmh-memory-chunk__raw-section">
            <div class="gmh-memory-chunk__section-title">원문</div>
            <pre class="gmh-memory-chunk__raw">${escapeHtml(chunk.raw, doc)}</pre>
          </div>
          <div class="gmh-memory-chunk__input-section">
            <div class="gmh-memory-chunk__section-title">요약 결과 붙여넣기</div>
            <textarea class="gmh-memory-input gmh-summary-input" placeholder="LLM 요약 결과를 여기에 붙여넣으세요...">${escapeHtml(chunk.summary ?? '', doc)}</textarea>
            <button class="gmh-small-btn gmh-save-summary" type="button">저장</button>
          </div>
          <div class="gmh-memory-chunk__input-section">
            <div class="gmh-memory-chunk__section-title">Facts 결과 붙여넣기</div>
            <textarea class="gmh-memory-input gmh-facts-input" placeholder="LLM Facts 결과를 여기에 붙여넣으세요...">${escapeHtml(chunk.facts ?? '', doc)}</textarea>
            <button class="gmh-small-btn gmh-save-facts" type="button">저장</button>
          </div>
        </div>
      </div>
    `;
  };

  /**
   * 메타 요약 대상 그룹 목록 생성
   */
  const getMetaGroups = (chunks: MemoryChunk[]): Array<{ chunkIds: string[]; chunkRange: [number, number]; summaries: string[] }> => {
    const chunksForGroup = chunks.map((c, i) => ({
      id: c.id,
      index: i,
      summary: c.summary,
    }));
    return groupChunksForMeta(chunksForGroup, 10);
  };

  /**
   * 메타 요약 섹션 렌더링 (v3.1.0)
   */
  const renderMetaSummarySection = (chunks: MemoryChunk[]): string => {
    const metaGroups = getMetaGroups(chunks);

    // 메타 요약 가능한 그룹이 없으면 빈 문자열
    if (metaGroups.length === 0) {
      return '';
    }

    // 각 그룹에 대해 이미 저장된 메타 요약 확인
    const groupsHtml = metaGroups.map((group, idx) => {
      // 이 그룹에 해당하는 저장된 메타 요약 찾기
      const existingMeta = savedMetaRecords.find(
        m => m.chunkRange[0] === group.chunkRange[0] && m.chunkRange[1] === group.chunkRange[1]
      );
      const hasMeta = !!existingMeta?.summary;
      const metaId = existingMeta?.id ?? `meta-${group.chunkRange[0]}-${group.chunkRange[1]}`;

      return `
        <div class="gmh-meta-group ${hasMeta ? 'gmh-meta-group--saved' : ''}" data-meta-range="${group.chunkRange[0]}-${group.chunkRange[1]}">
          <div class="gmh-meta-group__header">
            <span class="gmh-meta-group__range">청크 ${group.chunkRange[0] + 1}~${group.chunkRange[1] + 1}</span>
            <span class="gmh-meta-group__count">${group.chunkIds.length}개 요약</span>
            ${hasMeta
              ? '<span class="gmh-memory-badge gmh-memory-badge--complete">메타 완료</span>'
              : '<span class="gmh-memory-badge gmh-memory-badge--empty">미완료</span>'}
            <button class="gmh-small-btn gmh-small-btn--accent gmh-copy-meta-prompt" type="button" title="메타 요약 프롬프트 복사">
              📋 프롬프트
            </button>
          </div>
          <div class="gmh-meta-group__input-section">
            <textarea class="gmh-memory-input gmh-meta-input" placeholder="메타 요약 결과를 여기에 붙여넣으세요...">${escapeHtml(existingMeta?.summary ?? '', doc)}</textarea>
            <button class="gmh-small-btn gmh-save-meta" type="button" data-meta-id="${metaId}">저장</button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="gmh-meta-summary-section">
        <div class="gmh-memory-section-title">🔗 메타 요약 (10개 청크 통합)</div>
        <p class="gmh-meta-hint">요약이 완료된 청크 10개씩 묶어서 메타 요약을 생성합니다.</p>
        <div class="gmh-meta-groups">
          ${groupsHtml}
        </div>
      </div>
    `;
  };

  /**
   * 메타 요약 섹션 동적 갱신 (v3.1.0)
   * 요약 저장 후 메타 그룹이 새로 나타날 수 있으므로 섹션을 다시 렌더링
   */
  const refreshMetaSection = (chunks: MemoryChunk[]): void => {
    if (!contentEl) return;

    const existingSection = contentEl.querySelector('.gmh-meta-summary-section');
    const userNoteSection = contentEl.querySelector('.gmh-memory-usernote-section');
    const newHtml = renderMetaSummarySection(chunks);

    if (existingSection) {
      // 기존 섹션이 있으면 교체
      if (newHtml) {
        existingSection.outerHTML = newHtml;
      } else {
        existingSection.remove();
      }
    } else if (newHtml && userNoteSection) {
      // 기존 섹션이 없고 새로 생겨야 하면 유저노트 섹션 앞에 삽입
      userNoteSection.insertAdjacentHTML('beforebegin', newHtml);
    }

    // 메타 이벤트 다시 바인딩
    bindMetaEvents(chunks);
  };

  /**
   * 유저노트 복사 버튼 렌더링
   */
  const renderUserNoteCopySection = (): string => {
    return `
      <div class="gmh-memory-usernote-section">
        <div class="gmh-memory-section-title">유저노트용 복사</div>
        <div class="gmh-memory-usernote-actions">
          <button class="gmh-btn gmh-btn--primary gmh-copy-all-summary" type="button" title="모든 요약을 합쳐서 복사 (계층적)">
            📋 전체 요약 복사
          </button>
          <button class="gmh-btn gmh-btn--primary gmh-copy-all-facts" type="button" title="모든 Facts를 합쳐서 복사">
            📋 전체 Facts 복사
          </button>
          <button class="gmh-btn gmh-btn--accent gmh-copy-combined" type="button" title="요약 + Facts 모두 복사">
            📋 통합 복사
          </button>
        </div>
      </div>
    `;
  };

  /**
   * 청크 목록 렌더링
   */
  const renderChunks = (chunks: MemoryChunk[], isSaved: boolean): void => {
    if (!contentEl) return;

    if (chunks.length === 0) {
      renderEmpty();
      return;
    }

    const totalMessages = chunks.reduce((sum, c) => sum + c.messages.length, 0);
    const completedCount = chunks.filter(c => c.summary?.trim() && c.facts?.trim()).length;

    const chunksHtml = chunks.map(c => renderChunkItem(c, isSaved)).join('');
    const metaCount = savedMetaRecords.length;
    contentEl.innerHTML = `
      <div class="gmh-memory-stats">
        총 ${chunks.length}개 청크 (${totalMessages}개 메시지) | 완료: ${completedCount}/${chunks.length}
        ${metaCount > 0 ? ` | 메타: ${metaCount}개` : ''}
        ${isSaved ? '<span class="gmh-memory-saved-indicator">💾 저장됨</span>' : ''}
      </div>
      <div class="gmh-memory-chunks">
        ${chunksHtml}
      </div>
      ${renderMetaSummarySection(chunks)}
      ${renderUserNoteCopySection()}
    `;

    // 이벤트 바인딩
    bindChunkEvents(chunks, isSaved);
    bindMetaEvents(chunks);
    bindUserNoteEvents(chunks);
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
      showStatus?.(`${label} 복사 완료!`, 'success');
      logger?.log?.(`[GMH] ${label} copied`);
    } catch (err) {
      showStatus?.('복사에 실패했습니다.', 'error');
      logger?.warn?.('[GMH] copy failed', err);
    }
  };

  /**
   * 청크 저장 (IndexedDB)
   */
  const saveChunk = async (chunk: MemoryChunk): Promise<void> => {
    const blockStorage = getBlockStorage?.();
    if (!blockStorage) {
      logger?.warn?.('[GMH] BlockStorage not available, skipping save');
      return;
    }

    const sessionUrl = getSessionUrl?.() ?? '';
    if (!sessionUrl) {
      logger?.warn?.('[GMH] No session URL, skipping save');
      return;
    }

    try {
      const blockInit = chunkToBlockInit(chunk, sessionUrl);
      await blockStorage.save(blockInit);
      logger?.log?.('[GMH] Chunk saved:', chunk.id);
    } catch (err) {
      logger?.warn?.('[GMH] Failed to save chunk:', err);
      throw err;
    }
  };

  /**
   * 청크별 이벤트 바인딩
   */
  const bindChunkEvents = (chunks: MemoryChunk[], isSaved: boolean): void => {
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
        const chunk = chunks.find((c) => c.id === chunkId);
        if (!chunk) return;

        const prompt = buildSummaryPrompt(chunk);
        void doCopy(prompt, '요약 프롬프트');
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
        void doCopy(prompt, 'Facts 프롬프트');
      });
    });

    // 요약 저장 버튼
    contentEl.querySelectorAll<HTMLButtonElement>('.gmh-save-summary').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const chunkEl = btn.closest('.gmh-memory-chunk');
        const chunkId = chunkEl?.getAttribute('data-chunk-id');
        const chunk = chunks.find((c) => c.id === chunkId);
        if (!chunk) return;

        const textarea = chunkEl?.querySelector<HTMLTextAreaElement>('.gmh-summary-input');
        const value = textarea?.value?.trim() ?? '';
        if (!value) {
          showStatus?.('요약 내용을 입력해주세요.', 'error');
          return;
        }

        chunk.summary = value;
        btn.disabled = true;
        btn.textContent = '저장 중...';

        try {
          await saveChunk(chunk);
          showStatus?.('요약이 저장되었습니다.', 'success');
          updateChunkBadge(chunkEl, chunk);
          updateStats(chunks);
          refreshMetaSection(chunks); // 메타 요약 섹션 갱신
        } catch {
          showStatus?.('저장에 실패했습니다.', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = '저장';
        }
      });
    });

    // Facts 저장 버튼
    contentEl.querySelectorAll<HTMLButtonElement>('.gmh-save-facts').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const chunkEl = btn.closest('.gmh-memory-chunk');
        const chunkId = chunkEl?.getAttribute('data-chunk-id');
        const chunk = chunks.find((c) => c.id === chunkId);
        if (!chunk) return;

        const textarea = chunkEl?.querySelector<HTMLTextAreaElement>('.gmh-facts-input');
        const value = textarea?.value?.trim() ?? '';
        if (!value) {
          showStatus?.('Facts 내용을 입력해주세요.', 'error');
          return;
        }

        chunk.facts = value;
        btn.disabled = true;
        btn.textContent = '저장 중...';

        try {
          await saveChunk(chunk);
          showStatus?.('Facts가 저장되었습니다.', 'success');
          updateChunkBadge(chunkEl, chunk);
          updateStats(chunks);
        } catch {
          showStatus?.('저장에 실패했습니다.', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = '저장';
        }
      });
    });
  };

  /**
   * 메타 요약 저장 (IndexedDB)
   */
  const saveMetaSummary = async (metaInit: MetaSummaryInit): Promise<void> => {
    const blockStorage = getBlockStorage?.();
    if (!blockStorage) {
      logger?.warn?.('[GMH] BlockStorage not available for meta save');
      return;
    }

    try {
      await blockStorage.saveMeta(metaInit);
      logger?.log?.('[GMH] Meta summary saved:', metaInit.id);
    } catch (err) {
      logger?.warn?.('[GMH] Failed to save meta summary:', err);
      throw err;
    }
  };

  /**
   * 메타 요약 이벤트 바인딩 (v3.1.0)
   */
  const bindMetaEvents = (chunks: MemoryChunk[]): void => {
    if (!contentEl) return;

    const metaGroups = getMetaGroups(chunks);
    if (metaGroups.length === 0) return;

    // 메타 프롬프트 복사 버튼
    contentEl.querySelectorAll<HTMLButtonElement>('.gmh-copy-meta-prompt').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        const group = metaGroups[idx];
        if (!group) return;

        const prompt = buildMetaSummaryPrompt({
          chunkIds: group.chunkIds,
          summaries: group.summaries,
          chunkRange: group.chunkRange,
        });
        void doCopy(prompt, '메타 요약 프롬프트');
      });
    });

    // 메타 요약 저장 버튼
    contentEl.querySelectorAll<HTMLButtonElement>('.gmh-save-meta').forEach((btn, idx) => {
      btn.addEventListener('click', async () => {
        const groupEl = btn.closest('.gmh-meta-group');
        const group = metaGroups[idx];
        if (!group || !groupEl) return;

        const textarea = groupEl.querySelector<HTMLTextAreaElement>('.gmh-meta-input');
        const value = textarea?.value?.trim() ?? '';
        if (!value) {
          showStatus?.('메타 요약 내용을 입력해주세요.', 'error');
          return;
        }

        const sessionUrl = getSessionUrl?.() ?? '';
        if (!sessionUrl) {
          showStatus?.('세션 URL을 찾을 수 없습니다.', 'error');
          return;
        }

        btn.disabled = true;
        btn.textContent = '저장 중...';

        try {
          const metaId = `gmh-meta-${group.chunkRange[0]}-${group.chunkRange[1]}-${Date.now()}`;
          const metaInit: MetaSummaryInit = {
            id: metaId,
            sessionUrl,
            chunkIds: group.chunkIds,
            chunkRange: group.chunkRange,
            summary: value,
            timestamp: Date.now(),
          };

          await saveMetaSummary(metaInit);

          // 로컬 상태 업데이트
          const blockStorage = getBlockStorage?.();
          if (blockStorage) {
            savedMetaRecords = await blockStorage.getMetaBySession(sessionUrl);
          }

          showStatus?.('메타 요약이 저장되었습니다.', 'success');

          // 배지 업데이트
          const badgeEl = groupEl.querySelector('.gmh-memory-badge');
          if (badgeEl) {
            badgeEl.className = 'gmh-memory-badge gmh-memory-badge--complete';
            badgeEl.textContent = '메타 완료';
          }
          groupEl.classList.add('gmh-meta-group--saved');

          // 통계 업데이트
          updateStats(chunks);
        } catch {
          showStatus?.('메타 요약 저장에 실패했습니다.', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = '저장';
        }
      });
    });
  };

  /**
   * 청크 배지 업데이트
   */
  const updateChunkBadge = (chunkEl: Element | null, chunk: MemoryChunk): void => {
    if (!chunkEl) return;
    const badgeEl = chunkEl.querySelector('.gmh-memory-badge');
    if (!badgeEl) return;

    const hasSummary = !!chunk.summary?.trim();
    const hasFacts = !!chunk.facts?.trim();

    badgeEl.className = 'gmh-memory-badge';
    if (hasSummary && hasFacts) {
      badgeEl.classList.add('gmh-memory-badge--complete');
      badgeEl.textContent = '완료';
    } else if (hasSummary || hasFacts) {
      badgeEl.classList.add('gmh-memory-badge--partial');
      badgeEl.textContent = '진행중';
    } else {
      badgeEl.classList.add('gmh-memory-badge--empty');
      badgeEl.textContent = '미완료';
    }
  };

  /**
   * 통계 업데이트
   */
  const updateStats = (chunks: MemoryChunk[]): void => {
    if (!contentEl) return;
    const statsEl = contentEl.querySelector('.gmh-memory-stats');
    if (!statsEl) return;

    const totalMessages = chunks.reduce((sum, c) => sum + c.messages.length, 0);
    const completedCount = chunks.filter(c => c.summary?.trim() && c.facts?.trim()).length;
    const isSaved = savedRecords.length > 0;
    const metaCount = savedMetaRecords.length;

    statsEl.innerHTML = `
      총 ${chunks.length}개 청크 (${totalMessages}개 메시지) | 완료: ${completedCount}/${chunks.length}
      ${metaCount > 0 ? ` | 메타: ${metaCount}개` : ''}
      ${isSaved ? '<span class="gmh-memory-saved-indicator">💾 저장됨</span>' : ''}
    `;
  };

  /**
   * 메타 요약으로 커버되는 청크 인덱스 집합 계산 (v3.1.0)
   */
  const getMetaCoveredIndices = (): Set<number> => {
    const covered = new Set<number>();
    for (const meta of savedMetaRecords) {
      for (let i = meta.chunkRange[0]; i <= meta.chunkRange[1]; i++) {
        covered.add(i);
      }
    }
    return covered;
  };

  /**
   * 계층적 요약 생성 (메타 요약 + 비커버 청크 요약) (v3.1.0)
   */
  const buildHierarchicalSummary = (chunks: MemoryChunk[]): string[] => {
    const covered = getMetaCoveredIndices();
    const parts: Array<{ order: number; text: string }> = [];

    // 메타 요약 추가 (order = 첫 번째 청크 인덱스)
    for (const meta of savedMetaRecords) {
      parts.push({
        order: meta.chunkRange[0],
        text: `[메타 ${meta.chunkRange[0] + 1}~${meta.chunkRange[1] + 1}]\n${meta.summary}`,
      });
    }

    // 비커버 청크 요약 추가
    chunks.forEach((c, i) => {
      if (!covered.has(i) && c.summary?.trim()) {
        parts.push({
          order: i,
          text: `[청크 ${i + 1}] ${formatChunkRange(c)}\n${c.summary}`,
        });
      }
    });

    // 순서대로 정렬
    parts.sort((a, b) => a.order - b.order);
    return parts.map(p => p.text);
  };

  /**
   * 유저노트 복사 이벤트 바인딩
   */
  const bindUserNoteEvents = (chunks: MemoryChunk[]): void => {
    if (!contentEl) return;

    // 전체 요약 복사 (계층적 - v3.1.0)
    contentEl.querySelector<HTMLButtonElement>('.gmh-copy-all-summary')?.addEventListener('click', () => {
      const parts = buildHierarchicalSummary(chunks);

      if (parts.length === 0) {
        showStatus?.('저장된 요약이 없습니다.', 'error');
        return;
      }

      const summaries = parts.join('\n\n---\n\n');
      const hasMetaInfo = savedMetaRecords.length > 0 ? ` (메타 ${savedMetaRecords.length}개 포함)` : '';
      void doCopy(summaries, `전체 요약${hasMetaInfo}`);
    });

    // 전체 Facts 복사 (Facts는 계층화하지 않음 - 모든 청크의 Facts 포함)
    contentEl.querySelector<HTMLButtonElement>('.gmh-copy-all-facts')?.addEventListener('click', () => {
      const facts = chunks
        .filter(c => c.facts?.trim())
        .map((c, i) => `[청크 ${i + 1}] ${formatChunkRange(c)}\n${c.facts}`)
        .join('\n\n---\n\n');

      if (!facts) {
        showStatus?.('저장된 Facts가 없습니다.', 'error');
        return;
      }
      void doCopy(facts, '전체 Facts');
    });

    // 통합 복사 (계층적 요약 + 전체 Facts)
    contentEl.querySelector<HTMLButtonElement>('.gmh-copy-combined')?.addEventListener('click', () => {
      const combined: string[] = [];
      const sessionUrl = getSessionUrl?.() ?? 'Unknown Session';

      combined.push(`# 대화 메모리 - ${new Date().toLocaleDateString('ko-KR')}`);
      combined.push(`세션: ${sessionUrl}\n`);

      // 계층적 요약 섹션 (v3.1.0)
      const summaryParts = buildHierarchicalSummary(chunks);
      if (summaryParts.length > 0) {
        combined.push('## 📝 요약\n');
        summaryParts.forEach(part => {
          combined.push(part);
          combined.push('');
        });
      }

      // Facts 섹션 (모든 청크)
      const factsChunks = chunks.filter(c => c.facts?.trim());
      if (factsChunks.length > 0) {
        combined.push('## 📌 Facts\n');
        factsChunks.forEach((c, i) => {
          combined.push(`### 청크 ${i + 1} (${formatChunkRange(c)})`);
          combined.push(c.facts!);
          combined.push('');
        });
      }

      if (summaryParts.length === 0 && factsChunks.length === 0) {
        showStatus?.('저장된 요약/Facts가 없습니다.', 'error');
        return;
      }

      void doCopy(combined.join('\n'), '통합 메모리');
    });
  };

  /**
   * 청크 생성 및 저장 실행
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
    setTimeout(async () => {
      let savedCount = 0;
      let skippedCount = 0;

      try {
        currentResult = createChunks(messages, {
          sessionUrl: getSessionUrl?.() ?? undefined,
        });

        // IndexedDB에 청크 저장 (중복 체크)
        const blockStorage = getBlockStorage?.();
        if (blockStorage && currentResult.chunks.length > 0) {
          const sessionUrl = getSessionUrl?.() ?? '';
          if (sessionUrl) {
            showStatus?.('청크 저장 중...', 'progress');

            // 기존 저장된 청크의 ordinalRange 가져오기
            const existingBlocks = await blockStorage.getBySession(sessionUrl);
            const existingRanges = new Set(
              existingBlocks.map((b) => `${b.ordinalRange[0]}-${b.ordinalRange[1]}`),
            );

            for (const chunk of currentResult.chunks) {
              const rangeKey = `${chunk.range.start}-${chunk.range.end}`;
              if (existingRanges.has(rangeKey)) {
                // 이미 저장된 범위면 스킵 (기존 요약/Facts 보존)
                skippedCount++;
                continue;
              }
              await saveChunk(chunk);
              savedCount++;
            }

            savedRecords = await blockStorage.getBySession(sessionUrl);

            if (skippedCount > 0) {
              logger?.log?.(
                `[GMH] Chunks: ${savedCount} saved, ${skippedCount} skipped (already exists)`,
              );
            }
          }
        }

        // savedRecords를 청크로 변환하여 렌더링 (기존 요약/Facts 포함)
        const chunksToRender =
          savedRecords.length > 0
            ? savedRecords.map(blockRecordToChunk)
            : currentResult.chunks;

        // currentResult도 업데이트 (다른 곳에서 참조할 수 있으므로)
        currentResult = {
          ...currentResult,
          chunks: chunksToRender,
        };

        renderChunks(chunksToRender, true);

        // 상태 메시지 개선
        const totalChunks = chunksToRender.length;
        const statusMsg =
          savedCount > 0
            ? `${savedCount}개 새 청크 저장, 총 ${totalChunks}개 청크`
            : `${totalChunks}개 청크 (변경 없음)`;
        showStatus?.(statusMsg, 'success');
        logger?.log?.('[GMH] Chunks result:', { total: totalChunks, new: savedCount, skipped: skippedCount });
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
   * BlockStorage가 준비될 때까지 대기 (최대 5초, 500ms 간격)
   */
  const waitForStorage = async (maxAttempts = 10, intervalMs = 500): Promise<BlockStorageController | null> => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const storage = getBlockStorage?.();
      if (storage) return storage;

      if (attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
    return null;
  };

  /**
   * 저장된 청크 로드 (IndexedDB에서)
   * - storage가 아직 초기화되지 않았으면 재시도
   */
  const loadSavedChunks = async (): Promise<void> => {
    const sessionUrl = getSessionUrl?.() ?? '';
    if (!sessionUrl) return;

    // storage가 준비될 때까지 대기 (비동기 초기화 대응)
    let blockStorage = getBlockStorage?.();
    if (!blockStorage) {
      logger?.log?.('[GMH] BlockStorage not ready, waiting...');
      blockStorage = await waitForStorage();
      if (!blockStorage) {
        logger?.warn?.('[GMH] BlockStorage not available after retries');
        return;
      }
      logger?.log?.('[GMH] BlockStorage ready after wait');
    }

    try {
      // 청크 로드
      savedRecords = await blockStorage.getBySession(sessionUrl);

      // 메타 요약 로드 (v3.1.0)
      savedMetaRecords = await blockStorage.getMetaBySession(sessionUrl);

      if (savedRecords.length > 0) {
        const chunks = savedRecords.map(blockRecordToChunk);
        currentResult = {
          chunks,
          totalMessages: chunks.reduce((sum, c) => sum + c.messages.length, 0),
          sessionUrl,
          createdAt: savedRecords[0]?.timestamp ?? Date.now(),
        };
        renderChunks(chunks, true);
        const metaInfo = savedMetaRecords.length > 0 ? ` (메타 ${savedMetaRecords.length}개)` : '';
        showStatus?.(`${chunks.length}개 저장된 청크를 불러왔습니다.${metaInfo}`, 'info');
        logger?.log?.('[GMH] Loaded saved chunks:', chunks.length, 'meta:', savedMetaRecords.length);
      }
    } catch (err) {
      logger?.warn?.('[GMH] Failed to load saved chunks:', err);
    }
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

    // 초기 상태: 저장된 청크 로드 시도
    if (contentEl) {
      void loadSavedChunks().then(() => {
        if (savedRecords.length === 0 && !currentResult) {
          renderEmpty();
        }
      });
    }
  };

  /**
   * 정리
   */
  const destroy = (): void => {
    currentResult = null;
    savedRecords = [];
    savedMetaRecords = [];
    contentEl = null;
    loadBtn = null;
    isLoading = false;
  };

  return {
    mount,
    loadChunks,
    loadSavedChunks,
    getChunkResult: () => currentResult,
    destroy,
  };
}

export default createDualMemoryControls;
