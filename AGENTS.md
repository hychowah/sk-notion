# Agent Notes for `sk-notion`

This file is for AI agents and contributors who need to work with the Notion Wiki Publisher codebase.

## What this project does

A Node.js/TypeScript CLI and [MCP](https://modelcontextprotocol.io) server that publishes Markdown wiki content to a Notion page. It supports dumping existing content, appending/replacing blocks, creating child pages, uploading local images, and syncing a whole wiki tree via `page-map.json`.

## Build and test commands

```powershell
# Type-check only
npm run check

# Build dist/
npm run build

# Run unit tests (hermetic, no Notion calls)
npm test

# Run live smoke test against Notion (requires .env)
npm run test:live

# Run typecheck + unit tests + live smoke test
npm run verify
```

## Environment variables

Copy `.env.example` to `.env` and fill in real values:

- `NOTION_TOKEN` — Notion integration token (required).
- `NOTION_PAGE_ID` — Root Notion page UUID or URL (required).
- `NOTION_TEST_PAGE_ID` — Optional child page used by `npm run test:live`.
- `NOTION_API_VERSION` — Notion API version (defaults to `2026-03-11`).
- `WIKI_CONTENT_ROOT` — Path to the Markdown source tree containing `page-map.json`.

`.env` is gitignored. Never commit it or hardcode real page IDs/tokens.

## Conventions

- Source lives in `src/`; compiled output goes to `dist/` and is gitignored.
- Tests live in `test/` and run with Node's built-in test runner via `tsx`.
- Use `loadConfig()` from `src/config.ts` instead of reading `process.env` directly.
- Keep ad-hoc scripts out of `scripts/` unless they are reusable and free of workspace-specific values.
- Use synthetic IDs such as `00000000-0000-0000-0000-000000000001` in tests and examples.

## Common tasks

- **Publish wiki changes:** `npm run sync -- <section-name>`
- **Preview changes:** `npm run sync -- <section-name> --dry-run`
- **Validate wiki structure:** `npm run validate-wiki`
- **Run MCP server in dev:** `npm run mcp`

## First-commit checklist

1. `.env` is gitignored and not staged.
2. No hardcoded Notion tokens, page IDs, or local workspace paths.
3. `npm run check` and `npm test` pass.
4. `package.json` has `"private": true`.
