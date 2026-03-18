# Unsolved Problems: Composio Skill Content Quality

Date: 2026-03-10
Status: Open
Related: `apps/api/src/scripts/seed-composio-skills.ts`, `apps/api/src/scripts/fetch-composio-actions.ts`

---

## Problem 1: Critical user-facing actions are cut by the 15-action render cap

### What happens

Each SKILL.md lists a maximum of 15 actions in a detailed table. Actions are sorted by a basic priority heuristic (demoting `_ACL_`, `_WATCH`, `_BATCH_`, etc.) and then the first 15 are kept. However, within the default priority tier (priority 0), actions are still in the order returned by the Composio API (roughly alphabetical).

This means essential user-facing actions whose slugs come late alphabetically get cut.

### Evidence

| Toolkit | Total actions | Cut actions (examples) |
|---------|--------------|------------------------|
| Gmail (60) | 15 shown | `GMAIL_SEND_EMAIL`, `GMAIL_REPLY_TO_THREAD` — CUT |
| Slack (100) | 15 shown | `SLACK_SEND_MESSAGE`, `SLACK_CREATE_CHANNEL`, `SLACK_FIND_CHANNELS` — CUT |
| GitHub (100) | 15 shown | `CREATE_AN_ISSUE`, `CREATE_A_PULL_REQUEST`, `CREATE_A_FORK` — CUT |
| Notion (47) | 15 shown | `NOTION_SEARCH_NOTION_PAGE`, `NOTION_UPDATE_PAGE`, `NOTION_FETCH_DATA` — CUT |

### Impact

- The AI model reads only the SKILL.md to know which actions are available. If `GMAIL_SEND_EMAIL` is not listed, the model won't know it can send emails — the single most important Gmail action.
- Users ask "send an email" and the bot either fails or hallucinates an action name.

### Proposed fix directions

**Option A — Include ALL action slugs.** Remove the 15-cap entirely. List every action in the table. Downside: SKILL.md becomes very long (100 rows for Slack), consuming context budget.

**Option B — Two-tier format.** Keep the detailed table at 15 actions, but append a compact "All Available Actions" section listing every remaining slug as a bullet or comma-separated list. The model sees all valid names without the context cost of full descriptions.

**Option C — Better priority scoring.** Boost common CRUD verbs (`_SEND_`, `_CREATE_`, `_LIST_`, `_GET_`, `_UPDATE_`, `_DELETE_`, `_SEARCH_`, `_FIND_`, `_READ_`, `_FETCH_`) to highest priority so they always land in the top 15. Remaining actions still get cut.

**Option D — Per-toolkit curated lists.** Manually define the top 15 actions per toolkit in a static map. Most accurate but requires maintenance when Composio adds new actions.

**Recommended:** Option B + C combined. Better priority scoring ensures the detailed table has the right actions, and the compact slug list ensures the model knows every valid action name.

---

## Problem 2: Skill initialization content needs improvement

### What happens

When a user first tries to use a Composio toolkit (e.g. "send an email"), the bot needs to:

1. Attempt the action via `composio-exec.js`
2. Get a 403 response with a `connectUrl`
3. Present the authorization link to the user
4. Wait for the user to authorize
5. Retry the original action

The current SKILL.md has a "Handling Authorization Errors" section that explains this flow. However:

### Issues

1. **No proactive initialization guidance.** The SKILL.md doesn't tell the model to check connection status before attempting actions. The model always tries the action first, fails, then shows the link — adding an unnecessary round-trip and a confusing error message to the user.

2. **No "check status" command.** There's no way for the bot to check if a user is already connected without attempting an action. A lightweight `--check-status` flag on `composio-exec.js` could let the model proactively guide the user.

3. **First-use experience is reactive, not proactive.** When the model reads the SKILL.md for the first time (user says "connect my Gmail"), it should immediately know how to initiate the OAuth flow rather than having to fail an action first.

4. **Missing context about what happens after authorization.** The SKILL.md says "once connected, ask me again" but doesn't explain that the connection persists across sessions. Users may think they need to re-authorize every time.

### Proposed fix directions

**Option A — Add a `--check-status` flag** to `composio-exec.js` that calls a new lightweight API endpoint to check if the user has an active integration for a given toolkit. The SKILL.md would instruct the model to check status first before attempting actions.

**Option B — Add a "Getting Started" section** to SKILL.md that explicitly tells the model: "If the user wants to connect/setup/authorize {toolkit}, run the check-status command first. If not connected, present the authorization link proactively."

**Option C — Add a `--init` flag** that combines check-status + generate-connect-url in one call. Returns either `{"connected": true}` or `{"connected": false, "connectUrl": "..."}`.

**Recommended:** Option C (single `--init` command) + Option B (SKILL.md "Getting Started" section). This gives the model a clean path for both first-use and ongoing use.

---

## Implementation priority

Problem 1 (action curation) is **higher priority** — it directly causes action execution failures because the model doesn't know valid action names. Problem 2 (initialization UX) is a polish issue that makes first-use smoother but doesn't block functionality.
