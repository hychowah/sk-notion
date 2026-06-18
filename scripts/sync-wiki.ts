import { existsSync } from "node:fs";
import path from "node:path";

import { loadConfig, resolveWikiContentRoot } from "../src/config";
import { createNotionClient, formatNotionError } from "../src/notion/client";
import { loadPageMap, syncWikiSection } from "../src/sync-wiki";

async function main(): Promise<void> {
  const config = loadConfig();
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const smart = args.includes("--smart");
  const syncAll = args.includes("--all");
  const sectionName = syncAll ? undefined : args.find((a) => !a.startsWith("-"));

  const wikiContentDirectory = resolveWikiContentRoot(config.wikiContentRoot);
  if (!existsSync(wikiContentDirectory)) {
    throw new Error(
      `Wiki content directory not found: ${wikiContentDirectory}\n` +
        `Set WIKI_CONTENT_ROOT in .env or create the directory.`,
    );
  }

  const pageMap = await loadPageMap(
    path.resolve(wikiContentDirectory, "page-map.json"),
  );

  if ((!sectionName && !syncAll)) {
    console.log("Usage: npx tsx scripts/sync-wiki.ts <section-name> [--dry-run] [--smart]");
    console.log("       npx tsx scripts/sync-wiki.ts --all [--dry-run] [--smart]");
    console.log("");
    console.log("Sections:");
    for (const [key, meta] of Object.entries(pageMap.sections)) {
      const type = meta.pageId === "root" ? "root" : "child";
      console.log(`  ${key.padEnd(25)} ${type}  (${meta.name})`);
    }
    console.log("");
    console.log("Examples:");
    console.log('  npx tsx scripts/sync-wiki.ts <section-name>');
    console.log('  npx tsx scripts/sync-wiki.ts <section-name> --dry-run');
    console.log('  npx tsx scripts/sync-wiki.ts --all');
    console.log('  npm run sync -- <section-name>');
    console.log('  npm run sync -- --all');
    process.exit(0);
  }

  const client = createNotionClient(config);

  const deps = {
    client,
    rootPageId: config.notionPageId,
    wikiContentDirectory,
    pageMap,
  };

  const sectionNames = syncAll
    ? Object.keys(pageMap.sections)
    : [sectionName!];

  let hadWarning = false;
  let hadError = false;

  for (const name of sectionNames) {
    try {
      const result = await syncWikiSection({ sectionName: name, dryRun, smart }, deps);

      if (dryRun) {
        console.log(`[DRY RUN] Would sync: ${result.sectionName}`);
        console.log(`  Title: ${result.title}`);
        console.log(`  Page:  ${result.pageId}`);
        console.log(`  Blocks: ~${result.appendedCount} headings + paragraphs/lists`);
      } else if (result.smartResult) {
        console.log(`Smart-synced: ${result.title}`);
        console.log(`  Kept ${result.smartResult.unchangedCount}, updated ${result.smartResult.updatedCount}, replaced ${result.smartResult.replacedCount}, deleted ${result.smartResult.deletedCount}, added ${result.smartResult.addedCount}.`);
        console.log(`  Page ID: ${result.pageId}`);
        console.log(`  URL:     ${result.url}`);
      } else {
        console.log(`Synced: ${result.title}`);
        console.log(`  Archived ${result.archivedCount} existing block(s).`);
        console.log(`  Appended ${result.appendedCount} new block(s).`);
        console.log(`  Page ID: ${result.pageId}`);
        console.log(`  URL:     ${result.url}`);
      }

      if (result.uploadedImages.length > 0) {
        for (const img of result.uploadedImages) {
          console.log(`  Uploaded: ${img}`);
        }
      }

      if (result.warnings.length > 0) {
        hadWarning = true;
        for (const warning of result.warnings) {
          console.log(`  Warning: ${warning}`);
        }
      }

      if (syncAll && name !== sectionNames[sectionNames.length - 1]) {
        console.log("");
      }
    } catch (err) {
      hadError = true;
      console.error(`Error syncing "${name}": ${formatNotionError(err)}`);
    }
  }

  if (hadError) {
    process.exit(1);
  }

  if (hadWarning) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(`Error: ${formatNotionError(err)}`);
  process.exit(1);
});
