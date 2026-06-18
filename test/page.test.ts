import assert from "node:assert/strict";
import test from "node:test";

import type { BlockObjectRequest, Client, PageObjectResponse } from "@notionhq/client";

import {
  appendBlocks,
  archiveAllPageChildren,
  assertDirectChildPage,
  createChildPage,
  extractPageTitle,
  listAllBlockChildren,
  updatePageDetails,
} from "../src/notion/page";

test("appendBlocks chunks requests at 100 children", async () => {
  const appendCalls: BlockObjectRequest[][] = [];
  const client = {
    blocks: {
      children: {
        append: async ({ children }: { children: BlockObjectRequest[] }) => {
          appendCalls.push(children);
          return { results: children };
        },
      },
    },
  } as unknown as Client;

  const blocks = Array.from({ length: 101 }, (_, index) => ({
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: `block-${index}` } }],
    },
  })) as BlockObjectRequest[];

  const appendedCount = await appendBlocks(client, "page-id", blocks);

  assert.equal(appendedCount, 101);
  assert.equal(appendCalls.length, 2);
  assert.equal(appendCalls[0]?.length, 100);
  assert.equal(appendCalls[1]?.length, 1);
});

test("listAllBlockChildren follows pagination", async () => {
  const client = {
    blocks: {
      children: {
        list: async ({ start_cursor }: { start_cursor?: string }) => {
          if (!start_cursor) {
            return {
              results: [{ id: "block-1" }],
              has_more: true,
              next_cursor: "cursor-2",
            };
          }

          return {
            results: [{ id: "block-2" }],
            has_more: false,
            next_cursor: null,
          };
        },
      },
    },
  } as unknown as Client;

  const results = await listAllBlockChildren(client, "page-id");

  assert.deepEqual(results.map((item) => item.id), ["block-1", "block-2"]);
});

test("archiveAllPageChildren deletes each current content block and skips child pages/databases", async () => {
  const deletedBlockIds: string[] = [];
  const client = {
    blocks: {
      children: {
        list: async () => ({
          results: [
            { id: "block-1", type: "paragraph" },
            { id: "block-2", type: "heading_2" },
            { id: "page-block-1", type: "child_page" },
            { id: "db-block-1", type: "child_database" },
          ],
          has_more: false,
          next_cursor: null,
        }),
      },
      delete: async ({ block_id }: { block_id: string }) => {
        deletedBlockIds.push(block_id);
        return { id: block_id };
      },
    },
  } as unknown as Client;

  const archivedCount = await archiveAllPageChildren(client, "page-id");

  assert.equal(archivedCount, 4);
  assert.deepEqual(deletedBlockIds, ["block-1", "block-2"]);
});

test("createChildPage validates the parent and creates a child page", async () => {
  const createCalls: Array<Record<string, unknown>> = [];
  const client = {
    pages: {
      retrieve: async () => createPageResponse("parent-id", "Parent Page"),
      create: async (args: Record<string, unknown>) => {
        createCalls.push(args);
        return createPageResponse("child-id", "Child Page");
      },
    },
  } as unknown as Client;

  const createdPage = await createChildPage(client, {
    parentPageId: "parent-id",
    title: "Child Page",
  });

  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0]?.parent, {
    type: "page_id",
    page_id: "parent-id",
  });
  assert.deepEqual(createCalls[0]?.properties, {
    title: {
      title: [
        {
          type: "text",
          text: {
            content: "Child Page",
          },
        },
      ],
    },
  });
  assert.equal(createdPage.id, "child-id");
  assert.equal(createdPage.title, "Child Page");
  assert.equal(createdPage.topLevelBlockCount, 0);
});

test("updatePageDetails updates the page title and returns the current block count", async () => {
  const updateCalls: Array<Record<string, unknown>> = [];
  const client = {
    pages: {
      update: async (args: Record<string, unknown>) => {
        updateCalls.push(args);
        return createPageResponse("child-id", "Renamed Child");
      },
    },
    blocks: {
      children: {
        list: async () => ({
          results: [{ id: "block-1" }, { id: "block-2" }],
          has_more: false,
          next_cursor: null,
        }),
      },
    },
  } as unknown as Client;

  const updatedPage = await updatePageDetails(client, "child-id", {
    title: "Renamed Child",
  });

  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0], {
    page_id: "child-id",
    properties: {
      title: {
        title: [
          {
            type: "text",
            text: {
              content: "Renamed Child",
            },
          },
        ],
      },
    },
  });
  assert.equal(updatedPage.title, "Renamed Child");
  assert.equal(updatedPage.topLevelBlockCount, 2);
});

test("updatePageDetails without a title falls back to the existing page summary", async () => {
  let updateCalled = false;
  const client = {
    pages: {
      retrieve: async () => createPageResponse("child-id", "Existing Child"),
      update: async () => {
        updateCalled = true;
        return createPageResponse("child-id", "Unexpected");
      },
    },
    blocks: {
      children: {
        list: async () => ({
          results: [{ id: "block-1" }],
          has_more: false,
          next_cursor: null,
        }),
      },
    },
  } as unknown as Client;

  const existingPage = await updatePageDetails(client, "child-id", {});

  assert.equal(updateCalled, false);
  assert.equal(existingPage.title, "Existing Child");
  assert.equal(existingPage.topLevelBlockCount, 1);
});

test("assertDirectChildPage accepts pages under the configured parent", () => {
  assert.doesNotThrow(() => {
    assertDirectChildPage(createPageResponse("child-id", "Child Page", "parent-id"), "parent-id");
  });
});

test("assertDirectChildPage rejects pages outside the configured parent", () => {
  assert.throws(
    () => {
      assertDirectChildPage(createPageResponse("child-id", "Child Page", "other-parent-id"), "parent-id");
    },
    /not a direct child/,
  );
});

test("extractPageTitle returns the title property when available", () => {
  const page = {
    properties: {
      Title: {
        type: "title",
        title: [{ plain_text: "Wiki Home" }],
      },
    },
  } as unknown as PageObjectResponse;

  assert.equal(extractPageTitle(page), "Wiki Home");
});

test("extractPageTitle falls back to Untitled page", () => {
  const page = {
    properties: {},
  } as unknown as PageObjectResponse;

  assert.equal(extractPageTitle(page), "Untitled page");
});

function createPageResponse(
  id: string,
  title: string,
  parentPageId = "workspace-parent-id",
): PageObjectResponse {
  return {
    object: "page",
    id,
    url: `https://www.notion.so/${id}`,
    parent: {
      type: "page_id",
      page_id: parentPageId,
    },
    properties: {
      title: {
        type: "title",
        title: [{ plain_text: title }],
      },
    },
  } as unknown as PageObjectResponse;
}