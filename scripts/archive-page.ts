// One-off: archive (trash) a Notion page by ID. Use when a wiki section is removed.
import { loadConfig, assertNotionCredentials } from "../src/config";
import { createNotionClient } from "../src/notion/client";

async function main(): Promise<void> {
  const pageId = process.argv[2];
  if (!pageId) throw new Error("Usage: npx tsx scripts/archive-page.ts <pageId>");
  const config = loadConfig();
  assertNotionCredentials(config);
  const client = createNotionClient({
    notionToken: config.notionToken,
    notionApiVersion: config.notionApiVersion,
  });
  await client.pages.update({ page_id: pageId, in_trash: true } as never);
  console.log(`Moved page ${pageId} to trash.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
