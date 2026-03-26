---
id: 20260325-nexu-pal-issue-triage-automation
name: Nexu Pal Issue Triage Automation
status: designed
created: '2026-03-25'
---

## Overview

- 当前 nexu-pal issue 自动化现状见 `specs/current/nexu-pal.md`。
- 本 spec 用于在当前 nexu-pal 基础上实现一套新的 issue 分拣方案。
- 详细方案见 `./2026-03-25-github-issue-automation.md`。

注意：当前 nexu-pal 的自动打标签，只保留 bug 即可，去除 enhancement 和 help-wanted.

## Research

### Existing System

- The current `nexu-pal` automation is split across two GitHub Actions workflows: issue-opened runs first-time welcome plus issue processing, and issue-assigned removes the `needs-triage` label on assignment. Key wiring lives in `.github/workflows/nexu-pal-issue-opened.yml:3` and `.github/workflows/nexu-pal-issue-assigned.yml:3`.
- Issue preprocessing today is implemented in a standalone Node script that calls an OpenAI-compatible endpoint for language detection/translation and intent classification, then writes comments and labels through GitHub REST. Core flow lives in `scripts/nexu-pal/process-issue.mjs:132`, `scripts/nexu-pal/process-issue.mjs:172`, and `scripts/nexu-pal/process-issue.mjs:288`.
- The current classifier emits exactly one of `bug`, `enhancement`, or `help-wanted`; unassigned issues also get `needs-triage`. The allowed labels are defined in `scripts/nexu-pal/process-issue.mjs:177`, `scripts/nexu-pal/process-issue.mjs:269`, and `scripts/nexu-pal/process-issue.mjs:281`.
- Feishu issue/discussion notifications are handled by separate workflows and a shared webhook script; they currently notify on issue opened and discussion created, not on label-state transitions. Relevant files are `.github/workflows/feishu-issue-notify.yml:3`, `.github/workflows/feishu-discussion-notify.yml:3`, and `scripts/notify/feishu-notify.mjs:41`.
- Project-board Feishu notifications already use a richer workflow -> script -> GitHub API -> Feishu pattern with GitHub App auth and GraphQL enrichment. Relevant references are `.github/workflows/feishu-project-item-notify.yml:12` and `scripts/notify/feishu-project-notify.mjs:78`.
- Issue templates already collect structured inputs and apply default labels at creation time. Current templates are `.github/ISSUE_TEMPLATE/bug_report.yml:3`, `.github/ISSUE_TEMPLATE/feature_request.yml:3`, and `.github/ISSUE_TEMPLATE/improvement.yml:3`.

### Available Approaches

- **Keep GitHub Actions + standalone Node scripts:** extend the existing `nexu-pal` workflow family with additional triggers and script logic, following the current `.github/workflows/*` + `scripts/*` pattern already used for issue processing and Feishu notifications.
- **Add label-driven automation paths:** attach additional workflows to issue events and label changes so labels remain the state carrier for downstream actions, consistent with the change doc in `specs/change/20260325-nexu-pal-issue-triage-automation/2026-03-25-github-issue-automation.md:5`.
- **Add comment-command automation:** introduce an `issue_comment`-triggered workflow that parses `/triage ...` commands and mutates labels/comments/issues via GitHub API, matching the manual-operation model described in `specs/change/20260325-nexu-pal-issue-triage-automation/2026-03-25-github-issue-automation.md:83`.
- **Reuse existing Feishu notification path with new routing inputs:** keep webhook delivery in `scripts/notify/feishu-notify.mjs` or add a sibling notifier script, while changing trigger conditions and payload routing based on bug vs non-bug triage states.
- **Use issue-template completeness as a signal source:** rely on structured bug/feature/improvement fields and labels from GitHub issue forms as one of the inputs for completeness checks and early triage branching.

### Constraints & Dependencies

- The current change request explicitly says auto-labeling should keep only `bug` and remove automatic `enhancement` and `help-wanted`; current code still applies all three labels. Requirement note: `spec.md:14`; current implementation: `scripts/nexu-pal/process-issue.mjs:177` and `scripts/nexu-pal/process-issue.mjs:269`.
- The detailed change doc defines GitHub as the single source of truth, labels as the state machine, and comment commands as the intended manual entrypoint for PM triage actions. See `specs/change/20260325-nexu-pal-issue-triage-automation/2026-03-25-github-issue-automation.md:5`.
- Current nexu-pal workflows depend on GitHub App credentials plus OpenAI-compatible LLM credentials; Feishu notifications depend on the Feishu webhook secret. Current documented secrets are in `specs/current/nexu-pal.md:57`.
- Existing automation uses direct `fetch` calls in standalone Node scripts rather than shared internal libraries; no repository-local config file was found for label semantics.
- Current repo checks and contribution conventions still apply to any implementation path, including required validation commands and the rule against logging credentials. See `AGENTS.md` hard rules and required checks.
- No current workflow or script was found for `/triage accepted`, `/triage declined`, `/triage duplicated`, `possible-duplicate`, `needs-information`, or roadmap-hit handling; these appear only in the change docs today.

### Key References

- `specs/current/nexu-pal.md:5` - Current documented behavior, managed labels, secrets, and file map.
- `specs/change/20260325-nexu-pal-issue-triage-automation/2026-03-25-github-issue-automation.md:11` - Target label/state definitions and end-to-end workflow description.
- `.github/workflows/nexu-pal-issue-opened.yml:11` - Main issue-opened workflow and environment wiring for preprocessing.
- `scripts/nexu-pal/process-issue.mjs:132` - Translation flow for non-English issues.
- `scripts/nexu-pal/process-issue.mjs:172` - Current intent-classification prompt and label set.
- `scripts/nexu-pal/process-issue.mjs:281` - Current `needs-triage` addition logic.
- `.github/workflows/nexu-pal-issue-assigned.yml:11` - Assignment-triggered workflow.
- `scripts/nexu-pal/process-issue-assignment.mjs:40` - Current label-removal pattern for state transitions.
- `.github/workflows/feishu-issue-notify.yml:7` - Current issue-opened Feishu notification flow.
- `scripts/notify/feishu-project-notify.mjs:204` - Existing richer notification branching pattern with action-based card output.

## Design

### Chosen Approach

- Adopt a pragmatic phased design: keep the existing **GitHub Actions + standalone Node scripts** runtime model, but introduce a small triage pipeline shape so later phases can reuse the same decision flow.
- Phase 1 prioritizes a runnable `issue opened -> label only` path. Complex roadmap matching, duplicate matching, and `/triage` command execution are isolated into later phases.
- Feishu notification routing moves off the current `issue opened` timing and onto the `needs-triage` state transition so labels remain the main workflow state.
- Existing workflows do not need compatibility preservation during migration; the implementation can replace current workflows/scripts directly.

### Architecture Overview

```text
issues.opened
  -> workflow: nexu-pal-issue-opened
  -> script: process-issue-opened.mjs
  -> pipeline: evaluate triage plan
  -> executor: apply labels only

issues.labeled (needs-triage)
  -> workflow: nexu-pal-needs-triage-notify
  -> script: feishu-triage-notify.mjs
  -> route by labels: bug / non-bug webhook

issue_comment.created   [later phase]
  -> workflow: nexu-pal-triage-command
  -> script: process-triage-command.mjs
  -> permission check: write/admin only
  -> executor: apply triage:* transitions / close / comment
```

### System Structure

- **Workflow layer**: GitHub Actions triggers for `issues.opened`, `issues.labeled`, and later `issue_comment.created`.
- **Pipeline layer**: builds a `TriagePlan` from issue context and phase-enabled detectors.
- **Executor layer**: applies GitHub labels/comments/close actions for the current phase.
- **Adapter layer**: thin GitHub REST, LLM, roadmap matcher, duplicate detector, and Feishu webhook helpers.

### Interfaces / Contracts

- **`TriagePlan`**
  - `labelsToAdd: string[]`
  - `labelsToRemove: string[]`
  - `commentsToAdd: string[]`
  - `closeIssue: boolean`
  - `diagnostics: string[]`
- **Roadmap matcher**
  - Input: issue title/body/metadata
  - Output: `matched: boolean`, optional reference payload
  - Early phase behavior: stubbed no-op
- **Duplicate detector**
  - Input: issue title/body/metadata
  - Output: `matched: boolean`, optional candidate list
  - Early phase behavior: stubbed no-op
- **Command permission checker**
  - Input: repo + commenter login
  - Output: one of GitHub collaborator permission levels
  - Allowed values for execution: `write`, `admin`

### Data Flow

1. `issues.opened` workflow loads issue context and GitHub App token.
2. `process-issue-opened.mjs` computes a `TriagePlan` for opened issues.
3. Phase 1 executor applies labels only, with deterministic ordering.
4. When `needs-triage` is added, a separate workflow sends Feishu notification to bug or non-bug webhook.
5. Later, `/triage accepted|declined|duplicated` comment commands reuse the same executor style for label transitions, reply comments, and close actions.

### Implementation Steps

1. **Refactor issue-opened processing into a new entry script**
   - Replace the current monolithic opened flow with a new script dedicated to triage-plan generation for opened issues.
2. **Implement Phase 1 label-only executor**
   - Keep only `bug` as automatic classification output.
   - Add `needs-triage` when there is no assignee.
   - Keep roadmap and duplicate detection behind stub interfaces.
3. **Add label-driven Feishu notification workflow**
   - Trigger on `issues.labeled` when the added label is `needs-triage`.
   - Route to bug or non-bug webhook based on current issue labels.
4. **Keep roadmap and duplicate detection as stub-only in Phase 2**
   - Phase 2 keeps the detector interfaces and no-op behavior so the notification path can be validated independently.
5. **Add `/triage` comment command flow in a later phase**
   - Parse commands, verify permission, mutate labels, comment, and close issues where needed.
6. **Replace roadmap matcher with a real implementation in a later phase**
   - Real roadmap matching can be added without changing workflow entrypoints.
7. **Replace duplicate detector with a real implementation in a later phase**
   - Real duplicate matching can be added after the main opened + notify flow is stable.
8. **Add `needs-information` and re-entry handling in a later phase**
   - Handle incomplete issues, user follow-up, and re-running triage on the chosen edit/reopen path.
9. **Update current-state documentation after rollout**
   - Refresh `specs/current/nexu-pal.md` after the implemented workflow shape is finalized.

### Pseudocode: Opened Issue Flow

```text
main_opened_issue():
  ctx = readOpenedIssueEnv()

  roadmap = matchRoadmap(ctx.issue)
  duplicate = detectDuplicate(ctx.issue)
  bugSignal = classifyBugOnly(ctx.title, ctx.body)

  plan = new TriagePlan()

  if bugSignal is true:
    plan.labelsToAdd += ["bug"]

  if duplicate.matched is true:
    plan.labelsToAdd += ["possible-duplicate"]

  if ctx.assignee is empty and roadmap.matched is false:
    plan.labelsToAdd += ["needs-triage"]

  applyLabelsInOrder(plan.labelsToAdd)
```

### Pseudocode: Feishu Triage Routing

```text
on_issue_labeled(event):
  if event.label != "needs-triage":
    exit

  hasBug = currentIssueLabels contains "bug"
  webhook = hasBug ? FEISHU_BUG_WEBHOOK : FEISHU_NON_BUG_WEBHOOK
  payload = buildTriageCard(issue, hasBug)
  postWebhook(webhook, payload)
```

### Pseudocode: `/triage` Command Flow

```text
on_issue_comment(event):
  cmd = parseTriageCommand(event.comment.body)
  if cmd is null:
    exit

  permission = getCollaboratorPermission(repo, event.comment.user)
  if permission not in ["write", "admin"]:
    exit

  switch cmd.action:
    accepted:
      add "triage:accepted"
      remove "needs-triage"
      comment accepted message
    declined:
      add "triage:declined"
      remove "needs-triage"
      comment declined message
      close issue
    duplicated:
      add "triage:duplicated"
      remove "possible-duplicate"
      remove "needs-triage"
      comment duplicate message
      close issue
```

### File Structure

- **Modify**
  - `.github/workflows/nexu-pal-issue-opened.yml` - point issue-opened processing to the new entry script and remove Phase 1-unneeded envs.
  - `scripts/notify/feishu-notify.mjs` or replace with a sibling notifier - support label-driven triage cards and dual-webhook routing.
- **Create**
  - `scripts/nexu-pal/process-issue-opened.mjs` - opened-issue triage entrypoint.
  - `scripts/nexu-pal/lib/github-client.mjs` - shared GitHub helpers.
  - `scripts/nexu-pal/lib/triage-opened-engine.mjs` - plan generation logic.
  - `scripts/nexu-pal/lib/signals/roadmap-matcher.mjs` - roadmap matcher interface; stub initially.
  - `scripts/nexu-pal/lib/signals/duplicate-detector.mjs` - duplicate detector interface; stub initially.
  - `.github/workflows/nexu-pal-needs-triage-notify.yml` - label-triggered Feishu workflow.
  - `scripts/notify/feishu-triage-notify.mjs` - bug vs non-bug routing.
  - `.github/workflows/nexu-pal-triage-command.yml` - later-phase comment-command workflow.
  - `scripts/nexu-pal/process-triage-command.mjs` - later-phase command handler.
  - `scripts/nexu-pal/lib/permission-checker.mjs` - GitHub collaborator permission lookup.

### Edge Cases

- **Idempotency**: repeated labels or repeated command comments should behave as no-op where possible.
- **Ordering**: apply `bug` before `needs-triage` so label-triggered Feishu routing sees final issue labels.
- **Missing labels**: missing repo labels should fail clearly rather than silently skipping state transitions.
- **Unauthorized `/triage`**: ignore or exit cleanly without mutating issue state.
- **Webhook configuration**: bug/non-bug webhook secrets must be present before enabling the split-routing workflow.
- **Secret changes**: webhook secret renames can happen in-place in the phase that introduces dual-webhook routing; no compatibility layer is required.
- **Stub detectors**: roadmap and duplicate stub implementations must not block the main opened-issue path.
- **Race with assignment**: assignment-triggered removal of `needs-triage` may overlap with opened flow; label operations should remain safe if the label is already absent/present.
- **Issue vs PR comments**: `/triage` workflow should ignore pull request comments and non-command comments.
- **Re-entry behavior**: when `needs-information` is introduced, the design must define which events (`issues.edited`, `issues.reopened`, or both) re-run triage.

## Plan

- [x] Phase 1: Refactor issue-opened automation to a runnable label-only triage flow with bug-only auto-labeling and stubbed roadmap/duplicate detectors.
- [ ] Phase 2: Add `needs-triage`-driven Feishu dual-webhook routing while keeping roadmap and duplicate detection as stub-only no-op implementations.
- [ ] Phase 3: Stabilize the triage pipeline interfaces and executor behavior around the stubbed flow so later detectors can be swapped in without changing entrypoints.
- [ ] Phase 4: Add permission-gated `/triage accepted|declined|duplicated` command handling and complete the label-state-machine transitions.
- [ ] Phase 5: Replace the roadmap matcher stub with a real implementation.
- [ ] Phase 6: Replace the duplicate detector stub with a real implementation.
- [ ] Phase 7: Add `needs-information` handling and define the issue edit/reopen re-entry flow.

## Notes

### Implementation

- `.github/workflows/nexu-pal-issue-opened.yml` - switched issue-opened automation to the new Phase 1 entry script.
- `scripts/nexu-pal/process-issue-opened.mjs` - added the new opened-issue triage entrypoint.
- `scripts/nexu-pal/lib/github-client.mjs` - added shared GitHub issue helpers and ordered label application.
- `scripts/nexu-pal/lib/triage-opened-engine.mjs` - added `TriagePlan` generation with bug-only classification and `needs-triage` planning.
- `scripts/nexu-pal/lib/signals/roadmap-matcher.mjs` - added Phase 1 roadmap matcher stub.
- `scripts/nexu-pal/lib/signals/duplicate-detector.mjs` - added Phase 1 duplicate detector stub.
- Kept translation as an internal preprocessing step for classification quality, but removed translation comment and `ai-translated` output so Phase 1 stays label-only.
- Left the old `scripts/nexu-pal/process-issue.mjs` in place temporarily but detached from the workflow to avoid expanding Phase 1 scope into cleanup-only changes.

### Verification

- `node --check scripts/nexu-pal/lib/github-client.mjs && node --check scripts/nexu-pal/lib/triage-opened-engine.mjs && node --check scripts/nexu-pal/process-issue-opened.mjs` ✅
- `pnpm lint` ✅
- `pnpm test` ⚠️ failed due to pre-existing unrelated tests: `tests/desktop/skill-dir-watcher.test.ts` and `tests/desktop/openclaw-auth-profiles-writer.test.ts`.
- Manual implementation review confirmed Phase 1 now applies labels only, keeps auto-labeling to `bug`, and leaves roadmap/duplicate detection as no-op stubs.

<!-- Optional: Alternatives considered, open questions, etc. -->
