import MarkdownIt from "markdown-it";

import type {
  ContentNode,
  MarkdownTransformResult,
  RichTextAnnotations,
  RichTextSegment,
  TableCell,
} from "./types";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

type InlineSegment =
  | { type: "text"; value: string; annotations?: RichTextAnnotations }
  | { type: "link"; value: string; url: string; annotations?: RichTextAnnotations }
  | { type: "image"; source: string; caption?: string };

type TableState = {
  inHeader: boolean;
  header: TableCell[];
  rows: TableCell[][];
  currentRow: TableCell[] | null;
};

const CALLOUT_MARKERS: Array<{ prefix: string; icon: string; color: string }> = [
  { prefix: "Warning:", icon: "⚠️", color: "orange_background" },
  { prefix: "Note:", icon: "ℹ️", color: "gray_background" },
];

/**
 * Convert a quote's segments into a callout node when the quote starts with
 * a recognised marker (`Warning:` / `Note:` — bold or plain). Returns null
 * when the quote is an ordinary quote.
 */
function quoteSegmentsToCallout(segments: RichTextSegment[]): ContentNode | null {
  const plainText = segments.map((seg) => seg.text).join("").trimStart();
  for (const marker of CALLOUT_MARKERS) {
    if (plainText.startsWith(marker.prefix)) {
      return { type: "callout", segments, icon: marker.icon, color: marker.color };
    }
  }
  return null;
}

export function markdownToContentNodes(source: string): MarkdownTransformResult {
  // Strip HTML comments (e.g. `<!-- TODO image: ... -->` placeholders) so they
  // never leak into the published page as literal text.
  const uncommented = source.replace(/<!--[\s\S]*?-->/g, "");
  // markdown-it requires spaces in URLs to be percent-encoded; pre-process so
  // image/link syntax with literal spaces is recognised correctly.
  const processed = encodeSpacesInMarkdownUrls(uncommented);
  const tokens = markdown.parse(processed, {});
  const nodes: ContentNode[] = [];
  const warnings: string[] = [];

  const listStack: Array<"bulleted_list_item" | "numbered_list_item"> = [];
  let activeBlockType:
    | ContentNode["type"]
    | null = null;
  let quoteDepth = 0;
  let tableState: TableState | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    switch (token.type) {
      case "heading_open": {
        const level = Number(token.tag.replace("h", ""));
        activeBlockType = (level >= 1 && level <= 4
          ? `heading_${level}`
          : "heading_4") as ContentNode["type"];
        break;
      }
      case "heading_close":
        activeBlockType = null;
        break;
      case "paragraph_open":
        activeBlockType = listStack.at(-1) ?? (quoteDepth > 0 ? "quote" : "paragraph");
        break;
      case "paragraph_close":
        activeBlockType = null;
        break;
      case "bullet_list_open":
        listStack.push("bulleted_list_item");
        if (listStack.length > 1) {
          warnings.push("Nested bullet lists are flattened in this version.");
        }
        break;
      case "bullet_list_close":
        listStack.pop();
        break;
      case "ordered_list_open":
        listStack.push("numbered_list_item");
        if (listStack.length > 1) {
          warnings.push("Nested numbered lists are flattened in this version.");
        }
        break;
      case "ordered_list_close":
        listStack.pop();
        break;
      case "blockquote_open":
        quoteDepth += 1;
        break;
      case "blockquote_close":
        quoteDepth = Math.max(0, quoteDepth - 1);
        break;
      case "fence":
      case "code_block":
        nodes.push({
          type: "code",
          text: token.content,
          language: token.info.trim() || "plain text",
        });
        break;
      case "hr":
        nodes.push({ type: "divider" });
        break;
      case "table_open":
        tableState = { inHeader: false, header: [], rows: [], currentRow: null };
        break;
      case "thead_open":
        if (tableState) tableState.inHeader = true;
        break;
      case "tbody_open":
        if (tableState) tableState.inHeader = false;
        break;
      case "tr_open":
        if (tableState) tableState.currentRow = [];
        break;
      case "tr_close":
        if (tableState && tableState.currentRow) {
          if (tableState.inHeader) {
            tableState.header = tableState.currentRow;
          } else {
            tableState.rows.push(tableState.currentRow);
          }
          tableState.currentRow = null;
        }
        break;
      case "table_close":
        if (tableState) {
          nodes.push({ type: "table", header: tableState.header, rows: tableState.rows });
          tableState = null;
        }
        break;
      case "inline": {
        if (tableState && tableState.currentRow) {
          const cell: TableCell = [];
          for (const seg of inlineTokenToSegments(token)) {
            if (seg.type === "image") continue; // images not supported inside table cells
            cell.push({
              text: seg.value,
              ...(seg.type === "link" ? { link: { url: seg.url } } : {}),
              ...(seg.annotations ? { annotations: seg.annotations } : {}),
            });
          }
          tableState.currentRow.push(cell);
          break;
        }

        if (!activeBlockType) {
          break;
        }

        const segments = inlineTokenToSegments(token);

        // Collapse consecutive text segments into one for cleaner output
        const collapsed: RichTextSegment[] = [];
        for (const seg of segments) {
          if (seg.type === "image") {
            nodes.push({
              type: "image",
              source: seg.source,
              caption: seg.caption,
            });
            continue;
          }

          if (seg.type === "link" || seg.type === "text") {
            const value = seg.type === "link" ? seg.value : seg.value;
            if (value.trim().length === 0) continue;
            collapsed.push({
              text: value,
              ...(seg.type === "link" ? { link: { url: seg.url } } : {}),
              ...(seg.annotations ? { annotations: seg.annotations } : {}),
            });
          }
        }

        if (collapsed.length === 0) continue;

        if (
          activeBlockType === "heading_1" ||
          activeBlockType === "heading_2" ||
          activeBlockType === "heading_3" ||
          activeBlockType === "heading_4"
        ) {
          nodes.push({ type: activeBlockType, segments: collapsed });
          continue;
        }

        if (activeBlockType === "quote") {
          nodes.push(quoteSegmentsToCallout(collapsed) ?? { type: "quote", segments: collapsed });
          break;
        }

        if (
          activeBlockType === "paragraph" ||
          activeBlockType === "bulleted_list_item" ||
          activeBlockType === "numbered_list_item"
        ) {
          nodes.push({ type: activeBlockType, segments: collapsed });
        }
        break;
      }
      case "html_block":
        warnings.push(`Unsupported markdown block ignored: ${token.type}`);
        break;
      default:
        break;
    }
  }

  return { nodes, warnings };
}

function inlineTokenToSegments(token: {
  children?: Array<{ type: string; content: string; attrGet(name: string): string | null }> | null;
}): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const textBuffer: string[] = [];
  let activeLinkUrl: string | null = null;
  let bold = false;
  let italic = false;

  const currentAnnotations = (code: boolean): RichTextAnnotations | undefined => {
    const annotations: RichTextAnnotations = {};
    if (bold) annotations.bold = true;
    if (italic) annotations.italic = true;
    if (code) annotations.code = true;
    return Object.keys(annotations).length > 0 ? annotations : undefined;
  };

  const pushSegment = (value: string, code: boolean): void => {
    const annotations = currentAnnotations(code);
    if (activeLinkUrl) {
      segments.push({ type: "link", value, url: activeLinkUrl, ...(annotations ? { annotations } : {}) });
    } else {
      segments.push({ type: "text", value, ...(annotations ? { annotations } : {}) });
    }
  };

  const flushText = (): void => {
    if (textBuffer.length === 0) {
      return;
    }

    const value = textBuffer.join("");
    textBuffer.length = 0;
    pushSegment(value, false);
  };

  for (const child of token.children ?? []) {
    if (child.type === "strong_open") {
      flushText();
      bold = true;
      continue;
    }

    if (child.type === "strong_close") {
      flushText();
      bold = false;
      continue;
    }

    if (child.type === "em_open") {
      flushText();
      italic = true;
      continue;
    }

    if (child.type === "em_close") {
      flushText();
      italic = false;
      continue;
    }

    if (child.type === "link_open") {
      flushText();
      const href = child.attrGet("href") ?? "";
      activeLinkUrl = isNotionLinkUrl(href) ? href : null;
      continue;
    }

    if (child.type === "link_close") {
      flushText();
      activeLinkUrl = null;
      continue;
    }

    if (child.type === "image") {
      flushText();
      segments.push({
        type: "image",
        source: child.attrGet("src") ?? "",
        caption: child.content || undefined,
      });
      continue;
    }

    if (child.type === "code_inline") {
      flushText();
      if (child.content.trim().length > 0) {
        pushSegment(child.content, true);
      }
      continue;
    }

    if (child.type === "softbreak" || child.type === "hardbreak") {
      textBuffer.push("\n");
      continue;
    }

    if (child.type === "text") {
      textBuffer.push(child.content);
    }
  }

  flushText();
  return segments;
}

/**
 * Encode literal spaces inside markdown image/link URLs so markdown-it
 * recognises the syntax. Only affects the URL portion of `![alt](url)` and
 * `[text](url)` — it will not touch content inside code blocks or raw HTML.
 */
function encodeSpacesInMarkdownUrls(source: string): string {
  return source.replace(
    /(!?\[[^\]]*\]\()([^)]*)\)/g,
    (_match, prefix: string, url: string) => {
      return prefix + url.replace(/ /g, "%20") + ")";
    },
  );
}

/**
 * Notion rejects link URLs that are bare fragments (e.g. `#section`) or empty.
 * Keep all other URLs as-is and let the Notion API validate them.
 */
function isNotionLinkUrl(url: string): boolean {
  const trimmed = url.trim();
  return trimmed !== "" && !trimmed.startsWith("#");
}