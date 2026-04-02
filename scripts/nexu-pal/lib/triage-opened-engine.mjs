import {
  isInternalEquivalentAuthor,
  isSentryAutomationAuthor,
} from "./internal-equivalent-author.mjs";
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

function buildTranslationComment({ translatedTitle, translatedSections }) {
  const maxCommentLength = 65_500;
  const truncationMarker = "… [truncated]";
  const title =
    typeof translatedTitle === "string" ? translatedTitle.trim() : "";
  const sections = Array.isArray(translatedSections)
    ? translatedSections
        .map((section) => {
          if (!section || typeof section !== "object") {
            return null;
          }

          const heading =
            typeof section.heading === "string" ? section.heading.trim() : "";
          const translatedText =
            typeof section.translated_text === "string"
              ? section.translated_text.trim()
              : "";

          if (translatedText === "") {
            return null;
          }

          return {
            heading: heading === "" ? "Section" : heading,
            translatedText,
          };
        })
        .filter(Boolean)
    : [];

  const body = sections
    .map((section) => `**${section.heading}:**\n\n${section.translatedText}`)
    .join("\n\n---\n\n");

  const buildComment = ({ titleText, bodyText }) =>
    [
      "# AI Translation",
      "",
      "Only the non-English parts are translated below.",
      ...(titleText ? ["", "**Title:**", "", titleText] : []),
      ...(bodyText ? ["", "**Translated sections:**", "", bodyText] : []),
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
    bodyText: body === "" ? truncationMarker : body,
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

function normalizeTranslatedSections(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const sections = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const heading = typeof item.heading === "string" ? item.heading.trim() : "";
    const translatedText =
      typeof item.translated_text === "string"
        ? item.translated_text.trim()
        : "";

    if (translatedText === "") {
      continue;
    }

    sections.push({
      heading,
      translated_text: translatedText,
    });
  }

  return sections;
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

async function detectAndTranslate({ chat, issueTitle, issueBody }) {
  const content = `Title: ${issueTitle}\n\nBody:\n${issueBody}`;

  const systemPrompt = `You are a language detection and translation assistant.

Analyze the given GitHub issue content. Determine whether translation is actually needed for maintainers.

Respond with a JSON object (no markdown fences):
{
  "should_translate": true/false,
  "detected_language": "language name or null",
  "translated_title": "English translation only if the title itself needs translation; otherwise empty string",
  "translated_body": "Full body where only non-English parts are translated into English and already-English parts stay concise and unchanged; empty string if no translation is needed",
  "translated_sections": [
    {
      "heading": "Title or the nearest markdown heading / section label",
      "translated_text": "English translation only for that non-English section"
    }
  ]
}

Rules:
- If the issue is mostly English and the remaining non-English text is minor and does not affect the key meaning, set should_translate to false.
- Minor non-English words, greetings, short asides, proper nouns, or code identifiers do not require translation when the issue is still clear.
- Preserve markdown formatting in translations.
- If translation is needed, translate only the non-English parts.
- Split body translations by title or markdown heading when possible.
- Keep translated_sections minimal: include only the sections that actually needed translation.
- Do not repeat already-English sections in translated_sections.
- Translate accurately and naturally.`;

  const raw = await chat(systemPrompt, content);

  try {
    return JSON.parse(sanitizeJsonResponse(raw));
  } catch {
    return {
      should_translate: false,
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
  isInternalAuthor = false,
  issueAuthorLogin = "",
  repositoryOwner = "",
  issueAuthorAssociation = "NONE",
  chat,
}) {
  const plan = createTriagePlan();
  const shouldShortCircuitAfterClassification = isInternalEquivalentAuthor({
    isInternalAuthor,
    issueAuthorLogin,
  });

  const translation = await detectAndTranslate({ chat, issueTitle, issueBody });
  let englishTitle = issueTitle;
  let englishBody = issueBody;

  if (translation.should_translate === true) {
    const hasTitle =
      typeof translation.translated_title === "string" &&
      translation.translated_title.trim() !== "";
    const hasBody =
      typeof translation.translated_body === "string" &&
      translation.translated_body.trim() !== "";
    const normalizedTranslatedSections = normalizeTranslatedSections(
      translation.translated_sections,
    );
    const translatedSections =
      normalizedTranslatedSections.length > 0
        ? normalizedTranslatedSections
        : hasBody
          ? [
              {
                heading: "Body",
                translated_text: translation.translated_body.trim(),
              },
            ]
          : [];

    englishTitle = hasTitle ? translation.translated_title : issueTitle;
    englishBody = hasBody ? translation.translated_body : issueBody;

    if (hasTitle || translatedSections.length > 0) {
      const detectedLanguage =
        typeof translation.detected_language === "string" &&
        translation.detected_language.trim() !== ""
          ? translation.detected_language.trim()
          : "non-English";

      plan.commentsToAdd.push(
        buildTranslationComment({
          translatedTitle: hasTitle ? translation.translated_title : "",
          translatedSections,
        }),
      );
      plan.labelsToAdd.push("ai-translated");
      plan.diagnostics.push(
        `translation comment prepared for ${detectedLanguage} issue`,
      );
    }

    if (!(hasTitle || hasBody || translatedSections.length > 0)) {
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
  plan.diagnostics.push(`issue author login: ${issueAuthorLogin ?? "unknown"}`);
  plan.diagnostics.push(`repository owner: ${repositoryOwner ?? "unknown"}`);
  plan.diagnostics.push(
    `organization membership: ${isInternalAuthor === true ? "member" : "non-member"}`,
  );

  if (isSentryAutomationAuthor(issueAuthorLogin)) {
    plan.diagnostics.push(
      "author is sentry[bot]; treated as internal-equivalent automation for triage short-circuit",
    );
  }

  if (shouldShortCircuitAfterClassification === true) {
    plan.diagnostics.push(
      "internal-equivalent author detected; skipped roadmap/duplicate/completeness/needs-triage checks",
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
