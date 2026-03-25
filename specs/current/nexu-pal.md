# nexu-pal

GitHub issue/discussion automation around **nexu-pal** issue processing and Feishu notifications.

## Workflows

| Workflow | Trigger | Script |
|----------|---------|--------|
| `nexu-pal: issue opened` | `issues: [opened]` | `scripts/nexu-pal/process-issue.mjs` |
| `nexu-pal: issue assigned` | `issues: [assigned]` | `scripts/nexu-pal/process-issue-assignment.mjs` |
| `Feishu Issue Notification` | `issues: [opened]` | `scripts/notify/feishu-notify.mjs` |
| `Feishu Discussion Notification` | `discussion: [created]` | `scripts/notify/feishu-notify.mjs` |

## On issue opened

Runs in order:

1. **First-time contributor welcome** — Uses `actions/first-interaction@v3`. If the author has never opened an issue in this repo before, posts a welcome comment.

2. **Language detection & translation** — Sends the issue title and body to an LLM (`google/gemini-2.5-flash` via OpenRouter). If the content is primarily non-English, posts a comment with the English translation and adds the `ai-translated` label.

3. **Intent classification** — Sends the (English) title and body to the LLM and assigns one label: `bug`, `enhancement`, or `help-wanted`.

4. **Triage label** — If the issue has no assignee, adds the `needs-triage` label.

## On issue assigned

Removes the `needs-triage` label (no-op if the label is already absent).

## Feishu notifications

Two separate GitHub Actions send Feishu webhook notifications for newly created GitHub content:

1. **Issue notification** — On `issues: [opened]`, sends an interactive Feishu card with repo, issue number, title, author, labels, body snippet, and a link to the issue.
2. **Discussion notification** — On `discussion: [created]`, sends the same card format using the discussion category in place of labels.

Both workflows sparse-checkout `scripts/notify` and run `node scripts/notify/feishu-notify.mjs`.

## Labels managed

| Label | Added when | Removed when |
|-------|-----------|--------------|
| `ai-translated` | Non-English issue detected | — |
| `bug` | LLM classifies as bug | — |
| `enhancement` | LLM classifies as feature request | — |
| `help-wanted` | LLM classifies as help/usage question | — |
| `needs-triage` | Issue opened with no assignee | Issue is assigned |

## Authentication

The two **nexu-pal** workflows create a short-lived token via `actions/create-github-app-token@v1` using secrets `NEXU_PAL_APP_ID` and `NEXU_PAL_PRIVATE_KEY_PEM`. All GitHub API calls and the first-interaction action use this App token.

The two Feishu notification workflows do not use the GitHub App. They use the default GitHub Actions context plus a Feishu incoming-webhook secret.

## Secrets

| Secret | Purpose |
|--------|---------|
| `NEXU_PAL_APP_ID` | GitHub App ID |
| `NEXU_PAL_PRIVATE_KEY_PEM` | GitHub App private key |
| `OPENAI_BASE_URL` | OpenRouter base URL |
| `OPENAI_API_KEY` | OpenRouter API key |
| `ISSUE_SYNC_FEISHU_BOT_WEBHOOK` | Feishu bot incoming webhook URL |

## File map

```
.github/workflows/
  nexu-pal-issue-opened.yml
  nexu-pal-issue-assigned.yml
  feishu-issue-notify.yml
  feishu-discussion-notify.yml
scripts/nexu-pal/
  process-issue.mjs        # translation, classification, needs-triage
  process-issue-assignment.mjs  # remove needs-triage on assignment
scripts/notify/
  feishu-notify.mjs        # issue/discussion Feishu webhook card notification
```
