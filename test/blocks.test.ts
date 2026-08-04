import assert from "node:assert/strict";
import test from "node:test";

import {
  contentNodesToBlocks,
  markdownToParagraphBlocks,
  richTextFromText,
} from "../src/transform/blocks";

test("richTextFromText splits long content into Notion-sized chunks", () => {
  const longText = "a".repeat(2001);
  const richText = richTextFromText(longText);

  assert.equal(richText.length, 2);
  assert.equal(richText[0]?.text.content.length, 2000);
  assert.equal(richText[1]?.text.content.length, 1);
});

test("markdownToParagraphBlocks splits text on blank lines", () => {
  const blocks = markdownToParagraphBlocks("First paragraph\n\nSecond paragraph");

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.type, "paragraph");
  assert.equal(blocks[1]?.type, "paragraph");
});

test("contentNodesToBlocks builds an external image block for remote URLs", async () => {
  const built = await contentNodesToBlocks([
    {
      type: "image",
      source: "https://example.com/image.png",
      caption: "Preview",
    },
  ]);

  assert.equal(built.blocks.length, 1);
  const block = built.blocks[0];
  assert.equal(block?.type, "image");
  assert.equal(block?.image.type, "external");
  assert.equal(block?.image.external.url, "https://example.com/image.png");
  assert.deepEqual(built.result.uploadedImages, []);
});

test("contentNodesToBlocks rejects local image paths without a Notion client", async () => {
  await assert.rejects(
    () =>
      contentNodesToBlocks([
        {
          type: "image",
          source: "./diagram.png",
        },
      ]),
    /requires a configured Notion client for upload/,
  );
});
test("contentNodesToBlocks builds a table block with header and rows", async () => {
  const built = await contentNodesToBlocks([
    {
      type: "table",
      header: [[{ text: "a" }], [{ text: "b" }]],
      rows: [
        [[{ text: "1" }], [{ text: "2" }]],
        [[{ text: "3", annotations: { bold: true } }], [{ text: "4" }]],
      ],
    },
  ]);

  assert.equal(built.blocks.length, 1);
  const block = built.blocks[0];
  assert.equal(block?.type, "table");
  if (block?.type !== "table") throw new Error("expected table block");
  assert.equal(block.table.table_width, 2);
  assert.equal(block.table.has_column_header, true);
  const children = block.table.children ?? [];
  assert.equal(children.length, 3);
  const firstRow = children[0];
  if (firstRow?.type !== "table_row") throw new Error("expected table_row child");
  assert.equal(firstRow.table_row.cells.length, 2);
  const headerCell = firstRow.table_row.cells[0]?.[0];
  assert.equal(headerCell?.type, "text");
  if (headerCell?.type !== "text") throw new Error("expected text cell");
  assert.equal(headerCell.text.content, "a");
  const boldRow = children[2];
  if (boldRow?.type !== "table_row") throw new Error("expected table_row child");
  const boldCell = boldRow.table_row.cells[0]?.[0];
  assert.equal(boldCell?.annotations?.bold, true);
});

test("contentNodesToBlocks skips tables over the row limit with a warning", async () => {
  const rows = Array.from({ length: 91 }, (_, i) => [[{ text: String(i) }]]);
  const built = await contentNodesToBlocks([
    { type: "table", header: [[{ text: "n" }]], rows },
  ]);

  assert.equal(built.blocks.length, 0);
  assert.ok(built.result.warnings.some((w) => w.includes("publish limit")));
});

test("contentNodesToBlocks builds callout and table-of-contents blocks", async () => {
  const built = await contentNodesToBlocks([
    {
      type: "callout",
      segments: [
        { text: "Warning:", annotations: { bold: true } },
        { text: " be careful." },
      ],
      icon: "⚠️",
      color: "orange_background",
    },
    { type: "table_of_contents" },
  ]);

  assert.equal(built.blocks.length, 2);
  const callout = built.blocks[0];
  assert.equal(callout?.type, "callout");
  if (callout?.type !== "callout") throw new Error("expected callout block");
  assert.equal(callout.callout.color, "orange_background");
  assert.deepEqual(callout.callout.icon, { type: "emoji", emoji: "⚠️" });
  const firstSegment = callout.callout.rich_text[0];
  assert.equal(firstSegment?.annotations?.bold, true);

  const toc = built.blocks[1];
  assert.equal(toc?.type, "table_of_contents");
});
