import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { Client } from "@notionhq/client";

import {
  loadPageMap,
  resolveSection,
  resolvePageId,
  syncWikiSection,
  type PageMap,
  type SyncWikiDependencies,
} from "../src/sync-wiki";

test("loadPageMap parses a valid page-map.json", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sync-wiki-test-"));
  const mapPath = path.join(dir, "page-map.json");

  const data: PageMap = {
    sections: {
      "test-section": {
        name: "Test Section",
        pageId: "00000000-0000-0000-0000-000000000001",
        file: "test-section/index.md",
      },
    },
  };

  await writeFile(mapPath, JSON.stringify(data, null, 2), "utf8");
  const result = await loadPageMap(mapPath);

  assert.equal(result.sections["test-section"].name, "Test Section");
  assert.equal(result.sections["test-section"].pageId, "00000000-0000-0000-0000-000000000001");

  await rm(dir, { recursive: true });
});

test("resolveSection returns the section for a known name", () => {
  const pageMap: PageMap = {
    sections: {
      robot: { name: "Robot", pageId: "abc", file: "robot/index.md" },
    },
  };

  const section = resolveSection(pageMap, "robot");
  assert.equal(section.name, "Robot");
});

test("resolveSection throws for an unknown section name", () => {
  const pageMap: PageMap = {
    sections: {
      robot: { name: "Robot", pageId: "abc", file: "robot/index.md" },
    },
  };

  assert.throws(() => resolveSection(pageMap, "unknown"), /Unknown section/);
});

test("resolvePageId returns rootPageId for root sections", () => {
  const section = { name: "Root", pageId: "root", file: "parent.md" };
  assert.equal(resolvePageId(section, "00000000-0000-0000-0000-000000000000"), "00000000-0000-0000-0000-000000000000");
});

test("resolvePageId normalizes compact child page IDs", () => {
  const section = { name: "Child", pageId: "00000000000000000000000000000001", file: "child/index.md" };
  assert.equal(resolvePageId(section, "root-id"), "00000000-0000-0000-0000-000000000001");
});

test("syncWikiSection dry-run returns estimated block counts without API calls", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sync-wiki-test-"));
  const wikiDir = path.join(dir, "wiki-content");
  const sectionDir = path.join(wikiDir, "robot-development");

  await mkdir(sectionDir, { recursive: true });
  await writeFile(
    path.join(sectionDir, "index.md"),
    "# Robot Development\n\nSome content.\n\n- Item 1\n- Item 2\n",
    "utf8",
  );

  const pageMap: PageMap = {
    sections: {
      "robot-development": {
        name: "Robot Development",
        pageId: "00000000-0000-0000-0000-000000000001",
        file: "robot-development/index.md",
      },
    },
  };

  const client = {} as unknown as Client;

  const result = await syncWikiSection(
    { sectionName: "robot-development", dryRun: true },
    {
      client,
      rootPageId: "root-id",
      wikiContentDirectory: wikiDir,
      pageMap,
    },
  );

  assert.equal(result.sectionName, "robot-development");
  assert.equal(result.title, "Robot Development");
  assert.equal(result.archivedCount, 0);
  assert.equal(result.appendedCount, 1);
  assert.equal(result.uploadedImages.length, 0);
  assert.deepEqual(result.warnings, []);

  await rm(dir, { recursive: true });
});

test("syncWikiSection replaces content and updates title for child pages", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sync-wiki-test-"));
  const wikiDir = path.join(dir, "wiki-content");
  const sectionDir = path.join(wikiDir, "test-section");

  await mkdir(sectionDir, { recursive: true });
  await writeFile(
    path.join(sectionDir, "index.md"),
    "# Test\n\nHello world.\n",
    "utf8",
  );

  const pageMap: PageMap = {
    sections: {
      "test-section": {
        name: "Test Section",
        pageId: "00000000000000000000000000000001",
        file: "test-section/index.md",
      },
    },
  };

  let updatedPageId = "";
  let updatedTitle = "";

  const client = {
    blocks: {
      children: {
        list: async () => ({ results: [], has_more: false, next_cursor: null }),
        append: async ({ children }: { children: unknown[] }) => ({ results: children }),
      },
      update: async ({ block_id }: { block_id: string }) => {
        return { id: block_id };
      },
    },
    pages: {
      retrieve: async ({ page_id }: { page_id: string }) => ({
        object: "page",
        id: page_id,
        url: `https://www.notion.so/${page_id}`,
        parent: { type: "page_id", page_id: "parent-id" },
        properties: {
          title: {
            type: "title",
            title: [{ plain_text: updatedTitle || "Test Section" }],
          },
        },
      }),
      update: async ({ page_id, properties }: { page_id: string; properties: Record<string, unknown> }) => {
        updatedPageId = page_id;
        updatedTitle = (properties as any).title.title[0].text.content;
        return {
          object: "page",
          id: page_id,
          url: `https://www.notion.so/${page_id}`,
          parent: { type: "page_id", page_id: "parent-id" },
          properties: {
            title: {
              type: "title",
              title: [{ plain_text: updatedTitle }],
            },
          },
        };
      },
    },
  } as unknown as Client;

  const result = await syncWikiSection(
    { sectionName: "test-section" },
    {
      client,
      rootPageId: "parent-id",
      wikiContentDirectory: wikiDir,
      pageMap,
    },
  );

  assert.equal(result.title, "Test Section");
  assert.equal(result.archivedCount, 0);
  assert.equal(result.appendedCount, 4); // heading + paragraph + divider + modified-date paragraph
  assert.deepEqual(result.warnings, []);
  assert.equal(updatedPageId, "00000000-0000-0000-0000-000000000001");
  assert.equal(updatedTitle, "Test Section");

  await rm(dir, { recursive: true });
});

test("syncWikiSection throws a friendly error when the mapped file is missing", async () => {
  const pageMap: PageMap = {
    sections: {
      "missing-section": {
        name: "Missing Section",
        pageId: "00000000-0000-0000-0000-000000000001",
        file: "missing-section/index.md",
      },
    },
  };

  const client = {} as unknown as Client;

  await assert.rejects(
    syncWikiSection(
      { sectionName: "missing-section" },
      {
        client,
        rootPageId: "root-id",
        wikiContentDirectory: "/tmp/nonexistent-wiki",
        pageMap,
      },
    ),
    /Section "missing-section" maps to "missing-section\/index.md", but that file does not exist/,
  );
});

test("syncWikiSection does not update title for root sections", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sync-wiki-test-"));
  const wikiDir = path.join(dir, "wiki-content");

  await mkdir(wikiDir, { recursive: true });
  await writeFile(
    path.join(wikiDir, "parent.md"),
    "# Root Page\n\nContent.\n",
    "utf8",
  );

  const pageMap: PageMap = {
    sections: {
      parent: {
        name: "Root Page",
        pageId: "root",
        file: "parent.md",
      },
    },
  };

  let titleUpdated = false;

  const client = {
    blocks: {
      children: {
        list: async () => ({ results: [], has_more: false, next_cursor: null }),
        append: async ({ children }: { children: unknown[] }) => ({ results: children }),
      },
      update: async () => ({ id: "block-id" }),
    },
    pages: {
      retrieve: async ({ page_id }: { page_id: string }) => ({
        object: "page",
        id: page_id,
        url: `https://www.notion.so/${page_id}`,
        parent: { type: "workspace", workspace: true },
        properties: {
          title: {
            type: "title",
            title: [{ plain_text: "Root Page" }],
          },
        },
      }),
      update: async () => {
        titleUpdated = true;
        return { id: "page-id" };
      },
    },
  } as unknown as Client;

  const result = await syncWikiSection(
    { sectionName: "parent" },
    {
      client,
      rootPageId: "00000000-0000-0000-0000-000000000000",
      wikiContentDirectory: wikiDir,
      pageMap,
    },
  );

  assert.equal(result.title, "Root Page");
  assert.equal(titleUpdated, false);
  assert.deepEqual(result.warnings, []);

  await rm(dir, { recursive: true });
});

test("syncWikiSection propagates markdown warnings for unsupported blocks", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sync-wiki-test-"));
  const wikiDir = path.join(dir, "wiki-content");
  const sectionDir = path.join(wikiDir, "warn-section");

  await mkdir(sectionDir, { recursive: true });
  await writeFile(
    path.join(sectionDir, "index.md"),
    "# Warnings\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- parent\n  - child\n",
    "utf8",
  );

  const pageMap: PageMap = {
    sections: {
      "warn-section": {
        name: "Warning Section",
        pageId: "00000000000000000000000000000001",
        file: "warn-section/index.md",
      },
    },
  };

  const client = {
    blocks: {
      children: {
        list: async () => ({ results: [], has_more: false, next_cursor: null }),
        append: async ({ children }: { children: unknown[] }) => ({ results: children }),
      },
      update: async () => ({ id: "block-id" }),
    },
    pages: {
      retrieve: async ({ page_id }: { page_id: string }) => ({
        object: "page",
        id: page_id,
        url: `https://www.notion.so/${page_id}`,
        parent: { type: "page_id", page_id: "parent-id" },
        properties: {
          title: {
            type: "title",
            title: [{ plain_text: "Warning Section" }],
          },
        },
      }),
      update: async () => ({
        object: "page",
        id: "page-id",
        url: "https://www.notion.so/page-id",
        parent: { type: "page_id", page_id: "parent-id" },
        properties: {
          title: {
            type: "title",
            title: [{ plain_text: "Warning Section" }],
          },
        },
      }),
    },
  } as unknown as Client;

  const result = await syncWikiSection(
    { sectionName: "warn-section" },
    {
      client,
      rootPageId: "parent-id",
      wikiContentDirectory: wikiDir,
      pageMap,
    },
  );

  assert.ok(
    result.warnings.some((w) => w.includes("Unsupported markdown block ignored")),
    `Expected table warning, got: ${result.warnings.join(", ")}`,
  );
  assert.ok(
    result.warnings.some((w) => w.includes("flattened")),
    `Expected nested list warning, got: ${result.warnings.join(", ")}`,
  );

  await rm(dir, { recursive: true });
});

test("syncWikiSection handles multiple sections independently", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sync-wiki-test-"));
  const wikiDir = path.join(dir, "wiki-content");

  await mkdir(path.join(wikiDir, "section-a"), { recursive: true });
  await mkdir(path.join(wikiDir, "section-b"), { recursive: true });
  await writeFile(path.join(wikiDir, "section-a", "index.md"), "# A\n\nContent A.\n", "utf8");
  await writeFile(path.join(wikiDir, "section-b", "index.md"), "# B\n\nContent B.\n", "utf8");

  const pageMap: PageMap = {
    sections: {
      "section-a": {
        name: "Section A",
        pageId: "00000000000000000000000000000001",
        file: "section-a/index.md",
      },
      "section-b": {
        name: "Section B",
        pageId: "00000000000000000000000000000002",
        file: "section-b/index.md",
      },
    },
  };

  const client = {
    blocks: {
      children: {
        list: async () => ({ results: [], has_more: false, next_cursor: null }),
        append: async ({ children }: { children: unknown[] }) => ({ results: children }),
      },
      update: async () => ({ id: "block-id" }),
    },
    pages: {
      retrieve: async ({ page_id }: { page_id: string }) => ({
        object: "page",
        id: page_id,
        url: `https://www.notion.so/${page_id}`,
        parent: { type: "page_id", page_id: "parent-id" },
        properties: {
          title: {
            type: "title",
            title: [{ plain_text: "Section" }],
          },
        },
      }),
      update: async () => ({
        object: "page",
        id: "page-id",
        url: "https://www.notion.so/page-id",
        parent: { type: "page_id", page_id: "parent-id" },
        properties: {
          title: {
            type: "title",
            title: [{ plain_text: "Section" }],
          },
        },
      }),
    },
  } as unknown as Client;

  const deps = {
    client,
    rootPageId: "parent-id",
    wikiContentDirectory: wikiDir,
    pageMap,
  };

  const resultA = await syncWikiSection({ sectionName: "section-a" }, deps);
  const resultB = await syncWikiSection({ sectionName: "section-b" }, deps);

  assert.equal(resultA.title, "Section A");
  assert.equal(resultB.title, "Section B");
  assert.equal(resultA.appendedCount, 4); // heading + paragraph + divider + modified-date paragraph
  assert.equal(resultB.appendedCount, 4);

  await rm(dir, { recursive: true });
});
