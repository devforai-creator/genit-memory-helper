/**
 * Memory Prompts - Dual Memory 시스템을 위한 프롬프트 템플릿
 *
 * 요약(Semantic Memory)과 Facts(Episodic Memory) 추출을 위한
 * LLM 프롬프트 템플릿을 제공합니다.
 */

import type { MemoryChunk } from './memory-chunker';

/** 요약 프롬프트 템플릿 (기본) */
export const DEFAULT_SUMMARY_PROMPT = `다음 대화를 2-3문장으로 요약해주세요. 핵심 주제와 흐름만 간단히.

[대화 내용]
{chunk}`;

/** Facts 프롬프트 템플릿 (기본) */
export const DEFAULT_FACTS_PROMPT = `다음 대화에서 나중에 참조할 가치가 있는 구체적 사실을 추출해주세요.

추출 대상:
- 첫 경험 (첫 만남, 첫 시도 등)
- 구체적 정보 (날짜, 장소, 음식, 시간 등)
- 개인 선호/습관/특징
- 중요한 약속이나 결정
- 감정적으로 의미 있는 순간

출력 형식:
- 각 사실을 "- " 로 시작하는 bullet point로 작성
- 없으면 "기록할 사실 없음"이라고만 답변

[대화 내용]
{chunk}`;

/** 메타 요약 프롬프트 템플릿 (v3.1.0) */
export const DEFAULT_META_SUMMARY_PROMPT = `다음은 대화의 각 부분을 요약한 것입니다. 이 요약들을 하나의 통합 요약으로 압축해주세요.

요구사항:
- 전체 대화의 핵심 흐름과 주요 발전을 담아주세요
- 반복되는 내용은 한 번만 언급
- 500자 이내로 작성
- 시간 순서대로 주요 사건/변화를 정리

[청크 요약들]
{summaries}`;

/** 메타 요약 입력용 정보 인터페이스 */
export interface MetaSummaryInput {
  chunkIds: string[];
  summaries: string[];
  chunkRange: [number, number]; // [시작 청크 인덱스, 끝 청크 인덱스]
}

/**
 * 메타 요약 프롬프트 생성 (v3.1.0)
 *
 * @param input - 메타 요약에 필요한 청크 요약들
 * @param customTemplate - 사용자 정의 템플릿 (선택)
 * @returns 완성된 프롬프트
 */
export const buildMetaSummaryPrompt = (
  input: MetaSummaryInput,
  customTemplate?: string,
): string => {
  const template = customTemplate ?? DEFAULT_META_SUMMARY_PROMPT;

  // 각 청크 요약을 번호와 함께 포맷
  const formattedSummaries = input.summaries
    .map((summary, i) => `[${input.chunkRange[0] + i + 1}] ${summary}`)
    .join('\n\n');

  return template.replace('{summaries}', formattedSummaries);
};

/**
 * 메타 요약 대상 청크 그룹화 (10개씩)
 *
 * @param chunks - 모든 청크 (요약이 있는 것만)
 * @param groupSize - 그룹 크기 (기본 10)
 * @returns 메타 요약이 필요한 그룹들
 */
export const groupChunksForMeta = (
  chunks: Array<{ id: string; index: number; summary?: string }>,
  groupSize = 10,
): Array<{ chunkIds: string[]; chunkRange: [number, number]; summaries: string[] }> => {
  // 요약이 있는 청크만 필터링
  const withSummary = chunks.filter(c => c.summary && c.summary.trim());

  const groups: Array<{ chunkIds: string[]; chunkRange: [number, number]; summaries: string[] }> = [];

  for (let i = 0; i < withSummary.length; i += groupSize) {
    const group = withSummary.slice(i, i + groupSize);
    if (group.length === groupSize) {
      groups.push({
        chunkIds: group.map(c => c.id),
        chunkRange: [group[0].index, group[group.length - 1].index],
        summaries: group.map(c => c.summary!),
      });
    }
  }

  return groups;
};

/**
 * 프롬프트에 청크 내용 삽입
 */
const insertChunkContent = (template: string, chunkContent: string): string => {
  return template.replace('{chunk}', chunkContent);
};

/**
 * 요약 프롬프트 생성
 *
 * @param chunk - 메모리 청크
 * @param customTemplate - 사용자 정의 템플릿 (선택)
 * @returns 완성된 프롬프트
 */
export const buildSummaryPrompt = (
  chunk: MemoryChunk,
  customTemplate?: string,
): string => {
  const template = customTemplate ?? DEFAULT_SUMMARY_PROMPT;
  return insertChunkContent(template, chunk.raw);
};

/**
 * Facts 프롬프트 생성
 *
 * @param chunk - 메모리 청크
 * @param customTemplate - 사용자 정의 템플릿 (선택)
 * @returns 완성된 프롬프트
 */
export const buildFactsPrompt = (
  chunk: MemoryChunk,
  customTemplate?: string,
): string => {
  const template = customTemplate ?? DEFAULT_FACTS_PROMPT;
  return insertChunkContent(template, chunk.raw);
};

/**
 * 청크 범위를 사람이 읽기 쉬운 형태로 포맷
 */
export const formatChunkRange = (chunk: MemoryChunk): string => {
  return `#${chunk.index + 1} (${chunk.range.start}-${chunk.range.end})`;
};

/**
 * 청크 미리보기 텍스트 생성 (처음 100자)
 */
export const getChunkPreview = (chunk: MemoryChunk, maxLength = 100): string => {
  const raw = chunk.raw || '';
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength)}...`;
};

export default {
  DEFAULT_SUMMARY_PROMPT,
  DEFAULT_FACTS_PROMPT,
  DEFAULT_META_SUMMARY_PROMPT,
  buildSummaryPrompt,
  buildFactsPrompt,
  buildMetaSummaryPrompt,
  groupChunksForMeta,
  formatChunkRange,
  getChunkPreview,
};
