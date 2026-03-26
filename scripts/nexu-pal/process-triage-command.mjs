#!/usr/bin/env node

import { createGitHubIssueClient } from "./lib/github-client.mjs";
import {
  canExecuteTriageCommand,
  getCollaboratorPermission,
} from "./lib/permission-checker.mjs";
import {
  buildTriageCommandPlan,
  parseTriageCommand,
} from "./lib/triage-command-engine.mjs";

const ghToken = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const issueNumber = process.env.ISSUE_NUMBER;
const commentBody = process.env.COMMENT_BODY ?? "";
const commentAuthor = process.env.COMMENT_AUTHOR ?? "";

if (!ghToken || !repo || !issueNumber || !commentAuthor) {
  console.error(
    "Missing required env: GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_NUMBER, COMMENT_AUTHOR",
  );
  process.exit(1);
}

async function main() {
  const command = parseTriageCommand(commentBody);

  if (!command) {
    console.log("No supported /triage command found. Exiting.");
    return;
  }

  const permission = await getCollaboratorPermission({
    token: ghToken,
    repo,
    username: commentAuthor,
  });

  if (!canExecuteTriageCommand(permission)) {
    console.log(
      `Skipping /triage command from ${commentAuthor}: permission ${permission} is not allowed.`,
    );
    return;
  }

  const github = createGitHubIssueClient({
    token: ghToken,
    repo,
    issueNumber,
  });
  const plan = buildTriageCommandPlan(command.action);

  await github.applyPlan(plan);

  console.log(
    `Applied /triage ${command.action} to issue #${issueNumber} as GitHub App.`,
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
