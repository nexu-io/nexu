---
name: feishu-feedback-to-github-project
description: Use when the user says things like "帮我整理把用户反馈日志整理到github 的project issue", wants to sync pending user feedback from the fixed Feishu Bitable view into GitHub issues, or wants Feishu feedback to flow into the GitHub Project automatically. This skill reads the fixed Bitable view, triages and deduplicates feedback against existing GitHub issues, creates only the engineering-worthy issues, applies project-routing labels, and relies on GitHub Project auto-add rules instead of PRs.
---

# Feishu Feedback To GitHub Project

This skill packages the standing workflow for Ashley's Nexu user-feedback triage.

## Fixed targets

- Feishu Bitable base: `IjTWbPUYlaaD6asCUf5crYPFnoc`
- Feishu table: `tbl2Yd8krZwfzFsS`
- Default pending view: `vewgOAhLMw`
- GitHub repo: `nexu-io/nexu`
- GitHub Project: `https://github.com/orgs/nexu-io/projects/3/views/1`

## When to use this skill

Use this skill when the user wants to:

- turn the fixed Feishu pending-feedback view into GitHub issues
- deduplicate pending feedback against existing `nexu-io/nexu` issues
- auto-route new issues into the GitHub Project via labels
- process screenshots first, then insert the cleaned items into the fixed Bitable before syncing

## Mandatory workflow

1. Read the pending items from the fixed Feishu Bitable view with `lark-cli`.
2. Normalize each item into: date, channel, reporter, priority, summary, raw feedback, handling, source doc.
3. Compare against existing `nexu-io/nexu` issues before creating anything.
4. Filter out items that should **not** become engineering issues:
   - clear duplicates of existing GitHub issues
   - FAQ / documentation / brand / pricing questions
   - vague entries with insufficient detail
5. Merge obviously overlapping items before creation when they represent the same product problem.
6. Create the final GitHub issues with routing labels:
   - `source:feishu`
   - `triage`
   - `priority:P0` / `priority:P1` / `priority:P2`
   - `bug` or `feedback`
7. Confirm that the GitHub Project should rely on `Auto-add to project`, not PRs.
8. Summarize what was created, what was skipped as duplicate, and what was redirected to FAQ / docs / product pool.

## Hard rules

- Do not create issues blindly from every row in the view.
- Do not use PRs to manage user-feedback intake.
- Do not treat the Feishu wiki page as the automation source of truth; the Bitable view is the source.
- Do not create duplicate issues when an existing issue already covers the same problem.
- Prefer `source:feishu` as the primary Project-routing label.
- If the project auto-add rule is not enabled yet, note that the issues may need manual Project insertion once.

## Bundled scripts

- `scripts/sync_feishu_bitable_to_github.py`
  - mechanical sync helper for Bitable -> GitHub issue creation
  - can run in dry-run mode or real mode
- `scripts/run_pending_feedback_to_project.sh`
  - wrapper for the fixed Bitable view / GitHub repo defaults

Use the scripts when the environment is already authenticated and the user wants the workflow executed, not just explained.

## Setup reference

Read `references/setup.md` when you need:

- required auth and tools
- the exact Project auto-add rule
- the standing triage policy for duplicates vs FAQ/docs vs engineering issues

## Example execution

```bash
bash {baseDir}/scripts/run_pending_feedback_to_project.sh
```

## Expected summary back to the user

Report these buckets:

1. new issues created
2. duplicates mapped to existing issue numbers
3. items held back as FAQ / docs / product-pool
4. whether the GitHub Project should auto-ingest them via `source:feishu`
