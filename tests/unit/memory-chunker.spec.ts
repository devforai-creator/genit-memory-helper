import { describe, it, expect } from 'vitest';
import {
  createChunks,
  createChunksFromMessages,
  createChunksFromTurns,
  chunkToBlockInit,
  blockRecordToChunk,
} from '../../src/features/memory-chunker';
import { buildSummaryPrompt, buildFactsPrompt, formatChunkRange, getChunkPreview, DEFAULT_SUMMARY_PROMPT, DEFAULT_FACTS_PROMPT } from '../../src/features/memory-prompts';
import type { StructuredSnapshotMessage, TranscriptTurn, MemoryBlockRecord } from '../../src/types';

const buildMessage = (
  ordinal: number,
  options: Partial<StructuredSnapshotMessage> = {},
): StructuredSnapshotMessage => ({
  id: `msg-${ordinal}`,
  ordinal,
  userOrdinal: null,
  role: options.role ?? 'player',
  channel: options.channel ?? 'user',
  speaker: options.speaker ?? 'User',
  parts: [
    {
      text: options.parts?.[0]?.text ?? `Message ${ordinal} text`,
      lines: [`Message ${ordinal} text`],
      flavor: 'speech',
      role: options.role ?? 'player',
    },
  ],
  ...options,
});

const buildTurn = (index: number): TranscriptTurn => ({
  role: index % 2 === 0 ? 'user' : 'assistant',
  text: `Turn ${index} content`,
});

describe('memory-chunker', () => {
  describe('createChunks', () => {
    it('creates chunks of 10 messages by default', () => {
      const messages = Array.from({ length: 25 }, (_, i) => buildMessage(i + 1));
      const result = createChunks(messages);

      expect(result.chunks).toHaveLength(3);
      expect(result.totalMessages).toBe(25);
      expect(result.chunks[0].messages).toHaveLength(10);
      expect(result.chunks[1].messages).toHaveLength(10);
      expect(result.chunks[2].messages).toHaveLength(5);
    });

    it('creates correct chunk ranges', () => {
      const messages = Array.from({ length: 15 }, (_, i) => buildMessage(i + 1));
      const result = createChunks(messages);

      expect(result.chunks[0].range).toEqual({ start: 1, end: 10 });
      expect(result.chunks[1].range).toEqual({ start: 11, end: 15 });
    });

    it('generates unique chunk IDs', () => {
      const messages = Array.from({ length: 20 }, (_, i) => buildMessage(i + 1));
      const result = createChunks(messages);

      const ids = result.chunks.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('respects custom chunk size', () => {
      const messages = Array.from({ length: 12 }, (_, i) => buildMessage(i + 1));
      const result = createChunks(messages, { chunkSize: 5 });

      expect(result.chunks).toHaveLength(3);
      expect(result.chunks[0].messages).toHaveLength(5);
      expect(result.chunks[1].messages).toHaveLength(5);
      expect(result.chunks[2].messages).toHaveLength(2);
    });

    it('includes session URL in result', () => {
      const messages = [buildMessage(1)];
      const result = createChunks(messages, { sessionUrl: 'https://example.com/chat' });

      expect(result.sessionUrl).toBe('https://example.com/chat');
    });

    it('returns empty result for empty input', () => {
      const result = createChunks([]);

      expect(result.chunks).toHaveLength(0);
      expect(result.totalMessages).toBe(0);
    });

    it('builds raw text from messages', () => {
      const messages = [
        buildMessage(1, { speaker: 'Alice' }),
        buildMessage(2, { speaker: 'Bob', role: 'npc' }),
      ];
      const result = createChunks(messages, { chunkSize: 10 });

      expect(result.chunks[0].raw).toContain('Alice:');
      expect(result.chunks[0].raw).toContain('Bob:');
    });
  });

  describe('createChunksFromTurns', () => {
    it('chunks TranscriptTurn arrays', () => {
      const turns = Array.from({ length: 15 }, (_, i) => buildTurn(i));
      const result = createChunksFromTurns(turns);

      expect(result.chunks).toHaveLength(2);
      expect(result.chunks[0].messages).toHaveLength(10);
    });
  });

  describe('createChunksFromMessages', () => {
    it('chunks StructuredSnapshotMessage arrays', () => {
      const messages = Array.from({ length: 5 }, (_, i) => buildMessage(i + 1));
      const result = createChunksFromMessages(messages);

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].messages).toHaveLength(5);
    });
  });
});

describe('memory-prompts', () => {
  const buildTestChunk = () => {
    const messages = [buildMessage(1), buildMessage(2)];
    return createChunks(messages, { chunkSize: 10 }).chunks[0];
  };

  describe('buildSummaryPrompt', () => {
    it('builds summary prompt with default template', () => {
      const chunk = buildTestChunk();
      const prompt = buildSummaryPrompt(chunk);

      expect(prompt).toContain('다음 대화를 2-3문장으로 요약해주세요');
      expect(prompt).toContain(chunk.raw);
    });

    it('uses custom template when provided', () => {
      const chunk = buildTestChunk();
      const prompt = buildSummaryPrompt(chunk, 'Custom template: {chunk}');

      expect(prompt).toBe(`Custom template: ${chunk.raw}`);
    });
  });

  describe('buildFactsPrompt', () => {
    it('builds facts prompt with default template', () => {
      const chunk = buildTestChunk();
      const prompt = buildFactsPrompt(chunk);

      expect(prompt).toContain('구체적 사실을 추출해주세요');
      expect(prompt).toContain(chunk.raw);
    });

    it('uses custom template when provided', () => {
      const chunk = buildTestChunk();
      const prompt = buildFactsPrompt(chunk, 'Extract facts: {chunk}');

      expect(prompt).toBe(`Extract facts: ${chunk.raw}`);
    });
  });

  describe('formatChunkRange', () => {
    it('formats chunk range correctly', () => {
      const chunk = buildTestChunk();
      const formatted = formatChunkRange(chunk);

      expect(formatted).toMatch(/#1 \(\d+-\d+\)/);
    });
  });

  describe('getChunkPreview', () => {
    it('returns full text for short content', () => {
      const chunk = buildTestChunk();
      const preview = getChunkPreview(chunk, 1000);

      expect(preview).toBe(chunk.raw);
    });

    it('truncates long content with ellipsis', () => {
      const chunk = buildTestChunk();
      const preview = getChunkPreview(chunk, 10);

      expect(preview.length).toBe(13); // 10 chars + "..."
      expect(preview.endsWith('...')).toBe(true);
    });
  });

  describe('default templates', () => {
    it('DEFAULT_SUMMARY_PROMPT contains {chunk} placeholder', () => {
      expect(DEFAULT_SUMMARY_PROMPT).toContain('{chunk}');
    });

    it('DEFAULT_FACTS_PROMPT contains {chunk} placeholder', () => {
      expect(DEFAULT_FACTS_PROMPT).toContain('{chunk}');
    });
  });
});

describe('chunk conversion functions', () => {
  const buildTestMessages = (count: number): StructuredSnapshotMessage[] =>
    Array.from({ length: count }, (_, i) => buildMessage(i + 1, {
      speaker: i % 2 === 0 ? 'User' : 'AI',
      channel: i % 2 === 0 ? 'user' : 'assistant',
    }));

  describe('chunkToBlockInit', () => {
    it('converts MemoryChunk to MemoryBlockInit with correct fields', () => {
      const messages = buildTestMessages(5);
      const result = createChunks(messages, { chunkSize: 5 });
      const chunk = result.chunks[0];
      const sessionUrl = 'https://example.com/chat/123';

      const blockInit = chunkToBlockInit(chunk, sessionUrl);

      expect(blockInit.id).toBe(chunk.id);
      expect(blockInit.sessionUrl).toBe(sessionUrl);
      expect(blockInit.raw).toBe(chunk.raw);
      expect(blockInit.ordinalRange).toEqual([chunk.range.start, chunk.range.end]);
      expect(blockInit.timestamp).toBe(chunk.timestamp);
      expect(blockInit.messages).toHaveLength(5);
    });

    it('preserves summary and facts fields', () => {
      const messages = buildTestMessages(3);
      const result = createChunks(messages, { chunkSize: 10 });
      const chunk = result.chunks[0];
      chunk.summary = 'Test summary';
      chunk.facts = 'Test facts';

      const blockInit = chunkToBlockInit(chunk, 'https://example.com');

      expect(blockInit.summary).toBe('Test summary');
      expect(blockInit.facts).toBe('Test facts');
    });

    it('includes chunk metadata', () => {
      const messages = buildTestMessages(10);
      const result = createChunks(messages, { chunkSize: 5 });
      const chunk = result.chunks[1]; // second chunk

      const blockInit = chunkToBlockInit(chunk, 'https://example.com');

      expect(blockInit.meta).toBeDefined();
      expect(blockInit.meta?.chunkIndex).toBe(1);
      expect(blockInit.meta?.originalMessageCount).toBe(5);
    });

    it('converts TranscriptTurn messages to StructuredSnapshotMessage format', () => {
      const turns: TranscriptTurn[] = [
        { role: 'user', text: 'Hello' },
        { role: 'assistant', text: 'Hi there' },
      ];
      const result = createChunksFromTurns(turns, { chunkSize: 10 });
      const chunk = result.chunks[0];

      const blockInit = chunkToBlockInit(chunk, 'https://example.com');

      expect(blockInit.messages).toHaveLength(2);
      expect(blockInit.messages[0].parts).toBeDefined();
      expect(blockInit.messages[0].parts[0].text).toBe('Hello');
    });
  });

  describe('blockRecordToChunk', () => {
    it('converts MemoryBlockRecord to MemoryChunk with correct fields', () => {
      const record: MemoryBlockRecord = {
        id: 'gmh-chunk-0-12345',
        sessionUrl: 'https://example.com/chat',
        raw: 'User: Hello\n\nAI: Hi',
        messages: buildTestMessages(3),
        ordinalRange: [1, 3],
        timestamp: 12345,
        embedding: null,
        messageCount: 3,
        startOrdinal: 1,
        endOrdinal: 3,
        meta: { chunkIndex: 0, originalMessageCount: 3 },
      };

      const chunk = blockRecordToChunk(record);

      expect(chunk.id).toBe(record.id);
      expect(chunk.index).toBe(0);
      expect(chunk.range).toEqual({ start: 1, end: 3 });
      expect(chunk.raw).toBe(record.raw);
      expect(chunk.messages).toHaveLength(3);
      expect(chunk.timestamp).toBe(record.timestamp);
    });

    it('preserves summary and facts from record', () => {
      const record: MemoryBlockRecord = {
        id: 'gmh-chunk-0-12345',
        sessionUrl: 'https://example.com',
        raw: 'test',
        messages: [],
        ordinalRange: [1, 1],
        timestamp: 12345,
        embedding: null,
        messageCount: 0,
        startOrdinal: 1,
        endOrdinal: 1,
        summary: 'Stored summary',
        facts: 'Stored facts',
      };

      const chunk = blockRecordToChunk(record);

      expect(chunk.summary).toBe('Stored summary');
      expect(chunk.facts).toBe('Stored facts');
    });

    it('defaults chunk index to 0 if not in meta', () => {
      const record: MemoryBlockRecord = {
        id: 'gmh-chunk-5-12345',
        sessionUrl: 'https://example.com',
        raw: 'test',
        messages: [],
        ordinalRange: [51, 60],
        timestamp: 12345,
        embedding: null,
        messageCount: 0,
        startOrdinal: 51,
        endOrdinal: 60,
        // no meta
      };

      const chunk = blockRecordToChunk(record);

      expect(chunk.index).toBe(0);
    });

    it('extracts chunk index from meta.chunkIndex', () => {
      const record: MemoryBlockRecord = {
        id: 'gmh-chunk-3-12345',
        sessionUrl: 'https://example.com',
        raw: 'test',
        messages: [],
        ordinalRange: [31, 40],
        timestamp: 12345,
        embedding: null,
        messageCount: 0,
        startOrdinal: 31,
        endOrdinal: 40,
        meta: { chunkIndex: 3 },
      };

      const chunk = blockRecordToChunk(record);

      expect(chunk.index).toBe(3);
    });
  });

  describe('round-trip conversion', () => {
    it('chunk → blockInit → record → chunk preserves data', () => {
      const messages = buildTestMessages(5);
      const result = createChunks(messages, { chunkSize: 5 });
      const originalChunk = result.chunks[0];
      originalChunk.summary = 'Test summary';
      originalChunk.facts = 'Test facts';

      // Chunk → BlockInit
      const blockInit = chunkToBlockInit(originalChunk, 'https://example.com');

      // Simulate saving to IndexedDB (create record from init)
      const record: MemoryBlockRecord = {
        ...blockInit,
        embedding: null,
        messageCount: blockInit.messages.length,
        startOrdinal: blockInit.ordinalRange[0],
        endOrdinal: blockInit.ordinalRange[1],
      };

      // Record → Chunk
      const restoredChunk = blockRecordToChunk(record);

      expect(restoredChunk.id).toBe(originalChunk.id);
      expect(restoredChunk.range).toEqual(originalChunk.range);
      expect(restoredChunk.raw).toBe(originalChunk.raw);
      expect(restoredChunk.summary).toBe(originalChunk.summary);
      expect(restoredChunk.facts).toBe(originalChunk.facts);
      expect(restoredChunk.messages).toHaveLength(originalChunk.messages.length);
    });
  });
});
