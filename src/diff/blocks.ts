import type { BlockObjectRequest, BlockObjectResponse } from "@notionhq/client";
import type { RichTextItemRequest } from "@notionhq/client/build/src/api-endpoints/common";

export type BlockFingerprint = {
  type: string;
  text: string;
  language?: string;
  imageUrl?: string;
  caption?: string;
};

export type DiffOp =
  | { action: "keep"; currentIndex: number; targetIndex: number; blockId: string }
  | { action: "update"; currentIndex: number; targetIndex: number; blockId: string; newBlock: BlockObjectRequest }
  | { action: "replace"; currentIndex: number; targetIndex: number; blockId: string; newBlock: BlockObjectRequest }
  | { action: "remove"; currentIndex: number; blockId: string }
  | { action: "add"; targetIndex: number; newBlock: BlockObjectRequest };

export type BlockDiffResult = {
  ops: DiffOp[];
  unchangedCount: number;
  updatedCount: number;
  replacedCount: number;
  removedCount: number;
  addedCount: number;
};

function richTextResponseToPlainText(richText: Array<{ plain_text?: string }>): string {
  return richText.map((item) => item.plain_text ?? "").join("");
}

function richTextRequestToPlainText(richText: RichTextItemRequest[]): string {
  return richText
    .map((item) => {
      if (item.type === "text") {
        return item.text.content;
      }
      return "";
    })
    .join("");
}

export function fingerprintResponse(block: BlockObjectResponse): BlockFingerprint | null {
  switch (block.type) {
    case "paragraph":
      return {
        type: "paragraph",
        text: richTextResponseToPlainText(block.paragraph.rich_text),
      };
    case "heading_1":
      return {
        type: "heading_1",
        text: richTextResponseToPlainText(block.heading_1.rich_text),
      };
    case "heading_2":
      return {
        type: "heading_2",
        text: richTextResponseToPlainText(block.heading_2.rich_text),
      };
    case "heading_3":
      return {
        type: "heading_3",
        text: richTextResponseToPlainText(block.heading_3.rich_text),
      };
    case "heading_4":
      return {
        type: "heading_4",
        text: richTextResponseToPlainText(block.heading_4.rich_text),
      };
    case "bulleted_list_item":
      return {
        type: "bulleted_list_item",
        text: richTextResponseToPlainText(block.bulleted_list_item.rich_text),
      };
    case "numbered_list_item":
      return {
        type: "numbered_list_item",
        text: richTextResponseToPlainText(block.numbered_list_item.rich_text),
      };
    case "quote":
      return {
        type: "quote",
        text: richTextResponseToPlainText(block.quote.rich_text),
      };
    case "code":
      return {
        type: "code",
        text: richTextResponseToPlainText(block.code.rich_text),
        language: block.code.language,
      };
    case "divider":
      return { type: "divider", text: "" };
    case "image": {
      let imageUrl: string;
      if (block.image.type === "external") {
        imageUrl = block.image.external.url;
      } else if (block.image.type === "file") {
        imageUrl = block.image.file.url;
      } else {
        return null;
      }
      return {
        type: "image",
        text: "",
        imageUrl,
        caption: richTextResponseToPlainText(block.image.caption),
      };
    }
    default:
      return null;
  }
}

export function fingerprintRequest(block: BlockObjectRequest): BlockFingerprint | null {
  switch (block.type) {
    case "paragraph":
      return {
        type: "paragraph",
        text: richTextRequestToPlainText(block.paragraph.rich_text),
      };
    case "heading_1":
      return {
        type: "heading_1",
        text: richTextRequestToPlainText(block.heading_1.rich_text),
      };
    case "heading_2":
      return {
        type: "heading_2",
        text: richTextRequestToPlainText(block.heading_2.rich_text),
      };
    case "heading_3":
      return {
        type: "heading_3",
        text: richTextRequestToPlainText(block.heading_3.rich_text),
      };
    case "heading_4":
      return {
        type: "heading_4",
        text: richTextRequestToPlainText(block.heading_4.rich_text),
      };
    case "bulleted_list_item":
      return {
        type: "bulleted_list_item",
        text: richTextRequestToPlainText(block.bulleted_list_item.rich_text),
      };
    case "numbered_list_item":
      return {
        type: "numbered_list_item",
        text: richTextRequestToPlainText(block.numbered_list_item.rich_text),
      };
    case "quote":
      return {
        type: "quote",
        text: richTextRequestToPlainText(block.quote.rich_text),
      };
    case "code":
      return {
        type: "code",
        text: richTextRequestToPlainText(block.code.rich_text),
        language: block.code.language,
      };
    case "divider":
      return { type: "divider", text: "" };
    case "image": {
      let imageUrl: string;
      if (block.image.type === "external") {
        imageUrl = block.image.external.url;
      } else if (block.image.type === "file_upload") {
        imageUrl = block.image.file_upload.id;
      } else {
        return null;
      }
      return {
        type: "image",
        text: "",
        imageUrl,
        caption: block.image.caption ? richTextRequestToPlainText(block.image.caption) : "",
      };
    }
    default:
      return null;
  }
}

function fingerprintsEqual(a: BlockFingerprint, b: BlockFingerprint): boolean {
  if (a.type !== b.type) return false;
  if (a.text !== b.text) return false;
  if (a.language !== b.language) return false;
  if (a.imageUrl !== b.imageUrl) return false;
  if (a.caption !== b.caption) return false;
  return true;
}

/**
 * Compute a Myers-like diff between current (remote) blocks and target (local) blocks.
 * Uses longest common subsequence on block fingerprints.
 */
export function diffBlocks(
  currentBlocks: BlockObjectResponse[],
  targetBlocks: BlockObjectRequest[],
): BlockDiffResult {
  const current = currentBlocks
    .map((b, i) => ({ index: i, fp: fingerprintResponse(b), blockId: b.id }))
    .filter((b): b is typeof b & { fp: BlockFingerprint } => b.fp !== null);

  const target = targetBlocks
    .map((b, i) => ({ index: i, fp: fingerprintRequest(b), block: b }))
    .filter((b): b is typeof b & { fp: BlockFingerprint } => b.fp !== null);

  const m = current.length;
  const n = target.length;

  // LCS dynamic programming table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (fingerprintsEqual(current[i].fp, target[j].fp)) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;

  while (i < m || j < n) {
    if (i < m && j < n && fingerprintsEqual(current[i].fp, target[j].fp)) {
      ops.push({
        action: "keep",
        currentIndex: current[i].index,
        targetIndex: target[j].index,
        blockId: current[i].blockId,
      });
      i++;
      j++;
    } else if (j < n && (i >= m || dp[i][j + 1] > dp[i + 1][j])) {
      ops.push({
        action: "add",
        targetIndex: target[j].index,
        newBlock: target[j].block,
      });
      j++;
    } else if (i < m) {
      ops.push({
        action: "remove",
        currentIndex: current[i].index,
        blockId: current[i].blockId,
      });
      i++;
    } else {
      // Should not happen, but handle defensively
      break;
    }
  }

  // Post-process: convert adjacent remove+add or add+remove pairs to update/replace
  const optimizedOps: DiffOp[] = [];
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    const nextOp = ops[k + 1];

    const isRemoveAdd = op.action === "remove" && nextOp?.action === "add";
    const isAddRemove = op.action === "add" && nextOp?.action === "remove";

    if (isRemoveAdd || isAddRemove) {
      const removeOp = isRemoveAdd ? op : nextOp;
      const addOp = isRemoveAdd ? nextOp : op;
      const curr = current.find((c) => c.index === (removeOp as Extract<DiffOp, { action: "remove" }>).currentIndex)!;
      const tgt = target.find((t) => t.index === (addOp as Extract<DiffOp, { action: "add" }>).targetIndex)!;
      const sameType = curr.fp.type === tgt.fp.type;

      if (sameType && isUpdateableType(curr.fp.type)) {
        optimizedOps.push({
          action: "update",
          currentIndex: curr.index,
          targetIndex: tgt.index,
          blockId: curr.blockId,
          newBlock: tgt.block,
        });
      } else {
        optimizedOps.push({
          action: "replace",
          currentIndex: curr.index,
          targetIndex: tgt.index,
          blockId: curr.blockId,
          newBlock: tgt.block,
        });
      }
      k++;
    } else {
      optimizedOps.push(op);
    }
  }

  const unchangedCount = optimizedOps.filter((o) => o.action === "keep").length;
  const updatedCount = optimizedOps.filter((o) => o.action === "update").length;
  const replacedCount = optimizedOps.filter((o) => o.action === "replace").length;
  const removedCount = optimizedOps.filter((o) => o.action === "remove").length;
  const addedCount = optimizedOps.filter((o) => o.action === "add").length;

  return {
    ops: optimizedOps,
    unchangedCount,
    updatedCount,
    replacedCount,
    removedCount,
    addedCount,
  };
}

function isUpdateableType(type: string): boolean {
  return [
    "paragraph",
    "heading_1",
    "heading_2",
    "heading_3",
    "heading_4",
    "bulleted_list_item",
    "numbered_list_item",
    "quote",
    "code",
    "divider",
  ].includes(type);
}

/**
 * Format a diff result as a human-readable string for CLI output.
 */
export function formatDiff(result: BlockDiffResult): string {
  const lines: string[] = [];
  for (const op of result.ops) {
    switch (op.action) {
      case "keep":
        lines.push(`  ${op.currentIndex + 1} → keep`);
        break;
      case "update":
        lines.push(`  ${op.currentIndex + 1} → update (same type, new content)`);
        break;
      case "replace":
        lines.push(`  ${op.currentIndex + 1} → replace (type or unupdateable content changed)`);
        break;
      case "remove":
        lines.push(`  ${op.currentIndex + 1} → remove`);
        break;
      case "add":
        lines.push(`    → add after line ${op.targetIndex}`);
        break;
    }
  }
  lines.push("");
  lines.push(
    `Summary: ${result.unchangedCount} kept, ${result.updatedCount} updated, ${result.replacedCount} replaced, ${result.removedCount} removed, ${result.addedCount} added`,
  );
  return lines.join("\n");
}
