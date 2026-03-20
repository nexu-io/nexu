---
name: Nano Banana One Shop
description: All-in-one image generation with Gemini models. Supports Nano Banana (3.1 Flash), Nano Banana Pro (3 Pro), and Nano Banana 2 (2.5 Flash). Triggers on "generate image", "image generation", "nano banana", "edit image".
homepage: https://ai.google.dev/
metadata:
  {
    "openclaw":
      {
        "emoji": "🍌",
        "requires": { "bins": ["node"] },
      },
  }
---

# Nano Banana One Shop

All-in-one image generation and editing using the full Nano Banana model family. Pick the right model for the job.

## Models

| Flag | Model | Best for |
|------|-------|----------|
| `--model nano-banana` | Gemini 3.1 Flash Image | **Default.** Fast, balanced quality and cost. |
| `--model nano-banana-pro` | Gemini 3 Pro Image | Highest quality, up to 4K, slower. |
| `--model nano-banana-2` | Gemini 2.5 Flash Image | Speed-optimized, high-volume batch tasks. |

## Generate an image

```bash
node {baseDir}/scripts/generate-image.js --prompt "a cat sitting on mars" --filename "cat-on-mars.png"
```

## Use a specific model

```bash
node {baseDir}/scripts/generate-image.js --prompt "oil painting of a sunset" --filename "sunset.png" --model nano-banana-pro --resolution 4K
```

## Edit a single image

```bash
node {baseDir}/scripts/generate-image.js \
  --prompt "make the sky purple" \
  --filename "edited.png" \
  -i "/path/to/input.png" \
  --model nano-banana-pro
```

## Multi-image composition (up to 14 images)

```bash
node {baseDir}/scripts/generate-image.js \
  --prompt "combine these into a collage" \
  --filename "collage.png" \
  -i img1.png -i img2.png -i img3.png
```

## Options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--prompt` | `-p` | required | Image description or editing instruction |
| `--filename` | `-f` | required | Output filename |
| `--input-image` | `-i` | -- | Input image(s), repeatable, max 14 |
| `--model` | -- | `nano-banana` | `nano-banana`, `nano-banana-pro`, or `nano-banana-2` |
| `--resolution` | `-r` | `1K` | `1K`, `2K`, or `4K` |
| `--aspect-ratio` | -- | -- | e.g. `1:1`, `16:9`, `4:3`, `3:4`, `9:16` |

## API key

The API key is pre-configured on this machine. No flags or environment variables needed.

## Input image handling

All input images are sent as inline base64. Images over 500 KB are automatically compressed to JPEG and resized to fit under the limit. This keeps requests fast and avoids File API auth issues with the enterprise endpoint.

## Output

Relative filenames are saved to `$OPENCLAW_STATE_DIR/media/outbound/{slugid}/nano-banana/{filename}`. Absolute paths are used as-is. Use timestamps in filenames to avoid overwrites: `cat-on-mars-20260304-165000.png`.

## Sending images to the user

The script prints a `MEDIA: <absolute-path>` line on stdout. **You MUST include this exact MEDIA: line in your reply text** so the image is delivered as an attachment in Discord/Slack/chat.

Example reply:
```
Here's your image!
MEDIA: /Users/alche/.openclaw/media/outbound/my-bot/nano-banana/cat-on-mars.png
```

Rules:
- Copy the `MEDIA:` line from the script output into your reply verbatim
- Do NOT read the generated image back with the read tool
- Do NOT try to base64 encode or manually attach the image
- The `MEDIA:` line must be on its own line in your response
