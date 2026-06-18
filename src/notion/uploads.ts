import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Client } from "@notionhq/client";
import mime from "mime-types";

import { withRateLimitRetry } from "./client";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".apng",
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".tif",
  ".tiff",
  ".webp",
]);

export type UploadedImage = {
  fileUploadId: string;
  filename: string;
  contentType: string;
  contentLength: number;
};

export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function assertSupportedRemoteImageUrl(imageUrl: string): void {
  let parsed: URL;

  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error(`Invalid image URL: ${imageUrl}`);
  }

  const extension = path.extname(parsed.pathname).toLowerCase();

  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(
      "Remote image URLs must point directly to a supported image file extension.",
    );
  }
}

export async function uploadImageFile(
  client: Client,
  filePath: string,
): Promise<UploadedImage> {
  const absolutePath = path.resolve(filePath);
  const fileStats = await stat(absolutePath);

  if (!fileStats.isFile()) {
    throw new Error(`Image path is not a file: ${absolutePath}`);
  }

  const filename = path.basename(absolutePath);
  const extension = path.extname(filename).toLowerCase();

  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported image file type: ${extension || "unknown"}`);
  }

  const contentType = mime.lookup(filename);

  if (typeof contentType !== "string" || !contentType.startsWith("image/")) {
    throw new Error(`Could not determine a valid image MIME type for ${filename}`);
  }

  const fileBuffer = await readFile(absolutePath);
  const createdUpload = await withRateLimitRetry(() =>
    client.fileUploads.create({
      mode: "single_part",
      filename,
      content_type: contentType,
    }),
  );

  const sentUpload = await withRateLimitRetry(() =>
    client.fileUploads.send({
      file_upload_id: createdUpload.id,
      file: {
        filename,
        data: new Blob([fileBuffer], { type: contentType }),
      },
    }),
  );

  if (sentUpload.status !== "uploaded") {
    throw new Error(`Upload did not complete successfully. Status: ${sentUpload.status}`);
  }

  return {
    fileUploadId: sentUpload.id,
    filename: sentUpload.filename ?? filename,
    contentType: sentUpload.content_type ?? contentType,
    contentLength: sentUpload.content_length ?? fileBuffer.byteLength,
  };
}