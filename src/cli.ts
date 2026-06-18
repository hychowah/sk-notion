import { readFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import { loadConfig, normalizeNotionId } from "./config";
import { createNotionClient, formatNotionError } from "./notion/client";
import {
  addPageComment,
  appendBlocks,
  archiveAllPageChildren,
  assertDirectChildPage,
  createChildPage,
  getPage,
  getPageMarkdown,
  getPageSummary,
  listPageComments,
  replacePageContent,
  updatePageDetails,
} from "./notion/page";
import { updatePageContentSurgically } from "./diff/execute";
import { formatDiff } from "./diff/blocks";
import { assertSupportedRemoteImageUrl, uploadImageFile } from "./notion/uploads";
import { contentNodesToBlocks, markdownToParagraphBlocks, richTextFromText } from "./transform/blocks";
import { markdownToContentNodes } from "./transform/markdown";

async function main(): Promise<void> {
  const program = new Command();
  const defaultTestPageTitle = "Notion API Test Page";

  program
    .name("notion-wiki")
    .description("Publish markdown, text, and images into a Notion page via the Notion API.")
    .showHelpAfterError();

  program
    .command("validate")
    .description("Verify that the configured token can access the configured page.")
    .action(async () => {
      const context = createRuntimeContext();
      const page = await getPageSummary(context.client, context.config.notionPageId);

      console.log(`Connected to page: ${page.title}`);
      console.log(`Page ID: ${page.id}`);
      console.log(`Page URL: ${page.url}`);
      console.log(`Top-level blocks: ${page.topLevelBlockCount}`);
    });

  program
    .command("page-info")
    .description("Print page metadata and current top-level block count.")
    .action(async () => {
      const context = createRuntimeContext();
      const page = await getPageSummary(context.client, context.config.notionPageId);

      console.log(JSON.stringify(page, null, 2));
    });

  program
    .command("dump-md")
    .description("Dump the current page content as markdown to stdout.")
    .option("--page-id <id>", "Page ID or Notion page URL (defaults to NOTION_PAGE_ID).")
    .option("--with-block-ids", "Include block IDs as HTML comments.")
    .action(
      async (options: { pageId?: string; withBlockIds?: boolean }) => {
        const context = createRuntimeContext();
        const pageId = options.pageId
          ? normalizeNotionId(options.pageId)
          : context.config.notionPageId;

        const result = await getPageMarkdown(context.client, pageId, {
          includeBlockIds: options.withBlockIds,
        });

        if (result.title) {
          console.log(`# ${result.title}\n`);
        }
        console.log(result.markdown);
      },
    );

  program
    .command("diff-md")
    .description("Compare a local markdown file against the current Notion page content.")
    .option("--file <path>", "Read markdown from a file.")
    .option("--text <markdown>", "Use an inline markdown string.")
    .option("--page-id <id>", "Page ID or Notion page URL (defaults to NOTION_PAGE_ID).")
    .action(
      async (options: { file?: string; text?: string; pageId?: string }) => {
        const context = createRuntimeContext();
        const pageId = options.pageId
          ? normalizeNotionId(options.pageId)
          : context.config.notionPageId;
        const markdownInput = await resolveMarkdownInput(options);
        const markdownDirectory = options.file
          ? path.dirname(path.resolve(options.file))
          : process.cwd();

        const transformed = markdownToContentNodes(markdownInput);
        const built = await contentNodesToBlocks(transformed.nodes, {
          client: context.client,
          baseDirectory: markdownDirectory,
        });

        const { listAllBlockChildren } = await import("./notion/page.js");
        const { diffBlocks, formatDiff } = await import("./diff/blocks.js");
        const children = await listAllBlockChildren(context.client, pageId);
        const fullBlocks = children.filter(
          (b): b is import("@notionhq/client").BlockObjectResponse =>
            "type" in b && (b as Record<string, unknown>).type !== undefined,
        );

        const diff = diffBlocks(fullBlocks, built.blocks);
        console.log(formatDiff(diff));

        printWarnings([...transformed.warnings, ...built.result.warnings]);
      },
    );

  program
    .command("list-comments")
    .description("List comments on a Notion page.")
    .option("--page-id <id>", "Page ID or Notion page URL (defaults to NOTION_PAGE_ID).")
    .action(
      async (options: { pageId?: string }) => {
        const context = createRuntimeContext();
        const pageId = options.pageId
          ? normalizeNotionId(options.pageId)
          : context.config.notionPageId;
        const comments = await listPageComments(context.client, pageId);
        if (comments.length === 0) {
          console.log("No comments found.");
          return;
        }
        for (const comment of comments) {
          console.log(`[${comment.createdTime}] ${comment.id}: ${comment.richText}`);
        }
      },
    );

  program
    .command("add-comment")
    .description("Add a comment to a Notion page.")
    .argument("<text>", "Comment text.")
    .option("--page-id <id>", "Page ID or Notion page URL (defaults to NOTION_PAGE_ID).")
    .action(
      async (text: string, options: { pageId?: string }) => {
        const context = createRuntimeContext();
        const pageId = options.pageId
          ? normalizeNotionId(options.pageId)
          : context.config.notionPageId;
        const result = await addPageComment(context.client, pageId, text);
        console.log(`Added comment: ${result.id}`);
      },
    );

  program
    .command("append-text")
    .description("Append plain text paragraphs to the configured page.")
    .argument("<text>", "Text to append to the page.")
    .action(async (text: string) => {
      const context = createRuntimeContext();
      const blocks = markdownToParagraphBlocks(text);
      const appendedCount = await appendBlocks(
        context.client,
        context.config.notionPageId,
        blocks,
      );

      console.log(`Appended ${appendedCount} block(s).`);
    });

  program
    .command("append-md")
    .description("Append markdown content to the configured page.")
    .option("--file <path>", "Read markdown from a file.")
    .option("--text <markdown>", "Use an inline markdown string.")
    .action(async (options: { file?: string; text?: string }) => {
      await publishMarkdown(options, { replace: false });
    });

  program
    .command("replace-md")
    .description("Replace the page's current top-level content with markdown content.")
    .option("--file <path>", "Read markdown from a file.")
    .option("--text <markdown>", "Use an inline markdown string.")
    .option("--smart", "Use surgical block-level updates instead of clearing the whole page.")
    .action(async (options: { file?: string; text?: string; smart?: boolean }) => {
      await publishMarkdown(options, { replace: true, smart: options.smart });
    });

  program
    .command("append-image-url")
    .description("Append a directly hosted remote image URL to the page.")
    .argument("<url>", "Direct image URL.")
    .option("--caption <text>", "Optional image caption.")
    .action(async (url: string, options: { caption?: string }) => {
      const context = createRuntimeContext();

      assertSupportedRemoteImageUrl(url);
      const appendedCount = await appendBlocks(context.client, context.config.notionPageId, [
        {
          type: "image",
          image: {
            type: "external",
            external: { url },
            caption: options.caption ? richTextFromText(options.caption) : [],
          },
        },
      ]);

      console.log(`Appended ${appendedCount} image block.`);
    });

  program
    .command("append-image-file")
    .description("Upload a local image file to Notion and append it to the page.")
    .argument("<filePath>", "Path to a local image file.")
    .option("--caption <text>", "Optional image caption.")
    .action(async (filePath: string, options: { caption?: string }) => {
      const context = createRuntimeContext();
      const upload = await uploadImageFile(context.client, filePath);
      const appendedCount = await appendBlocks(context.client, context.config.notionPageId, [
        {
          type: "image",
          image: {
            type: "file_upload",
            file_upload: { id: upload.fileUploadId },
            caption: options.caption ? richTextFromText(options.caption) : [],
          },
        },
      ]);

      console.log(`Uploaded ${upload.filename} as ${upload.fileUploadId}.`);
      console.log(`Appended ${appendedCount} image block.`);
    });

  program
    .command("clear-page")
    .description("Archive the current top-level blocks on the configured page.")
    .action(async () => {
      const context = createRuntimeContext();
      const archivedCount = await archiveAllPageChildren(
        context.client,
        context.config.notionPageId,
      );

      console.log(`Archived ${archivedCount} existing top-level block(s).`);
    });

  program
    .command("ensure-test-page")
    .description("Create or validate a dedicated child page for live Notion testing.")
    .option("--title <text>", "Title to use when creating the test page.", defaultTestPageTitle)
    .action(async (options: { title: string }) => {
      const context = createRuntimeContext();

      if (context.config.notionTestPageId) {
        const page = await getPage(context.client, context.config.notionTestPageId);
        assertDirectChildPage(page, context.config.notionPageId);

        const summary = await getPageSummary(context.client, context.config.notionTestPageId);
        console.log("Configured test page is ready.");
        console.log(`Test Page ID: ${summary.id}`);
        console.log(`Test Page URL: ${summary.url}`);
        console.log(`Test Page Title: ${summary.title}`);
        return;
      }

      const page = await createChildPage(context.client, {
        parentPageId: context.config.notionPageId,
        title: options.title,
      });

      console.log("Created dedicated test child page.");
      console.log(`Test Page ID: ${page.id}`);
      console.log(`Test Page URL: ${page.url}`);
      console.log(`Test Page Title: ${page.title}`);
      console.log(`Add NOTION_TEST_PAGE_ID=${page.id} to your .env to reuse it for future live tests.`);
    });

  program
    .command("create-child-page")
    .description("Create a child page under the configured parent page and optionally seed it with markdown.")
    .argument("<title>", "Title for the new child page.")
    .option("--file <path>", "Read markdown from a file.")
    .option("--text <markdown>", "Use an inline markdown string.")
    .option("--parent-page-id <id>", "Parent page ID or URL (defaults to configured NOTION_PAGE_ID).")
    .action(async (title: string, options: { file?: string; text?: string; parentPageId?: string }) => {
      const context = createRuntimeContext();
      const parentPageId = options.parentPageId
        ? normalizeNotionId(options.parentPageId)
        : context.config.notionPageId;
      const page = await createChildPage(context.client, {
        parentPageId,
        title,
      });

      console.log(`Created child page: ${page.title}`);
      console.log(`Child Page ID: ${page.id}`);
      console.log(`Child Page URL: ${page.url}`);

      if (hasMarkdownInput(options)) {
        await publishMarkdownToPage(context, page.id, options, { replace: false });
      }
    });

  program
    .command("update-child-page")
    .description("Update an existing child page by page ID, including title and markdown content.")
    .requiredOption("--page-id <id>", "Child page ID or Notion page URL.")
    .option("--title <text>", "Rename the child page.")
    .option("--file <path>", "Read markdown from a file.")
    .option("--text <markdown>", "Use an inline markdown string.")
    .option("--append", "Append markdown instead of replacing the current top-level content.")
    .option("--smart", "When replacing, use surgical block-level updates instead of clearing the whole page.")
    .option("--skip-parent-check", "Skip validation that the page is a direct child of the configured parent.")
    .action(
      async (options: {
        pageId: string;
        title?: string;
        file?: string;
        text?: string;
        append?: boolean;
        smart?: boolean;
        skipParentCheck?: boolean;
      }) => {
        if (!options.title && !hasMarkdownInput(options)) {
          throw new Error("Provide at least one of --title, --file, or --text.");
        }

        const context = createRuntimeContext();
        const pageId = normalizeNotionId(options.pageId);
        const existingPage = await getPage(context.client, pageId);

        if (!options.skipParentCheck) {
          assertDirectChildPage(existingPage, context.config.notionPageId);
        }

        if (options.title) {
          await updatePageDetails(context.client, pageId, { title: options.title });
        }

        if (hasMarkdownInput(options)) {
          await publishMarkdownToPage(context, pageId, options, {
            replace: !options.append,
            smart: options.smart,
          });
        }

        const page = await getPageSummary(context.client, pageId);
        console.log(`Updated child page: ${page.title}`);
        console.log(`Child Page ID: ${page.id}`);
        console.log(`Child Page URL: ${page.url}`);
        console.log(`Top-level blocks: ${page.topLevelBlockCount}`);
      },
    );

  program
    .command("publish")
    .description("Publish markdown and optional images in one command.")
    .option("--file <path>", "Read markdown from a file.")
    .option("--text <markdown>", "Use an inline markdown string.")
    .option("--image-url <url...>", "Append one or more remote image URLs after the markdown.")
    .option("--image-file <path...>", "Upload one or more local image files after the markdown.")
    .option("--replace", "Replace the page contents before publishing.")
    .option("--smart", "When replacing, use surgical block-level updates instead of clearing the whole page.")
    .action(
      async (options: {
        file?: string;
        text?: string;
        imageUrl?: string[];
        imageFile?: string[];
        replace?: boolean;
        smart?: boolean;
      }) => {
        const context = createRuntimeContext();
        const markdownInput = await resolveMarkdownInput(options);
        const markdownDirectory = options.file
          ? path.dirname(path.resolve(options.file))
          : process.cwd();

        const transformed = markdownToContentNodes(markdownInput);
        const built = await contentNodesToBlocks(transformed.nodes, {
          client: context.client,
          baseDirectory: markdownDirectory,
        });

        const extraImageBlocks = [
          ...((options.imageUrl ?? []).map((url) => {
            assertSupportedRemoteImageUrl(url);
            return {
              type: "image",
              image: {
                type: "external",
                external: { url },
                caption: [],
              },
            };
          }) as Array<{
            type: "image";
            image: {
              type: "external";
              external: { url: string };
              caption: [];
            };
          }>),
          ...(await Promise.all(
            (options.imageFile ?? []).map(async (filePath) => {
              const upload = await uploadImageFile(context.client, filePath);
              return {
                type: "image" as const,
                image: {
                  type: "file_upload" as const,
                  file_upload: { id: upload.fileUploadId },
                  caption: [],
                },
              };
            }),
          )),
        ];

        const blocks = [...built.blocks, ...extraImageBlocks];

        if (options.replace) {
          if (options.smart) {
            const result = await updatePageContentSurgically(
              context.client,
              context.config.notionPageId,
              blocks,
            );
            console.log(`Smart update: ${result.unchangedCount} kept, ${result.updatedCount} updated, ${result.replacedCount} replaced, ${result.deletedCount} deleted, ${result.appendedCount} added.`);
          } else {
            const result = await replacePageContent(
              context.client,
              context.config.notionPageId,
              blocks,
            );
            console.log(`Archived ${result.archivedCount} existing block(s).`);
            console.log(`Appended ${result.appendedCount} new block(s).`);
          }
        } else {
          const appendedCount = await appendBlocks(
            context.client,
            context.config.notionPageId,
            blocks,
          );
          console.log(`Appended ${appendedCount} block(s).`);
        }

        printWarnings([...transformed.warnings, ...built.result.warnings]);

        if (built.result.uploadedImages.length > 0) {
          for (const uploadedImage of built.result.uploadedImages) {
            console.log(
              `Uploaded ${uploadedImage.source} as ${uploadedImage.fileUploadId}.`,
            );
          }
        }
      },
    );

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error(`Error: ${formatNotionError(error)}`);
    process.exitCode = 1;
  }
}

type RuntimeContext = ReturnType<typeof createRuntimeContext>;

function createRuntimeContext(): { config: ReturnType<typeof loadConfig>; client: ReturnType<typeof createNotionClient> } {
  const config = loadConfig();
  const client = createNotionClient(config);
  return { config, client };
}

async function publishMarkdown(
  options: { file?: string; text?: string },
  behavior: { replace: boolean; smart?: boolean },
): Promise<void> {
  const context = createRuntimeContext();
  await publishMarkdownToPage(context, context.config.notionPageId, options, behavior);
}

async function publishMarkdownToPage(
  context: RuntimeContext,
  pageId: string,
  options: { file?: string; text?: string },
  behavior: { replace: boolean; smart?: boolean },
): Promise<void> {
  const markdownInput = await resolveMarkdownInput(options);
  const markdownDirectory = options.file
    ? path.dirname(path.resolve(options.file))
    : process.cwd();

  const transformed = markdownToContentNodes(markdownInput);
  const built = await contentNodesToBlocks(transformed.nodes, {
    client: context.client,
    baseDirectory: markdownDirectory,
  });

  if (behavior.replace) {
    if (behavior.smart) {
      const result = await updatePageContentSurgically(
        context.client,
        pageId,
        built.blocks,
      );
      console.log(`Smart update: ${result.unchangedCount} kept, ${result.updatedCount} updated, ${result.replacedCount} replaced, ${result.deletedCount} deleted, ${result.appendedCount} added.`);
    } else {
      const result = await replacePageContent(
        context.client,
        pageId,
        built.blocks,
      );
      console.log(`Archived ${result.archivedCount} existing block(s).`);
      console.log(`Appended ${result.appendedCount} new block(s).`);
    }
  } else {
    const appendedCount = await appendBlocks(
      context.client,
      pageId,
      built.blocks,
    );
    console.log(`Appended ${appendedCount} block(s).`);
  }

  printWarnings([...transformed.warnings, ...built.result.warnings]);

  if (built.result.uploadedImages.length > 0) {
    for (const uploadedImage of built.result.uploadedImages) {
      console.log(`Uploaded ${uploadedImage.source} as ${uploadedImage.fileUploadId}.`);
    }
  }
}

async function resolveMarkdownInput(options: { file?: string; text?: string }): Promise<string> {
  if (Boolean(options.file) === Boolean(options.text)) {
    throw new Error("Provide exactly one of --file or --text.");
  }

  if (options.file) {
    return readFile(path.resolve(options.file), "utf8");
  }

  return options.text ?? "";
}

function printWarnings(warnings: string[]): void {
  if (warnings.length === 0) {
    return;
  }

  for (const warning of warnings) {
    console.log(`Warning: ${warning}`);
  }
}

function hasMarkdownInput(options: { file?: string; text?: string }): boolean {
  return Boolean(options.file || options.text);
}

void main();