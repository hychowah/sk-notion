# Notion Wiki Publisher

This project provides a small Node.js and TypeScript helper that publishes LLM-generated content into a single Notion page. It supports:

- validating access to an existing page
- **dumping existing page content as Markdown** so an LLM can read it before editing
- appending plain text and Markdown content
- replacing the current top-level page content with Markdown
- creating child pages under the configured parent page
- updating an existing direct child page by page ID
- embedding remote image URLs
- uploading local image files into Notion and attaching them to the page

## Quick start for wiki authors

If you are here to publish wiki content (not to develop the publisher itself):

```powershell
# 1. Check that every mapped file exists and every index.md is registered
npm run validate-wiki

# 2. See what sections you can sync
npm run sync

# 3. Preview what would change for a section
npm run sync -- <section-name> --dry-run

# 4. Publish the section
npm run sync -- <section-name>

# 5. Publish everything at once
npm run sync -- --all
```

## Setup

1. Open the existing page in Notion and confirm it is shared with your integration.
2. Fill in [.env](.env) with your values:

```env
NOTION_TOKEN=secret_xxx
NOTION_PAGE_ID=00000000-0000-0000-0000-000000000000
NOTION_TEST_PAGE_ID=00000000-0000-0000-0000-000000000000
NOTION_API_VERSION=2026-03-11

# Path to the Markdown source tree (page-map.json lives here).
# Use an absolute path, or a path relative to the project root.
WIKI_CONTENT_ROOT=/path/to/wiki-content
```

The `WIKI_CONTENT_ROOT` variable lets the sync scripts find the wiki content when it lives outside this project folder.

`NOTION_TEST_PAGE_ID` is optional. When set, `npm run test:live` targets that dedicated child page instead of the root page in `NOTION_PAGE_ID`.

3. Install dependencies if needed:

```powershell
npm install
```

4. Validate access:

```powershell
npm run validate
npm run test:live:setup
```

5. Run the test suite:

```powershell
npm test
npm run test:live
```

## Commands

Use the CLI through `npm run dev -- <command>` or directly with `npx tsx src/cli.ts <command>`.

The configured `NOTION_PAGE_ID` remains the root page for the existing commands. Child-page creation uses that page as the parent, and child-page updates are restricted to direct children of that configured page.

### Read and validation

```powershell
npm run validate
npm run page-info
npm test
npm run test:live:setup
npm run test:live
npm run verify
```

### Dump current page content as Markdown

```powershell
npx tsx src/cli.ts dump-md
```

This prints the existing top-level blocks as Markdown to stdout. Use it to let an LLM inspect the current content before modifying it.

```powershell
# Include block IDs for potential surgical updates later
npx tsx src/cli.ts dump-md --with-block-ids

# Dump a specific child page
npx tsx src/cli.ts dump-md --page-id 00000000-0000-0000-0000-000000000000
```

`npm test` runs hermetic unit tests. `npm run test:live:setup` creates or validates a dedicated child page for integration testing. `npm run test:live` prefers that dedicated test page when `NOTION_TEST_PAGE_ID` is set, otherwise it falls back to the configured root page. `npm run verify` runs typecheck, unit tests, and the live smoke test in sequence.

### Append plain text

```powershell
npx tsx src/cli.ts append-text "## ignored markdown\nThis command appends plain paragraphs only."
```

### Append Markdown from a file

```powershell
npx tsx src/cli.ts append-md --file .\sample.md
```

### Append Markdown inline

```powershell
npx tsx src/cli.ts append-md --text "# Wiki Title`n`n- item 1`n- item 2"
```

### Replace current page content

```powershell
npx tsx src/cli.ts replace-md --file .\wiki.md
```

### Create a child page under the configured parent page

```powershell
npx tsx src/cli.ts create-child-page "Release Notes"
npx tsx src/cli.ts create-child-page "Release Notes" --file .\release-notes.md
npx tsx src/cli.ts create-child-page "Release Notes" --parent-page-id 00000000-0000-0000-0000-000000000000 --file .\release-notes.md
```

The command prints the new child page ID and URL so you can target it later.

### Update an existing child page by page ID

```powershell
npx tsx src/cli.ts update-child-page --page-id 00000000-0000-0000-0000-000000000000 --title "Release Notes v2"
npx tsx src/cli.ts update-child-page --page-id https://www.notion.so/... --file .\release-notes.md
npx tsx src/cli.ts update-child-page --page-id 00000000-0000-0000-0000-000000000000 --text "# Patch Notes" --append
npx tsx src/cli.ts update-child-page --page-id 00000000-0000-0000-0000-000000000000 --file .\release-notes.md --skip-parent-check
```

By default, markdown updates replace the child page's current top-level content. Add `--append` to keep the existing content and append new blocks instead.

### Create or validate a dedicated test child page

```powershell
npm run test:live:setup
npx tsx src/cli.ts ensure-test-page --title "Notion API Test Page"
```

If `NOTION_TEST_PAGE_ID` is already set, the command validates that page and confirms it is still a direct child of the configured parent page. Otherwise it creates a new child page and prints the `NOTION_TEST_PAGE_ID` value you can add to `.env` for future test runs.

### Append a remote image

```powershell
npx tsx src/cli.ts append-image-url https://example.com/image.png --caption "Reference image"
```

The URL must point directly to a supported image file extension.

### Upload a local image

```powershell
npx tsx src/cli.ts append-image-file .\images\diagram.png --caption "System diagram"
```

### Publish Markdown plus extra images in one run

```powershell
npx tsx src/cli.ts publish --file .\wiki.md --image-file .\images\photo.jpg --image-url https://example.com/banner.png
```

Add `--replace` if you want the publish run to clear existing top-level blocks first.

## Supported Markdown subset

Version 1 converts these Markdown constructs into Notion blocks:

- headings 1 through 4
- paragraphs
- bulleted lists
- numbered lists
- blockquotes
- fenced code blocks
- horizontal rules
- image syntax using remote URLs or local file paths
- italic text (wrapped in `*` or `_`)

Current limitations:

- nested lists are flattened
- tables and raw HTML are ignored with warnings
- inline formatting is reduced to plain text
- **inline links to other wiki pages** — you can use relative markdown links like `[text](../other-page/index.md)` in source files. During sync, the tool resolves them against `page-map.json` and converts them to proper Notion page URLs. Only links that match a known page-map entry are converted; unmatched links are left as-is.
- image paths may contain spaces — the tool automatically percent-encodes them for parsing and decodes them again before resolving on disk
- **use local file paths for images** — S3 presigned URLs from `dump-md` expire within an hour and become dead images on republish

## Wiki Content Foundation

The Markdown source files live in the directory pointed to by `WIKI_CONTENT_ROOT`. Each section lives in its own folder with an `index.md` entry point and a local `images/` directory. See `AGENTS.md` in that folder for the full organization rules.

> **Why separate the code from the content?** Keeping the publisher code in its own repo and the wiki content in a separate folder lets you reuse the same tool across multiple wikis or projects.

An example `wiki-content/page-map.json` might look like this:

```json
{
  "sections": {
    "parent": {
      "name": "Wiki Home",
      "pageId": "root",
      "file": "parent.md"
    },
    "getting-started": {
      "name": "Getting Started",
      "pageId": "00000000-0000-0000-0000-000000000001",
      "file": "getting-started/index.md"
    }
  }
}
```

### Publishing workflow

The fastest way to publish is the `sync` command. It reads `wiki-content/page-map.json` so you never have to remember raw Notion page IDs.

```powershell
# Validate that every mapped file exists and every index.md is registered
npm run validate-wiki

# List all syncable sections
npm run sync

# Sync a specific section
npm run sync -- <section-name>

# Sync every section at once
npm run sync -- --all

# Preview what would change without touching Notion
npm run sync -- <section-name> --dry-run
```

> **Note on `--dry-run`:** The preview estimates block counts by counting headings in the Markdown source. It does not perform a full diff against the live Notion page.

> **Note on `--all`:** If one section fails, the script continues with the remaining sections and exits with code 1. Sections that were already synced before the failure are not rolled back.

#### Fallback: manual CLI commands

If you need to target a page that isn't in `page-map.json` (e.g. a deeply nested child page), use the low-level CLI directly. Paths are relative to the current directory, so prefix them with `$env:WIKI_CONTENT_ROOT`:

```powershell
# Update the root page
npx tsx src/cli.ts replace-md --file "$env:WIKI_CONTENT_ROOT\parent.md"

# Update a child page by ID
npx tsx src/cli.ts update-child-page --page-id <child-page-id> --file "$env:WIKI_CONTENT_ROOT\<section-folder>\index.md"

# Create a new child page when needed
npx tsx src/cli.ts create-child-page "New Section" --file "$env:WIKI_CONTENT_ROOT\new-section\index.md"
```

Because the tool flattens nested lists, ignores tables, and strips inline formatting, keep the source Markdown simple: use headings, plain paragraphs, bullet lists, numbered lists, blockquotes, code fences, dividers, and image references.

### Adding a new wiki section

1. Create a new folder in `wiki-content/` with `index.md` and an `images/` subdirectory.
2. Run `create-child-page` to add it under the root page and note the printed page ID.
3. Add an entry to `wiki-content/page-map.json` with the new page ID.
4. Update `wiki-content/parent.md` to list the new section, then republish the root page with `npm run sync -- parent`.

---

## Programmatic use

The library exports the core pieces through [src/index.ts](src/index.ts). A typical flow is:

1. load the config
2. create a Notion client
3. convert markdown into content nodes
4. build Notion blocks, including local image uploads when needed
5. append or replace content on the target page

That keeps content generation separate from transport. Your LLM can generate Markdown, and this project can handle publishing it safely.

### LLM workflow: read before you write

Because `dump-md` exports the current page in the same Markdown subset the tool consumes, an LLM can follow a safe read-modify-write loop:

```powershell
# 1. Read
$current = npx tsx src/cli.ts dump-md

# 2. LLM reasons about what to change, using $current as context

# 3. Write
npx tsx src/cli.ts replace-md --text "$newMarkdown"
```

The same flow works for child pages:

```powershell
npx tsx src/cli.ts dump-md --page-id <child-id>
npx tsx src/cli.ts update-child-page --page-id <child-id> --text "$newMarkdown"
```

---

## MCP server

The project also exposes the core operations as an [MCP](https://modelcontextprotocol.io) server. Any MCP client — Kimi, Claude Desktop, Cursor, etc. — can call the tools directly instead of shelling out to the CLI.

### Running the server

```powershell
# Development / stdio transport
npm run mcp

# After building
npm run build
node dist/mcp/server.js
```

The server reads `.env` just like the CLI (`NOTION_TOKEN`, `NOTION_PAGE_ID`, `WIKI_CONTENT_ROOT`).

### Example client configuration (Claude Desktop)

```json
{
  "mcpServers": {
    "notion-wiki": {
      "command": "node",
      "args": [
        "C:\\path\\to\\<this-repo>\\dist\\mcp\\server.js"
      ],
      "env": {
        "NOTION_TOKEN": "secret_xxx",
        "NOTION_PAGE_ID": "00000000-0000-0000-0000-000000000000",
        "WIKI_CONTENT_ROOT": "C:\\path\\to\\wiki-content"
      }
    }
  }
}
```

### Available tools

- `validate_page` — confirm token/page access.
- `dump_page_markdown` — export a page as Markdown.
- `append_markdown` — append Markdown to a page.
- `replace_markdown` — replace top-level page content with Markdown (with optional `--smart` surgical updates).
- `create_child_page` — create a child page and optionally seed it with Markdown.
- `update_child_page` — update a child page title and/or Markdown.
- `upload_image` — upload a local image file and append it to a page.
- `append_image_url` — append a remote image URL to a page.
- `sync_wiki_section` — sync one section from `page-map.json`.
- `sync_all_wiki_sections` — sync every registered section.
- `validate_wiki` — validate the wiki content tree.

Tool inputs are strongly typed; missing or conflicting arguments (for example, providing both `markdown` and `filePath`) are rejected before any Notion API call is made.# sk-notion
