import { config as loadDotEnv } from "dotenv";
import path from "node:path";
import { z } from "zod";

loadDotEnv({ quiet: true });

const UUID_DASHED_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_COMPACT_PATTERN = /^[0-9a-f]{32}$/i;

const envSchema = z.object({
  NOTION_TOKEN: z.string().min(1, "NOTION_TOKEN is required."),
  NOTION_PAGE_ID: z.string().min(1, "NOTION_PAGE_ID is required."),
  NOTION_TEST_PAGE_ID: z.string().min(1).optional(),
  NOTION_API_VERSION: z.string().default("2026-03-11"),
  WIKI_CONTENT_ROOT: z.string().optional(),
});

export type AppConfig = {
  notionToken: string;
  notionPageId: string;
  notionTestPageId?: string;
  notionApiVersion: string;
  wikiContentRoot?: string;
};

/**
 * Resolve the wiki content root directory.
 * If a root is configured, it is resolved as an absolute path.
 * Otherwise it falls back to a `wiki-content/` folder in the current working directory.
 */
export function resolveWikiContentRoot(configuredRoot?: string): string {
  return configuredRoot
    ? path.resolve(configuredRoot)
    : path.resolve(process.cwd(), "wiki-content");
}

export function normalizeNotionId(input: string, envVarName = "NOTION_PAGE_ID"): string {
  const trimmed = input.trim();

  const urlMatch = trimmed.match(/[0-9a-fA-F]{32}(?=(?:\?|$|#))/);
  const rawId = urlMatch?.[0] ?? trimmed.replace(/-/g, "");

  if (UUID_DASHED_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  if (!UUID_COMPACT_PATTERN.test(rawId)) {
    throw new Error(
      `${envVarName} must be a page UUID or a Notion page URL containing a UUID.`,
    );
  }

  const compact = rawId.toLowerCase();

  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) => issue.message).join(" ");
    throw new Error(messages);
  }

  return {
    notionToken: parsed.data.NOTION_TOKEN,
    notionPageId: normalizeNotionId(parsed.data.NOTION_PAGE_ID),
    notionTestPageId: parsed.data.NOTION_TEST_PAGE_ID
      ? normalizeNotionId(parsed.data.NOTION_TEST_PAGE_ID, "NOTION_TEST_PAGE_ID")
      : undefined,
    notionApiVersion: parsed.data.NOTION_API_VERSION,
    wikiContentRoot: parsed.data.WIKI_CONTENT_ROOT,
  };
}