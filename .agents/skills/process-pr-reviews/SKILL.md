---
name: process-pr-reviews
description: Use when the user asks to process, triage, fetch, view, count, list, or resolve review feedback in a GitHub PR. The built-in workflow currently focuses on CodeRabbit. In this workflow, “real review feedback” is strictly defined as actionable inline comments that are neither review summaries nor nitpicks.
---

# Process PR Reviews

## CodeRabbit Reviews

“Real review feedback” is strictly defined as:

- **inline review comments**
- **not** a review summary
- **not** a nitpick

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
