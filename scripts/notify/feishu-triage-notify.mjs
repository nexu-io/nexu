#!/usr/bin/env node

/**
 * Send a Feishu triage notification when `needs-triage` is added to an issue.
 *
 * Environment variables:
 *   BUG_WEBHOOK         — Feishu webhook for bug triage
 *   REQ_WEBHOOK         — Feishu webhook for non-bug triage
 *   TRIGGER_LABEL       — Added label name from the GitHub event
 *   TITLE               — Issue title
 *   URL                 — Issue HTML URL
 *   NUMBER              — Issue number
 *   AUTHOR              — Issue author login
 *   BODY                — Issue body (may be empty)
 *   LABELS_JSON         — JSON array of current issue labels
 *   REPO                — owner/repo
 */

const bugWebhookUrl = process.env.BUG_WEBHOOK;
const reqWebhookUrl = process.env.REQ_WEBHOOK;
const triggerLabel = process.env.TRIGGER_LABEL ?? "";
const title = process.env.TITLE ?? "";
const url = process.env.URL ?? "";
const number = process.env.NUMBER ?? "";
const author = process.env.AUTHOR ?? "";
const body = process.env.BODY ?? "";
const labelsJson = process.env.LABELS_JSON ?? "[]";
const repo = process.env.REPO ?? "";

if (!bugWebhookUrl || !reqWebhookUrl) {
  console.error(
    "BUG_WEBHOOK and REQ_WEBHOOK are required for triage notifications",
  );
  process.exit(1);
}

if (triggerLabel !== "needs-triage") {
  console.log(`Skipping notification for label: ${triggerLabel || "(none)"}`);
  process.exit(0);
}

function parseLabels(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((label) => typeof label === "string");
  } catch {
    return [];
  }
}

const labels = parseLabels(labelsJson);
const hasBugLabel = labels.includes("bug");
const webhookUrl = hasBugLabel ? bugWebhookUrl : reqWebhookUrl;
const queueLabel = hasBugLabel ? "Bug triage" : "Issue triage";
const headerColor = hasBugLabel ? "red" : "blue";
const labelsText = labels.length > 0 ? labels.join(", ") : "none";
const bodyCharacters = Array.from(body);
const bodySnippet =
  bodyCharacters.length > 300
    ? `${bodyCharacters.slice(0, 300).join("")}...`
    : body || "(no description)";
const fetchTimeoutMs = 30_000;
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), fetchTimeoutMs);

const payload = {
  msg_type: "interactive",
  card: {
    schema: "2.0",
    header: {
      title: {
        tag: "plain_text",
        content: `[${repo}] ${queueLabel} #${number}: ${title}`,
      },
      template: headerColor,
    },
    body: {
      direction: "vertical",
      elements: [
        { tag: "markdown", content: `**Author:** ${author}` },
        { tag: "markdown", content: `**Queue:** ${queueLabel}` },
        { tag: "markdown", content: `**Labels:** ${labelsText}` },
        { tag: "markdown", content: bodySnippet },
        {
          tag: "button",
          text: { tag: "plain_text", content: "View Issue" },
          url,
          type: "primary",
        },
      ],
    },
  },
};

let response;

try {
  response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") {
    console.error(
      `Webhook request timed out after ${fetchTimeoutMs}ms for ${webhookUrl}`,
    );
    process.exit(1);
  }

  throw error;
} finally {
  clearTimeout(timeoutId);
}

if (!response.ok) {
  const text = await response.text();
  console.error(`Webhook request failed (${response.status}): ${text}`);
  process.exit(1);
}

console.log(
  `Feishu triage notification sent to ${hasBugLabel ? "bug" : "non-bug"} queue`,
);
