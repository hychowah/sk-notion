import type { BlockObjectRequest, BlockObjectResponse, Client } from "@notionhq/client";

import { withRateLimitRetry } from "../notion/client";
import { listAllBlockChildren } from "../notion/page";
import { diffBlocks, type BlockDiffResult } from "./blocks";

const UPDATE_BATCH_SIZE = 10;
const DELETE_BATCH_SIZE = 10;
const APPEND_CHUNK_SIZE = 100;
const REQUEST_DELAY_MS = 350;

export type SurgicalUpdateResult = {
  updatedCount: number;
  replacedCount: number;
  deletedCount: number;
  appendedCount: number;
  unchangedCount: number;
};

/**
 * Fetch the current top-level blocks from Notion, diff them against the target blocks,
 * and apply only the necessary changes.
 */
export async function updatePageContentSurgically(
  client: Client,
  pageId: string,
  targetBlocks: BlockObjectRequest[],
): Promise<SurgicalUpdateResult> {
  const currentChildren = await listAllBlockChildren(client, pageId);
  // Filter to full blocks that we can fingerprint
  const currentBlocks = currentChildren.filter(
    (b): b is BlockObjectResponse => "type" in b && b.type !== undefined,
  );

  // Table rows live in child blocks; fetch them so table fingerprints include
  // the actual cell content and unchanged tables are kept, not replaced.
  const currentTableText = new Map<string, string>();
  for (const block of currentBlocks) {
    if (block.type === "table") {
      const rows = await listAllBlockChildren(client, block.id);
      const text = rows
        .filter(
          (r): r is BlockObjectResponse & { type: "table_row" } =>
            "type" in r && r.type === "table_row",
        )
        .map((r) =>
          r.table_row.cells
            .map((cell) => cell.map((c) => ("plain_text" in c ? c.plain_text : "")).join(""))
            .join("|"),
        )
        .join("\n");
      currentTableText.set(block.id, text);
    }
  }

  const diff = diffBlocks(currentBlocks, targetBlocks, currentTableText);

  if (diff.ops.length === 0) {
    return {
      updatedCount: 0,
      replacedCount: 0,
      deletedCount: 0,
      appendedCount: 0,
      unchangedCount: 0,
    };
  }

  // Phase 1: Apply updates in place
  const updateOps = diff.ops.filter((o) => o.action === "update");
  for (let i = 0; i < updateOps.length; i += UPDATE_BATCH_SIZE) {
    const batch = updateOps.slice(i, i + UPDATE_BATCH_SIZE);
    await Promise.all(
      batch.map((op) =>
        withRateLimitRetry(async () => {
          const block = op.newBlock;
          if (block.type === "paragraph") {
            await client.blocks.update({
              block_id: op.blockId,
              paragraph: { rich_text: block.paragraph.rich_text },
            });
          } else if (block.type === "heading_1") {
            await client.blocks.update({
              block_id: op.blockId,
              heading_1: { rich_text: block.heading_1.rich_text },
            });
          } else if (block.type === "heading_2") {
            await client.blocks.update({
              block_id: op.blockId,
              heading_2: { rich_text: block.heading_2.rich_text },
            });
          } else if (block.type === "heading_3") {
            await client.blocks.update({
              block_id: op.blockId,
              heading_3: { rich_text: block.heading_3.rich_text },
            });
          } else if (block.type === "heading_4") {
            await client.blocks.update({
              block_id: op.blockId,
              heading_4: { rich_text: block.heading_4.rich_text },
            });
          } else if (block.type === "bulleted_list_item") {
            await client.blocks.update({
              block_id: op.blockId,
              bulleted_list_item: { rich_text: block.bulleted_list_item.rich_text },
            });
          } else if (block.type === "numbered_list_item") {
            await client.blocks.update({
              block_id: op.blockId,
              numbered_list_item: { rich_text: block.numbered_list_item.rich_text },
            });
          } else if (block.type === "quote") {
            await client.blocks.update({
              block_id: op.blockId,
              quote: { rich_text: block.quote.rich_text },
            });
          } else if (block.type === "callout") {
            await client.blocks.update({
              block_id: op.blockId,
              callout: { rich_text: block.callout.rich_text },
            });
          } else if (block.type === "code") {
            await client.blocks.update({
              block_id: op.blockId,
              code: {
                rich_text: block.code.rich_text,
                language: block.code.language,
              },
            });
          } else if (block.type === "divider") {
            await client.blocks.update({
              block_id: op.blockId,
              divider: {},
            });
          }
        }),
      ),
    );
    if (i + UPDATE_BATCH_SIZE < updateOps.length) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
    }
  }

  // Phase 2: Collect blocks to delete (removes + replaces)
  const deleteBlockIds: string[] = [];
  for (const op of diff.ops) {
    if (op.action === "remove" || op.action === "replace") {
      deleteBlockIds.push(op.blockId);
    }
  }

  for (let i = 0; i < deleteBlockIds.length; i += DELETE_BATCH_SIZE) {
    const batch = deleteBlockIds.slice(i, i + DELETE_BATCH_SIZE);
    await Promise.all(
      batch.map((blockId) =>
        withRateLimitRetry(() => client.blocks.delete({ block_id: blockId })),
      ),
    );
    if (i + DELETE_BATCH_SIZE < deleteBlockIds.length) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
    }
  }

  // Phase 3: Add new blocks (adds + replaces need their new content inserted)
  // Group consecutive adds/replaces into runs, and determine the anchor block for each run.
  const opsWithInsertionIndex = diff.ops.map((op, idx) => ({ op, idx }));

  // Build a map from current block index to blockId for kept blocks
  const keptBlockIds = new Map<number, string>();
  for (const op of diff.ops) {
    if (op.action === "keep") {
      keptBlockIds.set(op.currentIndex, op.blockId);
    }
  }

  // We need to insert blocks in the correct order. The diff ops are already in order.
  // We'll walk through the ops and group consecutive adds/replaces into batches.
  // For each batch, the anchor is the last kept block that appears before this batch
  // in the *target* order. If none, we insert at start.

  type InsertBatch = {
    blocks: BlockObjectRequest[];
    anchorBlockId: string | null; // null means insert at start
  };

  const insertBatches: InsertBatch[] = [];
  let currentBatch: BlockObjectRequest[] = [];
  let currentAnchor: string | null = null;

  // We need to track which original current blocks are still present (not deleted)
  // to use as anchors. After deletes, any kept block before an insertion point
  // can serve as an anchor.

  // A simpler approach: since we know the target order, we can process the diff ops
  // in target order and whenever we encounter a keep, any subsequent adds use that
  // kept block as anchor until the next keep.

  for (const op of diff.ops) {
    if (op.action === "keep") {
      if (currentBatch.length > 0) {
        insertBatches.push({ blocks: currentBatch, anchorBlockId: currentAnchor });
        currentBatch = [];
      }
      currentAnchor = op.blockId;
    } else if (op.action === "add" || op.action === "replace") {
      currentBatch.push(op.newBlock);
    } else if (op.action === "update") {
      // Updates don't change the block ID, so anchor remains the same
    } else if (op.action === "remove") {
      // Removes don't produce new blocks, but if we had a batch in progress,
      // the anchor is still valid because the removed block was *after* the anchor
      // in the original order. In target order, the adds come at the position
      // where the removed block was.
    }
  }

  if (currentBatch.length > 0) {
    insertBatches.push({ blocks: currentBatch, anchorBlockId: currentAnchor });
  }

  let appendedCount = 0;

  for (const batch of insertBatches) {
    for (let i = 0; i < batch.blocks.length; i += APPEND_CHUNK_SIZE) {
      const chunk = batch.blocks.slice(i, i + APPEND_CHUNK_SIZE);
      const response = await withRateLimitRetry(() =>
        client.blocks.children.append({
          block_id: pageId,
          children: chunk,
          position:
            batch.anchorBlockId != null
              ? { type: "after_block", after_block: { id: batch.anchorBlockId } }
              : { type: "start" },
        }),
      );
      appendedCount += response.results.length;

      // If this was not the last chunk of this batch, we need to update the anchor
      // to the last block of the just-appended chunk so subsequent chunks go after it.
      if (i + APPEND_CHUNK_SIZE < batch.blocks.length && response.results.length > 0) {
        const lastResult = response.results[response.results.length - 1];
        batch.anchorBlockId = lastResult.id;
      }

      if (i + APPEND_CHUNK_SIZE < batch.blocks.length) {
        await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
      }
    }
  }

  return {
    updatedCount: diff.updatedCount,
    replacedCount: diff.replacedCount,
    deletedCount: deleteBlockIds.length,
    appendedCount,
    unchangedCount: diff.unchangedCount,
  };
}
