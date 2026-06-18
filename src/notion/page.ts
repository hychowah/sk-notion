import { isFullPage } from "@notionhq/client";
import type {
  AppendBlockChildrenParameters,
  BlockObjectRequest,
  BlockObjectResponse,
  Client,
  CreatePageParameters,
  PageObjectResponse,
  PartialBlockObjectResponse,
  UpdatePageParameters,
} from "@notionhq/client";

import { withRateLimitRetry } from "./client";
import { blocksToMarkdown, type BlocksToMarkdownOptions } from "../transform/notion-to-markdown";

const APPEND_CHUNK_SIZE = 100;
const ARCHIVE_BATCH_SIZE = 10;
const REQUEST_DELAY_MS = 350;

export type PageSummary = {
  id: string;
  url: string;
  title: string;
  topLevelBlockCount: number;
};

export type CreateChildPageOptions = {
  parentPageId: string;
  title: string;
};

export type UpdatePageDetailsOptions = {
  title?: string;
};

export async function getPage(client: Client, pageId: string): Promise<PageObjectResponse> {
  const response = await withRateLimitRetry(() => client.pages.retrieve({ page_id: pageId }));

  if (!isFullPage(response)) {
    throw new Error("The configured page ID resolved to a partial page object.");
  }

  return response;
}

export async function listAllBlockChildren(
  client: Client,
  blockId: string,
): Promise<Array<PartialBlockObjectResponse | BlockObjectResponse>> {
  const results: Array<PartialBlockObjectResponse | BlockObjectResponse> = [];
  let cursor: string | undefined;

  do {
    const response = await withRateLimitRetry(() =>
      client.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100,
      }),
    );

    results.push(...response.results);
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  return results;
}

export async function appendBlocks(
  client: Client,
  blockId: string,
  blocks: BlockObjectRequest[],
  position?: AppendBlockChildrenParameters["position"],
): Promise<number> {
  let appendedCount = 0;

  for (let index = 0; index < blocks.length; index += APPEND_CHUNK_SIZE) {
    const children = blocks.slice(index, index + APPEND_CHUNK_SIZE);

    const response = await withRateLimitRetry(() =>
      client.blocks.children.append({
        block_id: blockId,
        children,
        position,
      }),
    );

    appendedCount += response.results.length;

    const isLastChunk = index + APPEND_CHUNK_SIZE >= blocks.length;
    if (!isLastChunk) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
    }
  }

  return appendedCount;
}

export async function archiveAllPageChildren(client: Client, pageId: string): Promise<number> {
  const children = await listAllBlockChildren(client, pageId);

  for (let index = 0; index < children.length; index += ARCHIVE_BATCH_SIZE) {
    const batch = children.slice(index, index + ARCHIVE_BATCH_SIZE);

    await Promise.all(
      batch.map((child) =>
        withRateLimitRetry(async () => {
          // Child pages and databases cannot be modified through the blocks endpoint.
          // Skip them so sync only removes regular content blocks.
          const type = (child as { type?: string }).type;
          if (type === "child_page" || type === "child_database") {
            return;
          }
          await client.blocks.delete({ block_id: child.id });
        }),
      ),
    );

    const isLastBatch = index + ARCHIVE_BATCH_SIZE >= children.length;
    if (!isLastBatch) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
    }
  }

  return children.length;
}

export async function replacePageContent(
  client: Client,
  pageId: string,
  blocks: BlockObjectRequest[],
): Promise<{ archivedCount: number; appendedCount: number }> {
  const archivedCount = await archiveAllPageChildren(client, pageId);
  const appendedCount = await appendBlocks(client, pageId, blocks);

  return { archivedCount, appendedCount };
}

export async function createChildPage(
  client: Client,
  options: CreateChildPageOptions,
): Promise<PageSummary> {
  await getPage(client, options.parentPageId);

  const response = await withRateLimitRetry(() =>
    client.pages.create({
      parent: {
        type: "page_id",
        page_id: options.parentPageId,
      },
      properties: {
        title: buildTitlePropertyValue(options.title),
      },
    } satisfies CreatePageParameters),
  );

  if (!isFullPage(response)) {
    throw new Error("The created child page resolved to a partial page object.");
  }

  return summarizePage(response, 0);
}

export function assertDirectChildPage(page: PageObjectResponse, parentPageId: string): void {
  if (page.parent.type !== "page_id" || page.parent.page_id !== parentPageId) {
    throw new Error("The specified page is not a direct child of the configured parent page.");
  }
}

export async function updatePageDetails(
  client: Client,
  pageId: string,
  options: UpdatePageDetailsOptions,
): Promise<PageSummary> {
  const { title } = options;

  if (!title) {
    return getPageSummary(client, pageId);
  }

  const response = await withRateLimitRetry(() =>
    client.pages.update({
      page_id: pageId,
      properties: {
        title: buildTitlePropertyValue(title),
      },
    } satisfies UpdatePageParameters),
  );

  if (!isFullPage(response)) {
    throw new Error("The updated child page resolved to a partial page object.");
  }

  const children = await listAllBlockChildren(client, pageId);
  return summarizePage(response, children.length);
}

export async function getPageSummary(client: Client, pageId: string): Promise<PageSummary> {
  const [page, children] = await Promise.all([
    getPage(client, pageId),
    listAllBlockChildren(client, pageId),
  ]);

  return summarizePage(page, children.length);
}

export type PageMarkdown = {
  title: string;
  markdown: string;
  blockCount: number;
};

export async function getPageMarkdown(
  client: Client,
  pageId: string,
  options?: BlocksToMarkdownOptions,
): Promise<PageMarkdown> {
  const [page, children] = await Promise.all([
    getPage(client, pageId),
    listAllBlockChildren(client, pageId),
  ]);

  return {
    title: extractPageTitle(page),
    markdown: blocksToMarkdown(children, options),
    blockCount: children.length,
  };
}

export function extractPageTitle(page: PageObjectResponse): string {
  const titleProperty = Object.values(page.properties).find(
    (property) => property.type === "title",
  );

  if (!titleProperty || titleProperty.type !== "title") {
    return "Untitled page";
  }

  const plainText = titleProperty.title.map((item) => item.plain_text).join("").trim();
  return plainText.length > 0 ? plainText : "Untitled page";
}

function summarizePage(page: PageObjectResponse, topLevelBlockCount: number): PageSummary {
  return {
    id: page.id,
    url: page.url,
    title: extractPageTitle(page),
    topLevelBlockCount,
  };
}

function buildTitlePropertyValue(title: string): NonNullable<CreatePageParameters["properties"]>[string] {
  return {
    title: [
      {
        type: "text",
        text: {
          content: title,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export type NotionComment = {
  id: string;
  discussionId: string;
  createdTime: string;
  richText: string;
};

export async function listPageComments(client: Client, pageId: string): Promise<NotionComment[]> {
  const results: NotionComment[] = [];
  let cursor: string | undefined;

  do {
    const response = await withRateLimitRetry(() =>
      client.comments.list({
        block_id: pageId,
        start_cursor: cursor,
        page_size: 100,
      }),
    );

    for (const comment of response.results) {
      if (comment.object !== "comment") continue;
      results.push({
        id: comment.id,
        discussionId: comment.discussion_id,
        createdTime: comment.created_time,
        richText: comment.rich_text.map((item) => item.plain_text).join(""),
      });
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return results;
}

export async function addPageComment(
  client: Client,
  pageId: string,
  text: string,
): Promise<{ id: string }> {
  const response = await withRateLimitRetry(() =>
    client.comments.create({
      parent: { page_id: pageId, type: "page_id" },
      rich_text: [{ type: "text", text: { content: text } }],
    }),
  );

  return { id: response.id };
}