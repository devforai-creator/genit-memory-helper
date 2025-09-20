# Repository Guidelines

## Project Structure & Module Organization
- `genit-memory-helper.user.js` holds the entire Tampermonkey script; update logic, DOM parsers, and UI helpers here.
- `README.md` covers installation and usage; keep feature explanations in sync with script changes.
- `PRIVACY.md` documents data-handling expectations; review when introducing new logging or exports.
- No dedicated test or asset directories exist—add subfolders only when a new module truly warrants it to keep the root lean.

## Build, Test, and Development Commands
- `npm install prettier@latest` (one-time) ensures a consistent formatter for contributors working locally.
- `npx prettier --check genit-memory-helper.user.js` verifies formatting before committing.
- Automated build steps are unnecessary; reload the script in Tampermonkey to validate changes.

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

## Security & Privacy Considerations
- Revisit `PRIVACY.md` when exposing additional data; highlight any new sensitive fields in the PR description.
- Never introduce remote logging or analytics—processing must stay client-side to preserve user privacy.
