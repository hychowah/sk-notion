// One-off: archive ALL top-level blocks of an arbitrary page (by ID argument).
// Used to clear a page that accumulated orphaned blocks a normal sync didn't remove.
import { loadConfig, assertNotionCredentials } from "../src/config";
import { createNotionClient } from "../src/notion/client";
import { archiveAllPageChildren } from "../src/notion/page";

async function main(): Promise<void> {
  const pageId = process.argv[2];
  if (!pageId) throw new Error("Usage: npx tsx scripts/clear-one-page.ts <pageId>");
  const config = loadConfig();
  assertNotionCredentials(config);
  const client = createNotionClient({
    notionToken: config.notionToken,
    notionApiVersion: config.notionApiVersion,
  });
  const archived = await archiveAllPageChildren(client, pageId);
  console.log(`Archived ${archived} top-level block(s) on ${pageId}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
