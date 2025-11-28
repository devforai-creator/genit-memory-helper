# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**General Memory Helper (GMH)** is a Tampermonkey userscript that extracts chat logs from AI chatbot platforms (genit.ai, babechat.ai) and exports them in structured formats (JSON/Markdown/TXT) with privacy redaction features. It helps users create memory summaries for platform user notes by exporting conversation history and providing LLM-ready summarization prompts.

**Supported Platforms:**
- **genit.ai** - Full support (original target)
- **babechat.ai** - Full support (v2.2.0+)

Key features:
- Auto-scroll to load conversation history
- Privacy-aware redaction (email, phone, addresses, etc.)
- Export in multiple formats (Rich Markdown/JSON/TXT, Classic formats)
- Message range selection with bookmarking
- Clipboard integration for LLM summarization workflows
- **[v2.1.0]** Real-time message indexing with 5-message block generation
- **[v2.1.0]** IndexedDB persistent storage for conversation blocks
- **[v2.1.0]** Feature flag system for experimental features
- **[v2.2.0]** Multi-platform adapter architecture

## Development Commands

### Building
```bash
USE_ROLLUP=1 npm run build   # TypeScript → Rollup bundle → version injection (REQUIRED after v2.0.0)
npm run build                # Legacy: version injection only (DO NOT USE for development)
npm run sync:version         # Syncs version metadata only
```

**IMPORTANT**: Since v2.0.0 (TypeScript migration), `USE_ROLLUP=1` is **mandatory** for building. The plain `npm run build` only injects version numbers and does not bundle TypeScript sources.

### Testing
```bash
npm test               # Runs unit tests (Vitest) on built dist output
npm run test:unit      # Same as npm test
npm run test:smoke     # Playwright smoke tests (requires credentials)
npm run pretest        # Auto-runs before tests to ensure dist is built
```

**Important**: Unit tests validate the **built** `dist/genit-memory-helper.user.js` file, not source files directly. The `pretest` script automatically runs `USE_ROLLUP=1 npm run build` before testing, so you can just run `npm test` directly.

### Smoke Testing
Smoke tests require environment variables:
- `GENIT_TEST_URL` - A test conversation URL (requires login)
- `GENIT_USER` / `GENIT_PASS` - Test account credentials
- `GENIT_DEMO_URL` (optional) - Public demo URL (no login required)
- `GENIT_LOGIN_*` (optional) - Custom login selectors if defaults don't work

Tests automatically skip if credentials are missing.

### Release Workflow
```bash
npm run bump:patch     # Increment patch version, sync metadata, build, tag, and push
npm run bump:minor     # Same for minor version
npm run bump:major     # Same for major version
```

The bump commands:
1. Increment version in package.json
2. Run `sync:version` to update userscript metadata
3. Run `build` to generate dist output
4. Stage changes and create git commit
5. Create version tag and push to remote

GitHub Actions automatically creates releases when tags are pushed.

### Other Utilities
```bash
npm run fingerprint    # Generate asset hashes (for integrity checks)
```

## Architecture

### Modular Source Layout
The userscript now composes from modules under `src/`, while the bundled `genit-memory-helper.user.js` remains the Tampermonkey deliverable. `src/index.js` exposes the `GMH` namespace, and `src/legacy.js` orchestrates the existing runtime while modules are gradually extracted.

```
src/
├── index.ts            # Tampermonkey entry point (exports GMH/ENV)
├── env.ts              # Environment abstraction (window, localStorage, GM_* APIs)
├── types/              # TypeScript type definitions
├── core/               # State machine, error handler, export range, bookmarks, message indexer
├── adapters/           # Platform adapters (genit.ai, babechat.ai) and registry
├── privacy/            # Profiles, settings store, redaction pipeline
├── export/             # Structured + classic writers, manifest builder, parsers
├── features/           # Auto-loader, share workflow, snapshot, guide prompts, block builder, message stream
├── storage/            # [v2.1.0] IndexedDB block storage
├── experimental/       # [v2.1.0] Feature flag system
├── ui/                 # Panel layout, modal system, range controls, shortcuts, block viewer
└── utils/              # Text, DOM, validation helpers
```

Rollup (see `rollup.config.js`) stitches these modules into the single userscript when `USE_ROLLUP=1 npm run build` is executed. During Phase 5 the remaining UI glue is being migrated out of `src/legacy.js`.

### Key Modules

**Core Infrastructure:**
- `src/core/state.js` / `createStateManager`: centralises progress + status transitions consumed by auto-loader/export routines.
- `src/core/export-range.js`: range calculator used by UI controls and exporters; coordinates bookmarks via `src/core/turn-bookmarks.js`.
- `src/core/message-indexer.ts`: MutationObserver-based real-time message tracking with ordinal assignment and deduplication.

**v2.1.0 Memory Index Pipeline:**
- `src/features/block-builder.ts`: creates 5-message blocks with configurable overlap (currently 0), filters INFO/narration from raw text.
- `src/features/message-stream.ts`: orchestrates MessageIndexer → BlockBuilder → BlockStorage pipeline with streaming completion detection (8s + retry).
- `src/storage/block-storage.ts`: IndexedDB wrapper for persistent block storage with session-based indexing.
- `src/experimental/index.ts`: feature flag system (localStorage-based toggles for experimental features).
- `src/ui/memory-status.ts`: panel UI showing block count and indexing status.
- `src/ui/block-viewer.ts`: modal UI for inspecting stored blocks with message previews and expandable details.

**Export & Privacy:**
- `src/features/share.ts`: end-to-end export workflow (privacy gate, manifest, download) injected with clipboard + GM APIs.
- `src/features/guides.js`: houses the 요약/재요약 prompt templates and exposes copy helpers for reuse and testing.
- `src/privacy/*`: profile settings, pattern constants, redaction pipeline and validation utilities.
- `src/export/*`: DOM snapshot parsers plus structured/classic writers and manifest generator.

**UI Components:**
- `src/ui/panel-interactions.ts`: centralises panel wiring (privacy profile select, export buttons, quick export flow) and composes range/guide/shortcut bindings.
- `src/ui/privacy-gate.ts`: renders modern modal for privacy confirmation with redaction preview.
- `src/ui/guide-controls.ts`: binds the "Guides & Tools" panel buttons.
- `src/ui/range-controls.ts`, `src/ui/auto-loader-controls.ts`, `src/ui/panel-shortcuts.ts`: modern panel wiring for range selection, auto-load toggles, and keyboard shortcuts.

**Adapters:**
- `src/adapters/genit.ts`: DOM adapter for genit.ai with selector definitions and role detection heuristics.
- `src/adapters/babechat.ts`: DOM adapter for babechat.ai with turn-based message grouping and speaker parsing.
- `src/adapters/registry.ts`: Adapter registry for storing and retrieving platform-specific configurations.
- `src/composition/adapter-composition.ts`: Adapter composition logic with URL-based platform detection.

### Data Flow

**Export Flow (v2.0):**
1. **DOM Parsing**: `src/adapters/genit.ts` describes the host DOM and feeds parsers under `src/export/parsers.js`.
2. **Turn Processing**: Parsed turns flow through `src/core/export-range.js` and `src/features/share.ts`, where bookmarks and range filters are applied.
3. **Privacy Pass**: `src/privacy/pipeline.js` redacts the selected turns using the active profile/settings store.
4. **Format Conversion**: `src/export/writers-*.js` serialise the sanitized session into JSON/MD/TXT.
5. **Manifest Generation**: `src/export/manifest.js` records redaction statistics for reproducibility.
6. **UI Feedback**: `src/ui/state-view.ts` and `src/ui/status-manager.ts` mirror state transitions in the panel.

**Memory Index Pipeline (v2.1.0):**
1. **Message Detection**: `src/core/message-indexer.ts` observes DOM mutations and assigns ordinals to new messages, filtering `preview-*` cards.
2. **Streaming Completion**: `src/features/message-stream.ts` waits 8s + retry (up to 12 attempts, 3s intervals) for streaming to complete before processing.
3. **Message Collection**: Adapter's `collectStructuredMessage()` converts DOM elements to `StructuredSnapshotMessage`.
4. **Block Building**: `src/features/block-builder.ts` accumulates 5 messages, removes narration/INFO from `raw` text, creates block with all messages.
5. **Persistent Storage**: `src/storage/block-storage.ts` saves blocks to IndexedDB (`gmh-memory-blocks` database) with session URL indexing.
6. **UI Display**: `src/ui/memory-status.ts` shows block count; `src/ui/block-viewer.ts` allows inspection with 150-char summaries and expand/collapse.

### Testing Architecture

**Unit Tests** (`tests/unit/*` - if present)
- Validate built dist file
- No test files found in current scan - tests may be minimal or in-progress

**Smoke Tests** (`tests/smoke/*.spec.ts`)
- `session.spec.ts`: Authenticated test that loads panel and triggers auto-scroll
- `demo.spec.ts`: Public demo page test (no login)
- `mock.spec.ts`: Likely tests with mock DOM fixtures

Tests inject the userscript via Playwright's `addInitScript()` before page load.

## Important Notes

### Feature Flag System

**v2.1.0 introduces a formal feature flag system** via `src/experimental/index.ts`:

```javascript
// Enable memory indexing (experimental)
GMH.Experimental.MemoryIndex.enable();
location.reload();

// Check status
GMH.Experimental.MemoryIndex.enabled; // true/false

// Disable
GMH.Experimental.MemoryIndex.disable();
```

**Legacy flags** (still supported):
- `gmh_kill='1'` - Emergency killswitch to disable GMH entirely
- Debug flags: `gmh_debug_range`, `gmh_beta_structured`

**Breaking Change (v2.1.0)**: The legacy panel has been removed. Modern UI is always active unless the kill switch is toggled.

**Memory Index Activation**:
- Feature is enabled by default in v2.1.0
- Uses IndexedDB (`gmh-memory-blocks`) for persistent storage
- Blocks are session-specific (keyed by conversation URL)
- New sessions automatically index from start; existing sessions index new messages only

### Privacy Gate
All copy/export operations show a confirmation modal displaying:
- Active redaction profile
- Redaction counts by category (EMAIL:2, PHONE:1, etc.)
- Message preview with selected range highlighted
- Warning about sharing responsibility

Users must explicitly confirm before data leaves the browser.

### Single Source of Truth (SoT) Principles

The codebase follows strict SoT patterns to prevent configuration drift:

**Privacy Settings Access**
- ✅ ALWAYS use `createPrivacyStore()` from `src/privacy/store.js` to read/write settings
- ✅ Import constants from `src/privacy/constants.js` (STORAGE_KEYS, PRIVACY_PROFILES, etc.)
- ❌ NEVER access `ENV.localStorage` or `localStorage` directly for privacy settings
- ❌ NEVER hardcode storage keys or profile names

**Adapter Registry**
- ✅ ALWAYS use `src/adapters/registry.js` API to register/retrieve adapters
- ✅ Define selectors in dedicated adapter files (e.g., `src/adapters/genit.js`)
- ❌ NEVER duplicate selector definitions across files

**Environment Access**
- ✅ ALWAYS import from `src/env.js` (ENV.window, ENV.localStorage, etc.)
- ❌ NEVER access `window`, `localStorage`, `GM_info`, or `console` globals directly

**Archived Snapshots**
- The `*.baseline` files (e.g., `genit-memory-helper.user.js.baseline`) are historical references preserved during major refactors
- These files are NOT used by the build system, tests, or runtime
- All current source code lives in `src/` directory

### IndexedDB Block Storage (v2.1.0)

**Database**: `gmh-memory-blocks` (version 1)
**Object Store**: `blocks` (keyPath: `id`)

**Block Schema**:
```typescript
interface MemoryBlockInit {
  id: string;                    // gmh-block-{start}-{end}-{timestamp}-{counter}
  sessionUrl: string;            // genit.ai conversation URL
  messages: StructuredSnapshotMessage[];  // All messages (no filtering)
  raw: string;                   // Text with INFO/narration filtered
  ordinalRange: [number, number]; // [start, end]
  timestamp: number;             // Block creation time
  meta: {
    blockSize: number;           // Actual message count
    configuredBlockSize: number; // Target size (5)
    overlap: number;             // Overlap count (0)
    sourceOrdinals: number[];    // Ordinal list for debugging
  };
}
```

**Indexes**:
- `sessionUrl` - Query blocks by conversation
- `startOrdinal` - Range queries (future use)
- `timestamp` - Temporal ordering

**Limitations** (see ROADMAP.md for details):
- Per-browser, per-device storage (no cross-device sync)
- Subject to browser storage quotas (~5-10% of disk space)
- Data loss scenarios: private mode, browser reset, manual cache clear
- Backfill (indexing past messages) not yet implemented

### Build Process
The `scripts/build.js` file:
- Copies `genit-memory-helper.user.js` to `dist/`
- Injects current version from package.json into `@version` metadata comment
- No transpilation, bundling, or minification occurs

This keeps the userscript human-readable for Tampermonkey's editor and GitHub viewers.

### DOM Adapter Pattern
If genit.ai changes their DOM structure, update the adapter registration around line 150:
```javascript
GMH.Adapters.register('genit', {
  selectors: {
    conversationList: '.some-new-selector',
    messageBlock: '.another-selector',
    // ... etc
  }
});
```

The script auto-detects genit.ai via URL matching in the userscript header (`@match https://genit.ai/*`).

## Commit Message Convention

**AI agents MUST follow Conventional Commits format:**

```
<type>: <short description>

[optional body]
```

**Types:**
- `feat:` - New feature or enhancement
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `refactor:` - Code refactoring (no functional changes)
- `test:` - Test additions or modifications
- `chore:` - Build process, dependencies, tooling
- `perf:` - Performance improvements
- `style:` - Code style/formatting (no logic changes)

**Examples:**
```
feat: add bookmark navigation shortcuts
fix: resolve privacy gate modal z-index conflict
docs: update CLAUDE.md with commit conventions
refactor: extract range controls to separate module
test: add smoke tests for auto-loader
chore: update rollup dependencies
```

**For human maintainers:** Follow the convention when possible, but simple messages are acceptable for quick fixes and trivial changes.

## Development Workflow

1. Edit TypeScript modules under `src/` (core/adapters/privacy/export/ui/features).
2. Run `npm test` - this automatically runs `USE_ROLLUP=1 npm run build` via `pretest` hook.
3. For manual builds without testing: `USE_ROLLUP=1 npm run build`
4. For smoke tests, ensure `GENIT_TEST_URL` and related credentials are set, then run `npm run test:smoke`.
5. Use bump scripts for releases (they sync metadata, build, tag, and push).

## Common Pitfalls

- **Don't edit `dist/genit-memory-helper.user.js` directly** - changes will be overwritten by the build pipeline
- **Always use `USE_ROLLUP=1` for builds** - since v2.0.0, plain `npm run build` does NOT bundle TypeScript sources
- **`npm test` handles builds automatically** - `pretest` hook runs Rollup build before tests
- **Smoke tests need real credentials** - they're skipped in CI if secrets aren't configured
- **Keep `src/index.ts` lean** - new features should live in `src/features/` or `src/ui/`; avoid importing Tampermonkey globals directly (use `src/env.ts` instead)

## Documentation

- `README.md` - Korean user guide with installation, features, and FAQ
- `CHANGELOG.md` - Version history and release notes
- `ROADMAP.md` - Development roadmap with v2.1.0-v2.4.0+ milestones and semantic search plans
- `CONTRIBUTING.md` - Contributor guidelines and tier system
- `PRIVACY.md` - Privacy policy and data handling details
- `CLAUDE.md` - This file (guidance for Claude Code)
- `AGENTS.md` - Guidelines for AI coding agents
- `docs/dom-genit-structure.md` - DOM structure analysis for genit.ai
- `docs/role-classification-heuristics.md` - Logic for detecting user vs. assistant messages
- `gmh_poc_final_report.md` - Embedding PoC results (BGE-M3, 5+2 block strategy validation)
