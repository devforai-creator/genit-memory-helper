# Codex Review – 2025-09-30

## Findings

1. **High – Structured Markdown code fences render incorrectly**  
   - Evidence: `src/export/writers-structured.js:28` pushes ``\u0060\u0060\u0060${language}`` for the opening fence, while the closing fence is the literal string ```.
   - Impact: the export output contains the escaped sequence (`\u0060\u0060\u0060js`) instead of actual backticks, so fenced code blocks never render. Users lose syntax highlighting and multi-line code formatting in the ``Export → Structured Markdown`` pathway.
   - Recommendation: emit real backticks for the fence (e.g. `out.push('```' + language);`) and exercise the structured Markdown snapshot path to ensure round-tripping works.

2. **High – Snapshot transcript drops legitimate duplicate lines**  
   - Evidence: `src/features/snapshot.js:112-161` tracks a `seenLine` set across the whole capture. When a later message contains the same trimmed text as an earlier one, the exporter skips it (`if (!trimmed || seenLine.has(trimmed)) return`).  
   - Impact: repeated dialogue such as stock greetings or repeated emotes never make it into `legacyLines`, so JSON/TXT/Markdown exports—and range calculations tied to `entryOrigin`—silently lose messages and miscount ordinals. This also prevents accurate diffing against the on-screen transcript.
   - Recommendation: deduplicate per block only (the existing `localSeen` already handles intra-message duplication) or key the seen-set by `(originIndex,text)` instead of the raw string. Add regression fixtures covering identical consecutive NPC/user lines.

## Suggested Tests & Follow-up
- Extend `tests/unit/structured-export.spec.js` with a snapshot containing a code block and assert the fenced block uses literal backticks.
- Add a fixture to `tests/unit/export-range.spec.js` (or a new suite) where two separate turns share identical text to confirm the exporter keeps both entries.
- Update `docs/role-classification-heuristics.md` to reflect the actual `PLAYER_MARK` (`⟦PLAYER⟧ `) so troubleshooting instructions match the script.
