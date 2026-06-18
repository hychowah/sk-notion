import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import { loadConfig, resolveWikiContentRoot } from "../src/config";
import { loadPageMap } from "../src/sync-wiki";

async function main(): Promise<void> {
  const config = loadConfig();
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

  let errors = 0;
  let warnings = 0;

  for (const [key, section] of Object.entries(pageMap.sections)) {
    const filePath = path.resolve(wikiContentDirectory, section.file);
    try {
      await access(filePath);
    } catch {
      errors++;
      console.error(`ERROR: Section "${key}" maps to "${section.file}", but that file does not exist.`);
    }
  }

  // Walk wiki-content to find index.md files not in the map
  const { glob } = await import("node:fs/promises");
  // Simple recursive scan
  const { readdir } = await import("node:fs/promises");
  async function scan(dir: string, relative: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await scan(path.join(dir, entry.name), path.join(relative, entry.name));
      } else if (entry.name === "index.md" && relative !== "") {
        const relPath = path.join(relative, entry.name).replace(/\\/g, "/");
        const found = Object.values(pageMap.sections).some((s) => s.file === relPath);
        if (!found) {
          warnings++;
          console.warn(`WARNING: "${relPath}" exists on disk but is not registered in page-map.json.`);
        }
      }
    }
  }

  await scan(wikiContentDirectory, "");

  if (errors === 0 && warnings === 0) {
    console.log("Wiki content is valid. All sections are registered and all files exist.");
    process.exit(0);
  }

  if (errors > 0) {
    console.error(`\n${errors} error(s), ${warnings} warning(s).`);
    process.exit(1);
  }

  console.warn(`\n${errors} error(s), ${warnings} warning(s).`);
  process.exit(2);
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
