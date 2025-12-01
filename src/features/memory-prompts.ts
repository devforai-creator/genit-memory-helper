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
  buildSummaryPrompt,
  buildFactsPrompt,
  formatChunkRange,
  getChunkPreview,
};
