import assert from "node:assert/strict";
import test from "node:test";
import type { BlockObjectRequest, BlockObjectResponse } from "@notionhq/client";

import { diffBlocks, fingerprintRequest, fingerprintResponse } from "../src/diff/blocks";

function makeResponse(type: string, text: string, id: string): BlockObjectResponse {
  const base = {
    object: "block" as const,
    id,
    parent: { type: "page_id" as const, page_id: "parent" },
    created_time: "2024-01-01T00:00:00.000Z",
    created_by: { object: "user" as const, id: "user" },
    last_edited_time: "2024-01-01T00:00:00.000Z",
    last_edited_by: { object: "user" as const, id: "user" },
    has_children: false,
    in_trash: false,
    archived: false,
  };

  switch (type) {
    case "paragraph":
      return {
        ...base,
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: text }, plain_text: text }], color: "default", icon: null },
      } as unknown as BlockObjectResponse;
    case "heading_1":
      return {
        ...base,
        type: "heading_1",
        heading_1: { rich_text: [{ type: "text", text: { content: text }, plain_text: text }], color: "default", is_toggleable: false },
      } as unknown as BlockObjectResponse;
    case "heading_2":
      return {
        ...base,
        type: "heading_2",
        heading_2: { rich_text: [{ type: "text", text: { content: text }, plain_text: text }], color: "default", is_toggleable: false },
      } as unknown as BlockObjectResponse;
    case "code":
      return {
        ...base,
        type: "code",
        code: {
          rich_text: [{ type: "text", text: { content: text }, plain_text: text }],
          caption: [],
          language: "typescript",
        },
      } as unknown as BlockObjectResponse;
    case "divider":
      return {
        ...base,
        type: "divider",
        divider: {},
      } as unknown as BlockObjectResponse;
    case "image":
      return {
        ...base,
        type: "image",
        image: {
          type: "external",
          external: { url: text },
          caption: [],
        },
      } as unknown as BlockObjectResponse;
    default:
      throw new Error(`Unsupported type: ${type}`);
  }
}

function makeRequest(type: string, text: string): BlockObjectRequest {
  switch (type) {
    case "paragraph":
      return { type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text } }] } };
    case "heading_1":
      return { type: "heading_1", heading_1: { rich_text: [{ type: "text", text: { content: text } }] } };
    case "heading_2":
      return { type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: text } }] } };
    case "code":
      return { type: "code", code: { rich_text: [{ type: "text", text: { content: text } }], caption: [], language: "typescript" } };
    case "divider":
      return { type: "divider", divider: {} };
    case "image":
      return { type: "image", image: { type: "external", external: { url: text }, caption: [] } };
    default:
      throw new Error(`Unsupported type: ${type}`);
  }
}

test("diffBlocks detects unchanged blocks", () => {
  const current = [makeResponse("paragraph", "Hello", "block-1")];
  const target = [makeRequest("paragraph", "Hello")];
  const diff = diffBlocks(current, target);

  assert.equal(diff.unchangedCount, 1);
  assert.equal(diff.updatedCount, 0);
  assert.equal(diff.removedCount, 0);
  assert.equal(diff.addedCount, 0);
});

test("diffBlocks detects updated blocks with same type", () => {
  const current = [makeResponse("paragraph", "Hello", "block-1")];
  const target = [makeRequest("paragraph", "World")];
  const diff = diffBlocks(current, target);

  assert.equal(diff.unchangedCount, 0);
  assert.equal(diff.updatedCount, 1);
  assert.equal(diff.removedCount, 0);
  assert.equal(diff.addedCount, 0);
  assert.equal(diff.ops[0].action, "update");
  assert.equal((diff.ops[0] as Extract<typeof diff.ops[0], { action: "update" }>).blockId, "block-1");
});

test("diffBlocks detects added blocks", () => {
  const current = [makeResponse("paragraph", "Hello", "block-1")];
  const target = [
    makeRequest("paragraph", "Hello"),
    makeRequest("paragraph", "World"),
  ];
  const diff = diffBlocks(current, target);

  assert.equal(diff.unchangedCount, 1);
  assert.equal(diff.updatedCount, 0);
  assert.equal(diff.removedCount, 0);
  assert.equal(diff.addedCount, 1);
});

test("diffBlocks detects removed blocks", () => {
  const current = [
    makeResponse("paragraph", "Hello", "block-1"),
    makeResponse("paragraph", "World", "block-2"),
  ];
  const target = [makeRequest("paragraph", "Hello")];
  const diff = diffBlocks(current, target);

  assert.equal(diff.unchangedCount, 1);
  assert.equal(diff.updatedCount, 0);
  assert.equal(diff.removedCount, 1);
  assert.equal(diff.addedCount, 0);
});

test("diffBlocks detects mixed changes", () => {
  const current = [
    makeResponse("paragraph", "A", "block-1"),
    makeResponse("paragraph", "B", "block-2"),
    makeResponse("paragraph", "C", "block-3"),
  ];
  const target = [
    makeRequest("paragraph", "A"),
    makeRequest("paragraph", "B-modified"),
    makeRequest("paragraph", "D"),
  ];
  const diff = diffBlocks(current, target);

  assert.equal(diff.unchangedCount, 1);
  assert.equal(diff.updatedCount, 1);
  assert.equal(diff.removedCount, 1);
  assert.equal(diff.addedCount, 1);
});

test("diffBlocks detects type change as replace", () => {
  const current = [makeResponse("paragraph", "Hello", "block-1")];
  const target = [makeRequest("heading_1", "Hello")];
  const diff = diffBlocks(current, target);

  assert.equal(diff.unchangedCount, 0);
  assert.equal(diff.updatedCount, 0);
  assert.equal(diff.replacedCount, 1);
  assert.equal(diff.removedCount, 0);
  assert.equal(diff.addedCount, 0);
});

test("fingerprintRequest extracts plain text from paragraph", () => {
  const block = makeRequest("paragraph", "Hello world");
  const fp = fingerprintRequest(block);
  assert.equal(fp?.type, "paragraph");
  assert.equal(fp?.text, "Hello world");
});

test("fingerprintResponse extracts plain text from heading", () => {
  const block = makeResponse("heading_2", "Title", "block-1");
  const fp = fingerprintResponse(block);
  assert.equal(fp?.type, "heading_2");
  assert.equal(fp?.text, "Title");
});

test("fingerprintRequest extracts code language", () => {
  const block = makeRequest("code", "const x = 1;");
  const fp = fingerprintRequest(block);
  assert.equal(fp?.type, "code");
  assert.equal(fp?.text, "const x = 1;");
  assert.equal(fp?.language, "typescript");
});

test("fingerprintResponse extracts image url", () => {
  const block = makeResponse("image", "https://example.com/img.png", "block-1");
  const fp = fingerprintResponse(block);
  assert.equal(fp?.type, "image");
  assert.equal(fp?.imageUrl, "https://example.com/img.png");
});
