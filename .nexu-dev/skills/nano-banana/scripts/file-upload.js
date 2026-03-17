#!/usr/bin/env node

/**
 * Upload files to Gemini Files API.
 *
 * Usage:
 *   node file-upload.js <file-path> [--name "display name"]
 *   node file-upload.js --list
 *   node file-upload.js --delete files/abc-123
 *
 * Requires: GEMINI_API_KEY env var
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const BASE_URL = "https://generativelanguage.googleapis.com";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    options: {
      name: { type: "string", short: "n" },
      list: { type: "boolean", short: "l" },
      delete: { type: "string", short: "d" },
      get: { type: "string", short: "g" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help) {
    console.log(`Usage:
  node file-upload.js <file-path> [--name "display name"]   Upload a file
  node file-upload.js --list                                 List uploaded files
  node file-upload.js --get files/abc-123                    Get file info
  node file-upload.js --delete files/abc-123                 Delete a file

Env: GEMINI_API_KEY (required)`);
    process.exit(0);
  }

  return { ...values, filePath: positionals[0] };
}

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("Error: GEMINI_API_KEY environment variable is required");
    process.exit(1);
  }
  return key;
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".mp3": "audio/mp3",
    ".wav": "audio/wav",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".json": "application/json",
    ".csv": "text/csv",
  };
  return types[ext] || "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Upload (resumable protocol)
// ---------------------------------------------------------------------------

async function uploadFile(filePath, displayName, apiKey) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: File not found: ${resolved}`);
    process.exit(1);
  }

  const fileBytes = fs.readFileSync(resolved);
  const mime = mimeType(resolved);
  const name = displayName || path.basename(resolved);

  console.log(
    `Uploading ${name} (${mime}, ${Math.round(fileBytes.length / 1024)}KB)...`,
  );

  // Step 1: Start resumable upload
  const startRes = await fetch(`${BASE_URL}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(fileBytes.length),
      "X-Goog-Upload-Header-Content-Type": mime,
    },
    body: JSON.stringify({ file: { display_name: name } }),
  });

  if (!startRes.ok) {
    const text = await startRes.text();
    console.error(`Error starting upload (${startRes.status}): ${text}`);
    process.exit(1);
  }

  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    console.error("Error: No upload URL returned");
    process.exit(1);
  }

  // Step 2: Upload file bytes
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(fileBytes.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: fileBytes,
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    console.error(`Error uploading file (${uploadRes.status}): ${text}`);
    process.exit(1);
  }

  const result = await uploadRes.json();
  const file = result.file;

  console.log("\nUpload complete!");
  console.log(`  Name:    ${file.name}`);
  console.log(`  URI:     ${file.uri}`);
  console.log(`  MIME:    ${file.mimeType}`);
  console.log(`  Size:    ${Math.round(Number(file.sizeBytes) / 1024)}KB`);
  console.log(`  State:   ${file.state}`);
  console.log(`  Expires: ${file.expirationTime}`);

  return file;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

async function listFiles(apiKey) {
  const res = await fetch(`${BASE_URL}/v1beta/files?pageSize=100`, {
    headers: { "x-goog-api-key": apiKey },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Error listing files (${res.status}): ${text}`);
    process.exit(1);
  }

  const data = await res.json();
  const files = data.files || [];

  if (files.length === 0) {
    console.log("No files uploaded.");
    return;
  }

  console.log(`${files.length} file(s):\n`);
  for (const f of files) {
    const size = f.sizeBytes
      ? `${Math.round(Number(f.sizeBytes) / 1024)}KB`
      : "?";
    console.log(
      `  ${f.name}  ${f.displayName}  ${f.mimeType}  ${size}  ${f.state}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

async function getFile(name, apiKey) {
  const res = await fetch(`${BASE_URL}/v1beta/${name}`, {
    headers: { "x-goog-api-key": apiKey },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Error getting file (${res.status}): ${text}`);
    process.exit(1);
  }

  const file = await res.json();
  console.log(JSON.stringify(file, null, 2));
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

async function deleteFile(name, apiKey) {
  const res = await fetch(`${BASE_URL}/v1beta/${name}`, {
    method: "DELETE",
    headers: { "x-goog-api-key": apiKey },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Error deleting file (${res.status}): ${text}`);
    process.exit(1);
  }

  console.log(`Deleted: ${name}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseCliArgs();
const apiKey = getApiKey();

if (args.list) {
  await listFiles(apiKey);
} else if (args.get) {
  await getFile(args.get, apiKey);
} else if (args.delete) {
  await deleteFile(args.delete, apiKey);
} else if (args.filePath) {
  await uploadFile(args.filePath, args.name, apiKey);
} else {
  console.error("Error: Provide a file path, or use --list / --get / --delete");
  process.exit(1);
}
