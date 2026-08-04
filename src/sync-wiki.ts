import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Client } from "@notionhq/client";
import { z } from "zod";

import { normalizeNotionId } from "./config";
import { createChildPage, getPageSummary, movePageToParent, replacePageContent, updatePageDetails } from "./notion/page";
import { updatePageContentSurgically } from "./diff/execute";
import { contentNodesToBlocks } from "./transform/blocks";
import { markdownToContentNodes } from "./transform/markdown";
import type { ContentNode } from "./transform/types";

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function formatLocalDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * Append an automatic "Last modified" footer to markdown before publishing.
 * Any existing auto-generated footer at the end of the source is stripped
 * first to avoid duplicates on re-sync.
 */
function appendModifiedDate(markdown: string): string {
  // Strip an existing auto-generated footer (handles both \n and \r\n)
  const stripped = markdown.replace(
    /\r?\n---\r?\n\*Last modified: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\*\s*$/,
    "",
  );
  return `${stripped.trimEnd()}\n\n---\n*Last modified: ${formatLocalDateTime(new Date())}*\n`;
}

const pageMapEntrySchema = z.object({
  name: z.string().min(1, "Section name must be a non-empty string."),
  pageId: z.string().min(1, "pageId must be a non-empty string."),
  file: z.string().min(1, "file must be a non-empty string."),
});

const pageMapSchema = z.object({
  sections: z.record(z.string(), pageMapEntrySchema),
});

export type PageMap = z.infer<typeof pageMapSchema>;

const UUID_DASHED_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_COMPACT_PATTERN = /^[0-9a-f]{32}$/i;
const PLACEHOLDER_PAGE_IDS = new Set(["", "TODO", "TBD"]);

function isPlaceholderPageId(pageId: string): boolean {
  const trimmed = pageId.trim();
  if (PLACEHOLDER_PAGE_IDS.has(trimmed)) return true;
  if (UUID_DASHED_PATTERN.test(trimmed)) return false;
  const compact = trimmed.replace(/-/g, "");
  if (UUID_COMPACT_PATTERN.test(compact)) return false;
  return true;
}

async function persistPageMap(pageMapPath: string, pageMap: PageMap): Promise<void> {
  await writeFile(pageMapPath, JSON.stringify(pageMap, null, 2) + "\n", "utf8");
}

/**
 * Find the key of the section that is the structural parent of a markdown
 * file, based on the folder hierarchy in page-map.json. For example,
 * `start-here/project-timeline/index.md` is the child of the section whose
 * file is `start-here/index.md`. Returns null for root-level sections.
 */
export function findParentSectionKey(pageMap: PageMap, file: string): string | null {
  const dir = path.posix.dirname(file);
  if (dir === ".") return null;
  const grand = path.posix.dirname(dir);
  if (grand === ".") return null;
  const parentFile = path.posix.join(grand, "index.md");
  for (const [key, entry] of Object.entries(pageMap.sections)) {
    if (entry.file === parentFile) return key;
  }
  return null;
}

/**
 * Resolve the Notion page ID that should be the parent of a section,
 * following the folder hierarchy. Root-level sections resolve to rootPageId.
 */
function resolveStructuralParentPageId(
  pageMap: PageMap,
  sectionKey: string,
  rootPageId: string,
): string {
  const parentKey = findParentSectionKey(pageMap, pageMap.sections[sectionKey].file);
  if (!parentKey) return rootPageId;
  return resolvePageId(pageMap.sections[parentKey], rootPageId);
}

/**
 * Create a Notion child page for a section whose pageId is a placeholder,
 * under its structural parent. Existing pages are re-parented if they sit
 * under the wrong parent. Updates page-map.json when a page is created.
 */
export async function ensureSectionPage(
  client: Client,
  section: PageMap["sections"][string],
  sectionKey: string,
  rootPageId: string,
  pageMap: PageMap,
  pageMapPath: string,
): Promise<void> {
  if (section.pageId === "root") return;

  const parentPageId = resolveStructuralParentPageId(pageMap, sectionKey, rootPageId);

  if (isPlaceholderPageId(section.pageId)) {
    const page = await createChildPage(client, {
      parentPageId,
      title: section.name,
    });
    section.pageId = page.id;
    await persistPageMap(pageMapPath, pageMap);
    return;
  }

  await movePageToParent(client, normalizeNotionId(section.pageId), parentPageId);
}

/**
 * Create Notion child pages for every section whose pageId is a placeholder,
 * nesting each under its structural parent, and re-parent any existing pages
 * that sit in the wrong place. Parents are processed before children.
 * Updates page-map.json once at the end with all newly created page IDs.
 */
export async function ensureAllSectionPages(
  client: Client,
  rootPageId: string,
  pageMap: PageMap,
  pageMapPath: string,
): Promise<void> {
  const entries = Object.entries(pageMap.sections)
    .filter(([, section]) => section.pageId !== "root")
    // Parents (shallower paths) first so children can resolve their page IDs.
    .sort((a, b) => a[1].file.split("/").length - b[1].file.split("/").length);

  let changed = false;
  for (const [key, section] of entries) {
    const parentPageId = resolveStructuralParentPageId(pageMap, key, rootPageId);

    if (isPlaceholderPageId(section.pageId)) {
      const page = await createChildPage(client, {
        parentPageId,
        title: section.name,
      });
      section.pageId = page.id;
      changed = true;
    } else {
      await movePageToParent(client, normalizeNotionId(section.pageId), parentPageId);
    }
  }
  if (changed) {
    await persistPageMap(pageMapPath, pageMap);
  }
}

/** Convert a local markdown file path (relative to wiki-content/) to its Notion URL. */
function resolveNotionUrl(
  localFilePath: string,
  pageMap: PageMap,
  rootPageId: string,
): string | null {
  for (const [_key, entry] of Object.entries(pageMap.sections)) {
    if (entry.file === localFilePath) {
      let pageId: string;
      if (entry.pageId === "root") {
        pageId = rootPageId;
      } else if (isPlaceholderPageId(entry.pageId)) {
        return null;
      } else {
        pageId = normalizeNotionId(entry.pageId);
      }
      const slug = entry.name.replace(/\s+/g, "-");
      return `https://app.notion.com/p/${slug}-${pageId.replace(/-/g, "")}`;
    }
  }
  return null;
}

/**
 * Preprocess markdown to replace local wiki-internal links (`[text](./some-path.md)`)
 * with Notion page URLs so they render as proper hyperlinks on the published page.
 * Only rewrites links that match a known page-map entry.
 *
 * @param markdown - The markdown source text.
 * @param markdownFilePath - Absolute path to the markdown file (used to resolve relative links).
 * @param wikiContentDirectory - Absolute path to the wiki-content/ directory.
 * @param pageMap - The page map for matching file paths to Notion URLs.
 * @param rootPageId - The root Notion page ID.
 */
function resolveInternalLinks(
  markdown: string,
  markdownFilePath: string,
  wikiContentDirectory: string,
  pageMap: PageMap,
  rootPageId: string,
  warnings?: string[],
): string {
  return markdown.replace(
    /\[([^\]]+?)\]\(((?!https?:|mailto:|tel:|#)[^)]+\.md)\)/g,
    (_match, text: string, linkPath: string) => {
      // Resolve the link path relative to the file that contains it
      const resolved = path.resolve(path.dirname(markdownFilePath), linkPath);
      const relative = path.relative(wikiContentDirectory, resolved).replace(/\\/g, "/");
      const notionUrl = resolveNotionUrl(relative, pageMap, rootPageId);
      if (notionUrl) {
        return `[${text}](${notionUrl})`;
      }
      // Not a known wiki page — drop the dead URL instead of publishing it raw.
      warnings?.push(
        `Unresolved wiki link dropped: [${text}](${linkPath}) in ${path.relative(wikiContentDirectory, markdownFilePath).replace(/\\/g, "/")}`,
      );
      return text;
    },
  );
}

const TOC_MIN_SUBHEADINGS = 8;

/**
 * Insert a Notion table-of-contents block right after the first H1 when a
 * page has enough sub-headings to benefit from in-page navigation.
 */
function insertTableOfContents(nodes: ContentNode[]): ContentNode[] {
  const subHeadingCount = nodes.filter(
    (n) => n.type === "heading_2" || n.type === "heading_3",
  ).length;
  if (subHeadingCount < TOC_MIN_SUBHEADINGS) return nodes;
  const h1Index = nodes.findIndex((n) => n.type === "heading_1");
  if (h1Index < 0) return nodes;
  const result = [...nodes];
  result.splice(h1Index + 1, 0, { type: "table_of_contents" });
  return result;
}

export async function loadPageMap(mapPath: string): Promise<PageMap> {
  const raw = await readFile(mapPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse "${mapPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = pageMapSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid page map in "${mapPath}": ${issues}`);
  }
  return result.data;
}

export interface SyncWikiOptions {
  sectionName: string;
  dryRun?: boolean;
  smart?: boolean;
}

export interface SyncWikiDependencies {
  client: Client;
  rootPageId: string;
  wikiContentDirectory: string;
  pageMap: PageMap;
  pageMapPath?: string;
}

export interface SyncWikiResult {
  sectionName: string;
  title: string;
  pageId: string;
  archivedCount: number;
  appendedCount: number;
  url: string;
  uploadedImages: string[];
  warnings: string[];
  smartResult?: {
    unchangedCount: number;
    updatedCount: number;
    replacedCount: number;
    deletedCount: number;
    addedCount: number;
  };
}

export function resolveSection(
  pageMap: PageMap,
  sectionName: string,
): PageMap["sections"][string] {
  const section = pageMap.sections[sectionName];
  if (!section) {
    const known = Object.keys(pageMap.sections).join(", ");
    throw new Error(`Unknown section "${sectionName}". Known sections: ${known}`);
  }
  return section;
}

export function resolvePageId(section: PageMap["sections"][string], rootPageId: string): string {
  return section.pageId === "root" ? rootPageId : normalizeNotionId(section.pageId);
}

export async function syncWikiSection(
  options: SyncWikiOptions,
  deps: SyncWikiDependencies,
): Promise<SyncWikiResult> {
  const { sectionName, dryRun, smart } = options;
  const { client, rootPageId, wikiContentDirectory, pageMap, pageMapPath } = deps;

  const section = resolveSection(pageMap, sectionName);
  const filePath = path.resolve(wikiContentDirectory, section.file);
  let markdownInput: string;
  try {
    markdownInput = await readFile(filePath, "utf8");
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      throw new Error(
        `Section "${sectionName}" maps to "${section.file}", but that file does not exist.`,
      );
    }
    throw err;
  }

  markdownInput = appendModifiedDate(markdownInput);

  const sectionPageId =
    section.pageId === "root"
      ? rootPageId
      : isPlaceholderPageId(section.pageId)
        ? "(will be created)"
        : normalizeNotionId(section.pageId);
  const sectionUrl =
    section.pageId === "root" || !isPlaceholderPageId(section.pageId)
      ? `https://app.notion.com/p/${encodeURIComponent(section.name.replace(/\s+/g, "-"))}-${sectionPageId.replace(/-/g, "")}`
      : "(child page will be created under root)";

  if (dryRun) {
    const headingCount = (markdownInput.match(/^#{1,4}\s/gm) ?? []).length;
    return {
      sectionName,
      title: section.name,
      pageId: sectionPageId,
      archivedCount: 0,
      appendedCount: headingCount,
      url: sectionUrl,
      uploadedImages: [],
      warnings:
        section.pageId !== "root" && isPlaceholderPageId(section.pageId)
          ? ["Page does not exist yet; it will be created on a real sync."]
          : [],
    };
  }

  if (pageMapPath && section.pageId !== "root" && isPlaceholderPageId(section.pageId)) {
    await ensureSectionPage(client, section, sectionName, rootPageId, pageMap, pageMapPath);
  }

  const pageId = resolvePageId(section, rootPageId);

  const linkWarnings: string[] = [];
  const transformed = markdownToContentNodes(
    resolveInternalLinks(markdownInput, filePath, wikiContentDirectory, pageMap, rootPageId, linkWarnings),
  );
  const contentNodes = insertTableOfContents(transformed.nodes);
  const built = await contentNodesToBlocks(contentNodes, {
    client,
    baseDirectory: path.dirname(filePath),
  });

  let result: { archivedCount: number; appendedCount: number };
  let smartResult: SyncWikiResult["smartResult"];

  if (smart) {
    const surgical = await updatePageContentSurgically(client, pageId, built.blocks);
    result = {
      archivedCount: surgical.deletedCount,
      appendedCount: surgical.appendedCount,
    };
    smartResult = {
      unchangedCount: surgical.unchangedCount,
      updatedCount: surgical.updatedCount,
      replacedCount: surgical.replacedCount,
      deletedCount: surgical.deletedCount,
      addedCount: surgical.appendedCount,
    };
  } else {
    result = await replacePageContent(client, pageId, built.blocks);
  }

  if (section.pageId !== "root") {
    await updatePageDetails(client, pageId, { title: section.name });
  }

  const summary = await getPageSummary(client, pageId);

  return {
    sectionName,
    title: section.name,
    pageId: summary.id,
    archivedCount: result.archivedCount,
    appendedCount: result.appendedCount,
    url: summary.url,
    uploadedImages: built.result.uploadedImages.map((img) => img.source),
    warnings: [...linkWarnings, ...transformed.warnings, ...built.result.warnings],
    smartResult,
  };
}
