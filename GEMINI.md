# GEMINI.md

This document provides guidance for the Gemini agent when working with the **Genit Memory Helper** repository.

## Project Overview

**Genit Memory Helper** is a Tampermonkey userscript designed to extract and format chat logs from genit.ai. Its primary purpose is to help users summarize conversations for the platform's user notes by exporting chat history with privacy-preserving features.

- **Core Functionality**: Auto-scrolls to load history, redacts sensitive information, and exports conversations into various formats (JSON, Markdown, TXT).
- **Key Goal**: Facilitate the creation of memory summaries for LLMs by providing clean, structured data and prompt templates.

## Development Commands

I will use the following commands to build, test, and work with the project:

- **Installation**: `npm install`
- **Build**: `npm run build` (To create the `dist` output from `src` modules)
- **Testing**:
    - `npm test` or `npm run test:unit` (To run Vitest unit tests on the built file)
    - `npm run test:smoke` (To run Playwright smoke tests, if environment variables are configured)
- **Formatting**: `npx prettier --write .` (To ensure code style consistency)

I understand that tests run against the `dist/genit-memory-helper.user.js` file, so I will always run `npm run build` after making changes to the `src/` directory and before running tests.

## Interaction Model

- **Tool-Based**: I operate by executing tools to read files, write code, and run shell commands.
- **Verification**: After modifying code, I will run relevant build and test commands to verify my changes.
- **Clarity**: I will ask for clarification if a request is ambiguous.
- **Safety**: I will explain any commands that modify the file system before running them.

## Key Files & Architecture

I have analyzed the project structure and understand the following:

- **`src/`**: The main source code, organized into modules (core, ui, features, etc.).
- **`genit-memory-helper.user.js`**: The legacy, monolithic userscript. I will primarily work within the `src/` directory.
- **`dist/genit-memory-helper.user.js`**: The build artifact that is consumed by tests and Tampermonkey.
- **`package.json`**: Defines scripts and dependencies.
- **`tests/`**: Contains unit and smoke tests.
- **`AGENTS.md`, `CLAUDE.md`**: Guides for other AI agents, which I have reviewed for context.
