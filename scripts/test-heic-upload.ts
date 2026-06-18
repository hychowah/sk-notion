import { loadConfig } from "../src/config.js";
import { createNotionClient } from "../src/notion/client.js";
import { uploadImageFile } from "../src/notion/uploads.js";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: tsx scripts/test-heic-upload.ts <path-to-image.heic>");
    process.exit(1);
  }

  const config = loadConfig();
  const client = createNotionClient(config);
  try {
    const result = await uploadImageFile(client, filePath);
    console.log("Uploaded:", result.filename, result.fileUploadId, result.contentType);
  } catch (err) {
    console.error("Upload failed:", err);
  }
}

main();
