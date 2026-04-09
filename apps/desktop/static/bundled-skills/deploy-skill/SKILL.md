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
- it reads the Nexu cloud API key from `~/.nexu/config.json`
- it stores submitted jobs in `~/.nexu/deploy-skill-jobs.json`
- it can either submit an existing zip or render a built-in template into a zip first
- it submits the resulting zip directly to the deploy server
- it emits a follow-up async payload so the final completion message is delivered later

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

The content file must be structured JSON with this exact frame:
- `title`: 2-10 characters
- `subtitle`: 15-30 characters and must include `牛马指数`, `/100`, and `—`
- `portraitId`: must be one of `portrait-1` through `portrait-7`
- `tags`: 1-8 strings, each 2-8 characters
- `metrics`: 4-6 items total
- `posterSpeciesEmoji`
- `posterSpeciesName`: 3-8 characters
- `posterSpeciesSub`: 5-8 characters
- `description`: 150-250 characters, no markdown, HTML, or newlines
- `qaCards`: 2-3 items
- `dialogs`: 3-6 items
- `ctaText`: must equal `⭐ 生成我的牛马锐评`
- `installText`: must equal `复制链接发给你的 nexu agent：https://github.com/nexu-io/roast-skill`

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
