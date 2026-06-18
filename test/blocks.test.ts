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