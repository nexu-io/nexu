#!/usr/bin/env node

/**
 * nexu-pal: Automatic issue processing bot.
 *
 * 1. Detects non-English content in issue title/body → translates → comments → tags `ai-translated`
 * 2. Classifies intent → tags `bug`, `enhancement`, or `help-wanted`
 *
 * Environment variables:
 *   LITELLM_ENDPOINT  — LiteLLM proxy base URL (e.g. https://litellm.example.com/v1)
 *   LITELLM_API_KEY   — API key for the proxy
 *   LITELLM_MODEL     — Model ID (default: google/gemini-2.5-flash)
 *   GITHUB_TOKEN      — GitHub token with issues write permission
 *   GITHUB_REPOSITORY — owner/repo
 *   ISSUE_NUMBER      — Issue number to process
 *   ISSUE_TITLE       — Issue title
 *   ISSUE_BODY        — Issue body (may be empty)
 *   ISSUE_ASSIGNEE    — Issue assignee login (empty if unassigned)
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const endpoint = process.env.LITELLM_ENDPOINT;
const apiKey = process.env.LITELLM_API_KEY;
const model = process.env.LITELLM_MODEL ?? "google/gemini-2.5-flash";
const ghToken = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY; // owner/repo
const issueNumber = process.env.ISSUE_NUMBER;
const issueTitle = process.env.ISSUE_TITLE ?? "";
const issueBody = process.env.ISSUE_BODY ?? "";

if (!endpoint || !apiKey || !ghToken || !repo || !issueNumber) {
  console.error(
    "Missing required env: LITELLM_ENDPOINT, LITELLM_API_KEY, GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_NUMBER",
  );
  process.exit(1);
}

const FETCH_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// LLM helper
// ---------------------------------------------------------------------------

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

async function chat(systemPrompt, userPrompt) {
  const url = `${endpoint}/chat/completions`;
  const res = await fetchWithTimeout(url, {
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

async function ghApi(path, method = "GET", body = undefined) {
  const url = `https://api.github.com/repos/${repo}${path}`;
  const headers = {
    Authorization: `Bearer ${ghToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetchWithTimeout(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GitHub API ${method} ${path} failed (${res.status}): ${text}`,
    );
  }

  if (res.status === 204) return null;
  return res.json();
}

async function addComment(body) {
  return ghApi(`/issues/${issueNumber}/comments`, "POST", { body });
}

async function addLabels(labels) {
  return ghApi(`/issues/${issueNumber}/labels`, "POST", { labels });
}

// ---------------------------------------------------------------------------
// Step 1: Language detection + translation
// ---------------------------------------------------------------------------

async function detectAndTranslate() {
  const content = `Title: ${issueTitle}\n\nBody:\n${issueBody}`;

  const systemPrompt = `You are a language detection and translation assistant.

Analyze the given GitHub issue content. Determine if a significant portion of the title or body is written in a non-English language (e.g., Chinese, Japanese, Korean, Spanish, etc.).

Respond with a JSON object (no markdown fences):
{
  "is_non_english": true/false,
  "detected_language": "language name or null",
  "translated_title": "English translation of the title, or the original if already English",
  "translated_body": "English translation of the body, or the original if already English"
}

Rules:
- If the content is already primarily in English, set is_non_english to false.
- Minor non-English words (proper nouns, code identifiers) do not count as non-English.
- Preserve markdown formatting in translations.
- Translate accurately and naturally.`;

  const raw = await chat(systemPrompt, content);

  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/^```(?:json)?\s*\n?/m, "")
    .replace(/\n?```\s*$/m, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    console.error("Failed to parse translation response:", raw);
    return { is_non_english: false };
  }
}

// ---------------------------------------------------------------------------
// Step 2: Intent classification
// ---------------------------------------------------------------------------

async function classifyIntent(englishTitle, englishBody) {
  const content = `Title: ${englishTitle}\n\nBody:\n${englishBody}`;

  const systemPrompt = `You are a GitHub issue classifier.

Analyze the issue and assign ONE primary label from the following:
- "bug" — the issue describes errors, crashes, exceptions, unexpected behavior, or broken functionality
- "enhancement" — the issue suggests new features, improvements, additions, or requests for changes
- "help-wanted" — the issue explicitly asks for help, expresses confusion about usage, or asks how to do something

Respond with a JSON object (no markdown fences):
{
  "label": "bug" | "enhancement" | "help-wanted",
  "reason": "brief one-line explanation"
}

Rules:
- Choose the single most fitting label.
- If the issue could be both a bug report and a feature request, prefer "bug" if it describes something currently broken.
- If none of the three fit well, pick the closest match.`;

  const raw = await chat(systemPrompt, content);
  const cleaned = raw
    .replace(/^```(?:json)?\s*\n?/m, "")
    .replace(/\n?```\s*$/m, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    console.error("Failed to parse classification response:", raw);
    return { label: null, reason: "classification failed" };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Processing issue #${issueNumber}: "${issueTitle}"`);

  const labels = [];
  let englishTitle = issueTitle;
  let englishBody = issueBody;

  // Step 1: Detect language and translate if needed
  console.log("Step 1: Detecting language...");
  const translation = await detectAndTranslate();
  console.log(
    `  Non-English: ${translation.is_non_english} (${translation.detected_language ?? "N/A"})`,
  );

  if (translation.is_non_english === true) {
    const hasTitle =
      typeof translation.translated_title === "string" &&
      translation.translated_title.trim() !== "";
    const hasBody =
      typeof translation.translated_body === "string" &&
      translation.translated_body.trim() !== "";

    englishTitle = hasTitle ? translation.translated_title : issueTitle;
    englishBody = hasBody ? translation.translated_body : issueBody;

    if (hasTitle || hasBody) {
      const comment = [
        "# AI Translation:",
        "",
        "---",
        "",
        "**Title:**",
        "",
        englishTitle,
        "",
        "**Body:**",
        "",
        englishBody,
      ].join("\n");

      await addComment(comment);
      labels.push("ai-translated");
      console.log("  Translation comment posted.");
    } else {
      console.warn(
        "  Translation flagged non-English but returned empty translated strings; skipping comment.",
      );
    }
  } else if (translation.is_non_english !== false) {
    console.warn(
      `  Unexpected is_non_english value: ${JSON.stringify(translation.is_non_english)}; treating as English.`,
    );
  }

  // Step 2: Classify intent
  console.log("Step 2: Classifying intent...");
  const classification = await classifyIntent(englishTitle, englishBody);
  console.log(`  Label: ${classification.label} (${classification.reason})`);

  const validLabels = new Set(["bug", "enhancement", "help-wanted"]);
  if (
    typeof classification.label === "string" &&
    validLabels.has(classification.label)
  ) {
    labels.push(classification.label);
  } else if (classification.label != null) {
    console.warn(
      `  Unexpected classification label: ${JSON.stringify(classification.label)}; skipping label.`,
    );
  }

  // Step 3: needs-triage label
  const issueAssignee = process.env.ISSUE_ASSIGNEE ?? "";
  if (!issueAssignee) {
    labels.push("needs-triage");
    console.log("  No assignee — adding needs-triage label.");
  }

  // Apply labels
  if (labels.length > 0) {
    await addLabels(labels);
    console.log(`  Labels applied: ${labels.join(", ")}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
