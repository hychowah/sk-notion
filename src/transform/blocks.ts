import path from "node:path";

import type { BlockObjectRequest, Client } from "@notionhq/client";
import type { RichTextItemRequest } from "@notionhq/client/build/src/api-endpoints/common";

import { assertSupportedRemoteImageUrl, isRemoteUrl, uploadImageFile } from "../notion/uploads";
import type { BlockBuildResult, ContentNode, RichTextSegment, TableCell } from "./types";

const MAX_TABLE_ROWS = 90;

const MAX_RICH_TEXT_CHARS = 2000;
const NOTION_CODE_LANGUAGES = new Set([
  "abap",
  "arduino",
  "bash",
  "c",
  "c#",
  "c++",
  "clojure",
  "coffeescript",
  "css",
  "dart",
  "diff",
  "docker",
  "elixir",
  "elm",
  "erlang",
  "go",
  "graphql",
  "groovy",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "latex",
  "less",
  "lua",
  "makefile",
  "markdown",
  "objective-c",
  "perl",
  "php",
  "plain text",
  "powershell",
  "python",
  "r",
  "ruby",
  "rust",
  "scala",
  "scheme",
  "scss",
  "shell",
  "solidity",
  "sql",
  "swift",
  "toml",
  "typescript",
  "vb.net",
  "visual basic",
  "xml",
  "yaml",
]);

export type BuildBlocksOptions = {
  client?: Client;
  baseDirectory?: string;
};

export async function contentNodesToBlocks(
  nodes: ContentNode[],
  options: BuildBlocksOptions = {},
): Promise<{ blocks: BlockObjectRequest[]; result: BlockBuildResult }> {
  const blocks: BlockObjectRequest[] = [];
  const warnings: string[] = [];
  const uploadedImages: Array<{ source: string; fileUploadId: string }> = [];

  for (const node of nodes) {
    if (node.type === "divider") {
      blocks.push({ type: "divider", divider: {} });
      continue;
    }

    if (node.type === "image") {
      const imageBlock = await imageNodeToBlock(node.source, node.caption, options);
      blocks.push(imageBlock.block);

      if (imageBlock.uploadedImage) {
        uploadedImages.push(imageBlock.uploadedImage);
      }
      continue;
    }

    switch (node.type) {
      case "heading_1":
        blocks.push({
          type: "heading_1",
          heading_1: {
            rich_text: "segments" in node ? segmentsToRichText(node.segments) : richTextFromText((node as { text: string }).text),
          },
        });
        break;
      case "heading_2":
        blocks.push({
          type: "heading_2",
          heading_2: {
            rich_text: "segments" in node ? segmentsToRichText(node.segments) : richTextFromText((node as { text: string }).text),
          },
        });
        break;
      case "heading_3":
        blocks.push({
          type: "heading_3",
          heading_3: {
            rich_text: "segments" in node ? segmentsToRichText(node.segments) : richTextFromText((node as { text: string }).text),
          },
        });
        break;
      case "heading_4":
        blocks.push({
          type: "heading_4",
          heading_4: {
            rich_text: "segments" in node ? segmentsToRichText(node.segments) : richTextFromText((node as { text: string }).text),
          },
        });
        break;
      case "paragraph":
        blocks.push({
          type: "paragraph",
          paragraph: {
            rich_text: "segments" in node ? segmentsToRichText(node.segments) : richTextFromText((node as { text: string }).text),
          },
        });
        break;
      case "bulleted_list_item":
        blocks.push({
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: "segments" in node ? segmentsToRichText(node.segments) : richTextFromText((node as { text: string }).text),
          },
        });
        break;
      case "numbered_list_item":
        blocks.push({
          type: "numbered_list_item",
          numbered_list_item: {
            rich_text: "segments" in node ? segmentsToRichText(node.segments) : richTextFromText((node as { text: string }).text),
          },
        });
        break;
      case "quote":
        blocks.push({
          type: "quote",
          quote: {
            rich_text: "segments" in node ? segmentsToRichText(node.segments) : richTextFromText((node as { text: string }).text),
          },
        });
        break;
      case "callout":
        blocks.push({
          type: "callout",
          callout: {
            rich_text: segmentsToRichText(node.segments),
            icon: { type: "emoji", emoji: node.icon as never },
            color: node.color as never,
          },
        });
        break;
      case "table": {
        const tableWidth = node.header.length;
        if (tableWidth === 0) {
          warnings.push("Table without a header row skipped.");
          break;
        }
        if (node.rows.length > MAX_TABLE_ROWS) {
          warnings.push(
            `Table with ${node.rows.length} rows exceeds the ${MAX_TABLE_ROWS}-row publish limit and was skipped.`,
          );
          break;
        }
        blocks.push({
          type: "table",
          table: {
            table_width: tableWidth,
            has_column_header: true,
            has_row_header: false,
            children: [
              tableRowBlock(node.header),
              ...node.rows.map((row) => tableRowBlock(row)),
            ],
          },
        });
        break;
      }
      case "table_of_contents":
        blocks.push({
          type: "table_of_contents",
          table_of_contents: { color: "default" },
        });
        break;
      case "code":
        blocks.push({
          type: "code",
          code: {
            rich_text: richTextFromText(node.text),
            caption: [],
            language: mapCodeLanguage(node.language) as never,
          },
        });
        break;
      default:
        warnings.push(`Unsupported content node skipped: ${(node as ContentNode).type}`);
        break;
    }
  }

  return {
    blocks,
    result: {
      warnings,
      uploadedImages,
    },
  };
}

export function markdownToParagraphBlocks(text: string): BlockObjectRequest[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => ({
      type: "paragraph",
      paragraph: {
        rich_text: richTextFromText(paragraph),
      },
    }));
}

export function richTextFromText(text: string): RichTextItemRequest[] {
  const chunks = splitIntoChunks(text, MAX_RICH_TEXT_CHARS);
  return chunks.map((chunk) => ({
    type: "text",
    text: { content: chunk },
  }));
}

export function segmentsToRichText(segments: RichTextSegment[]): RichTextItemRequest[] {
  const result: RichTextItemRequest[] = [];
  for (const seg of segments) {
    const chunks = splitIntoChunks(seg.text, MAX_RICH_TEXT_CHARS);
    for (const chunk of chunks) {
      const item: RichTextItemRequest = {
        type: "text",
        text: { content: chunk },
      };
      if (seg.link) {
        item.text.link = seg.link;
      }
      if (seg.annotations) {
        item.annotations = {
          ...(seg.annotations.bold ? { bold: true } : {}),
          ...(seg.annotations.italic ? { italic: true } : {}),
          ...(seg.annotations.code ? { code: true } : {}),
        };
      }
      result.push(item);
    }
  }
  return result;
}

function tableRowBlock(cells: TableCell[]) {
  return {
    type: "table_row" as const,
    table_row: {
      cells: cells.map((cell) => segmentsToRichText(cell)),
    },
  };
}

async function imageNodeToBlock(
  source: string,
  caption: string | undefined,
  options: BuildBlocksOptions,
): Promise<{
  block: BlockObjectRequest;
  uploadedImage?: { source: string; fileUploadId: string };
}> {
  const richCaption = caption ? richTextFromText(caption) : [];

  if (isRemoteUrl(source)) {
    assertSupportedRemoteImageUrl(source);
    return {
      block: {
        type: "image",
        image: {
          type: "external",
          external: { url: source },
          caption: richCaption,
        },
      },
    };
  }

  if (!options.client) {
    throw new Error(
      `Local image path ${source} requires a configured Notion client for upload.`,
    );
  }

  // Decode percent-encoded characters (e.g. %20 → space) so paths with
  // spaces resolve correctly on the local filesystem.
  const decodedSource = decodeURIComponent(source);

  const resolvedPath = options.baseDirectory
    ? path.resolve(options.baseDirectory, decodedSource)
    : path.resolve(decodedSource);

  const uploadedImage = await uploadImageFile(options.client, resolvedPath);
  return {
    block: {
      type: "image",
      image: {
        type: "file_upload",
        file_upload: { id: uploadedImage.fileUploadId },
        caption: richCaption,
      },
    },
    uploadedImage: {
      source: resolvedPath,
      fileUploadId: uploadedImage.fileUploadId,
    },
  };
}

function splitIntoChunks(value: string, maxSize: number): string[] {
  if (value.length <= maxSize) {
    return [value];
  }

  const chunks: string[] = [];

  for (let index = 0; index < value.length; index += maxSize) {
    chunks.push(value.slice(index, index + maxSize));
  }

  return chunks;
}

function mapCodeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase() || "plain text";
  return NOTION_CODE_LANGUAGES.has(normalized) ? normalized : "plain text";
}