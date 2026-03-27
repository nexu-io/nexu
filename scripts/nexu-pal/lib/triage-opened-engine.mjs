import { detectDuplicate } from "./signals/duplicate-detector.mjs";
import { matchRoadmap } from "./signals/roadmap-matcher.mjs";

export function createTriagePlan() {
  return {
    labelsToAdd: [],
    labelsToRemove: [],
    commentsToAdd: [],
    closeIssue: false,
    diagnostics: [],
  };
}

function buildTranslationComment({ englishTitle, englishBody }) {
  const maxCommentLength = 65_500;
  const truncationMarker = "… [truncated]";
  const title = typeof englishTitle === "string" ? englishTitle.trim() : "";
  const body = typeof englishBody === "string" ? englishBody.trim() : "";

  const buildComment = ({ titleText, bodyText }) =>
    [
      "# AI Translation:",
      "",
      "---",
      "",
      "**Title:**",
      "",
      titleText,
      "",
      "**Body:**",
      "",
      bodyText,
    ].join("\n");

  const withMarker = (text, maxLength) => {
    if (maxLength <= 0) {
      return "";
    }

    if (text.length <= maxLength) {
      return text;
    }

    if (maxLength <= truncationMarker.length) {
      return truncationMarker.slice(0, maxLength);
    }

    return `${text.slice(0, maxLength - truncationMarker.length).trimEnd()}${truncationMarker}`;
  };

  const fullComment = buildComment({ titleText: title, bodyText: body });
  if (fullComment.length <= maxCommentLength) {
    return fullComment;
  }

  const maxBodyLength = Math.max(
    0,
    body.length - (fullComment.length - maxCommentLength),
  );
  const truncatedBody = withMarker(body, maxBodyLength);
  const commentWithTrimmedBody = buildComment({
    titleText: title,
    bodyText: truncatedBody,
  });

  if (commentWithTrimmedBody.length <= maxCommentLength) {
    return commentWithTrimmedBody;
  }

  const commentWithoutBody = buildComment({
    titleText: title,
    bodyText: truncationMarker,
  });
  if (commentWithoutBody.length <= maxCommentLength) {
    return commentWithoutBody;
  }

  const titleAllowance = Math.max(
    0,
    maxCommentLength -
      buildComment({ titleText: "", bodyText: truncationMarker }).length,
  );

  return buildComment({
    titleText: withMarker(title, titleAllowance),
    bodyText: truncationMarker,
  });
}

function toOrderedUniqueStrings(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const normalizedValue = value.trim();
    if (normalizedValue === "" || seen.has(normalizedValue)) {
      continue;
    }

    seen.add(normalizedValue);
    result.push(normalizedValue);
  }

  return result;
}

function sanitizeJsonResponse(raw) {
  return raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
}

function isInternalIssueAuthor(authorAssociation) {
  return authorAssociation === "MEMBER" || authorAssociation === "OWNER";
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

async function assessInformationCompleteness({
  chat,
  englishTitle,
  englishBody,
  isBug,
}) {
  const content = `Issue type hint: ${isBug ? "bug" : "non-bug"}\n\nTitle: ${englishTitle}\n\nBody:\n${englishBody}`;

  const systemPrompt = `You are a GitHub issue intake reviewer.

Decide whether this issue is missing the minimum information required to continue triage right now.

Respond with a JSON object (no markdown fences):
{
  "needs_information": true | false,
  "reason": "brief one-line explanation",
  "missing_items": ["item 1", "item 2"]
}

Rules:
- Return true only when the report is clearly too incomplete for a PM/maintainer to reasonably triage.
- For bug reports, look for basics like what happened, what was expected, and some reproducible context or error details.
- For non-bug requests, look for basics like the problem/motivation and the requested change.
- If the issue is understandable enough to be triaged manually, return false.
- Keep missing_items short, concrete, and user-facing.
- When uncertain, prefer false.`;

  const raw = await chat(systemPrompt, content);

  try {
    const parsed = JSON.parse(sanitizeJsonResponse(raw));
    return {
      needs_information: parsed.needs_information === true,
      reason:
        typeof parsed.reason === "string" && parsed.reason.trim() !== ""
          ? parsed.reason.trim()
          : "no reason provided",
      missing_items: toOrderedUniqueStrings(parsed.missing_items),
    };
  } catch {
    return {
      needs_information: false,
      reason: "completeness parse failed",
      missing_items: [],
    };
  }
}

function buildNeedsInformationComment({ missingItems, reason }) {
  const lines = [
    "Thanks for the report. We need a bit more information before we can continue triage.",
  ];

  if (missingItems.length > 0) {
    lines.push("", "Please update this issue with:");
    for (const item of missingItems) {
      lines.push(`- ${item}`);
    }
  } else if (reason) {
    lines.push("", `What is missing: ${reason}`);
  }

  lines.push(
    "",
    "Once the missing details are added, a maintainer can continue triage.",
  );

  return lines.join("\n");
}

export async function buildOpenedIssueTriagePlan({
  issueTitle,
  issueBody,
  issueAuthorAssociation,
  chat,
}) {
  const plan = createTriagePlan();

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

    if (hasTitle || hasBody) {
      const detectedLanguage =
        typeof translation.detected_language === "string" &&
        translation.detected_language.trim() !== ""
          ? translation.detected_language.trim()
          : "non-English";

      plan.commentsToAdd.push(
        buildTranslationComment({
          englishTitle,
          englishBody,
        }),
      );
      plan.labelsToAdd.push("ai-translated");
      plan.diagnostics.push(
        `translation comment prepared for ${detectedLanguage} issue`,
      );
    }

    if (!(hasTitle || hasBody)) {
      plan.diagnostics.push(
        "translation flagged non-English but returned empty translated strings; skipped translated content",
      );
    }
  }

  if (Array.isArray(translation.diagnostics)) {
    plan.diagnostics.push(...translation.diagnostics);
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

  plan.diagnostics.push(
    `author association: ${issueAuthorAssociation ?? "unknown"}`,
  );

  if (isInternalIssueAuthor(issueAuthorAssociation)) {
    plan.diagnostics.push(
      "internal author detected; skipped roadmap/duplicate/completeness/needs-triage checks",
    );
    return plan;
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

  const completeness = await assessInformationCompleteness({
    chat,
    englishTitle,
    englishBody,
    isBug: classification.is_bug === true,
  });

  plan.diagnostics.push(
    `information completeness: ${completeness.reason ?? "no reason provided"}`,
  );

  if (completeness.needs_information === true) {
    plan.labelsToAdd.push("needs-information");
    plan.commentsToAdd.push(
      buildNeedsInformationComment({
        missingItems: completeness.missing_items,
        reason: completeness.reason,
      }),
    );
    return plan;
  }

  if (roadmap.matched !== true) {
    plan.labelsToAdd.push("needs-triage");
  }

  return plan;
}
