# Repository Guidelines

## Project Structure & Module Organization
- `genit-memory-helper.user.js` holds the entire Tampermonkey script; update logic, DOM parsers, and UI helpers here.
- `README.md` covers installation and usage; keep feature explanations in sync with script changes.
- `PRIVACY.md` documents data-handling expectations; review when introducing new logging or exports.
- `docs/` contains heuristics and DOM reference notes. Update alongside parsing changes.
- `tests/` houses the Vitest suites (unit + smoke helpers). Extend these when touching parsing/ExportRange logic.

## Build, Test, and Development Commands
- `npm install` installs the local toolchain (includes `prettier`).
- `npx prettier --check genit-memory-helper.user.js` verifies formatting before committing. Use `--write` if you intend to reformat.
- Automated build steps are unnecessary; reload the script in Tampermonkey to validate changes.

### Versioning guardrail (for automation/agents)
- Do **not** bump package or userscript versions (`package.json`, `package-lock.json`, `genit-memory-helper.user.js` metadata, tags) unless the maintainer explicitly instructs it. The maintainer runs `npm run bump:*` and handles publishing.
- When documenting releases, only update human-facing notes (e.g., `README.md`, `CHANGELOG.md`) to the version number provided by the maintainer.

## Coding Style & Naming Conventions
- Use 2-space indentation and single quotes, mirroring the current script style.
- Prefer `camelCase` for functions and variables, `UPPER_SNAKE_CASE` for constants, and keep exported metadata keys (`@name`, `@version`, etc.) aligned with Tampermonkey requirements.
- Group related helper utilities together and add brief block comments only for complex DOM parsing or serialization logic.

## Testing Guidelines
- Manual verification is required: install the updated userscript in Tampermonkey, load `https://genit.ai/`, and walk through JSON export, prompt copy, and repro buttons after each change.
- Check browser devtools for console warnings; ensure JSON output includes newly introduced fields without breaking existing keys.
- When altering parsing logic, craft small HTML snippets in devtools or use recorded DOM samples to regression-check edge cases (INFO labels, 메시지 이미지 blocks, code headers).

## Commit & Pull Request Guidelines
- Write imperative, concise commit messages (`feat: add actor guessing fallback`, `fix: handle 메시지 이미지 blocks`); avoid underscores used in older history.
- For pull requests, include: a short summary, before/after notes or screenshots of the Tampermonkey panel, reproduction steps on Genit, and links to any related issues.
- Keep PRs focused—separate formatting-only changes from feature or bug fixes so reviewers can reason about the diff quickly.
- Always commit or stash your work as soon as a logical chunk is complete. Do **not** rely on uncommitted buffers; never run `git checkout`, `git reset`, or similar destructive commands on tracked files unless the latest changes are safely committed or explicitly stashed.
- When responding to new instructions, restate or summarize the request to confirm understanding (e.g., “제가 이해한 요구사항은 A와 B입니다, 맞나요?”). Do not proceed if interpretation is ambiguous or unconfirmed.
- Any time the role classification/parsing heuristics are modified (e.g., adjusting `detectRole`, `emit*Lines`, `parseTurns` logic), update `docs/role-classification-heuristics.md` in the same change to reflect the new behavior and note any known issues.

## Security & Privacy Considerations
- Revisit `PRIVACY.md` when exposing additional data; highlight any new sensitive fields in the PR description.
- Never introduce remote logging or analytics—processing must stay client-side to preserve user privacy.
