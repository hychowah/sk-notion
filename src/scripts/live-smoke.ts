import assert from "node:assert/strict";

import { assertNotionCredentials, loadConfig } from "../config";
import { createNotionClient, formatNotionError } from "../notion/client";
import { assertDirectChildPage, getPage, getPageSummary } from "../notion/page";

async function main(): Promise<void> {
  const config = loadConfig();
  assertNotionCredentials(config);
  const client = createNotionClient({
    notionToken: config.notionToken,
    notionApiVersion: config.notionApiVersion,
  });
  const targetPageId = config.notionTestPageId ?? config.notionPageId;

  if (config.notionTestPageId) {
    const testPage = await getPage(client, config.notionTestPageId);
    assertDirectChildPage(testPage, config.notionPageId);
  }

  const summary = await getPageSummary(client, targetPageId);

  assert.equal(summary.id, targetPageId);
  assert.ok(summary.url.length > 0, "Expected the page URL to be present.");
  assert.ok(summary.title.length > 0, "Expected the page title to be present.");
  assert.ok(
    Number.isInteger(summary.topLevelBlockCount) && summary.topLevelBlockCount >= 0,
    "Expected a valid top-level block count.",
  );

  console.log("Live Notion smoke test passed.");
  console.log(`Mode: ${config.notionTestPageId ? "dedicated test child page" : "configured root page"}`);
  console.log(`Page: ${summary.title}`);
  console.log(`Top-level blocks: ${summary.topLevelBlockCount}`);
}

void main().catch((error) => {
  console.error(`Live Notion smoke test failed: ${formatNotionError(error)}`);
  process.exitCode = 1;
});