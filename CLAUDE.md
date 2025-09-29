# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Genit Memory Helper** is a Tampermonkey userscript that extracts chat logs from genit.ai (a Korean AI chatbot platform) and exports them in structured formats (JSON/Markdown/TXT) with privacy redaction features. It helps users create memory summaries for the platform's 2000-character user notes by exporting conversation history and providing LLM-ready summarization prompts.

Key features:
- Auto-scroll to load conversation history
- Privacy-aware redaction (email, phone, addresses, etc.)
- Export in multiple formats (Rich Markdown/JSON/TXT, Classic formats)
- Message range selection with bookmarking
- Clipboard integration for LLM summarization workflows

## Development Commands

### Building
```bash
npm run build          # Injects version from package.json into userscript
npm run sync:version   # Syncs version metadata only
```

### Testing
```bash
npm test               # Runs unit tests (Vitest) on built dist output
npm run test:unit      # Same as npm test
npm run test:smoke     # Playwright smoke tests (requires credentials)
npm run pretest        # Auto-runs before tests to ensure dist is built
```

**Important**: Unit tests validate the **built** `dist/genit-memory-helper.user.js` file, not source files directly. Always run `npm run build` before testing if you modify the userscript.

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

### Single-File Structure
The entire userscript is contained in **`genit-memory-helper.user.js`** (~7400 lines). This is not a typical Node.js project with separate source files - the userscript is both source and distribution format.

The code is organized into namespaced modules within a single IIFE:

```javascript
const GMH = {
  VERSION: scriptVersion,
  Util: {},        // Utility functions (DOM queries, debounce, etc.)
  Privacy: {},     // Redaction engine & PII detection
  Export: {},      // Format converters (JSON/MD/TXT)
  UI: {},          // Panel rendering & modals
  Core: {},        // State management & coordination
  Adapters: {},    // Platform-specific DOM selectors
};
```

### Key Modules

**GMH.Adapters** (lines ~79-150)
- Registry pattern for platform-specific DOM selectors
- Currently implements `genit` adapter for genit.ai
- Selectors for conversation containers, message blocks, turn elements

**GMH.Core.Range** (lines ~400-750)
- Manages message range selection ("message 1" = latest, "message N" = oldest)
- Converts user-specified ranges (start/end message numbers) to turn indices
- Handles bookmarking for quick range selection

**GMH.Privacy** (lines ~3500-4500)
- Profile-based redaction: SAFE, STANDARD, RESEARCH
- PII detection patterns (email, phone, national ID, IP, etc.)
- Customizable blacklist/whitelist for sensitive terms
- Content safety blocks for CSAM-related content

**GMH.Export** (lines ~4500-5500)
- Structured export (Rich formats): Preserves message parts (code blocks, quotes, images)
- Classic export: Simple text-based formats
- Generates manifest files tracking redaction metadata

**GMH.UI** (lines ~6800-7400)
- Modern panel UI with drag/resize
- Modal system for confirmations
- Auto-collapse behavior
- Keyboard shortcuts (Alt+M toggle, Alt+G focus, Esc close, Alt+P privacy settings)

**GMH.Core.State** (lines ~1200-1400)
- Manages UI state transitions (IDLE → LOADING → READY → ERROR)
- Progress tracking for auto-scroll operations

### Data Flow

1. **DOM Parsing**: Adapter selectors extract conversation structure from genit.ai page
2. **Turn Processing**: Messages are parsed into turn objects with speaker/role/content
3. **Range Application**: User-selected range filters which turns to export
4. **Privacy Pass**: Selected turns undergo redaction based on active profile
5. **Format Conversion**: Redacted data serialized to JSON/MD/TXT
6. **Manifest Generation**: Metadata file tracks redaction stats and settings

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

### UI Flag System
The script uses localStorage flags for feature rollout:
- `gmh_flag_newUI='1'` - Enables modern panel (default since v1.4+)
- `gmh_kill='1'` - Emergency killswitch to disable new UI
- Debug flags: `gmh_debug_range`, `gmh_beta_structured`

### Privacy Gate
All copy/export operations show a confirmation modal displaying:
- Active redaction profile
- Redaction counts by category (EMAIL:2, PHONE:1, etc.)
- Message preview with selected range highlighted
- Warning about sharing responsibility

Users must explicitly confirm before data leaves the browser.

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

## Development Workflow

1. Edit `genit-memory-helper.user.js` directly (it's the source file)
2. Run `npm run build` to copy to dist/ with version injection
3. Run `npm test` to validate (tests import from dist/)
4. For smoke tests, ensure `GENIT_TEST_URL` and credentials are set
5. Use bump scripts for releases (automatically handles versioning and tagging)

## Common Pitfalls

- **Don't edit `dist/genit-memory-helper.user.js` directly** - changes will be overwritten by build
- **Tests require a build** - `pretest` script handles this automatically, but manual builds may be needed during development
- **Smoke tests need real credentials** - they're skipped in CI if secrets aren't configured
- **The userscript is the source** - this isn't a compiled project, the .user.js file IS the deliverable

## Documentation

- `README.md` - Korean user guide with installation, features, and FAQ
- `CHANGELOG.md` - Version history and release notes
- `CONTRIBUTING.md` - Contributor guidelines and tier system
- `PRIVACY.md` - Privacy policy and data handling details
- `docs/dom-genit-structure.md` - DOM structure analysis for genit.ai
- `docs/role-classification-heuristics.md` - Logic for detecting user vs. assistant messages