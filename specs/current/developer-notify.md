# developer-notify

Developer community notification flow that is independent from the existing `nexu-pal` and legacy Feishu notification paths.

## Workflows

| Workflow | Trigger | Script |
|----------|---------|--------|
| `Developer Issue Notification` | `issues: [opened]` | `scripts/notify/developer-notify.mjs` |
| `Developer Pull Request Notification` | `pull_request_target: [opened]` | `scripts/notify/developer-notify.mjs` |

## Behavior

### Issue notification

Runs on `issues: [opened]` via `.github/workflows/developer-issue-notify.yml`.

1. Creates a short-lived GitHub App token using `NEXU_PAL_APP_ID` and `NEXU_PAL_PRIVATE_KEY_PEM`.
2. Runs `scripts/notify/developer-notify.mjs` with `EVENT_KIND=issue`.
3. Skips notifications for `sentry[bot]`.
4. Checks whether the issue author is a member of the repository-owner organization; internal authors are skipped.
5. Broadcasts the developer-community issue card to all webhook URLs (comma-separated in `NOTIFY_DEVELOPER_FEISHU_WEBHOOK`).

### Pull request notification

Runs on `pull_request_target: [opened]` via `.github/workflows/developer-pr-notify.yml`.

1. Job runs only when `github.event.pull_request.head.repo.fork` is true.
2. Runs `scripts/notify/developer-notify.mjs` with `EVENT_KIND=pr`.
3. Skips notifications for `sentry[bot]`.
4. Broadcasts the external-contributor PR card to all webhook URLs (comma-separated in `NOTIFY_DEVELOPER_FEISHU_WEBHOOK`).

## Notification payloads

- `scripts/notify/developer-notify.mjs` is the single payload builder and delivery entrypoint for both developer issue and developer PR notifications.
- The script selects the payload by `EVENT_KIND` (`issue` or `pr`) and broadcasts a Feishu interactive card to all webhook URLs listed in `WEBHOOK_URL` (comma-separated). Delivery uses `Promise.allSettled` so a single group failure does not block others.
- Payload layout details are intentionally not documented here; treat the script as the source of truth for message structure.

## Safety and isolation

- Do not modify the existing `nexu-pal` workflow or the legacy Feishu issue/discussion/PR notification workflows.
- The new path only reuses GitHub App credentials for organization-member filtering; the Feishu webhook is dedicated to developer notifications.
- The PR flow remains metadata-only, continues to use `pull_request_target`, and does not execute PR code.
- All outbound links are restricted to `https://github.com/*` or fixed official documentation links.
- Webhook delivery validates not only the HTTP status but also the Feishu JSON `code/msg` response fields, so an HTTP 200 with a business-level failure is not treated as success.

## Secrets

| Secret | Purpose |
|--------|---------|
| `NOTIFY_DEVELOPER_FEISHU_WEBHOOK` | Comma-separated Feishu incoming webhook URLs for developer notifications (one per group) |
| `NEXU_PAL_APP_ID` | GitHub App ID used for issue-author org-membership filtering |
| `NEXU_PAL_PRIVATE_KEY_PEM` | GitHub App private key used for issue-author org-membership filtering |

## File map

```
.github/workflows/
  developer-issue-notify.yml
  developer-pr-notify.yml
scripts/notify/
  developer-notify.mjs
tests/notify/
  developer-notify.test.ts
```
