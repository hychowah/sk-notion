# sk-notion MCP server usage

## What this is

This project (`sk-notion`) is a custom Notion wiki publisher. It exposes an MCP server named **`sk-notion-wiki`** that can:

- Publish Markdown blocks to a Notion page.
- Upload local images or append remote image URLs.
- Create and update child pages.
- Sync a whole wiki tree defined by `page-map.json`.
- Dump existing Notion content back to Markdown.

It is **not** the generic Notion MCP server. The tool names depend on the key you assign in `.kimi-code/mcp.json`. Use the key **`sk_notion_wiki`** so tools appear as:

```text
mcp__sk_notion_wiki__get_server_info
mcp__sk_notion_wiki__validate_page
mcp__sk_notion_wiki__sync_wiki_section
...
```

## Credentials

`NOTION_TOKEN` and `NOTION_PAGE_ID` can be supplied in two ways:

1. **Environment variables** set before the MCP server starts:
   - `NOTION_TOKEN` — Notion integration token.
   - `NOTION_PAGE_ID` — root page UUID or Notion page URL.
2. **Per-tool arguments** passed to each call:
   - `notionToken` — overrides `NOTION_TOKEN`.
   - `pageId` — overrides `NOTION_PAGE_ID` for that call.

The token value is never returned by any tool. Use `get_server_info` to see whether a token/page ID is configured.

## First check: identify the server and verify connectivity

Always start with `get_server_info`. It returns:

- `serverName` — should be `sk-notion-wiki`.
- `version`.
- `notionTokenConfigured` / `pageIdConfigured` booleans.
- `wikiContentDirectory`.
- `connectionStatus` — `ok`, `error`, or `not_configured`.
- `connectionDetail` — page title on success, or the error reason.

If `connectionStatus` is `error`, the token may be stale or the page ID may be wrong. If it is `not_configured`, provide credentials as env vars or tool arguments.

## Common workflows

### Sync one wiki section

```json
{
  "name": "sync_wiki_section",
  "arguments": {
    "sectionName": "getting-started",
    "dryRun": true
  }
}
```

Run with `dryRun: true` first, then remove it to apply.

### Sync all sections

```json
{
  "name": "sync_all_wiki_sections",
  "arguments": { "dryRun": true }
}
```

### Append or replace Markdown on a page

```json
{
  "name": "append_markdown",
  "arguments": {
    "markdown": "# New section\n\nSome content."
  }
}
```

Use `replace_markdown` with `smart: true` for surgical updates that preserve unchanged blocks.

### Upload a local image

```json
{
  "name": "upload_image",
  "arguments": {
    "filePath": "./diagrams/arch.png",
    "caption": "Architecture diagram"
  }
}
```

### Validate the local wiki tree

```json
{ "name": "validate_wiki", "arguments": {} }
```

This only inspects local files; it does not call Notion.

## CLI equivalents

The same functionality is available from the terminal:

```powershell
npm run validate-wiki
npm run sync -- <section-name>
npm run sync -- <section-name> --dry-run
```

The CLI still requires `NOTION_TOKEN` and `NOTION_PAGE_ID` via `.env`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401` or `unauthorized` from `get_server_info` / `validate_page` | Stale or wrong `NOTION_TOKEN` | Refresh the integration token in Notion and update `.env`/MCP config. |
| `could not find page` | Wrong `NOTION_PAGE_ID` or page not shared with the integration | Check the page URL/ID and integration permissions. |
| `Unknown section "..."` | Missing or mistyped key in `page-map.json` | Verify the section key and the `page-map.json` file path. |
| `Section "..." maps to "...", but that file does not exist` | `page-map.json` references a missing `index.md` | Create the file or fix the mapping. |
| `Please provide notionToken` / `pageId` | Neither env var nor tool argument supplied | Set env vars in `.kimi-code/mcp.json` or pass them per call. |

## Config file locations

Kimi Code looks for MCP server config in this order (later wins):

1. Global: `~/.kimi-code/mcp.json`
2. Session state
3. Workspace: `<project-root>/.kimi-code/mcp.json`

For this project, the workspace-level file is the one to edit.
