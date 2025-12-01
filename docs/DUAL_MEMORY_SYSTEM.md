# Dual Memory System Guide

> **⚠️ 참조 문서 (Reference Document)**
> 이 문서는 **RebelAI 프로젝트**에서 구현된 Dual Memory 시스템의 원본 문서입니다.
> GMH(General Memory Helper)의 Dual Memory 구현은 이 철학을 참고하되,
> 브라우저 userscript 환경에 맞게 재설계되었습니다.
>
> **GMH Dual Memory 로드맵**: [ROADMAP.md](../ROADMAP.md#-v300---dual-memory-core-이중-메모리-시스템)

---

**Version**: 0.6.6 (RebelAI)
**Last Updated**: 2025-11-12
**Status**: Production (RebelAI)
**GMH 참조일**: 2025-12-01

## Overview

RebelAI implements a **dual memory system** inspired by human memory architecture to balance efficient summarization with detail preservation. This system addresses a fundamental trade-off in long-term chat memory: abstract summaries lose specific details, but raw messages consume too many tokens.

### Memory Types

1. **Semantic Memory** — Abstract summaries
   - Hierarchical summarization of conversations
   - 2-level system: chunk summaries → meta summaries
   - Optimizes token usage for long conversations
   - Implementation: `chat_summaries` table (existing)

2. **Episodic Memory** — Concrete facts
   - Preserves specific details: dates, places, food, promises, etc.
   - Extracted in parallel with summaries (not from summaries)
   - Plain text format for flexibility
   - Implementation: `chat_facts` table (new in v0.6.6)

### The Problem We're Solving

**Before v0.6.6:**
```
Original: "November 10, 2025, first meeting while eating tteokbokki at 'Meko Restaurant'"
After summarization: "had food at a restaurant"
```

Hierarchical summarization loses specificity through abstraction. Important details like exact dates, place names, and food choices are lost.

**After v0.6.6:**
- **Semantic memory** maintains: "had food at a restaurant" (efficient)
- **Episodic memory** preserves: "November 10, 2025, first meeting while eating tteokbokki at 'Meko Restaurant'" (specific)
- Both are included in context when building prompts

## Architecture

### Database Schema

#### chat_facts table (Migration 27)

```sql
CREATE TABLE IF NOT EXISTS public.chat_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_seq int NOT NULL,
  end_seq int NOT NULL,
  facts text NOT NULL,  -- Plain text, not JSON
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT chat_facts_unique_range UNIQUE (chat_id, start_seq, end_seq)
);

-- RLS policies: user_id = auth.uid()
-- Indexes: chat_id, (chat_id, start_seq, end_seq)
```

#### profiles table extension (Migration 28)

```sql
ALTER TABLE public.profiles
  ADD COLUMN fact_extraction_prompt TEXT;
```

Users can customize their fact extraction prompt in account settings.

#### Realtime support (Migration 29)

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE chat_facts;
ALTER TABLE public.chat_facts REPLICA IDENTITY FULL;
```

Enables real-time UI updates when facts are created/edited.

### Extraction Flow

```
New messages arrive (10+ accumulate)
         ↓
processChunkSummaries() triggered
         ↓
     ┌───┴────┐
     ↓        ↓
createChunk   createChunk
Summary()     Facts()
     ↓        ↓
  Semantic   Episodic
   Memory     Memory
     ↓        ↓
chat_summaries  chat_facts
    table       table
```

**Key Points:**
- Facts are extracted **in parallel** with summaries, not from summaries
- Both use the same 10-message chunk boundaries
- Both use the user's configured API key and model (BYOK)
- Extraction happens in `src/lib/chat-summaries.ts`

### Context Building

When building context for LLM prompts (see `buildContext()` in `src/lib/chat-summaries.ts`):

1. Load meta summaries (level 1+)
2. Load chunk summaries (level 0)
3. **Load episodic facts** (NEW in v0.6.6)
4. Load recent messages (within `CONTEXT_WINDOW`)

The context structure:

```
=== Full Conversation Summary ===
(meta summaries)

=== Chunk Summaries ===
(chunk summaries)

=== Key Facts to Remember ===  ← NEW
(episodic facts)

=== Recent Conversation ===
(recent messages)
```

### Manual Regeneration Controls (v0.7.2+)

UI operators can now re-run either layer of the memory system directly from **Dashboard → Long-term Memory Summary**:

- **Summary card recycle button**: When regenerating, re-extracts chunk summary and episodic memory for the specified message range (10 messages). Allows recovery when LLM leaves fallback text without clearing the chat.
- **Meta summary card recycle button**: Re-synthesizes 10 consecutive chunk summaries to update the higher-level overview. After re-running chunks, realign subsequent meta summaries with one click.
- **Episodic memory card recycle button**: Re-extracts only the facts for that range, and if needed, use the embed refresh button to regenerate RAG vectors.

Each button calls `/api/summaries/generate` with the same BYOK key/model, processing only the specified range, allowing quality recovery without wasting tokens or time.

## Implementation Details

### Fact Extraction Prompt

Default prompt is defined in `src/lib/chat-summaries.ts`:

```typescript
export const DEFAULT_FACT_EXTRACTION_PROMPT = `Extract specific facts from the following conversation that are worth referencing later, in Korean. Write each fact as a single bullet point line. Exclude generic conversational content.

Extract these types of facts:
- First-time events (first meeting, first experience, etc.)
- Specific places, dates, times, food, etc.
- Personal preferences, habits, characteristics
- Important promises or decisions
- Emotionally significant moments

Output format (plain text only, no JSON or Markdown):
- 2025년 11월 10일, '메코 식당'에서 떡볶이를 먹으며 처음 만남
- 사용자는 매운 음식을 잘 먹는다고 함
- 캐릭터는 고양이를 무서워함

If there are no significant facts to record, respond with only "No facts to record".`
```

Users can customize this in **Account Settings → Long-term Memory System Prompt**.

### Plain Text Format

Facts are stored as **plain text** (not JSON) for several reasons:

1. **Flexibility**: LLM output format can vary without breaking storage
2. **Error resilience**: No JSON parsing errors
3. **Human-readable**: Easy to view/edit in Supabase dashboard
4. **LLM-friendly**: Can be directly included in prompts

Example stored format:
```
- November 10, 2025, first meeting while eating tteokbokki at 'Meko Restaurant'
- User said they enjoy spicy food
- Character is afraid of cats
```

### createChunkFacts() Function

Located in `src/lib/chat-summaries.ts`:

```typescript
async function createChunkFacts({
  supabase,
  chatId,
  userId,
  model,
  startSeq,
  endSeq,
  factPrompt,
}: {
  supabase: SupabaseClient
  chatId: string
  userId: string
  model: any
  startSeq: number
  endSeq: number
  factPrompt: string
}) {
  // 1. Load messages for chunk
  const { data: messages } = await supabase
    .from('messages')
    .select('role, content')
    .eq('chat_id', chatId)
    .order('sequence', { ascending: true })
    .range(fromIndex, toIndex)

  // 2. Format transcript
  const formattedTranscript = messages
    .map((msg) => `${msg.role.toUpperCase()}: ${truncateText(msg.content, MESSAGE_CHAR_LIMIT)}`)
    .join('\n')

  // 3. Extract facts via LLM
  const { text } = await generateText({
    model,
    system: factPrompt,
    prompt: formattedTranscript,
    maxTokens: 1024,
    temperature: 0,
  })

  // 4. Check for "no facts" response
  const facts = text.trim()
  if (facts.includes('No facts to record') || facts.length < 10) {
    return // Skip saving
  }

  // 5. Save to database
  await supabase.from('chat_facts').insert({
    chat_id: chatId,
    user_id: userId,
    start_seq: startSeq,
    end_seq: endSeq,
    facts,
  })
}
```

### Prompt Caching Strategy (v0.7.x)

To cut token costs, every OpenAI call in the dual-memory pipeline now sends an explicit `promptCacheKey`:

- **Chat job runner** reuses a stable key per chat (`chat:<chatId>`) for GPT-5.1. Other OpenAI models fall back to a hashed context key so their prefixes can still hit implicit caching. Cache retention sticks to `24h` when the model supports it; otherwise it downgrades to `in_memory`.
- **Chunk summaries** use `summary:<chatId>:<startSeq>-<endSeq>`, **episodic facts** use `facts:<chatId>:<startSeq>-<endSeq>`, and **meta summaries** use `meta:<chatId>:<startSeq>-<endSeq>`. Re-running the same range within 24 hours almost always serves from cache, so QA/ops can regenerate safely without double-paying.
- Each LLM call includes a token estimate (`estimateTokenCount`) so we only request caching once the context passes `OPENAI_PROMPT_CACHE_MIN_TOKENS` (default 1,024). You can toggle the feature with `OPENAI_PROMPT_CACHE_ENABLED` or force shorter retention via `OPENAI_PROMPT_CACHE_RETENTION`.
- Cache usage is recorded in `messages.debug_info.promptCache` and `debug_info.cacheHit` for the chat runner, making it easy to audit Supabase rows without inspecting logs.

Providers other than OpenAI simply ignore the override and behave as before, so the strategy is safe to roll out regardless of the BYOK vendor.

#### Gemini Prompt Caching Status

- **Implicit caching** already works today: Gemini 2.5 Flash caches prefixes ≥1,024 tokens and 2.5 Pro caches prefixes ≥2,048 tokens with no code changes. Cache hits discount the cached portion by **75 %** on the direct Gemini API (only 25 % of the normal input cost is billed) and by **90 %** when routed through Vertex AI. We keep the header (global system prompt → character profile → summaries → lorebook → recent messages) stable, so most repeated headers benefit automatically.
- **Explicit caching** requires us to create a `cachedContents/{id}` resource, store that ID (plus TTL) in Postgres, and delete it when it expires to avoid hourly storage fees. This would let us pin a long-lived header (e.g., shared character description) and guarantee 90 % discounts, but it adds operational overhead and extra cron/cleanup work.
- Because Risu preset/lorebook output can vary each time due to keyword matching, it's difficult to bundle "identical system blocks" into cache. Unless we first separate lorebook from headers, explicit caching is deemed too complex relative to benefit and remains **on hold**.
- If we revisit Gemini explicit caching later, start by picking deterministic prompts (e.g., identical chunk summary ranges) and design a `gemini_prompt_cache` table to record the `cachedContents` name, `chat_id`, `range`, and `expires_at`.

### UI Components

#### ChatSummariesPanel

Located in `src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx`:

- Three collapsible sections:
  - **Meta summaries**
  - **Chunk summaries**
  - **Episodic facts** ← NEW
- Each section can be independently expanded/collapsed
- Realtime subscription updates facts live
- Shows count badges: "Episodic facts (3)"

```typescript
// Realtime subscription
supabase.channel(`chat_facts:${chatId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'chat_facts',
    filter: `chat_id=eq.${chatId}`,
  }, (payload) => {
    if (payload.eventType === 'INSERT') {
      setFacts((prev) => [...prev, payload.new as FactType])
    }
    // ... UPDATE, DELETE handlers
  })
  .subscribe()
```

#### Account Settings

Located in `src/app/dashboard/account/page.tsx`:

Users can customize three prompts:
1. Chunk summary prompt
2. Meta summary prompt
3. **Fact extraction prompt** ← NEW

Changes are saved via server action and take effect on next summary generation.

## Backfill Script

### Purpose

For conversations that existed before v0.6.6, use `scripts/backfill-facts.js` to extract facts from existing chunks.

### Setup

Add to `.env.local`:

```bash
# Choose your provider: google, openai, or anthropic
BACKFILL_API_PROVIDER=google
BACKFILL_API_KEY=your-google-api-key
BACKFILL_MODEL_NAME=gemini-2.0-flash-exp

# Examples for other providers:
# BACKFILL_API_PROVIDER=openai
# BACKFILL_MODEL_NAME=gpt-4o-mini

# BACKFILL_API_PROVIDER=anthropic
# BACKFILL_MODEL_NAME=claude-3-5-haiku-20241022
```

### Usage

```bash
npm run backfill:facts
```

The script will:
1. Find all chunk-level summaries (`level = 0` in `chat_summaries`)
2. For each chunk:
   - Check if facts already exist (skip if yes)
   - Load original messages for the chunk
   - Extract facts using configured LLM
   - Save to `chat_facts` table
3. Print summary: total processed, created, skipped, errors

**Rate limiting**: 500ms delay between chunks to avoid API rate limits.

### Manual Alternative

You can also manually insert facts via Supabase Dashboard:

1. Navigate to **Table Editor → chat_facts**
2. Click **Insert → Insert row**
3. Fill in:
   - `chat_id`: (UUID from chats table)
   - `user_id`: (UUID from profiles table)
   - `start_seq`: Starting message sequence (e.g., 1)
   - `end_seq`: Ending message sequence (e.g., 10)
   - `facts`: Plain text bullet points
4. `id`, `created_at`, `updated_at` auto-generate

## Migration Checklist

When deploying v0.6.6:

- [ ] Run migration 27: `27_chat_facts_table.sql`
- [ ] Run migration 28: `28_fact_extraction_prompt.sql`
- [ ] Run migration 29: `29_enable_realtime_chat_facts.sql`
- [ ] Add `SUMMARY_GENERATION_SECRET` to production environment
- [ ] (Optional) Configure backfill script and run for existing chats
- [ ] Verify Realtime is working in production

## Performance Considerations

### Token Usage

Each fact extraction adds:
- **Input tokens**: ~200-500 per chunk (10 messages, truncated to 1200 chars each)
- **Output tokens**: ~50-200 per chunk (facts are concise)
- **Cost**: Minimal (uses flash models by default)

Facts are only generated when summaries are generated (every 10 messages), not on every message.

### Database Load

- Facts table grows at same rate as summaries (one row per 10-message chunk)
- Indexes on `chat_id` and `(chat_id, start_seq, end_seq)` keep queries fast
- Realtime publication adds minimal overhead

### Context Window Impact

Including facts in context adds ~50-200 tokens per chunk with facts. This is offset by the fact that facts are highly relevant and replace the need for keeping more raw messages in context.

## Troubleshooting

### Facts not generating

**Check:**
1. Is `SUMMARY_GENERATION_SECRET` set in environment?
2. Are summaries generating? (Facts only generate alongside summaries)
3. Is the LLM returning "No facts to record"? (This is expected for generic conversations)
4. Check logs for LLM errors

### Realtime not updating

**Check:**
1. Has migration 29 been executed?
2. Is Realtime enabled for `chat_facts` in Supabase dashboard?
3. Check browser console for subscription errors
4. Verify RLS policies allow the current user

### Backfill script errors

**Common issues:**
- **Invalid JSON response**: LLM not following output format (expected, script skips these)
- **API rate limits**: Increase delay between chunks in script
- **Missing environment variables**: Verify `BACKFILL_API_PROVIDER`, `BACKFILL_API_KEY`, `BACKFILL_MODEL_NAME`

**Alternative**: Use manual insertion via Supabase dashboard (see above).

## Design Decisions

### Why plain text instead of JSON?

**Considered**: Structured JSON like `{ "date": "...", "place": "...", "event": "..." }`

**Rejected because:**
- LLMs produce inconsistent JSON, leading to parsing errors
- Facts vary in structure (some have dates, some don't)
- Plain text is more flexible for future prompt changes
- Human-readable format is easier to debug

### Why extract from messages, not summaries?

**Considered**: Extract facts from chunk summaries (would save tokens)

**Rejected because:**
- Summaries already lose details we want to preserve
- Extracting from summaries compounds the information loss
- Small token savings not worth the quality loss

### Why same chunk boundaries?

**Considered**: Different chunk sizes for facts vs summaries

**Rejected because:**
- Simplifies implementation (one `processChunkSummaries()` call)
- Easier to understand and debug
- Natural alignment between facts and summaries

## Future Enhancements

Potential improvements (not currently planned):

1. **Semantic search**: Embed facts for similarity search
2. **Fact editing**: UI for users to edit/delete facts
3. **Fact importance scoring**: Weight facts by relevance
4. **Cross-chat facts**: Link facts across multiple chats with same character
5. **Fact categories**: Tag facts by type (date, place, preference, etc.)

## See Also

- `CHANGELOG.md` — v0.6.6 release notes
- `DATABASE_SCHEMA.md` — chat_facts table schema
- `src/lib/chat-summaries.ts` — Implementation
- `scripts/backfill-facts.js` — Backfill script source
