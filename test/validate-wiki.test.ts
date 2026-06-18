import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadPageMap, type PageMap } from "../src/sync-wiki";

test("loadPageMap rejects invalid JSON with a friendly message", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sync-wiki-test-"));
  const mapPath = path.join(dir, "page-map.json");

  await writeFile(mapPath, "{ invalid json", "utf8");

  await assert.rejects(loadPageMap(mapPath), /Failed to parse/);

  await rm(dir, { recursive: true });
});

test("loadPageMap rejects missing required fields", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sync-wiki-test-"));
  const mapPath = path.join(dir, "page-map.json");

  await writeFile(
    mapPath,
    JSON.stringify({ sections: { bad: { name: "", pageId: "abc", file: "x.md" } } }),
    "utf8",
  );

  await assert.rejects(loadPageMap(mapPath), /Invalid page map/);

  await rm(dir, { recursive: true });
});

test("loadPageMap rejects empty pageId", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sync-wiki-test-"));
  const mapPath = path.join(dir, "page-map.json");

  await writeFile(
    mapPath,
    JSON.stringify({ sections: { bad: { name: "Bad", pageId: "", file: "x.md" } } }),
    "utf8",
  );

  await assert.rejects(loadPageMap(mapPath), /Invalid page map/);

  await rm(dir, { recursive: true });
});
