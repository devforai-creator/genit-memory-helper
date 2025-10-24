# AI Agent Guidelines

This document provides guidance for AI coding agents (e.g., Cursor, Copilot, Codex, Claude Code) working on the Genit Memory Helper codebase.

## Quick Reference

**Current Version**: v2.1.0 (Infrastructure - Real-time indexing, block storage, feature flags)
**Next Goal**: v2.2.0 (Semantic Search - BGE-M3 embedding, search UI)
**Language**: TypeScript (migrated from JavaScript in v2.0.0)
**Build System**: Rollup + TypeScript
**Test Framework**: Vitest (unit), Playwright (smoke)

## Project Overview

**Genit Memory Helper** is a Tampermonkey userscript that:
- Extracts chat logs from genit.ai (Korean AI chatbot platform)
- Exports conversations in JSON/Markdown/TXT with privacy redaction
- **[v2.1.0]** Indexes messages in real-time for future semantic search
- **[v2.1.0]** Stores 5-message blocks in IndexedDB for persistent memory

## Architecture (v2.1.0)

### Module Structure

```
src/
├── index.ts            # Entry point, GMH namespace, wiring
├── env.ts              # Environment abstraction (window, localStorage, GM_*)
├── types/              # TypeScript type definitions
├── core/               # State, error handling, export range, message indexer
├── adapters/           # genit.ai DOM selectors and role detection
├── privacy/            # Redaction profiles, patterns, pipeline
├── export/             # Parsers, writers (JSON/MD/TXT), manifest
├── features/           # Auto-loader, share, guides, block-builder, message-stream
├── storage/            # [v2.1.0] IndexedDB block storage
├── experimental/       # [v2.1.0] Feature flag system
├── ui/                 # Panels, modals, controls, block viewer
└── utils/              # Text, DOM, validation helpers
```

### Key Systems

**Message Indexing Pipeline (v2.1.0)**:
1. `MessageIndexer` (src/core/message-indexer.ts) detects new messages via MutationObserver
2. `MessageStream` (src/features/message-stream.ts) waits for streaming completion (8s + retry)
3. `BlockBuilder` (src/features/block-builder.ts) creates 5-message blocks
4. `BlockStorage` (src/storage/block-storage.ts) persists to IndexedDB
5. `MemoryStatus` (src/ui/memory-status.ts) displays count in panel

**Export Pipeline (v2.0)**:
1. Adapter parses DOM → StructuredSnapshotMessage
2. ExportRange applies bookmarks/filters
3. Privacy pipeline redacts sensitive data
4. Writers serialize to JSON/MD/TXT
5. Manifest records redaction stats

### Critical Files

**DO NOT MODIFY WITHOUT REVIEW**:
- `src/index.ts` - Entry point, namespace wiring
- `src/env.ts` - Environment abstraction (breaks tests if wrong)
- `src/types/index.ts` - Type definitions (affects entire codebase)
- `src/adapters/genit.ts` - DOM selectors (breaks if genit.ai changes)

**SAFE TO EXTEND**:
- `src/features/*` - Add new features here
- `src/ui/*` - UI components
- `src/utils/*` - Helper functions

## Development Commands

### Building

```bash
# REQUIRED for development (bundles TypeScript)
USE_ROLLUP=1 npm run build

# Version injection only (DO NOT USE for dev)
npm run build

# Version sync only
npm run sync:version
```

**IMPORTANT**: Since v2.0.0, `USE_ROLLUP=1` is **mandatory**. Plain `npm run build` does NOT bundle TypeScript.

### Testing

```bash
# Unit tests (auto-runs USE_ROLLUP=1 build via pretest)
npm test

# Smoke tests (requires GENIT_TEST_URL, GENIT_USER, GENIT_PASS)
npm run test:smoke
```

### Release

```bash
# Bump version, build, commit, tag, push
npm run bump:patch   # 2.1.0 → 2.1.1
npm run bump:minor   # 2.1.0 → 2.2.0
npm run bump:major   # 2.1.0 → 3.0.0
```

**DO NOT bump versions manually**. Only the maintainer runs bump scripts.

## Coding Standards

### TypeScript

- **Strict mode enabled** - No implicit any, strict null checks
- **Use types from `src/types/index.ts`** - Don't duplicate types
- **Prefer interfaces over types** for object shapes
- **Export types** that cross module boundaries

### Style

- **2-space indentation** (enforced by Prettier)
- **Single quotes** for strings
- **Semicolons required**
- **camelCase** for variables/functions, **PascalCase** for types
- **UPPER_SNAKE_CASE** for constants

### Naming Conventions

```typescript
// Good
const messageCount = 5;
const DEFAULT_BLOCK_SIZE = 5;
interface MessageBlock { ... }
function createBlockBuilder() { ... }

// Bad
const message_count = 5;  // snake_case
const defaultBlockSize = 5;  // not a constant
type messageBlock = { ... };  // lowercase type
function CreateBlockBuilder() { ... }  // PascalCase function
```

## Single Source of Truth (SoT)

### Privacy Settings

```typescript
// ✅ CORRECT
import { createPrivacyStore } from './privacy/store';
const store = createPrivacyStore();
const profile = store.getProfile();

// ❌ WRONG
const profile = localStorage.getItem('gmh_privacy_profile');
```

### Environment Access

```typescript
// ✅ CORRECT
import { ENV } from './env';
ENV.localStorage.setItem('key', 'value');
ENV.console.log('message');

// ❌ WRONG
localStorage.setItem('key', 'value');  // Direct global access
console.log('message');  // Direct global access
```

### Adapter Registry

```typescript
// ✅ CORRECT
import { getActiveAdapter } from './adapters/registry';
const adapter = getActiveAdapter();
const blocks = adapter.listMessageBlocks();

// ❌ WRONG
const blocks = document.querySelectorAll('.some-selector');  // Hardcoded selector
```

## Testing Guidelines

### Manual Testing Workflow

1. Run `USE_ROLLUP=1 npm run build`
2. Open Tampermonkey dashboard
3. Update script content with `dist/genit-memory-helper.user.js`
4. Navigate to `https://genit.ai/`
5. Test:
   - Panel loads
   - Export buttons work
   - Privacy gate shows
   - **[v2.1.0]** Memory status shows block count
   - **[v2.1.0]** Console: `GMH.Core.BlockStorage.then(s => s.getAll())`

### Unit Testing

- Tests run on **built dist output**, not source files
- `pretest` hook auto-builds before tests
- Focus tests on:
  - Parsers (DOM → StructuredSnapshotMessage)
  - Writers (Session → JSON/MD/TXT)
  - Privacy pipeline (redaction correctness)
  - **[v2.1.0]** BlockBuilder (5-message blocks, overlap)

### Smoke Testing

Requires env vars:
- `GENIT_TEST_URL` - Conversation URL (requires login)
- `GENIT_USER` / `GENIT_PASS` - Test credentials
- `GENIT_DEMO_URL` (optional) - Public demo URL

Tests auto-skip if credentials missing.

## Commit Conventions

**MUST follow Conventional Commits format:**

```
<type>: <description>

[optional body]
```

**Types**:
- `feat:` - New feature (e.g., `feat: add block viewer UI`)
- `fix:` - Bug fix (e.g., `fix: handle streaming completion`)
- `docs:` - Documentation (e.g., `docs: update AGENTS.md`)
- `refactor:` - Code refactoring (e.g., `refactor: extract block builder`)
- `test:` - Test changes (e.g., `test: add BlockStorage unit tests`)
- `chore:` - Build/tooling (e.g., `chore: update rollup config`)
- `perf:` - Performance (e.g., `perf: cache DOM queries`)
- `style:` - Formatting only (e.g., `style: run prettier`)

**Examples**:
```
feat: implement 5-message block generation
fix: prevent duplicate blocks on page refresh
docs: add v2.1.0 architecture to AGENTS.md
refactor: move block builder to features/
test: add IndexedDB storage tests
chore: update dependencies
```

## v2.1.0 Specific Notes

### Memory Index Pipeline

**When modifying the pipeline**:
1. Update `src/core/message-indexer.ts` for message detection changes
2. Update `src/features/message-stream.ts` for streaming logic
3. Update `src/features/block-builder.ts` for block generation
4. Update `src/storage/block-storage.ts` for persistence
5. Update `src/ui/memory-status.ts` for UI display
6. Run `USE_ROLLUP=1 npm run build` and test manually

**Common Issues**:
- **Duplicate blocks**: Check `seenIds` in BlockBuilder
- **Empty messages**: Streaming completion timing in MessageStream
- **Wrong ordinals**: MessageIndexer assignment logic (reverse order: newest=1)
- **Storage errors**: IndexedDB quota or schema version mismatch

### IndexedDB

**Database**: `gmh-memory-blocks` (version 1)
**Store**: `blocks` (keyPath: `id`)

**Accessing from console**:
```javascript
// Get storage instance (Promise-based)
GMH.Core.BlockStorage.then(s => {
  s.getAll().then(console.log);
  s.getBySession(sessionUrl).then(console.log);
  s.delete(blockId);
  s.clear();
});

// Get current session blocks
GMH.Core.MessageStream.getBuffer();  // Current buffer
```

**Limitations**:
- Per-browser, per-device (no sync)
- ~5-10% disk quota
- Lost in private mode / browser reset
- No backfill (past messages not indexed)

### Feature Flags

```javascript
// Enable memory indexing
GMH.Experimental.MemoryIndex.enable();
location.reload();

// Check status
GMH.Experimental.MemoryIndex.enabled;  // true/false

// Disable
GMH.Experimental.MemoryIndex.disable();
```

Flags stored in `localStorage` with `gmh_experimental_*` prefix.

## Common Pitfalls

❌ **Editing `dist/` directly** - Changes overwritten by build
❌ **Using `npm run build` without `USE_ROLLUP=1`** - Doesn't bundle TypeScript
❌ **Accessing globals directly** - Use `ENV.window`, `ENV.localStorage`
❌ **Hardcoding selectors** - Use adapter registry
❌ **Bumping versions** - Only maintainer runs `npm run bump:*`
❌ **Skipping manual tests** - Always test in Tampermonkey after changes
❌ **Ignoring TypeScript errors** - Fix before committing

## When Stuck

1. **Read the docs**:
   - `CLAUDE.md` - Detailed architecture
   - `ROADMAP.md` - Feature roadmap
   - `gmh_poc_final_report.md` - Embedding PoC findings
   - `docs/role-classification-heuristics.md` - Role detection logic

2. **Check console**:
   - `GMH` - Inspect namespace
   - `GMH.Core.BlockStorage` - Check storage
   - `GMH.Core.MessageIndexer.getSummary()` - Message counts
   - `GMH.Experimental.MemoryIndex.enabled` - Feature flag status

3. **Ask maintainer**:
   - Unclear requirements
   - Breaking changes needed
   - Version bump requests
   - Architecture decisions

## Documentation Updates

**When modifying these systems, update docs**:

| System | Files to Update |
|--------|----------------|
| Message indexing | `CLAUDE.md`, `AGENTS.md`, `docs/role-classification-heuristics.md` |
| Block generation | `CLAUDE.md`, `ROADMAP.md` |
| IndexedDB schema | `CLAUDE.md`, `src/types/index.ts` |
| Export formats | `README.md`, `PRIVACY.md` |
| Privacy redaction | `PRIVACY.md`, `src/privacy/constants.ts` |
| Feature flags | `CLAUDE.md`, `AGENTS.md` |

## Workflow Summary

```bash
# 1. Make changes to src/
vim src/features/my-feature.ts

# 2. Build (bundles TypeScript)
USE_ROLLUP=1 npm run build

# 3. Test
npm test  # Unit tests
# Manual test in Tampermonkey

# 4. Commit (conventional format)
git add .
git commit -m "feat: add my feature"

# 5. Push (maintainer reviews)
git push origin feature-branch
```

---

**Last Updated**: 2025-10-24 (v2.1.0)
**Next Review**: Before v2.2.0 (Semantic Search)
