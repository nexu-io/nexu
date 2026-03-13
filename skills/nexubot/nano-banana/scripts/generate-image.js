#!/usr/bin/env node

/**
 * Generate or edit images using Gemini image models.
 * Requires: sharp (npm install sharp)
 *
 * Usage:
 *   node generate-image.js --prompt "a cat on mars" --filename output.png
 *   node generate-image.js --prompt "edit this" --filename out.png -i photo.png --model nano-banana-pro
 *   node generate-image.js --prompt "combine" --filename out.png -i a.png -i b.png -i c.png
 *
 * Models:
 *   nano-banana     → gemini-3.1-flash-image-preview (default, fast)
 *   nano-banana-pro → gemini-3-pro-image-preview (highest quality)
 *   nano-banana-2   → gemini-2.5-flash-image (legacy)
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_MAP = {
  "nano-banana": "gemini-3.1-flash-image-preview",
  "nano-banana-pro": "gemini-3-pro-image-preview",
  "nano-banana-2": "gemini-2.5-flash-image",
};

const VALID_MODELS = Object.keys(MODEL_MAP);
const RESOLUTIONS = ["1K", "2K", "4K"];
const MAX_INPUT_IMAGES = 14;
const MAX_IMAGE_BYTES = 512_000; // 500 KB per image after compression

const GENERATE_BASE_URL = "https://aiplatform.googleapis.com";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`Usage: node generate-image.js --prompt "desc" --filename "out.png" [options]

Options:
  -p, --prompt        Image description / editing instruction (required)
  -f, --filename      Output filename (required)
  -i, --input-image   Input image path(s) for editing (repeatable, max 14)
      --model         Model: nano-banana (default), nano-banana-pro, nano-banana-2
  -r, --resolution    Output resolution: 1K (default), 2K, 4K
      --aspect-ratio  Aspect ratio e.g. 1:1, 16:9, 4:3, 3:4, 9:16
  -h, --help          Show this help`);
}

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      prompt: { type: "string", short: "p" },
      filename: { type: "string", short: "f" },
      "input-image": { type: "string", short: "i", multiple: true },
      model: { type: "string", default: "nano-banana" },
      resolution: { type: "string", short: "r", default: "1K" },
      "aspect-ratio": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (!values.prompt) {
    console.error("Error: --prompt is required");
    process.exit(1);
  }
  if (!values.filename) {
    console.error("Error: --filename is required");
    process.exit(1);
  }
  if (!VALID_MODELS.includes(values.model)) {
    console.error(`Error: --model must be one of: ${VALID_MODELS.join(", ")}`);
    process.exit(1);
  }
  if (!RESOLUTIONS.includes(values.resolution)) {
    console.error(
      `Error: --resolution must be one of: ${RESOLUTIONS.join(", ")}`,
    );
    process.exit(1);
  }

  const inputImages = values["input-image"] || [];
  if (inputImages.length > MAX_INPUT_IMAGES) {
    console.error(
      `Error: Too many input images (${inputImages.length}). Maximum is ${MAX_INPUT_IMAGES}.`,
    );
    process.exit(1);
  }

  return {
    prompt: values.prompt,
    filename: values.filename,
    inputImages,
    model: values.model,
    resolution: values.resolution,
    aspectRatio: values["aspect-ratio"] ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveContextFile() {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);

  if (process.env.OPENCLAW_STATE_DIR) {
    const p = path.join(process.env.OPENCLAW_STATE_DIR, "nexu-context.json");
    if (fs.existsSync(p)) return p;
  }

  // Walk up from script dir: scripts/ → nano-banana/ → skills/ → stateDir/
  const stateDir = path.dirname(path.dirname(path.dirname(scriptDir)));
  const p = path.join(stateDir, "nexu-context.json");
  if (fs.existsSync(p)) return p;

  return null;
}

async function fetchApiKey() {
  // Tier 1: environment variable
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }

  // Tier 2: Nexu secrets API via SKILL_API_TOKEN + nexu-context.json
  const token = process.env.SKILL_API_TOKEN;
  const contextFile = resolveContextFile();

  if (token && contextFile) {
    try {
      const ctx = JSON.parse(fs.readFileSync(contextFile, "utf-8"));
      const { apiUrl, poolId } = ctx;
      if (apiUrl && poolId) {
        const url = `${apiUrl}/api/internal/secrets/nano-banana?poolId=${poolId}`;
        const res = await fetch(url, {
          headers: { "x-internal-token": token },
        });
        if (res.ok) {
          const secrets = await res.json();
          if (secrets.GEMINI_API_KEY) {
            return secrets.GEMINI_API_KEY;
          }
        }
      }
    } catch (err) {
      console.error(
        `Warning: Failed to fetch secret from Nexu API: ${err.message}`,
      );
    }
  }

  console.error(
    "Error: GEMINI_API_KEY not found.\n" +
      "Set it via:\n" +
      "  1. GEMINI_API_KEY environment variable, or\n" +
      "  2. Nexu pool secrets API (requires SKILL_API_TOKEN + nexu-context.json)",
  );
  process.exit(1);
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

// ---------------------------------------------------------------------------
// Image compression via sharp
// ---------------------------------------------------------------------------

// Use createRequire so NODE_PATH resolves globally-installed sharp
// (works in sandbox without a /node_modules symlink).
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);

let sharp;
try {
  sharp = _require("sharp");
} catch {
  // Not pre-installed — try auto-install (works outside sandbox where fs is writable).
  const { execSync } = await import("node:child_process");
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  console.log("Installing sharp (first run only)...");
  try {
    execSync("npm install --no-save sharp", {
      cwd: scriptDir,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    sharp = _require("sharp");
  } catch {
    console.error("ERROR: sharp is required but could not be installed.");
    process.exit(1);
  }
}

async function compressImage(buffer, maxBytes) {
  if (buffer.length <= maxBytes) {
    return buffer;
  }

  // Progressive JPEG quality reduction
  let quality = 85;
  let output = await sharp(buffer).jpeg({ quality }).toBuffer();

  while (output.length > maxBytes && quality > 10) {
    quality -= 10;
    output = await sharp(buffer).jpeg({ quality }).toBuffer();
  }

  // If still over limit, also resize dimensions
  if (output.length > maxBytes) {
    const meta = await sharp(buffer).metadata();
    if (meta.width) {
      const scale = Math.sqrt(maxBytes / output.length) * 0.9;
      const newWidth = Math.max(256, Math.round(meta.width * scale));
      output = await sharp(buffer)
        .resize(newWidth)
        .jpeg({ quality: Math.max(quality, 20) })
        .toBuffer();
    }
  }

  return output;
}

// ---------------------------------------------------------------------------
// Build request parts for input images (always inline base64)
// ---------------------------------------------------------------------------

async function buildImageParts(imagePaths) {
  if (imagePaths.length === 0) return [];

  const parts = [];
  for (const p of imagePaths) {
    const resolved = path.resolve(p);
    let buffer;
    try {
      buffer = fs.readFileSync(resolved);
    } catch (e) {
      console.error(`Error loading image '${resolved}': ${e.message}`);
      process.exit(1);
    }

    const originalSize = buffer.length;
    const compressed = await compressImage(buffer, MAX_IMAGE_BYTES);
    const mime = compressed === buffer ? mimeType(resolved) : "image/jpeg";

    if (compressed !== buffer) {
      console.log(
        `  Compressed ${path.basename(resolved)}: ${Math.round(originalSize / 1024)}KB → ${Math.round(compressed.length / 1024)}KB`,
      );
    }

    parts.push({
      inline_data: {
        data: compressed.toString("base64"),
        mime_type: mime,
      },
    });
  }

  console.log(`Prepared ${parts.length} image(s) as inline base64`);
  return parts;
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

async function generateImage(args, apiKey) {
  const modelId = MODEL_MAP[args.model];
  const url = `${GENERATE_BASE_URL}/v1/publishers/google/models/${modelId}:generateContent?key=${apiKey}`;

  const imageParts = await buildImageParts(args.inputImages);

  const contents = [
    {
      role: "user",
      parts: [...imageParts, { text: args.prompt }],
    },
  ];

  const generationConfig = {
    responseModalities: ["TEXT", "IMAGE"],
  };

  // Build imageConfig only if we have relevant settings
  const imageConfig = {};
  imageConfig.imageSize = args.resolution;
  if (args.aspectRatio) {
    imageConfig.aspectRatio = args.aspectRatio;
  }
  generationConfig.imageConfig = imageConfig;

  const body = { contents, generationConfig };

  const count = imageParts.length;
  if (count > 0) {
    console.log(
      `Processing ${count} image(s) with model=${args.model} resolution=${args.resolution}...`,
    );
  } else {
    console.log(
      `Generating image with model=${args.model} resolution=${args.resolution}...`,
    );
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Error from Gemini API (${res.status}): ${text}`);
    process.exit(1);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];

  // Absolute paths are used as-is; relative filenames go under
  // ~/.openclaw/workspace/output/nano-banana/ which is an allowed media root
  // (stateDir/workspace is in the default media local roots list).
  const stateDir =
    process.env.OPENCLAW_STATE_DIR ||
    path.join(process.env.HOME || process.env.USERPROFILE || "~", ".openclaw");
  const outputPath = path.isAbsolute(args.filename)
    ? args.filename
    : path.join(
        stateDir,
        "media",
        "outbound",
        path.basename(process.cwd()),
        "nano-banana",
        args.filename,
      );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  let imageSaved = false;

  for (const part of parts) {
    if (part.text) {
      console.log(`Model: ${part.text}`);
    } else if (part.inlineData) {
      const imageData = Buffer.from(part.inlineData.data, "base64");
      fs.writeFileSync(outputPath, imageData);
      imageSaved = true;
    }
  }

  if (imageSaved) {
    if (!fs.existsSync(outputPath)) {
      console.error(`Error: File was written but not found at ${outputPath}`);
      process.exit(1);
    }
    const stat = fs.statSync(outputPath);
    console.log(
      `Image saved: ${outputPath} (${Math.round(stat.size / 1024)}KB)`,
    );
    console.log(`MEDIA: ${outputPath}`);
  } else {
    console.error("Error: No image was generated in the response.");
    console.error(
      "The model may have returned only text. Try rephrasing your prompt.",
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseCliArgs();
const apiKey = await fetchApiKey();
await generateImage(args, apiKey);
