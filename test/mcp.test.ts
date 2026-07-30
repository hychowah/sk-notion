import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { mcpTools, executeTool } from "../src/mcp/tools";
import type { AppConfig } from "../src/config";

function createMockContext(): { config: AppConfig } {
  return {
    config: {
      notionToken: "secret_test",
      notionPageId: "00000000-0000-0000-0000-000000000001",
      notionApiVersion: "2026-03-11",
      wikiContentRoot: process.env.WIKI_CONTENT_ROOT,
    },
  };
}

function createEmptyMockContext(): { config: AppConfig } {
  return {
    config: {
      notionApiVersion: "2026-03-11",
    },
  };
}

describe("MCP server tools", () => {
  it("registers the expected tools", () => {
    const names = mcpTools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "append_image_url",
      "append_markdown",
      "create_child_page",
      "dump_page_markdown",
      "get_server_info",
      "replace_markdown",
      "sync_all_wiki_sections",
      "sync_wiki_section",
      "update_child_page",
      "upload_image",
      "validate_page",
      "validate_wiki",
    ]);
  });

  it("produces valid JSON Schema for every tool", () => {
    for (const tool of mcpTools) {
      assert.ok(tool.inputSchema, `${tool.name} is missing inputSchema`);
      const schema = tool.inputSchema as Record<string, unknown>;
      assert.equal(schema.type, "object", `${tool.name} schema is not an object`);
      assert.ok(
        typeof schema.properties === "object" || schema.properties === undefined,
        `${tool.name} schema has invalid properties`,
      );
    }
  });

  it("rejects markdown input when both markdown and filePath are provided", async () => {
    const result = await executeTool(
      "append_markdown",
      { markdown: "# Hello", filePath: "./readme.md" },
      createMockContext(),
    );
    assert.equal(result.isError, true);
    assert.ok(
      result.content[0].text.includes("Provide exactly one of markdown or filePath"),
      `unexpected error: ${result.content[0].text}`,
    );
  });

  it("rejects update_child_page when no actionable field is provided", async () => {
    const result = await executeTool(
      "update_child_page",
      { pageId: "00000000-0000-0000-0000-000000000002" },
      createMockContext(),
    );
    assert.equal(result.isError, true);
    assert.ok(
      result.content[0].text.includes("at least one of title, markdown, or filePath"),
      `unexpected error: ${result.content[0].text}`,
    );
  });

  it("validates a well-formed wiki content tree", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sk-notion-mcp-test-"));
    mkdirSync(path.join(root, "section-a"), { recursive: true });
    writeFileSync(path.join(root, "page-map.json"), JSON.stringify({
      sections: {
        "section-a": {
          name: "Section A",
          pageId: "00000000-0000-0000-0000-000000000002",
          file: "section-a/index.md",
        },
      },
    }));
    writeFileSync(path.join(root, "section-a", "index.md"), "# Section A\n\nContent.\n");

    const originalRoot = process.env.WIKI_CONTENT_ROOT;
    process.env.WIKI_CONTENT_ROOT = root;
    try {
      const result = await executeTool("validate_wiki", {}, createMockContext());
      assert.equal(result.isError, undefined);
      assert.ok(
        result.content[0].text.includes("Wiki content is valid"),
        `unexpected output: ${result.content[0].text}`,
      );
    } finally {
      if (originalRoot === undefined) {
        delete process.env.WIKI_CONTENT_ROOT;
      } else {
        process.env.WIKI_CONTENT_ROOT = originalRoot;
      }
    }
  });

  it("reports a missing mapped file during wiki validation", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sk-notion-mcp-test-"));
    writeFileSync(path.join(root, "page-map.json"), JSON.stringify({
      sections: {
        missing: {
          name: "Missing",
          pageId: "00000000-0000-0000-0000-000000000002",
          file: "missing/index.md",
        },
      },
    }));

    const originalRoot = process.env.WIKI_CONTENT_ROOT;
    process.env.WIKI_CONTENT_ROOT = root;
    try {
      const result = await executeTool("validate_wiki", {}, createMockContext());
      assert.equal(result.isError, true);
      assert.ok(
        result.content[0].text.includes("does not exist"),
        `unexpected output: ${result.content[0].text}`,
      );
    } finally {
      if (originalRoot === undefined) {
        delete process.env.WIKI_CONTENT_ROOT;
      } else {
        process.env.WIKI_CONTENT_ROOT = originalRoot;
      }
    }
  });

  it("asks for notionToken when it is not configured or provided", async () => {
    const result = await executeTool(
      "validate_page",
      { pageId: "00000000-0000-0000-0000-000000000001" },
      createEmptyMockContext(),
    );
    assert.equal(result.isError, true);
    assert.ok(
      result.content[0].text.includes("Please provide notionToken"),
      `unexpected error: ${result.content[0].text}`,
    );
  });

  it("asks for pageId when it is not configured or provided", async () => {
    const result = await executeTool(
      "validate_page",
      { notionToken: "secret_test" },
      createEmptyMockContext(),
    );
    assert.equal(result.isError, true);
    assert.ok(
      result.content[0].text.includes("Please provide pageId"),
      `unexpected error: ${result.content[0].text}`,
    );
  });

  it("get_server_info reports configuration status without credentials", async () => {
    const result = await executeTool("get_server_info", {}, createEmptyMockContext());
    assert.equal(result.isError, undefined);
    const info = JSON.parse(result.content[0].text);
    assert.equal(info.serverName, "sk-notion-wiki");
    assert.equal(info.notionTokenConfigured, false);
    assert.equal(info.pageIdConfigured, false);
    assert.equal(info.connectionStatus, "not_configured");
  });

  it("get_server_info reports missing pageId when only token is provided", async () => {
    const result = await executeTool(
      "get_server_info",
      { notionToken: "secret_test" },
      createEmptyMockContext(),
    );
    assert.equal(result.isError, undefined);
    const info = JSON.parse(result.content[0].text);
    assert.equal(info.notionTokenConfigured, true);
    assert.equal(info.pageIdConfigured, false);
    assert.equal(info.connectionStatus, "not_configured");
    assert.ok(info.connectionDetail.includes("pageId is missing"));
  });
});
