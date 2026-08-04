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

test("markdownToContentNodes parses tables into table nodes", () => {
  const result = markdownToContentNodes("| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |");

  assert.deepEqual(result.nodes, [
    {
      type: "table",
      header: [[{ text: "a" }], [{ text: "b" }]],
      rows: [
        [[{ text: "1" }], [{ text: "2" }]],
        [[{ text: "3" }], [{ text: "4" }]],
      ],
    },
  ]);
  assert.deepEqual(result.warnings, []);
});

test("markdownToContentNodes strips HTML comments", () => {
  const result = markdownToContentNodes(
    "Before.\n\n<!-- TODO image: secret/path.png -->\n\nAfter.",
  );

  assert.deepEqual(result.nodes, [
    { type: "paragraph", segments: [{ text: "Before." }] },
    { type: "paragraph", segments: [{ text: "After." }] },
  ]);
});

test("markdownToContentNodes preserves bold, italic, and inline code", () => {
  const result = markdownToContentNodes(
    "Status **OPEN** and *maybe* with `code/path.ts` inline.",
  );

  assert.deepEqual(result.nodes, [
    {
      type: "paragraph",
      segments: [
        { text: "Status " },
        { text: "OPEN", annotations: { bold: true } },
        { text: " and " },
        { text: "maybe", annotations: { italic: true } },
        { text: " with " },
        { text: "code/path.ts", annotations: { code: true } },
        { text: " inline." },
      ],
    },
  ]);
});

test("markdownToContentNodes converts marked quotes to callouts", () => {
  const result = markdownToContentNodes(
    "> **Warning:** the workspace does not build.\n\n> **Note:** read this first.\n\n> ordinary quote",
  );

  assert.deepEqual(result.nodes, [
    {
      type: "callout",
      segments: [
        { text: "Warning:", annotations: { bold: true } },
        { text: " the workspace does not build." },
      ],
      icon: "⚠️",
      color: "orange_background",
    },
    {
      type: "callout",
      segments: [
        { text: "Note:", annotations: { bold: true } },
        { text: " read this first." },
      ],
      icon: "ℹ️",
      color: "gray_background",
    },
    { type: "quote", segments: [{ text: "ordinary quote" }] },
  ]);
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