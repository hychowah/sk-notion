import { describe, it } from "node:test";
import assert from "node:assert";

import { blocksToMarkdown } from "../src/transform/notion-to-markdown";
import type { BlockObjectResponse } from "@notionhq/client";

function makeRichText(plainText: string) {
  return [
    {
      type: "text" as const,
      text: { content: plainText },
      plain_text: plainText,
      href: null,
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: "default" as const,
      },
    },
  ];
}

function baseBlock(overrides: Partial<BlockObjectResponse> & { type: BlockObjectResponse["type"] }): BlockObjectResponse {
  return {
    id: "block-id",
    object: "block",
    created_time: "2024-01-01T00:00:00.000Z",
    created_by: { object: "user", id: "user-id" },
    last_edited_time: "2024-01-01T00:00:00.000Z",
    last_edited_by: { object: "user", id: "user-id" },
    has_children: false,
    in_trash: false,
    archived: false,
    parent: { type: "page_id", page_id: "page-id" },
    ...overrides,
  } as BlockObjectResponse;
}

describe("blocksToMarkdown", () => {
  it("returns empty string for empty array", () => {
    assert.strictEqual(blocksToMarkdown([]), "");
  });

  it("converts paragraph blocks", () => {
    const blocks: BlockObjectResponse[] = [
      baseBlock({
        id: "p1",
        type: "paragraph",
        paragraph: { rich_text: makeRichText("Hello world"), color: "default" },
      }),
    ];

    assert.strictEqual(blocksToMarkdown(blocks), "Hello world");
  });

  it("converts headings 1-4", () => {
    const blocks: BlockObjectResponse[] = [
      baseBlock({ id: "h1", type: "heading_1", heading_1: { rich_text: makeRichText("Title"), color: "default", is_toggleable: false } }),
      baseBlock({ id: "h2", type: "heading_2", heading_2: { rich_text: makeRichText("Section"), color: "default", is_toggleable: false } }),
      baseBlock({ id: "h3", type: "heading_3", heading_3: { rich_text: makeRichText("Subsection"), color: "default", is_toggleable: false } }),
      baseBlock({ id: "h4", type: "heading_4", heading_4: { rich_text: makeRichText("Detail"), color: "default", is_toggleable: false } }),
    ];

    const expected = "# Title\n\n## Section\n\n### Subsection\n\n#### Detail";
    assert.strictEqual(blocksToMarkdown(blocks), expected);
  });

  it("converts bulleted and numbered list items", () => {
    const blocks: BlockObjectResponse[] = [
      baseBlock({ id: "b1", type: "bulleted_list_item", bulleted_list_item: { rich_text: makeRichText("First"), color: "default" } }),
      baseBlock({ id: "b2", type: "bulleted_list_item", bulleted_list_item: { rich_text: makeRichText("Second"), color: "default" } }),
      baseBlock({ id: "n1", type: "numbered_list_item", numbered_list_item: { rich_text: makeRichText("One"), color: "default" } }),
      baseBlock({ id: "n2", type: "numbered_list_item", numbered_list_item: { rich_text: makeRichText("Two"), color: "default" } }),
    ];

    const expected = "- First\n- Second\n\n1. One\n1. Two";
    assert.strictEqual(blocksToMarkdown(blocks), expected);
  });

  it("converts quote blocks", () => {
    const blocks: BlockObjectResponse[] = [
      baseBlock({ id: "q1", type: "quote", quote: { rich_text: makeRichText("A quote"), color: "default" } }),
    ];

    assert.strictEqual(blocksToMarkdown(blocks), "> A quote");
  });

  it("converts code blocks with language", () => {
    const blocks: BlockObjectResponse[] = [
      baseBlock({
        id: "c1",
        type: "code",
        code: { rich_text: makeRichText("console.log('hi');"), caption: [], language: "javascript" },
      }),
    ];

    assert.strictEqual(blocksToMarkdown(blocks), "```javascript\nconsole.log('hi');\n```");
  });

  it("converts code blocks without language for plain text", () => {
    const blocks: BlockObjectResponse[] = [
      baseBlock({
        id: "c1",
        type: "code",
        code: { rich_text: makeRichText("some text"), caption: [], language: "plain text" },
      }),
    ];

    assert.strictEqual(blocksToMarkdown(blocks), "```\nsome text\n```");
  });

  it("converts divider blocks", () => {
    const blocks: BlockObjectResponse[] = [
      baseBlock({ id: "d1", type: "divider", divider: {} }),
    ];

    assert.strictEqual(blocksToMarkdown(blocks), "---");
  });

  it("converts external image blocks", () => {
    const blocks: BlockObjectResponse[] = [
      baseBlock({
        id: "i1",
        type: "image",
        image: {
          type: "external",
          external: { url: "https://example.com/image.png" },
          caption: makeRichText("Alt text"),
        },
      }),
    ];

    assert.strictEqual(blocksToMarkdown(blocks), "![Alt text](https://example.com/image.png)");
  });

  it("converts file image blocks", () => {
    const blocks: BlockObjectResponse[] = [
      baseBlock({
        id: "i1",
        type: "image",
        image: {
          type: "file",
          file: { url: "https://s3.us-west-2.amazonaws.com/secure.notion-static.com/xxx/image.png", expiry_time: "2024-01-01T00:00:00.000Z" },
          caption: [],
        },
      }),
    ];

    assert.strictEqual(blocksToMarkdown(blocks), "![](https://s3.us-west-2.amazonaws.com/secure.notion-static.com/xxx/image.png)");
  });

  it("renders unsupported blocks as HTML comments", () => {
    const blocks: BlockObjectResponse[] = [
      baseBlock({ id: "t1", type: "table", table: { table_width: 3, has_column_header: false, has_row_header: false } }),
    ];

    assert.strictEqual(blocksToMarkdown(blocks), "<!-- notion:unsupported:table -->");
  });

  it("includes block IDs when option is enabled", () => {
    const blocks: BlockObjectResponse[] = [
      baseBlock({ id: "p1", type: "paragraph", paragraph: { rich_text: makeRichText("Text"), color: "default" } }),
    ];

    const result = blocksToMarkdown(blocks, { includeBlockIds: true });
    assert.strictEqual(result, "<!-- notion:block_id:p1 -->\nText");
  });

  it("includes has_children comment", () => {
    const blocks: BlockObjectResponse[] = [
      baseBlock({ id: "p1", type: "paragraph", paragraph: { rich_text: makeRichText("Text"), color: "default" }, has_children: true }),
    ];

    const result = blocksToMarkdown(blocks);
    assert.strictEqual(result, "<!-- notion:has_children -->\nText");
  });

  it("filters out partial blocks", () => {
    const blocks = [
      { object: "block", id: "partial-id" },
      baseBlock({ id: "p1", type: "paragraph", paragraph: { rich_text: makeRichText("Only this"), color: "default" } }),
    ];

    assert.strictEqual(blocksToMarkdown(blocks as BlockObjectResponse[]), "Only this");
  });

  it("handles multiple paragraphs with blank lines", () => {
    const blocks: BlockObjectResponse[] = [
      baseBlock({ id: "p1", type: "paragraph", paragraph: { rich_text: makeRichText("First"), color: "default" } }),
      baseBlock({ id: "p2", type: "paragraph", paragraph: { rich_text: makeRichText("Second"), color: "default" } }),
    ];

    assert.strictEqual(blocksToMarkdown(blocks), "First\n\nSecond");
  });
});
