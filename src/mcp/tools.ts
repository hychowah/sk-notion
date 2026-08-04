import { readFile } from "node:fs/promises";
import path from "node:path";

import type { BlockObjectRequest } from "@notionhq/client";
import { z } from "zod";

import {
  normalizeNotionId,
  resolveWikiContentRoot,
  type AppConfig,
} from "../config";
import { createNotionClient, formatNotionError } from "../notion/client";
import {
  appendBlocks,
  assertDirectChildPage,
  createChildPage,
  getPage,
  getPageMarkdown,
  getPageSummary,
  replacePageContent,
  updatePageDetails,
  type PageSummary,
} from "../notion/page";
import { assertSupportedRemoteImageUrl, uploadImageFile } from "../notion/uploads";
import { updatePageContentSurgically } from "../diff/execute";
import { contentNodesToBlocks, richTextFromText } from "../transform/blocks";
import { markdownToContentNodes } from "../transform/markdown";
import { ensureAllSectionPages, loadPageMap, syncWikiSection, type PageMap } from "../sync-wiki";
import type {
  AppendImageUrlInput,
  AppendMarkdownInput,
  CreateChildPageInput,
  DumpPageMarkdownInput,
  GetServerInfoInput,
  ReplaceMarkdownInput,
  SyncAllWikiSectionsInput,
  SyncWikiSectionInput,
  UpdateChildPageInput,
  UploadImageInput,
  ValidatePageInput,
} from "./schemas";
import {
  appendImageUrlSchema,
  appendMarkdownSchema,
  createChildPageSchema,
  dumpPageMarkdownSchema,
  getServerInfoSchema,
  replaceMarkdownSchema,
  syncAllWikiSectionsSchema,
  syncWikiSectionSchema,
  updateChildPageSchema,
  uploadImageSchema,
  validatePageSchema,
  appendImageUrlInputSchema,
  appendMarkdownInputSchema,
  createChildPageInputSchema,
  dumpPageMarkdownInputSchema,
  getServerInfoInputSchema,
  replaceMarkdownInputSchema,
  syncAllWikiSectionsInputSchema,
  syncWikiSectionInputSchema,
  updateChildPageInputSchema,
  uploadImageInputSchema,
  validatePageInputSchema,
  validateWikiInputSchema,
} from "./schemas";
import { serverMetadata } from "./meta";

export interface McpContext {
  config: AppConfig;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (args: unknown, context: McpContext) => Promise<unknown>;
}

interface ResolvedCredentials {
  token: string;
  pageId: string;
}

function resolveCredentials(
  input: { notionToken?: string; pageId?: string },
  context: McpContext,
): ResolvedCredentials {
  const token = input.notionToken ?? context.config.notionToken;
  if (!token) {
    throw new Error(
      "Please provide notionToken (tool argument) or set the NOTION_TOKEN environment variable.",
    );
  }

  const rawPageId = input.pageId ?? context.config.notionPageId;
  if (!rawPageId) {
    throw new Error(
      "Please provide pageId (tool argument) or set the NOTION_PAGE_ID environment variable.",
    );
  }

  return { token, pageId: normalizeNotionId(rawPageId) };
}

function createClient(token: string, context: McpContext) {
  return createNotionClient({
    notionToken: token,
    notionApiVersion: context.config.notionApiVersion,
  });
}

async function resolveMarkdownInput(
  input: { markdown?: string; filePath?: string },
): Promise<{ content: string; baseDirectory: string }> {
  if (input.markdown !== undefined && input.filePath !== undefined) {
    throw new Error("Provide exactly one of markdown or filePath.");
  }
  if (input.markdown !== undefined) {
    return { content: input.markdown, baseDirectory: process.cwd() };
  }
  if (input.filePath !== undefined) {
    const resolved = path.resolve(input.filePath);
    const content = await readFile(resolved, "utf8");
    return { content, baseDirectory: path.dirname(resolved) };
  }
  throw new Error("Provide exactly one of markdown or filePath.");
}

async function buildBlocksFromMarkdown(
  context: McpContext,
  input: { markdown?: string; filePath?: string },
  token: string,
): Promise<{ blocks: BlockObjectRequest[]; warnings: string[]; uploadedImages: string[] }> {
  const { content, baseDirectory } = await resolveMarkdownInput(input);
  const transformed = markdownToContentNodes(content);
  const built = await contentNodesToBlocks(transformed.nodes, {
    client: createClient(token, context),
    baseDirectory,
  });

  return {
    blocks: built.blocks,
    warnings: [...transformed.warnings, ...built.result.warnings],
    uploadedImages: built.result.uploadedImages.map((img) => img.source),
  };
}

async function loadWikiContext(context: McpContext): Promise<{
  wikiContentDirectory: string;
  pageMap: PageMap;
  pageMapPath: string;
}> {
  const wikiContentDirectory = resolveWikiContentRoot(context.config.wikiContentRoot);
  const pageMapPath = path.resolve(wikiContentDirectory, "page-map.json");
  const pageMap = await loadPageMap(pageMapPath);
  return { wikiContentDirectory, pageMap, pageMapPath };
}

function formatPageSummary(summary: PageSummary): string {
  return [
    `Title: ${summary.title}`,
    `Page ID: ${summary.id}`,
    `URL: ${summary.url}`,
    `Top-level blocks: ${summary.topLevelBlockCount}`,
  ].join("\n");
}

const validatePageTool: ToolDefinition = {
  name: "validate_page",
  description:
    "Verify that the configured Notion token can access the configured page and return page metadata.",
  inputSchema: validatePageInputSchema,
  handler: async (args, context) => {
    const input = validatePageSchema.parse(args);
    const { token, pageId } = resolveCredentials(input, context);
    const client = createClient(token, context);
    const summary = await getPageSummary(client, pageId);
    return {
      content: [
        {
          type: "text",
          text: `Connected to page.\n${formatPageSummary(summary)}`,
        },
      ],
    };
  },
};

const getServerInfoTool: ToolDefinition = {
  name: "get_server_info",
  description:
    "Return server identity, configuration status, and a live Notion connectivity check. Useful for discovering which server is running and whether credentials work.",
  inputSchema: getServerInfoInputSchema,
  handler: async (args, context) => {
    const input = getServerInfoSchema.parse(args);
    const token = input.notionToken ?? context.config.notionToken;
    const rawPageId = input.pageId ?? context.config.notionPageId;

    const wikiContentDirectory = resolveWikiContentRoot(context.config.wikiContentRoot);

    let connectionStatus: "ok" | "error" | "not_configured" = "not_configured";
    let connectionDetail = "No notionToken and/or pageId configured.";

    if (token && rawPageId) {
      try {
        const client = createClient(token, context);
        const summary = await getPageSummary(client, normalizeNotionId(rawPageId));
        connectionStatus = "ok";
        connectionDetail = `Connected to "${summary.title}" (${summary.url}, ${summary.topLevelBlockCount} blocks)`;
      } catch (err) {
        connectionStatus = "error";
        connectionDetail = formatNotionError(err);
      }
    } else if (token) {
      connectionDetail = "notionToken is configured, but pageId is missing.";
    } else if (rawPageId) {
      connectionDetail = "pageId is configured, but notionToken is missing.";
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              serverName: serverMetadata.name,
              version: serverMetadata.version,
              description: serverMetadata.description,
              notionTokenConfigured: Boolean(token),
              pageIdConfigured: Boolean(rawPageId),
              wikiContentDirectory,
              connectionStatus,
              connectionDetail,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};

const dumpPageMarkdownTool: ToolDefinition = {
  name: "dump_page_markdown",
  description:
    "Export the current Notion page content as Markdown. Useful for read-modify-write workflows.",
  inputSchema: dumpPageMarkdownInputSchema,
  handler: async (args, context) => {
    const input = dumpPageMarkdownSchema.parse(args);
    const { token, pageId } = resolveCredentials(input, context);
    const client = createClient(token, context);
    const result = await getPageMarkdown(client, pageId, {
      includeBlockIds: input.includeBlockIds,
    });

    const parts: string[] = [];
    if (result.title) {
      parts.push(`# ${result.title}\n`);
    }
    parts.push(result.markdown);

    return {
      content: [
        {
          type: "text",
          text: parts.join("\n"),
        },
      ],
    };
  },
};

const appendMarkdownTool: ToolDefinition = {
  name: "append_markdown",
  description: "Append Markdown content to a Notion page.",
  inputSchema: appendMarkdownInputSchema,
  handler: async (args, context) => {
    const input = appendMarkdownSchema.parse(args);
    const { token, pageId } = resolveCredentials(input, context);
    const client = createClient(token, context);
    const { blocks, warnings, uploadedImages } = await buildBlocksFromMarkdown(context, input, token);
    const appendedCount = await appendBlocks(client, pageId, blocks);

    const lines = [`Appended ${appendedCount} block(s).`];
    if (uploadedImages.length > 0) {
      for (const source of uploadedImages) {
        lines.push(`Uploaded image: ${source}`);
      }
    }
    if (warnings.length > 0) {
      for (const warning of warnings) {
        lines.push(`Warning: ${warning}`);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: lines.join("\n"),
        },
      ],
    };
  },
};

const replaceMarkdownTool: ToolDefinition = {
  name: "replace_markdown",
  description: "Replace the current top-level content of a Notion page with Markdown content.",
  inputSchema: replaceMarkdownInputSchema,
  handler: async (args, context) => {
    const input = replaceMarkdownSchema.parse(args);
    const { token, pageId } = resolveCredentials(input, context);
    const client = createClient(token, context);
    const { blocks, warnings, uploadedImages } = await buildBlocksFromMarkdown(context, input, token);

    const lines: string[] = [];

    if (input.smart) {
      const result = await updatePageContentSurgically(client, pageId, blocks);
      lines.push(
        `Smart update: ${result.unchangedCount} kept, ${result.updatedCount} updated, ${result.replacedCount} replaced, ${result.deletedCount} deleted, ${result.appendedCount} added.`,
      );
    } else {
      const result = await replacePageContent(client, pageId, blocks);
      lines.push(
        `Archived ${result.archivedCount} existing block(s).`,
        `Appended ${result.appendedCount} new block(s).`,
      );
    }

    if (uploadedImages.length > 0) {
      for (const source of uploadedImages) {
        lines.push(`Uploaded image: ${source}`);
      }
    }
    if (warnings.length > 0) {
      for (const warning of warnings) {
        lines.push(`Warning: ${warning}`);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: lines.join("\n"),
        },
      ],
    };
  },
};

const createChildPageTool: ToolDefinition = {
  name: "create_child_page",
  description:
    "Create a new child page under a parent page and optionally seed it with Markdown content.",
  inputSchema: createChildPageInputSchema,
  handler: async (args, context) => {
    const input = createChildPageSchema.parse(args);
    const token = input.notionToken ?? context.config.notionToken;
    if (!token) {
      throw new Error(
        "Please provide notionToken (tool argument) or set the NOTION_TOKEN environment variable.",
      );
    }
    const parentPageId = input.parentPageId
      ? normalizeNotionId(input.parentPageId)
      : context.config.notionPageId;
    if (!parentPageId) {
      throw new Error(
        "Please provide parentPageId (tool argument) or set the NOTION_PAGE_ID environment variable.",
      );
    }

    const client = createClient(token, context);

    const page = await createChildPage(client, {
      parentPageId,
      title: input.title,
    });

    const lines = [
      `Created child page: ${page.title}`,
      `Page ID: ${page.id}`,
      `URL: ${page.url}`,
    ];

    const hasMarkdown = input.markdown !== undefined || input.filePath !== undefined;
    if (hasMarkdown) {
      const { blocks, warnings, uploadedImages } = await buildBlocksFromMarkdown(context, input, token);
      const appendedCount = await appendBlocks(client, page.id, blocks);
      lines.push(`Appended ${appendedCount} block(s).`);
      if (uploadedImages.length > 0) {
        for (const source of uploadedImages) {
          lines.push(`Uploaded image: ${source}`);
        }
      }
      if (warnings.length > 0) {
        for (const warning of warnings) {
          lines.push(`Warning: ${warning}`);
        }
      }
    }

    return {
      content: [
        {
          type: "text",
          text: lines.join("\n"),
        },
      ],
    };
  },
};

const updateChildPageTool: ToolDefinition = {
  name: "update_child_page",
  description:
    "Update an existing direct child page by page ID or URL, including title and/or Markdown content.",
  inputSchema: updateChildPageInputSchema,
  handler: async (args, context) => {
    const input = updateChildPageSchema.parse(args);
    const token = input.notionToken ?? context.config.notionToken;
    if (!token) {
      throw new Error(
        "Please provide notionToken (tool argument) or set the NOTION_TOKEN environment variable.",
      );
    }
    const client = createClient(token, context);
    const pageId = normalizeNotionId(input.pageId);
    const existingPage = await getPage(client, pageId);

    if (!input.skipParentCheck) {
      if (!context.config.notionPageId) {
        throw new Error(
          "NOTION_PAGE_ID environment variable is required for the parent check. Provide it or use skipParentCheck.",
        );
      }
      assertDirectChildPage(existingPage, context.config.notionPageId);
    }

    const lines: string[] = [];

    if (input.title) {
      await updatePageDetails(client, pageId, { title: input.title });
    }

    const hasMarkdown = input.markdown !== undefined || input.filePath !== undefined;
    if (hasMarkdown) {
      const { blocks, warnings, uploadedImages } = await buildBlocksFromMarkdown(context, input, token);

      if (input.append) {
        const appendedCount = await appendBlocks(client, pageId, blocks);
        lines.push(`Appended ${appendedCount} block(s).`);
      } else if (input.smart) {
        const result = await updatePageContentSurgically(client, pageId, blocks);
        lines.push(
          `Smart update: ${result.unchangedCount} kept, ${result.updatedCount} updated, ${result.replacedCount} replaced, ${result.deletedCount} deleted, ${result.appendedCount} added.`,
        );
      } else {
        const result = await replacePageContent(client, pageId, blocks);
        lines.push(
          `Archived ${result.archivedCount} existing block(s).`,
          `Appended ${result.appendedCount} new block(s).`,
        );
      }

      if (uploadedImages.length > 0) {
        for (const source of uploadedImages) {
          lines.push(`Uploaded image: ${source}`);
        }
      }
      if (warnings.length > 0) {
        for (const warning of warnings) {
          lines.push(`Warning: ${warning}`);
        }
      }
    }

    const summary = await getPageSummary(client, pageId);
    lines.push("", `Updated child page: ${summary.title}`, formatPageSummary(summary));

    return {
      content: [
        {
          type: "text",
          text: lines.join("\n"),
        },
      ],
    };
  },
};

const uploadImageTool: ToolDefinition = {
  name: "upload_image",
  description: "Upload a local image file to Notion and append it to a page.",
  inputSchema: uploadImageInputSchema,
  handler: async (args, context) => {
    const input = uploadImageSchema.parse(args);
    const { token, pageId } = resolveCredentials(input, context);
    const client = createClient(token, context);
    const resolvedPath = path.resolve(input.filePath);
    const upload = await uploadImageFile(client, resolvedPath);
    const appendedCount = await appendBlocks(client, pageId, [
      {
        type: "image",
        image: {
          type: "file_upload",
          file_upload: { id: upload.fileUploadId },
          caption: input.caption ? richTextFromText(input.caption) : [],
        },
      },
    ]);

    return {
      content: [
        {
          type: "text",
          text: [
            `Uploaded ${upload.filename} as ${upload.fileUploadId}.`,
            `Appended ${appendedCount} image block.`,
          ].join("\n"),
        },
      ],
    };
  },
};

const appendImageUrlTool: ToolDefinition = {
  name: "append_image_url",
  description: "Append a remote image URL to a Notion page.",
  inputSchema: appendImageUrlInputSchema,
  handler: async (args, context) => {
    const input = appendImageUrlSchema.parse(args);
    const { token, pageId } = resolveCredentials(input, context);
    const client = createClient(token, context);
    assertSupportedRemoteImageUrl(input.url);
    const appendedCount = await appendBlocks(client, pageId, [
      {
        type: "image",
        image: {
          type: "external",
          external: { url: input.url },
          caption: input.caption ? richTextFromText(input.caption) : [],
        },
      },
    ]);

    return {
      content: [
        {
          type: "text",
          text: `Appended ${appendedCount} image block.`,
        },
      ],
    };
  },
};

const syncWikiSectionTool: ToolDefinition = {
  name: "sync_wiki_section",
  description:
    "Sync a single wiki section from the local Markdown source tree to its mapped Notion page.",
  inputSchema: syncWikiSectionInputSchema,
  handler: async (args, context) => {
    const input = syncWikiSectionSchema.parse(args);
    const { token, pageId } = resolveCredentials(input, context);
    const client = createClient(token, context);
    const { wikiContentDirectory, pageMap, pageMapPath } = await loadWikiContext(context);

    const result = await syncWikiSection(
      {
        sectionName: input.sectionName,
        dryRun: input.dryRun,
        smart: input.smart,
      },
      {
        client,
        rootPageId: pageId,
        wikiContentDirectory,
        pageMap,
        pageMapPath,
      },
    );

    const lines: string[] = [];
    if (input.dryRun) {
      lines.push(
        `[DRY RUN] Would sync: ${result.sectionName}`,
        `Title: ${result.title}`,
        `Page: ${result.pageId}`,
        `Blocks: ~${result.appendedCount} headings + paragraphs/lists`,
      );
    } else if (result.smartResult) {
      lines.push(
        `Smart-synced: ${result.title}`,
        `Kept ${result.smartResult.unchangedCount}, updated ${result.smartResult.updatedCount}, replaced ${result.smartResult.replacedCount}, deleted ${result.smartResult.deletedCount}, added ${result.smartResult.addedCount}.`,
        `Page ID: ${result.pageId}`,
        `URL: ${result.url}`,
      );
    } else {
      lines.push(
        `Synced: ${result.title}`,
        `Archived ${result.archivedCount} existing block(s).`,
        `Appended ${result.appendedCount} new block(s).`,
        `Page ID: ${result.pageId}`,
        `URL: ${result.url}`,
      );
    }

    if (result.uploadedImages.length > 0) {
      for (const img of result.uploadedImages) {
        lines.push(`Uploaded: ${img}`);
      }
    }
    if (result.warnings.length > 0) {
      for (const warning of result.warnings) {
        lines.push(`Warning: ${warning}`);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: lines.join("\n"),
        },
      ],
    };
  },
};

const syncAllWikiSectionsTool: ToolDefinition = {
  name: "sync_all_wiki_sections",
  description:
    "Sync every registered wiki section from the local Markdown source tree to Notion.",
  inputSchema: syncAllWikiSectionsInputSchema,
  handler: async (args, context) => {
    const input = syncAllWikiSectionsSchema.parse(args);
    const { token, pageId } = resolveCredentials(input, context);
    const client = createClient(token, context);
    const { wikiContentDirectory, pageMap, pageMapPath } = await loadWikiContext(context);

    if (!input.dryRun) {
      await ensureAllSectionPages(client, pageId, pageMap, pageMapPath);
    }

    const sectionNames = Object.keys(pageMap.sections);
    const outputs: string[] = [];
    let hadError = false;
    let hadWarning = false;

    for (const sectionName of sectionNames) {
      try {
        const result = await syncWikiSection(
          {
            sectionName,
            dryRun: input.dryRun,
            smart: input.smart,
          },
          {
            client,
            rootPageId: pageId,
            wikiContentDirectory,
            pageMap,
          },
        );

        const lines: string[] = [];
        if (input.dryRun) {
          lines.push(
            `[DRY RUN] ${result.sectionName}: ~${result.appendedCount} blocks`,
          );
        } else if (result.smartResult) {
          lines.push(
            `${result.sectionName}: kept ${result.smartResult.unchangedCount}, updated ${result.smartResult.updatedCount}, replaced ${result.smartResult.replacedCount}, deleted ${result.smartResult.deletedCount}, added ${result.smartResult.addedCount}.`,
          );
        } else {
          lines.push(
            `${result.sectionName}: archived ${result.archivedCount}, appended ${result.appendedCount}.`,
          );
        }
        if (result.warnings.length > 0) {
          hadWarning = true;
          for (const warning of result.warnings) {
            lines.push(`  Warning: ${warning}`);
          }
        }
        outputs.push(lines.join("\n"));
      } catch (err) {
        hadError = true;
        outputs.push(`Error syncing "${sectionName}": ${formatNotionError(err)}`);
      }
    }

    return {
      isError: hadError,
      content: [
        {
          type: "text",
          text: outputs.join("\n\n"),
        },
      ],
    };
  },
};

const validateWikiTool: ToolDefinition = {
  name: "validate_wiki",
  description:
    "Validate the wiki content tree: every mapped file exists and every index.md is registered in page-map.json.",
  inputSchema: validateWikiInputSchema,
  handler: async (_args, context) => {
    const { wikiContentDirectory } = await loadWikiContext(context);
    const pageMap = await loadPageMap(path.resolve(wikiContentDirectory, "page-map.json"));

    let errors = 0;
    let warnings = 0;
    const messages: string[] = [];

    for (const [key, section] of Object.entries(pageMap.sections)) {
      const filePath = path.resolve(wikiContentDirectory, section.file);
      try {
        await readFile(filePath);
      } catch {
        errors++;
        messages.push(
          `ERROR: Section "${key}" maps to "${section.file}", but that file does not exist.`,
        );
      }
    }

    const { readdir } = await import("node:fs/promises");
    async function scan(dir: string, relative: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await scan(path.join(dir, entry.name), path.join(relative, entry.name));
        } else if (entry.name === "index.md" && relative !== "") {
          const relPath = path.join(relative, entry.name).replace(/\\/g, "/");
          const found = Object.values(pageMap.sections).some((s) => s.file === relPath);
          if (!found) {
            warnings++;
            messages.push(
              `WARNING: "${relPath}" exists on disk but is not registered in page-map.json.`,
            );
          }
        }
      }
    }

    await scan(wikiContentDirectory, "");

    if (errors === 0 && warnings === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Wiki content is valid. All sections are registered and all files exist.",
          },
        ],
      };
    }

    return {
      isError: errors > 0,
      content: [
        {
          type: "text",
          text: `${messages.join("\n")}\n\n${errors} error(s), ${warnings} warning(s).`,
        },
      ],
    };
  },
};

export const mcpTools: ToolDefinition[] = [
  getServerInfoTool,
  validatePageTool,
  dumpPageMarkdownTool,
  appendMarkdownTool,
  replaceMarkdownTool,
  createChildPageTool,
  updateChildPageTool,
  uploadImageTool,
  appendImageUrlTool,
  syncWikiSectionTool,
  syncAllWikiSectionsTool,
  validateWikiTool,
];

/**
 * Execute a single tool call, catching errors and formatting them as MCP
 * error responses.
 */
export async function executeTool(
  name: string,
  args: unknown,
  context: McpContext,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const tool = mcpTools.find((t) => t.name === name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  }

  try {
    const result = await tool.handler(args, context);
    return result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
      return {
        isError: true,
        content: [{ type: "text", text: `Invalid input: ${issues.join("; ")}` }],
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: formatNotionError(error) }],
    };
  }
}
