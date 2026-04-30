---
name: deploy-skill
description: "Deploy static websites to Cloudflare Pages. Use when a user wants to upload a zip bundle, publish it, and get a final live link later."
---

# deploy-skill

Deploy a zipped static website bundle to Cloudflare Pages through the remote deploy server.

Default production gateway:
- `https://deploy.nexu.io`

This skill is self-contained:
- it reads its own deploy server config from `~/.nexu/deploy-skill.json`
- it resolves the Nexu cloud API key using a multi-path fallback (see below)
- it stores submitted jobs in `~/.nexu/deploy-skill-jobs.json`
- it can either submit an existing zip or render a built-in template into a zip first
- it submits the resulting zip directly to the deploy server
- it emits a follow-up async payload so the final completion message is delivered later

### Nexu cloud credential lookup

The skill searches the following `config.json` locations in order and uses the
first one that contains a valid `desktop.cloud` section with `connected: true`
and a non-empty `apiKey`:

1. `{NEXU_HOME}/config.json` — respects an explicit `NEXU_HOME` env var, otherwise `~/.nexu/config.json`.
2. `~/Library/Application Support/@nexu/desktop/.nexu/config.json` — the real location used by the Nexu desktop app on macOS.
3. `~/.nexu/config.json` — legacy fallback (skipped if already covered by candidate 1).

Resolution rules:
- If a candidate file exists and has a `desktop.cloud` section, that file is authoritative — the skill either uses its `apiKey` or fails with a specific error for that file. It does **not** fall through to the next candidate in that case.
- If a candidate file is missing, or exists but has no `desktop.cloud` section at all, the skill moves on to the next candidate.
- If every candidate falls through, the skill fails with a "could not find a Nexu cloud configuration" error that lists every path it checked.

This means a user who has logged into the Nexu desktop app (which writes to candidate 2) will have their API key picked up automatically, even if the older `~/.nexu/config.json` is empty or legacy.

## Requirements

- Node.js 24+
- `baseUrl` configured in `~/.nexu/deploy-skill.json`
- a logged-in Nexu cloud account so `~/.nexu/config.json` contains `desktop.cloud.apiKey`

## Setup

The production deploy gateway for this skill is:
- `https://deploy.nexu.io`

Configure the deploy server base URL:

```bash
node scripts/deploy_skill.js setup --base-url https://deploy.nexu.io
```

Validate the setup:

```bash
node scripts/deploy_skill.js check
```

## Submit a Deploy

```bash
node scripts/deploy_skill.js submit \
  --zip /absolute/path/to/site.zip \
  --bot-id BOT_ID \
  --chat-id CHAT_ID \
  --chat-type channel \
  --channel slack \
  [--to DELIVERY_TARGET] \
  [--thread-id THREAD_ID] \
  [--account-id ACCOUNT_ID] \
  [--session-key SESSION_KEY] \
  [--user-id USER_ID]
```

On success, the command returns immediately and emits a `sessions_spawn` payload so the runtime can continue polling in the background.

## Submit a Template Candidate

The first built-in candidate template is `distill-campaign`.

```bash
node scripts/deploy_skill.js submit \
  --template-id distill-campaign \
  --content-file /absolute/path/to/content.json \
  --bot-id BOT_ID \
  --chat-id CHAT_ID \
  --chat-type channel \
  --channel slack \
  [--to DELIVERY_TARGET] \
  [--thread-id THREAD_ID] \
  [--account-id ACCOUNT_ID] \
  [--session-key SESSION_KEY] \
  [--user-id USER_ID]
```

The content file must be structured JSON with this exact frame. Each field maps to a specific slot in the rendered page layout — write content with the target slot in mind.

Left sidebar (identity panel):
- `title`: 2-10 characters — user's name / cyber-persona headline, shown in `.profile-name` under the avatar.
- `subtitle`: 15-30 characters and must include `牛马指数`, `/100`, and `—` — short signature line rendered as `.profile-sub` directly under the name. Example format: `牛马指数 92/100 — 龙虾成瘾者`.
- `portraitId`: must be one of `portrait-1` through `portrait-7` — chooses the avatar image shown in the sidebar AND on each `bot` chat bubble.
- `tags`: 1-8 strings, each 2-8 characters — rendered both as the social-tag chips in the sidebar and as the quick-reply prompt buttons in the chat card (first 4). Keep tags punchy, noun-like, suitable for both roles.

Right column (tabbed layout: 核心指标 / 深度扒皮 / 和我对话 / 技能文件):
- `metrics`: 4-6 items total. `metrics[0]` becomes the hero score card (big number + label) in the 核心指标 tab and also drives the poster overlay score; its `value` should be a bare integer (e.g. `"92"`, no `%`). `metrics[1..]` become the horizontal bar chart rows below the species card, each with an SVG icon and a percentage bar — their `value` should be a percentage string (e.g. `"88%"`).
- `posterSpeciesEmoji`: short emoji (1-4 chars) — shown in the species card next to the name and in the poster text overlay.
- `posterSpeciesName`: 3-8 characters — the "物种" name in the species card (e.g. `龙虾成瘾者`).
- `posterSpeciesSub`: 5-8 characters — small subtitle under the species name (e.g. `办公室物种鉴定`).
- `description`: 150-250 characters, no markdown, HTML, or newlines — the main roast paragraph rendered as `.roast-text` inside the 核心指标 tab, above the bar chart. Write it as one dense paragraph; the template does not support paragraph breaks here.
- `qaCards`: 2-3 items, each `{ question, answer }` — the 深度扒皮 tab. Each card gets a rotating icon (🔥 💪 💀 …). `question` is the title (short, label-style), `answer` is the body (1-3 sentences per card).
- `dialogs`: 3-6 items, each `{ speaker: "bot" | "user", text }` — the 和我对话 tab. The first message should usually be a `bot` intro. The template alternates bubbles and shows the avatar next to `bot` messages.
- `ctaText`: must equal `⭐ 生成我的牛马锐评` — shown in the "蒸馏完成度" progress header in the 技能文件 tab.
- `installText`: must equal `复制链接发给你的 nexu agent：https://github.com/nexu-io/roast-skill` — shown inside the copy-to-clipboard code block in the 技能文件 tab.

Poster (share modal):
- The template ships a static `assets/poster.png` artwork as the backdrop. The following fields are overlaid as text on top of the artwork: `title`, `subtitle`, `metrics[0].value`, `metrics[0].label`, and `posterSpeciesEmoji` + `posterSpeciesName`. There is no per-user image composition — the poster artwork is the same PNG for every user; only the text overlay changes.

If any field violates the frame, the skill rejects the payload and does not render. It never truncates, rewrites, or invents missing values.

Portrait rule:
- The agent must choose `portraitId` explicitly.
- The skill does not randomly pick a head portrait anymore.
- Any missing or unknown `portraitId` is rejected before rendering.

To restore unfinished jobs after a restart:

```bash
node scripts/deploy_skill.js recover
```

## Final Success Message

When the deploy finishes successfully, the async follow-up must tell the user exactly:

> Your website is ready, the link is {link}

## Mandatory Guard Checklist

This skill has a hard anti-hallucination rule. The model must verify each step before it can describe that step as successful.

Submit step checks:
- confirm `~/.nexu/deploy-skill.json` exists and contains a valid `baseUrl`
- confirm `~/.nexu/config.json` contains a connected Nexu cloud account with a non-empty API key
- confirm either the upload path exists and ends with `.zip`, or the template id is registered and the content file matches the template schema
- confirm submit sends `Authorization: Bearer <apiKey>` from the local Nexu config
- confirm the server response contains a real `jobId`
- confirm `taskType` is exactly `static-deploy`
- confirm `status` is exactly `queued` or `running`
- if a delivery target is available, confirm it is persisted as `to` in the local job record so later notification does not need to guess the recipient
- confirm the accepted job was persisted locally with the same `jobId` and `status`

Polling step checks:
- confirm the queried job already exists in `~/.nexu/deploy-skill-jobs.json`
- confirm polling sends the same `Authorization: Bearer <apiKey>` from the local Nexu config
- confirm the server response still references the same `jobId`
- confirm `status` is one of `queued`, `running`, `succeeded`, `failed`, or `cancelled`
- if `status` is `succeeded`, confirm `result.url` exists and ends with `.nexu.space` before generating any success message
- if `status` is `failed` or `cancelled`, relay the server error message and hint instead of inventing one
- if polling times out, only fall back to a temporary `.pages.dev` link when that link already exists in the persisted job record

Output rule:
- If any check fails, stop and return the explicit guard-check error.
- Never claim “deployment started” or “website is ready” until the matching guard checklist has passed.
- Timeout fallback message must be:
  `Your page has been deployed to the temporary domain {pagesDevLink}. If you cannot access this domain, you can retry deploy again.`

## Rules

- Never invent a job id, URL, or completion state.
- Never invent the delivery target. Persist the concrete `to` target when it is known.
- Never say the site is ready during submit.
- Always reject malformed server responses instead of guessing missing fields.
- Always use the local persisted job record for recovery and polling.
- If the server returns an explicit error message or hint, relay it instead of rewriting it.
