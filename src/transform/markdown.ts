import MarkdownIt from "markdown-it";

import type { ContentNode, MarkdownTransformResult, RichTextSegment } from "./types";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

type InlineSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string; url: string }
  | { type: "image"; source: string; caption?: string };

export function markdownToContentNodes(source: string): MarkdownTransformResult {
  // markdown-it requires spaces in URLs to be percent-encoded; pre-process so
  // image/link syntax with literal spaces is recognised correctly.
  const processed = encodeSpacesInMarkdownUrls(source);
  const tokens = markdown.parse(processed, {});
  const nodes: ContentNode[] = [];
  const warnings: string[] = [];

  const listStack: Array<"bulleted_list_item" | "numbered_list_item"> = [];
  let activeBlockType:
    | ContentNode["type"]
    | null = null;
  let quoteDepth = 0;

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
      case "inline": {
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

        if (
          activeBlockType === "paragraph" ||
          activeBlockType === "quote" ||
          activeBlockType === "bulleted_list_item" ||
          activeBlockType === "numbered_list_item"
        ) {
          nodes.push({ type: activeBlockType, segments: collapsed });
        }
        break;
      }
      case "html_block":
      case "table_open":
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

  const flushText = (): void => {
    if (textBuffer.length === 0) {
      return;
    }

    const value = textBuffer.join("");
    textBuffer.length = 0;

    if (activeLinkUrl) {
      segments.push({ type: "link", value, url: activeLinkUrl });
    } else {
      segments.push({ type: "text", value });
    }
  };

  for (const child of token.children ?? []) {
    if (child.type === "link_open") {
      flushText();
      activeLinkUrl = child.attrGet("href") ?? null;
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

    if (child.type === "softbreak" || child.type === "hardbreak") {
      textBuffer.push("\n");
      continue;
    }

    if (child.type === "text" || child.type === "code_inline") {
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