import { z } from "zod";

/**
 * Shared input shapes for MCP tools. Zod schemas are used for runtime
 * validation; the matching `inputSchema` objects are plain JSON Schema 7
 * definitions passed to MCP clients during tool discovery.
 */

export const optionalPageIdSchema = z.object({
  pageId: z.string().optional(),
});

export const markdownInputSchema = z
  .object({
    markdown: z.string().optional(),
    filePath: z.string().optional(),
  })
  .refine(
    (data) =>
      (data.markdown === undefined && data.filePath !== undefined) ||
      (data.markdown !== undefined && data.filePath === undefined),
    {
      message: "Provide exactly one of markdown or filePath.",
    },
  );

export const dumpPageMarkdownSchema = optionalPageIdSchema.extend({
  includeBlockIds: z.boolean().optional(),
});

export const appendMarkdownSchema = z
  .object({
    pageId: z.string().optional(),
    markdown: z.string().optional(),
    filePath: z.string().optional(),
  })
  .refine(
    (data) =>
      (data.markdown === undefined && data.filePath !== undefined) ||
      (data.markdown !== undefined && data.filePath === undefined),
    {
      message: "Provide exactly one of markdown or filePath.",
    },
  );

export const replaceMarkdownSchema = z
  .object({
    pageId: z.string().optional(),
    markdown: z.string().optional(),
    filePath: z.string().optional(),
    smart: z.boolean().optional(),
  })
  .refine(
    (data) =>
      (data.markdown === undefined && data.filePath !== undefined) ||
      (data.markdown !== undefined && data.filePath === undefined),
    {
      message: "Provide exactly one of markdown or filePath.",
    },
  );

export const createChildPageSchema = z
  .object({
    title: z.string().min(1),
    parentPageId: z.string().optional(),
    markdown: z.string().optional(),
    filePath: z.string().optional(),
  })
  .refine(
    (data) =>
      !(data.markdown !== undefined && data.filePath !== undefined),
    {
      message: "Provide exactly one of markdown or filePath.",
    },
  );

export const updateChildPageSchema = z
  .object({
    pageId: z.string().min(1),
    title: z.string().optional(),
    append: z.boolean().optional(),
    smart: z.boolean().optional(),
    skipParentCheck: z.boolean().optional(),
    markdown: z.string().optional(),
    filePath: z.string().optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.markdown !== undefined ||
      data.filePath !== undefined,
    {
      message: "Provide at least one of title, markdown, or filePath.",
    },
  )
  .refine(
    (data) =>
      (data.markdown === undefined && data.filePath === undefined) ||
      (data.markdown === undefined && data.filePath !== undefined) ||
      (data.markdown !== undefined && data.filePath === undefined),
    {
      message: "Provide exactly one of markdown or filePath.",
    },
  );

export const uploadImageSchema = z.object({
  filePath: z.string().min(1),
  caption: z.string().optional(),
  pageId: z.string().optional(),
});

export const appendImageUrlSchema = z.object({
  url: z.string().min(1),
  caption: z.string().optional(),
  pageId: z.string().optional(),
});

export const syncWikiSectionSchema = z.object({
  sectionName: z.string().min(1),
  dryRun: z.boolean().optional(),
  smart: z.boolean().optional(),
});

export const syncAllWikiSectionsSchema = z.object({
  dryRun: z.boolean().optional(),
  smart: z.boolean().optional(),
});

export type OptionalPageIdInput = z.infer<typeof optionalPageIdSchema>;
export type MarkdownInput = z.infer<typeof markdownInputSchema>;
export type DumpPageMarkdownInput = z.infer<typeof dumpPageMarkdownSchema>;
export type AppendMarkdownInput = z.infer<typeof appendMarkdownSchema>;
export type ReplaceMarkdownInput = z.infer<typeof replaceMarkdownSchema>;
export type CreateChildPageInput = z.infer<typeof createChildPageSchema>;
export type UpdateChildPageInput = z.infer<typeof updateChildPageSchema>;
export type UploadImageInput = z.infer<typeof uploadImageSchema>;
export type AppendImageUrlInput = z.infer<typeof appendImageUrlSchema>;
export type SyncWikiSectionInput = z.infer<typeof syncWikiSectionSchema>;
export type SyncAllWikiSectionsInput = z.infer<typeof syncAllWikiSectionsSchema>;

/**
 * Plain JSON Schema 7 definitions for MCP tool discovery. These mirror the
 * Zod schemas above so clients get accurate autocompletion/validation hints.
 */

const emptyObjectSchema = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

const pageIdProperty = {
  pageId: {
    type: "string" as const,
    description:
      "Notion page ID or URL. Defaults to the NOTION_PAGE_ID environment variable.",
  },
};

const markdownInputProperties = {
  markdown: {
    type: "string" as const,
    description: "Inline Markdown content. Provide exactly one of markdown or filePath.",
  },
  filePath: {
    type: "string" as const,
    description:
      "Absolute or relative path to a Markdown file. Provide exactly one of markdown or filePath.",
  },
};

export const dumpPageMarkdownInputSchema = {
  type: "object" as const,
  properties: {
    ...pageIdProperty,
    includeBlockIds: {
      type: "boolean" as const,
      description: "Include block IDs as HTML comments in the output.",
    },
  },
  additionalProperties: false,
};

export const appendMarkdownInputSchema = {
  type: "object" as const,
  properties: {
    ...pageIdProperty,
    ...markdownInputProperties,
  },
  additionalProperties: false,
};

export const replaceMarkdownInputSchema = {
  type: "object" as const,
  properties: {
    ...pageIdProperty,
    ...markdownInputProperties,
    smart: {
      type: "boolean" as const,
      description:
        "Use surgical block-level updates instead of clearing the whole page.",
    },
  },
  additionalProperties: false,
};

export const createChildPageInputSchema = {
  type: "object" as const,
  properties: {
    title: {
      type: "string" as const,
      description: "Title for the new child page.",
    },
    parentPageId: {
      type: "string" as const,
      description:
        "Parent page ID or URL. Defaults to the NOTION_PAGE_ID environment variable.",
    },
    ...markdownInputProperties,
  },
  required: ["title"],
  additionalProperties: false,
};

export const updateChildPageInputSchema = {
  type: "object" as const,
  properties: {
    pageId: {
      type: "string" as const,
      description: "Child page ID or URL.",
    },
    title: {
      type: "string" as const,
      description: "New title for the child page.",
    },
    append: {
      type: "boolean" as const,
      description:
        "Append Markdown instead of replacing the current top-level content.",
    },
    smart: {
      type: "boolean" as const,
      description:
        "When replacing, use surgical block-level updates instead of clearing the whole page.",
    },
    skipParentCheck: {
      type: "boolean" as const,
      description:
        "Skip validation that the page is a direct child of the configured parent.",
    },
    ...markdownInputProperties,
  },
  required: ["pageId"],
  additionalProperties: false,
};

export const uploadImageInputSchema = {
  type: "object" as const,
  properties: {
    filePath: {
      type: "string" as const,
      description: "Path to a local image file.",
    },
    caption: {
      type: "string" as const,
      description: "Optional image caption.",
    },
    pageId: {
      type: "string" as const,
      description:
        "Target page ID or URL. Defaults to the NOTION_PAGE_ID environment variable.",
    },
  },
  required: ["filePath"],
  additionalProperties: false,
};

export const appendImageUrlInputSchema = {
  type: "object" as const,
  properties: {
    url: {
      type: "string" as const,
      description: "Direct URL to a supported image file.",
    },
    caption: {
      type: "string" as const,
      description: "Optional image caption.",
    },
    pageId: {
      type: "string" as const,
      description:
        "Target page ID or URL. Defaults to the NOTION_PAGE_ID environment variable.",
    },
  },
  required: ["url"],
  additionalProperties: false,
};

export const syncWikiSectionInputSchema = {
  type: "object" as const,
  properties: {
    sectionName: {
      type: "string" as const,
      description: "Section key from page-map.json.",
    },
    dryRun: {
      type: "boolean" as const,
      description: "Preview what would change without touching Notion.",
    },
    smart: {
      type: "boolean" as const,
      description:
        "Use surgical block-level updates instead of clearing the page.",
    },
  },
  required: ["sectionName"],
  additionalProperties: false,
};

export const syncAllWikiSectionsInputSchema = {
  type: "object" as const,
  properties: {
    dryRun: {
      type: "boolean" as const,
      description: "Preview what would change without touching Notion.",
    },
    smart: {
      type: "boolean" as const,
      description:
        "Use surgical block-level updates instead of clearing pages.",
    },
  },
  additionalProperties: false,
};

export const validateWikiInputSchema = emptyObjectSchema;
export const validatePageInputSchema = emptyObjectSchema;
