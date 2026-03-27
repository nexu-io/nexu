# nexu-pal

GitHub issue/discussion automation around **nexu-pal** issue processing and Feishu notifications.

## Workflows

| Workflow | Trigger | Script |
|----------|---------|--------|
| `nexu-pal: issue opened` | `issues: [opened]` | `scripts/nexu-pal/process-issue-opened.mjs` |
| `nexu-pal: triage command` | `issue_comment: [created]` (issues only) | `scripts/nexu-pal/process-triage-command.mjs` |
| `Feishu Issue Notification` | `issues: [opened]` | `scripts/notify/feishu-notify.mjs` |
| `nexu-pal: needs-triage notify` | `issues: [labeled]` (when label is `needs-triage`) | `scripts/notify/feishu-triage-notify.mjs` |
| `Feishu Discussion Notification` | `discussion: [created]` | `scripts/notify/feishu-notify.mjs` |

## On issue opened

Runs in order:

1. **First-time contributor welcome** — Uses `actions/first-interaction@v3`. If the author has never opened an issue in this repo before, posts a welcome comment.

2. **Language detection & translation** — Sends the issue title and body to an LLM (`google/gemini-2.5-flash` via OpenRouter). If the content is primarily non-English, posts a comment with the English translation, adds the `ai-translated` label, and uses the English translation internally for downstream classification.

3. **Intent classification** — Sends the normalized English title and body to the LLM and assigns only the `bug` label when the issue clearly describes broken behavior.

4. **Internal-member short-circuit** — If `issue.author_association` is `MEMBER` or `OWNER`, the opened-issue flow stops after translation + bug classification. Internal issues skip known-issue matching, completeness checks, and `needs-triage` labeling.

5. **Completeness check** — For non-internal authors, uses the LLM to decide whether the issue is too incomplete to continue triage. If so, adds `needs-information`, posts a follow-up comment, and pauses there.

6. **Triage label** — For non-internal authors, if the issue is not roadmap-matched and does not need more information, adds the `needs-triage` label.

The opened-issue flow is split into a small pipeline:

- `process-issue-opened.mjs` is the workflow entrypoint.
- `lib/triage-opened-engine.mjs` builds a stable `TriagePlan` shape.
- `lib/github-client.mjs` executes the plan.

Current Phase 3 behavior keeps roadmap and duplicate detection as no-op stubs, but the shared `TriagePlan` / executor contract already supports:

- `commentsToAdd`
- `labelsToAdd`
- `labelsToRemove`
- `closeIssue`

## On `/triage` issue comment

Runs on `issue_comment: [created]` for issues only.

1. **Command parsing** — Supports `/triage accepted`, `/triage declined`, and `/triage duplicated`.
2. **Permission check** — Looks up collaborator permission through the GitHub API and only executes for `write` or `admin` users.
3. **State transition** — Applies the resulting `TriagePlan` via the shared GitHub issue client, using the GitHub App token so all mutations are authored by the app.

Current transitions:

- `/triage accepted` — add `triage:accepted`, remove `needs-triage` / `needs-information`, add acceptance comment.
- `/triage declined` — add `triage:declined`, remove `needs-triage` / `needs-information`, add decline comment, close the issue.
- `/triage duplicated` — add `triage:duplicated`, remove `needs-triage` / `needs-information` / `possible-duplicate`, add duplicate comment, close the issue.

## Feishu notifications

Three GitHub Actions send Feishu webhook notifications for GitHub content:

1. **Issue notification** — On `issues: [opened]`, sends the existing issue card to the legacy webhook without changing the current chain.
2. **Needs-triage issue notification** — On `issues: [labeled]`, when the added label is `needs-triage`, sends a triage card to either the bug or non-bug webhook based on the issue's current labels. The workflow maps GitHub secrets to internal env vars `BUG_WEBHOOK` and `REQ_WEBHOOK`.
3. **Discussion notification** — On `discussion: [created]`, sends the existing discussion card format using the discussion category in place of labels.

The legacy issue/discussion workflows continue to run `node scripts/notify/feishu-notify.mjs`. The new triage workflow runs `node scripts/notify/feishu-triage-notify.mjs`.

## Labels managed

| Label | Added when | Removed when |
|-------|-----------|--------------|
| `ai-translated` | Non-English issue detected and translated into a public comment | — |
| `bug` | LLM classifies as bug | — |
| `needs-information` | LLM determines the issue is too incomplete to continue triage | `/triage *` terminal transitions for manual override; automatic re-entry is not implemented yet |
| `needs-triage` | Issue opened, not roadmap-matched, and complete enough for manual triage | `/triage *` terminal transitions |
| `triage:accepted` | `/triage accepted` by a `write` / `admin` collaborator | superseded by a later `/triage` terminal action |
| `triage:declined` | `/triage declined` by a `write` / `admin` collaborator | superseded by a later `/triage` terminal action |
| `triage:duplicated` | `/triage duplicated` by a `write` / `admin` collaborator | superseded by a later `/triage` terminal action |

## Authentication

The three **nexu-pal** workflows create a short-lived token via `actions/create-github-app-token@v1` using secrets `NEXU_PAL_APP_ID` and `NEXU_PAL_PRIVATE_KEY_PEM`. All GitHub API calls and the first-interaction action use this App token.

The Feishu notification workflows do not use the GitHub App. They use the default GitHub Actions context plus Feishu incoming-webhook secrets.

## Secrets

| Secret | Purpose |
|--------|---------|
| `NEXU_PAL_APP_ID` | GitHub App ID |
| `NEXU_PAL_PRIVATE_KEY_PEM` | GitHub App private key |
| `OPENAI_BASE_URL` | OpenRouter base URL |
| `OPENAI_API_KEY` | OpenRouter API key |
| `ISSUE_SYNC_FEISHU_BOT_WEBHOOK` | Feishu incoming webhook URL for the existing issue-opened and discussion notifications |
| `ISSUE_TRIAGE_BUG_FEISHU_WEBHOOK` | Feishu incoming webhook URL for bug triage notifications |
| `ISSUE_TRIAGE_REQ_FEISHU_WEBHOOK` | Feishu incoming webhook URL for non-bug triage notifications |

## File map

```
.github/workflows/
  nexu-pal-issue-opened.yml
  nexu-pal-triage-command.yml
  feishu-issue-notify.yml
  nexu-pal-needs-triage-notify.yml
  feishu-discussion-notify.yml
scripts/nexu-pal/
  process-issue-opened.mjs # opened-issue triage pipeline with bug-only labeling + needs-information pause
  process-triage-command.mjs    # parse /triage comments, check permission, and apply terminal transitions
  lib/github-client.mjs         # shared GitHub issue executor for comments/labels/close actions
  lib/permission-checker.mjs    # collaborator permission lookup for command gating
  lib/triage-opened-engine.mjs  # builds the stable opened-issue TriagePlan
  lib/triage-command-engine.mjs # parses /triage commands and builds terminal triage plans
  lib/signals/roadmap-matcher.mjs     # roadmap matcher stub
  lib/signals/duplicate-detector.mjs  # duplicate detector stub
scripts/notify/
  feishu-triage-notify.mjs # route needs-triage issue notifications via BUG_WEBHOOK / REQ_WEBHOOK
  feishu-notify.mjs        # legacy issue-opened and discussion Feishu webhook card notification
```
