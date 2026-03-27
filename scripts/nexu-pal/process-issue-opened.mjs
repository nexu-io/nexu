#!/usr/bin/env node

import {
  createGitHubIssueClient,
  fetchWithTimeout,
} from "./lib/github-client.mjs";
import { buildOpenedIssueTriagePlan } from "./lib/triage-opened-engine.mjs";

const endpoint = process.env.OPENAI_BASE_URL;
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL ?? "google/gemini-2.5-flash";
const ghToken = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const issueNumber = process.env.ISSUE_NUMBER;
const issueTitle = process.env.ISSUE_TITLE ?? "";
const issueBody = process.env.ISSUE_BODY ?? "";
const issueAuthorAssociation = process.env.ISSUE_AUTHOR_ASSOCIATION ?? "NONE";

if (!endpoint || !apiKey || !ghToken || !repo || !issueNumber) {
  console.error(
    "Missing required env: OPENAI_BASE_URL, OPENAI_API_KEY, GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_NUMBER",
  );
  process.exit(1);
}

async function chat(systemPrompt, userPrompt) {
  const response = await fetchWithTimeout(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function main() {
  console.log(`Processing opened issue #${issueNumber}: "${issueTitle}"`);

  const plan = await buildOpenedIssueTriagePlan({
    issueTitle,
    issueBody,
    issueAuthorAssociation,
    chat,
  });

  const github = createGitHubIssueClient({
    token: ghToken,
    repo,
    issueNumber,
  });

  if (plan.diagnostics.length > 0) {
    for (const diagnostic of plan.diagnostics) {
      console.log(`diagnostic: ${diagnostic}`);
    }
  }

  await github.applyPlan(plan);

  if (plan.commentsToAdd.length > 0) {
    console.log(`comments added: ${plan.commentsToAdd.length}`);
  }

  if (plan.labelsToAdd.length > 0) {
    console.log(`labels applied in order: ${plan.labelsToAdd.join(", ")}`);
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
