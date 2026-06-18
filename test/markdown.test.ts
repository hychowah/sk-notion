import assert from "node:assert/strict";
import test from "node:test";

import { markdownToContentNodes } from "../src/transform/markdown";

test("markdownToContentNodes converts common wiki markdown blocks", () => {
  const markdown = [
    "# Title",
    "",
    "Paragraph text.",
    "",
    "- bullet item",
    "",
    "> quoted text",
    "",
    "```ts",
    "const value = 1;",
    "```",
    "",
    "---",
    "",
    "![Diagram](https://example.com/diagram.png)",
  ].join("\n");

  const result = markdownToContentNodes(markdown);

  assert.deepEqual(result.nodes, [
    { type: "heading_1", segments: [{ text: "Title" }] },
    { type: "paragraph", segments: [{ text: "Paragraph text." }] },
    { type: "bulleted_list_item", segments: [{ text: "bullet item" }] },
    { type: "quote", segments: [{ text: "quoted text" }] },
    { type: "code", text: "const value = 1;\n", language: "ts" },
    { type: "divider" },
    {
      type: "image",
      source: "https://example.com/diagram.png",
      caption: "Diagram",
    },
  ]);
  assert.deepEqual(result.warnings, []);
});

test("markdownToContentNodes warns when flattening nested lists", () => {
  const result = markdownToContentNodes("- parent\n  - child");

  assert.ok(
    result.warnings.includes("Nested bullet lists are flattened in this version."),
  );
});

test("markdownToContentNodes warns on unsupported tables", () => {
  const result = markdownToContentNodes("| a | b |\n| - | - |\n| 1 | 2 |");

  assert.ok(result.warnings.includes("Unsupported markdown block ignored: table_open"));
});

test("markdownToContentNodes preserves inline links", () => {
  const result = markdownToContentNodes("See [Procedure of EE Homing](./procedure-ee-homing/index.md) for details.");

  assert.deepEqual(result.nodes, [
    {
      type: "paragraph",
      segments: [
        { text: "See " },
        { text: "Procedure of EE Homing", link: { url: "./procedure-ee-homing/index.md" } },
        { text: " for details." },
      ],
    },
  ]);
  assert.deepEqual(result.warnings, []);
});

test("markdownToContentNodes handles image paths with spaces", () => {
  const result = markdownToContentNodes("![Mobile Base](./diagram folder/base.svg)");

  assert.deepEqual(result.nodes, [
    {
      type: "image",
      source: "./diagram%20folder/base.svg",
      caption: "Mobile Base",
    },
  ]);
  assert.deepEqual(result.warnings, []);
});