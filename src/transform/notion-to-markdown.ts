import { isFullBlock } from "@notionhq/client";
import type {
  BlockObjectResponse,
  PartialBlockObjectResponse,
  RichTextItemResponse,
} from "@notionhq/client";

export type BlocksToMarkdownOptions = {
  includeBlockIds?: boolean;
};

export function blocksToMarkdown(
  blocks: Array<PartialBlockObjectResponse | BlockObjectResponse>,
  options: BlocksToMarkdownOptions = {},
): string {
  const fullBlocks = blocks.filter((block): block is BlockObjectResponse => isFullBlock(block));

  const lines: string[] = [];
  let previousType: string | null = null;

  for (const block of fullBlocks) {
    const blockLines: string[] = [];

    if (options.includeBlockIds) {
      blockLines.push(`<!-- notion:block_id:${block.id} -->`);
    }

    if (block.has_children) {
      blockLines.push(`<!-- notion:has_children -->`);
    }

    const content = blockToMarkdown(block);
    if (content !== null) {
      blockLines.push(content);
    }

    if (blockLines.length > 0) {
      const separator = shouldUseSingleNewline(previousType, block.type) ? "\n" : "\n\n";
      if (lines.length > 0) {
        lines.push(separator);
      }
      lines.push(blockLines.join("\n"));
      previousType = block.type;
    }
  }

  return lines.join("").trimEnd();
}

function shouldUseSingleNewline(prevType: string | null, currType: string): boolean {
  if (prevType === null) return false;
  return prevType === currType && (prevType === "bulleted_list_item" || prevType === "numbered_list_item");
}

function blockToMarkdown(block: BlockObjectResponse): string | null {
  switch (block.type) {
    case "paragraph":
      return richTextToPlainText(block.paragraph.rich_text);

    case "heading_1":
      return `# ${richTextToPlainText(block.heading_1.rich_text)}`;

    case "heading_2":
      return `## ${richTextToPlainText(block.heading_2.rich_text)}`;

    case "heading_3":
      return `### ${richTextToPlainText(block.heading_3.rich_text)}`;

    case "heading_4":
      return `#### ${richTextToPlainText(block.heading_4.rich_text)}`;

    case "bulleted_list_item":
      return `- ${richTextToPlainText(block.bulleted_list_item.rich_text)}`;

    case "numbered_list_item":
      return `1. ${richTextToPlainText(block.numbered_list_item.rich_text)}`;

    case "quote":
      return `> ${richTextToPlainText(block.quote.rich_text)}`;

    case "code": {
      const language = block.code.language === "plain text" ? "" : block.code.language;
      const codeText = richTextToPlainText(block.code.rich_text);
      return `\`\`\`${language}\n${codeText}\n\`\`\``;
    }

    case "divider":
      return "---";

    case "image": {
      let url: string;

      if (block.image.type === "external") {
        url = block.image.external.url;
      } else if (block.image.type === "file") {
        url = block.image.file.url;
      } else {
        return "<!-- notion:unsupported:image_type -->";
      }

      const caption = richTextToPlainText(block.image.caption);
      return `![${caption}](${url})`;
    }

    default:
      return `<!-- notion:unsupported:${block.type} -->`;
  }
}

function richTextToPlainText(richText: Array<RichTextItemResponse>): string {
  return richText.map((item) => item.plain_text).join("");
}
