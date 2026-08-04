// One-off: print the first N and last M top-level block summaries of a page.
import { loadConfig, assertNotionCredentials } from "../src/config";
import { createNotionClient } from "../src/notion/client";
import { listAllBlockChildren } from "../src/notion/page";

function summarize(b: any): string {
  const t = b.type;
  const payload = b[t] ?? {};
  const text = (payload.rich_text ?? payload.caption ?? [])
    .map((r: any) => r.plain_text ?? "")
    .join("")
    .slice(0, 70);
  return `${t}${text ? ` | ${text}` : ""}`;
}

async function main(): Promise<void> {
  const pageId = process.argv[2];
  if (!pageId) throw new Error("Usage: npx tsx scripts/peek-page.ts <pageId>");
  const config = loadConfig();
  assertNotionCredentials(config);
  const client = createNotionClient({
    notionToken: config.notionToken,
    notionApiVersion: config.notionApiVersion,
  });
  const blocks = await listAllBlockChildren(client, pageId);
  console.log(`total top-level blocks: ${blocks.length}`);
  console.log("--- first 6 ---");
  blocks.slice(0, 6).forEach((b) => console.log(summarize(b)));
  console.log("--- last 3 ---");
  blocks.slice(-3).forEach((b) => console.log(summarize(b)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
