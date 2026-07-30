import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig, normalizeNotionId, resolveWikiContentRoot } from "../src/config";

test("normalizeNotionId accepts compact page IDs", () => {
  assert.equal(
    normalizeNotionId("00000000000000000000000000000001"),
    "00000000-0000-0000-0000-000000000001",
  );
});

test("normalizeNotionId extracts IDs from notion page URLs", () => {
  assert.equal(
    normalizeNotionId(
      "https://www.notion.so/My-Wiki-00000000000000000000000000000001?pvs=4",
    ),
    "00000000-0000-0000-0000-000000000001",
  );
});

test("loadConfig applies the default API version", () => {
  const config = loadConfig({
    NOTION_TOKEN: "token",
    NOTION_PAGE_ID: "00000000000000000000000000000001",
  });

  assert.equal(config.notionApiVersion, "2026-03-11");
  assert.equal(config.notionPageId, "00000000-0000-0000-0000-000000000001");
});

test("loadConfig normalizes an optional dedicated test page ID", () => {
  const config = loadConfig({
    NOTION_TOKEN: "token",
    NOTION_PAGE_ID: "00000000000000000000000000000001",
    NOTION_TEST_PAGE_ID: "11111111111111111111111111111111",
  });

  assert.equal(config.notionTestPageId, "11111111-1111-1111-1111-111111111111");
});

test("loadConfig rejects invalid page IDs", () => {
  assert.throws(
    () =>
      loadConfig({
        NOTION_TOKEN: "token",
        NOTION_PAGE_ID: "not-a-page-id",
      }),
    /NOTION_PAGE_ID must be a page UUID or a Notion page URL containing a UUID/,
  );
});

test("loadConfig rejects an invalid dedicated test page ID", () => {
  assert.throws(
    () =>
      loadConfig({
        NOTION_TOKEN: "token",
        NOTION_PAGE_ID: "00000000000000000000000000000001",
        NOTION_TEST_PAGE_ID: "not-a-page-id",
      }),
    /NOTION_TEST_PAGE_ID must be a page UUID or a Notion page URL containing a UUID/,
  );
});

test("loadConfig reads WIKI_CONTENT_ROOT", () => {
  const config = loadConfig({
    NOTION_TOKEN: "token",
    NOTION_PAGE_ID: "00000000000000000000000000000001",
    WIKI_CONTENT_ROOT: "/path/to/wiki-content",
  });

  assert.equal(config.wikiContentRoot, "/path/to/wiki-content");
});

test("loadConfig leaves WIKI_CONTENT_ROOT undefined when not set", () => {
  const config = loadConfig({
    NOTION_TOKEN: "token",
    NOTION_PAGE_ID: "00000000000000000000000000000001",
  });

  assert.equal(config.wikiContentRoot, undefined);
});

test("resolveWikiContentRoot resolves a configured root to an absolute path", () => {
  const resolved = resolveWikiContentRoot("./some-folder");
  assert.ok(resolved.endsWith("some-folder"));
  assert.ok(resolved.startsWith("/") || resolved.includes(":"));
});

test("resolveWikiContentRoot falls back to wiki-content in the current working directory", () => {
  const resolved = resolveWikiContentRoot();
  assert.ok(resolved.endsWith("wiki-content"));
});

test("loadConfig leaves token and page ID undefined when not set", () => {
  const config = loadConfig({});
  assert.equal(config.notionToken, undefined);
  assert.equal(config.notionPageId, undefined);
});

test("loadConfig treats empty token and page ID as undefined", () => {
  const config = loadConfig({
    NOTION_TOKEN: "",
    NOTION_PAGE_ID: "   ",
  });
  assert.equal(config.notionToken, undefined);
  assert.equal(config.notionPageId, undefined);
});