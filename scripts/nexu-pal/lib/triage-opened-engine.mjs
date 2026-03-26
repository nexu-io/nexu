import { detectDuplicate } from "./signals/duplicate-detector.mjs";
import { matchRoadmap } from "./signals/roadmap-matcher.mjs";

function sanitizeJsonResponse(raw) {
  return raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
}

async function detectAndTranslate({ chat, issueTitle, issueBody }) {
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

  try {
    return JSON.parse(sanitizeJsonResponse(raw));
  } catch {
    return {
      is_non_english: false,
      diagnostics: ["translation parse failed; treated issue as English"],
    };
  }
}

async function classifyBugOnly({ chat, englishTitle, englishBody }) {
  const content = `Title: ${englishTitle}\n\nBody:\n${englishBody}`;

  const systemPrompt = `You are a GitHub issue classifier.

Analyze the issue and decide whether it should receive the label "bug".

Respond with a JSON object (no markdown fences):
{
  "is_bug": true | false,
  "reason": "brief one-line explanation"
}

Rules:
- Return true only when the issue describes errors, crashes, exceptions, unexpected behavior, broken functionality, or a clear defect.
- Return false for feature requests, improvements, roadmap asks, questions, support requests, or ambiguous non-bug reports.
- When uncertain, prefer false unless there is concrete evidence of something currently broken.`;

  const raw = await chat(systemPrompt, content);

  try {
    return JSON.parse(sanitizeJsonResponse(raw));
  } catch {
    return { is_bug: false, reason: "classification parse failed" };
  }
}

export async function buildOpenedIssueTriagePlan({
  issueTitle,
  issueBody,
  issueAssignee,
  chat,
}) {
  const plan = {
    labelsToAdd: [],
    labelsToRemove: [],
    commentsToAdd: [],
    closeIssue: false,
    diagnostics: [],
  };

  const translation = await detectAndTranslate({ chat, issueTitle, issueBody });
  let englishTitle = issueTitle;
  let englishBody = issueBody;

  if (translation.is_non_english === true) {
    const hasTitle =
      typeof translation.translated_title === "string" &&
      translation.translated_title.trim() !== "";
    const hasBody =
      typeof translation.translated_body === "string" &&
      translation.translated_body.trim() !== "";

    englishTitle = hasTitle ? translation.translated_title : issueTitle;
    englishBody = hasBody ? translation.translated_body : issueBody;

    if (!(hasTitle || hasBody)) {
      plan.diagnostics.push(
        "translation flagged non-English but returned empty translated strings; skipped translated content",
      );
    }
  }

  if (Array.isArray(translation.diagnostics)) {
    plan.diagnostics.push(...translation.diagnostics);
  }

  const roadmap = await matchRoadmap({
    title: englishTitle,
    body: englishBody,
  });
  const duplicate = await detectDuplicate({
    title: englishTitle,
    body: englishBody,
  });

  if (Array.isArray(roadmap.diagnostics)) {
    plan.diagnostics.push(...roadmap.diagnostics);
  }

  if (Array.isArray(duplicate.diagnostics)) {
    plan.diagnostics.push(...duplicate.diagnostics);
  }

  const classification = await classifyBugOnly({
    chat,
    englishTitle,
    englishBody,
  });

  if (classification.is_bug === true) {
    plan.labelsToAdd.push("bug");
  }

  plan.diagnostics.push(
    `bug classification: ${classification.reason ?? "no reason provided"}`,
  );

  if (!issueAssignee && roadmap.matched !== true) {
    plan.labelsToAdd.push("needs-triage");
  }

  return plan;
}
