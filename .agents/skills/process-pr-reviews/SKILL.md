---
name: process-pr-reviews
description: Use when the user asks to process, triage, fetch, view, count, list, or resolve review feedback in a GitHub PR. Supports both CodeRabbit and Codex review workflows. In this workflow, “real review feedback” is strictly defined as actionable inline comments; for CodeRabbit, exclude review summaries and nitpicks, and for Codex, exclude review summary cards and use PR main-thread reactions only as status signals.
---

# Process PR Reviews

This workflow supports both CodeRabbit and Codex PR review signals.

## CodeRabbit Reviews

“Real review feedback” is strictly defined as:

- **inline review comments**
- **not** a review summary
- **not** a nitpick

Nitpick comments from CodeRabbit must always be ignored to avoid unnecessary noise.

There is no need to analyze the comment content itself.

### Data sources

The CodeRabbit workflow only needs these two sources:

1. **PR review comments**

   ```bash
   gh api --paginate repos/<owner>/<repo>/pulls/<pr_number>/comments
   ```

   This is the authoritative source for real inline comments.

2. **PR reviews**

   ```bash
   gh api --paginate repos/<owner>/<repo>/pulls/<pr_number>/reviews
   ```

   This is only used to identify and exclude review summaries / nitpick summaries. It is not used to extract the final result.

Do not treat these as primary sources:

- `gh pr view ...`
- `gh api repos/<owner>/<repo>/issues/<pr_number>/comments`

Reason: they are not the authoritative source for actionable inline comments.

### Workflow

#### 0. Optional: fetch review thread IDs early if resolve/dismiss may be needed

If the user may ask you to resolve review conversations after triaging them, fetch review thread IDs as soon as you know the PR number:

```bash
gh api graphql -f query='query { repository(owner: "<owner>", name: "<repo>") { pullRequest(number: <pr_number>) { reviewThreads(first: 100) { nodes { id isResolved comments(first: 20) { nodes { databaseId path line author { login } body } } } } } } }'
```

This is not a primary source for actionable review feedback. It is only for mapping inline comments to resolvable thread IDs.

Recommendation:

- If the user only wants to **view/list/count** review feedback, this step is optional.
- If the user may want to **resolve conversations**, doing this early is usually more convenient because you can map comment `databaseId` / `path` / `line` to thread IDs in one pass.

#### 1. Fetch inline comments

```bash
gh api --paginate repos/<owner>/<repo>/pulls/<pr_number>/comments
```

Only keep records that satisfy all of the following:

- `user.login` is `coderabbitai[bot]` or `coderabbitai`
- `in_reply_to_id == null` (only top-level inline comments, not replies)

This is the candidate set.

#### 2. Fetch reviews to exclude review summaries / nitpicks

```bash
gh api --paginate repos/<owner>/<repo>/pulls/<pr_number>/reviews
```

Identify CodeRabbit review summaries. Common characteristics include:

- `Actionable comments posted: N`
- `Nitpick comments`
- long summary text

These review-level contents are **not the final result**. They are only used to help determine:

- which items are summaries
- which nitpicks should not be counted as actionable inline comments

### Filtering rule

The final goal of the CodeRabbit workflow is always:

> **Top-level inline comments left by CodeRabbit in `pulls/<pr_number>/comments` that are neither nitpicks nor summaries**

Important:

- Treat CodeRabbit nitpicks as non-actionable by default.
- Do not include nitpicks in counts, summaries, or resolution queues unless the user explicitly asks for nitpicks.

In practice, do the following:

1. Get CodeRabbit top-level inline comments from `pulls/<pr_number>/comments`
2. Use `pulls/<pr_number>/reviews` to determine whether the PR contains nitpick summaries
3. In the output, keep only the inline comments you confirm are actionable

### Large output handling

If the output of `gh api --paginate ...` is too large and gets truncated:

1. Record the tool output file path
2. Do not manually read through the entire large JSON blob
3. Hand it off to `@explorer` to extract:
   - CodeRabbit-authored comments
   - the number of top-level inline comments
   - each comment’s `path` / `line` / `body`

### Resolving review conversations

### Resolution policy

When triaging review feedback, apply this rule:

- If a comment will **not** be fixed, you may resolve the conversation after triage.
- If a comment **will** be fixed, do **not** resolve it first — make the code change first, then resolve the conversation afterward.

In short:

- **won't fix / no code change** → triage, then resolve
- **will fix / code change required** → fix first, then resolve

If the user asks to resolve a CodeRabbit review conversation:

1. Identify the target inline comment from the actionable comment list.
2. Map that comment to its review thread ID via `reviewThreads` GraphQL data.
   - Match using `databaseId` when possible.
   - If needed, fall back to `path` + `line` + author login.
3. Resolve the thread with GraphQL:

```bash
gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<thread_id>"}) { thread { isResolved } } }'
```

Notes:

- Resolve the **thread**, not the individual comment.
- `pulls/<pr_number>/comments` remains the source of truth for identifying actionable inline comments.
- `reviewThreads` is only for thread-level operations such as resolving conversations.

## Codex Reviews

“Real review feedback” is strictly defined as:

- **inline review comments**
- **not** the review summary card

There is no need to analyze the comment content itself.

### Important behavior differences from CodeRabbit

- Codex review is **silent while running**.
- Unlike CodeRabbit, Codex does **not** expose an in-progress PR check for review status.
- While Codex is reviewing, the PR main conversation thread gets an `eyes` reaction from `chatgpt-codex-connector[bot]`.
- If Codex finds no issues, it may leave **no actionable inline comments** and instead react to the PR main conversation thread with `+1` (thumbs up).
- If Codex finds issues, it may create inline review comments in `pulls/<pr_number>/comments` and a review summary card in `pulls/<pr_number>/reviews`.

### Data sources

The Codex workflow uses these sources:

1. **PR review comments**

   ```bash
   gh api --paginate repos/<owner>/<repo>/pulls/<pr_number>/comments
   ```

   This is the authoritative source for actionable inline Codex comments.

2. **PR reviews**

   ```bash
   gh api --paginate repos/<owner>/<repo>/pulls/<pr_number>/reviews
   ```

   This is used to identify the Codex review summary card such as `### 💡 Codex Review`. It is not the primary source of actionable inline feedback.

3. **Issue comment reactions on the PR main thread**

   First fetch the PR issue node / comments if needed:

   ```bash
   gh api repos/<owner>/<repo>/issues/<pr_number>/comments
   gh api repos/<owner>/<repo>/issues/<pr_number>/reactions
   ```

   Use reactions on the PR main conversation thread only to detect Codex review state:

   - `eyes` from `chatgpt-codex-connector[bot]` → Codex review appears to be in progress
   - `+1` from `chatgpt-codex-connector[bot]` on the PR main thread → Codex reviewed and found no issues

   These reactions are **status signals**, not actionable review feedback.

Do not treat these as primary sources for actionable comments:

- `gh pr view ...`
- `gh api repos/<owner>/<repo>/issues/<pr_number>/comments`
- `gh api repos/<owner>/<repo>/issues/<pr_number>/reactions`

Reason: actionable Codex review feedback still lives in PR review comments, not in the PR issue timeline.

### Workflow

#### 1. Fetch inline comments

```bash
gh api --paginate repos/<owner>/<repo>/pulls/<pr_number>/comments
```

Only keep records that satisfy all of the following:

- `user.login` is `chatgpt-codex-connector[bot]`
- `in_reply_to_id == null` (only top-level inline comments, not replies)

This is the candidate set of actionable Codex comments.

#### 2. Fetch reviews to identify the summary card

```bash
gh api --paginate repos/<owner>/<repo>/pulls/<pr_number>/reviews
```

Identify Codex review summaries. Common characteristics include:

- `### 💡 Codex Review`
- explanatory text such as `Here are some automated review suggestions for this pull request.`
- “About Codex in GitHub” help text

These review-level contents are **not the final result**. They are only used to understand whether Codex posted a review summary.

#### 3. Optionally inspect PR main-thread reactions for status

If the user asks whether Codex is still reviewing, or whether Codex finished with no findings, inspect reactions on the PR main thread.

Interpret them as follows:

- `eyes` by `chatgpt-codex-connector[bot]` → likely still reviewing / review in progress
- `+1` by `chatgpt-codex-connector[bot]` with no Codex inline comments → likely completed with no findings

Do not count these reactions as review comments.

### Filtering rule

The final goal of the Codex workflow is always:

> **Top-level inline comments left by Codex in `pulls/<pr_number>/comments`**

In practice, do the following:

1. Get Codex top-level inline comments from `pulls/<pr_number>/comments`
2. Use `pulls/<pr_number>/reviews` only to recognize the summary card
3. If there are no Codex inline comments, optionally inspect PR main-thread reactions to distinguish:
   - still reviewing (`eyes`)
   - reviewed with no findings (`+1`)
   - no observable Codex activity

### Large output handling

If any `gh api --paginate ...` output is too large and gets truncated:

1. Record the tool output file path
2. Do not manually read through the entire large JSON blob
3. Hand it off to `@explorer` to extract:
   - Codex-authored inline comments
   - the number of top-level inline comments
   - each comment’s `path` / `line` / `body`
