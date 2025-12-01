/**
 * Memory Chunker - Dual Memory 시스템을 위한 10개 메시지 청크화
 *
 * 온디맨드 방식으로 수집된 메시지를 10개 단위로 청크화하여
 * 요약/Facts 추출에 사용할 수 있도록 준비합니다.
 */

import type { StructuredSnapshotMessage, TranscriptTurn } from '../types';

/** 청크 단위 메시지 수 */
const DEFAULT_CHUNK_SIZE = 10;

/** 메모리 청크 인터페이스 */
export interface MemoryChunk {
  /** 청크 고유 ID */
  id: string;
  /** 청크 인덱스 (0부터 시작) */
  index: number;
  /** 메시지 범위 (1-based, 사람이 읽기 쉬운 형태) */
  range: {
    start: number;
    end: number;
  };
  /** 원본 메시지 배열 */
  messages: Array<StructuredSnapshotMessage | TranscriptTurn>;
  /** 원문 텍스트 (LLM 프롬프트용) */
  raw: string;
  /** 사용자가 입력한 요약 (Phase 2) */
  summary?: string;
  /** 사용자가 입력한 Facts (Phase 2) */
  facts?: string;
  /** 생성 타임스탬프 */
  timestamp: number;
}

/** 청크화 옵션 */
export interface ChunkerOptions {
  /** 청크당 메시지 수 (기본: 10) */
  chunkSize?: number;
  /** 세션 URL (식별용) */
  sessionUrl?: string;
}

/** 청크화 결과 */
export interface ChunkerResult {
  /** 생성된 청크 배열 */
  chunks: MemoryChunk[];
  /** 총 메시지 수 */
  totalMessages: number;
  /** 세션 URL */
  sessionUrl: string | null;
  /** 생성 타임스탬프 */
  createdAt: number;
}

/**
 * 메시지에서 speaker/role 정보 추출
 */
const getSpeaker = (message: StructuredSnapshotMessage | TranscriptTurn): string => {
  if ('speaker' in message && message.speaker) {
    return String(message.speaker);
  }
  if ('role' in message && message.role) {
    return String(message.role);
  }
  if ('channel' in message && message.channel) {
    return message.channel === 'user' ? '유저' : 'AI';
  }
  return 'unknown';
};

/**
 * 메시지에서 텍스트 추출
 */
const getMessageText = (message: StructuredSnapshotMessage | TranscriptTurn): string => {
  // TranscriptTurn 형태
  if ('text' in message && typeof message.text === 'string') {
    return message.text.trim();
  }

  // StructuredSnapshotMessage 형태
  if ('parts' in message && Array.isArray(message.parts)) {
    const textParts: string[] = [];

    for (const part of message.parts) {
      if (!part) continue;

      // INFO 파트 제외
      if (part.type === 'info' || part.speaker === 'INFO') continue;

      // 텍스트 추출
      if (typeof part.text === 'string' && part.text.trim()) {
        textParts.push(part.text.trim());
      }

      // lines 배열 처리
      if (Array.isArray(part.lines)) {
        for (const line of part.lines) {
          if (typeof line === 'string' && line.trim()) {
            textParts.push(line.trim());
          }
        }
      }
    }

    if (textParts.length > 0) {
      return textParts.join('\n');
    }
  }

  // legacyLines 폴백
  const legacyLines = Reflect.get(message as Record<string, unknown>, 'legacyLines');
  if (Array.isArray(legacyLines)) {
    const lines = legacyLines
      .filter((line): line is string => typeof line === 'string')
      .map((line) => line.trim())
      .filter((line) => line && line.toUpperCase() !== 'INFO');

    if (lines.length > 0) {
      return lines.join('\n');
    }
  }

  return '';
};

/**
 * 메시지 배열을 LLM 프롬프트용 텍스트로 변환
 */
const buildRawText = (messages: Array<StructuredSnapshotMessage | TranscriptTurn>): string => {
  const sections: string[] = [];

  for (const message of messages) {
    const speaker = getSpeaker(message);
    const text = getMessageText(message);

    if (!text) continue;

    // speaker: text 형태로 포맷
    sections.push(`${speaker}: ${text}`);
  }

  return sections.join('\n\n');
};

/**
 * 청크 ID 생성
 */
const buildChunkId = (index: number, timestamp: number): string => {
  return `gmh-chunk-${index}-${timestamp}`;
};

/**
 * 메시지 배열을 10개 단위 청크로 분할
 *
 * @param messages - 수집된 메시지 배열
 * @param options - 청크화 옵션
 * @returns 청크화 결과
 */
export const createChunks = (
  messages: Array<StructuredSnapshotMessage | TranscriptTurn>,
  options: ChunkerOptions = {},
): ChunkerResult => {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const sessionUrl = options.sessionUrl ?? null;
  const timestamp = Date.now();

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      chunks: [],
      totalMessages: 0,
      sessionUrl,
      createdAt: timestamp,
    };
  }

  const chunks: MemoryChunk[] = [];
  const totalMessages = messages.length;

  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunkMessages = messages.slice(i, i + chunkSize);
    const chunkIndex = Math.floor(i / chunkSize);

    const chunk: MemoryChunk = {
      id: buildChunkId(chunkIndex, timestamp),
      index: chunkIndex,
      range: {
        start: i + 1, // 1-based
        end: Math.min(i + chunkSize, totalMessages),
      },
      messages: chunkMessages,
      raw: buildRawText(chunkMessages),
      timestamp,
    };

    chunks.push(chunk);
  }

  return {
    chunks,
    totalMessages,
    sessionUrl,
    createdAt: timestamp,
  };
};

/**
 * TranscriptTurn 배열을 청크화 (parsers.ts 결과용)
 */
export const createChunksFromTurns = (
  turns: TranscriptTurn[],
  options: ChunkerOptions = {},
): ChunkerResult => {
  return createChunks(turns, options);
};

/**
 * StructuredSnapshotMessage 배열을 청크화 (progressive collection 결과용)
 */
export const createChunksFromMessages = (
  messages: StructuredSnapshotMessage[],
  options: ChunkerOptions = {},
): ChunkerResult => {
  return createChunks(messages, options);
};

export default createChunks;
