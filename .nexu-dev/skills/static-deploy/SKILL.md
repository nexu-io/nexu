---
name: static-deploy
description: "Deploy static pages to nexu.space. Use when user says deploy, publish, ship, or go live with a static site/page. Uploads files from workspace to <project-slug>.nexu.space via Wrangler + Cloudflare Pages. Supports first deploy and redeploy."
---

# Static Deploy

Deploy static files to `<project-slug>.nexu.space` via Wrangler + Cloudflare Pages.

The deploy script stages a temporary copy of the site and injects a `_headers`
file (if needed) with cache revalidation rules for HTML/CSS/JS to reduce stale
asset issues after redeploys. Source files are not modified.

## What it deploys

Any static files: HTML, CSS, JS, images, fonts, etc. Common use cases:
- Single-page apps (React, Vue, etc. — deploy the `dist/` or `build/` folder)
- Landing pages, portfolios, documentation sites
- Quick prototypes or demos
- Any folder with an `index.html`

## Usage

1. Identify the directory containing files to deploy (must have an `index.html`)
2. Derive a project-slug from context (e.g., "family budget" → `family-budget`)
   - Lowercase alphanumeric + hyphens only, max 63 characters
   - Reuse the same slug for redeployments
   - Ask user to confirm if ambiguous
3. Run the deploy script:

```bash
"$SKILL_DIR/scripts/deploy.sh" <project-slug> <directory>
```

4. Parse the JSON output and report to user:
   - Brief summary of what was deployed
   - Live URL from the `url` field
   - **Important:** Tell the user that Cloudflare Pages propagation takes ~3 minutes. The URL may not work immediately after the first deploy. For redeployments, it's usually faster.

## Example reply

> Deployed! Your site is live at https://family-budget.nexu.space
>
> Note: First-time deploys take ~3 minutes to propagate on Cloudflare. If you see a "not found" page, wait a few minutes and refresh.

## Rules

- Never read, echo, or log `SKILL_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, or `CLOUDFLARE_ACCOUNT_ID`
- Never pass credentials as command arguments
- Always use the bundled `deploy.sh` — do not call Cloudflare API directly
- Do not set `DEPLOY_BACKEND` or any other env overrides — the script handles everything
- Do not hand-edit source files just to add cache-busting query params; the deploy script handles cache revalidation via a staged `_headers` file
- If the script fails, show the `message` field from the JSON error to the user
- Cloudflare credentials are fetched at runtime via the scoped secrets API using `SKILL_API_TOKEN` from env — do not attempt to read or inject them manually

## Output Format

Success:
```json
{
  "status": "success",
  "url": "https://<slug>.nexu.space",
  "deployment_url": "https://<id>.<slug>.pages.dev",
  "files_total": 10,
  "files_uploaded": 2,
  "files_cached": 8
}
```

Error:
```json
{
  "status": "error",
  "message": "Description of what went wrong"
}
```
