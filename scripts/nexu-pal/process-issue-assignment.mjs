#!/usr/bin/env node

/**
 * nexu-pal: Remove `needs-triage` label when an issue is assigned.
 *
 * Environment variables:
 *   GITHUB_TOKEN      — GitHub token with issues write permission
 *   GITHUB_REPOSITORY — owner/repo
 *   ISSUE_NUMBER      — Issue number
 */

const ghToken = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const issueNumber = process.env.ISSUE_NUMBER;

if (!ghToken || !repo || !issueNumber) {
  console.error(
    "Missing required env: GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_NUMBER",
  );
  process.exit(1);
}

const FETCH_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function removeLabel(label) {
  const url = `https://api.github.com/repos/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`;
  const res = await fetchWithTimeout(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (res.status === 404) {
    console.log(
      `Label "${label}" not found on issue #${issueNumber} — skipping.`,
    );
    return;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GitHub API DELETE label "${label}" failed (${res.status}): ${text}`,
    );
  }

  console.log(`Label "${label}" removed from issue #${issueNumber}.`);
}

console.log(`Handling assignment for issue #${issueNumber}`);
await removeLabel("needs-triage");
console.log("Done.");
