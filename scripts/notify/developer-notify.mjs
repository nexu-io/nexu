#!/usr/bin/env node

const CONTRIBUTOR_GUIDE_URL = "https://docs.nexu.io/zh/guide/first-pr";
const GOOD_FIRST_ISSUE_URL =
  "https://github.com/nexu-io/nexu/labels/good-first-issue";
const ALL_ISSUES_URL = "https://github.com/nexu-io/nexu/issues";
const WEBHOOK_TIMEOUT_MS = 30_000;

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timeoutId);
    },
  };
}

export function truncateText(value, maxLength) {
  const characters = Array.from(value);
  if (characters.length <= maxLength) {
    return value;
  }
  return `${characters.slice(0, maxLength).join("")}...`;
}

export function sanitizeText(value, maxLength = 200) {
  return truncateText(
    value
      .replace(/[\r\n\t]+/g, " ")
      .replace(/[\\`*_{}\[\]()#+\-.!|<>~]/g, "\\$&")
      .replace(/@/g, "＠")
      .trim(),
    maxLength,
  );
}

export function validateGithubUrl(value) {
  const parsedUrl = new URL(value);
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "github.com") {
    throw new Error("Only https://github.com URLs are allowed");
  }
  return parsedUrl.toString();
}

export function isInternalEquivalentAuthor(author) {
  return author === "sentry[bot]";
}

export async function checkOrganizationMembership({ token, org, username }) {
  const { signal, clear } = createTimeoutSignal(WEBHOOK_TIMEOUT_MS);

  let response;

  try {
    response = await fetch(
      `https://api.github.com/orgs/${encodeURIComponent(org)}/members/${encodeURIComponent(username)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "nexu-developer-notify",
        },
        redirect: "manual",
        signal,
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `GitHub membership lookup timed out after ${WEBHOOK_TIMEOUT_MS}ms`,
      );
    }

    throw error;
  } finally {
    clear();
  }

  if (response.status === 204) {
    return true;
  }

  if (
    response.status === 301 ||
    response.status === 302 ||
    response.status === 307 ||
    response.status === 308 ||
    response.status === 404
  ) {
    return false;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub membership lookup failed (${response.status}): ${text}`,
    );
  }

  return false;
}

function createButton(text, url, type = "default") {
  return {
    tag: "button",
    text: { tag: "plain_text", content: text },
    url,
    type,
  };
}

function createButtonColumns(actions) {
  return {
    tag: "column_set",
    flex_mode: "flow",
    columns: actions.map((action) => ({
      tag: "column",
      width: "auto",
      elements: [action],
    })),
  };
}

function createRewardCopy() {
  return [
    "只需 3 步💥：❶ 选任务 ❷ 认领 ❸ 提交 PR",
    "",
    "🎁 合并后即可获得以下奖励：",
    "✅ 最高 2000 积分，可兑换价值 $20 的 nexu 使用额度",
    "✅ GitHub README 贡献者公开致谢",
    "✅ GitHub 社区徽章",
  ].join("\n");
}

export function buildDeveloperPrPayload({ title, author, labels, prUrl }) {
  const safeTitle = sanitizeText(title || "(no title)", 120) || "(no title)";
  const safeAuthor = sanitizeText(author, 80);
  const safeLabels = sanitizeText(labels || "none", 120) || "none";

  return {
    msg_type: "interactive",
    card: {
      schema: "2.0",
      header: {
        title: {
          tag: "plain_text",
          content: "🎉 又有新贡献者给 Nexu 提 PR 啦！你也来试试？",
        },
        template: "purple",
      },
      body: {
        direction: "vertical",
        elements: [
          {
            tag: "markdown",
            content: `**Title:** ${safeTitle}\n**Author:** ${safeAuthor}\n**Labels:** ${safeLabels}`,
          },
          createButtonColumns([createButton("查看贡献 PR", prUrl, "primary")]),
          {
            tag: "markdown",
            content: [
              "Nexu 还准备了一批新手友好的 Good First Issue 等你来领 👇 提交后 24 小时内审核回复",
              createRewardCopy(),
            ].join("\n"),
          },
          createButtonColumns([
            createButton("Good First Issue", GOOD_FIRST_ISSUE_URL),
            createButton("贡献者指南", CONTRIBUTOR_GUIDE_URL),
            createButton("查看全部 Issue", ALL_ISSUES_URL),
          ]),
        ],
      },
    },
  };
}

export function buildDeveloperIssuePayload({
  title,
  author,
  labels,
  body,
  issueUrl,
}) {
  const safeTitle = sanitizeText(title || "(no title)", 120) || "(no title)";
  const safeAuthor = sanitizeText(author || "unknown", 80) || "unknown";
  const safeLabels = sanitizeText(labels || "none", 120) || "none";
  const safeBody = sanitizeText(body || "No description provided.", 240);

  return {
    msg_type: "interactive",
    card: {
      schema: "2.0",
      header: {
        title: {
          tag: "plain_text",
          content: "刚新增 1 条 issue 等你来领取🎉，做贡献领积分奖励💰",
        },
        template: "blue",
      },
      body: {
        direction: "vertical",
        elements: [
          {
            tag: "markdown",
            content: `**标题：** ${safeTitle}\n**提交者：** ${safeAuthor}\n**标签：** ${safeLabels}\n**描述：** ${safeBody}`,
          },
          createButtonColumns([
            createButton("查看 issue", issueUrl, "primary"),
          ]),
          {
            tag: "markdown",
            content: createRewardCopy(),
          },
          createButtonColumns([
            createButton("Good First Issue", GOOD_FIRST_ISSUE_URL),
            createButton("贡献者指南", CONTRIBUTOR_GUIDE_URL),
            createButton("查看全部 Issue", ALL_ISSUES_URL),
          ]),
        ],
      },
    },
  };
}

export async function sendWebhook(webhookUrl, payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Webhook request failed (${response.status}): ${text}`);
    }

    const responseBody = await response.json().catch(() => null);
    if (
      responseBody &&
      typeof responseBody === "object" &&
      "code" in responseBody &&
      responseBody.code !== 0
    ) {
      const message =
        typeof responseBody.msg === "string"
          ? responseBody.msg
          : JSON.stringify(responseBody);
      throw new Error(
        `Webhook business error (${responseBody.code}): ${message}`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Webhook request timed out after ${WEBHOOK_TIMEOUT_MS}ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runFromEnv(env = process.env) {
  const webhookUrl = env.WEBHOOK_URL;
  const eventKind = env.EVENT_KIND ?? "issue";
  const title = env.TITLE ?? "";
  const author = env.AUTHOR ?? "";
  const body = env.BODY ?? "";
  const labels = env.LABELS_OR_CATEGORY || "none";
  const url = env.URL ?? "";
  const githubToken = env.GITHUB_TOKEN;
  const repositoryOwner = env.GITHUB_REPOSITORY_OWNER;

  if (!webhookUrl) {
    throw new Error("WEBHOOK_URL is required");
  }

  if (!author) {
    throw new Error("AUTHOR is required");
  }

  if (!url) {
    throw new Error("URL is required");
  }

  const safeUrl = validateGithubUrl(url);

  if (isInternalEquivalentAuthor(author)) {
    return { skipped: true, reason: "internal-equivalent-author" };
  }

  if (eventKind === "issue") {
    if (!githubToken || !repositoryOwner) {
      throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY_OWNER are required");
    }

    const isInternalAuthor = await checkOrganizationMembership({
      token: githubToken,
      org: repositoryOwner,
      username: author,
    });

    if (isInternalAuthor) {
      return { skipped: true, reason: "internal-author" };
    }

    const payload = buildDeveloperIssuePayload({
      title,
      author,
      labels,
      body,
      issueUrl: safeUrl,
    });
    await sendWebhook(webhookUrl, payload);
    return { skipped: false, eventKind };
  }

  if (eventKind === "pr") {
    const payload = buildDeveloperPrPayload({
      title,
      author,
      labels,
      prUrl: safeUrl,
    });
    await sendWebhook(webhookUrl, payload);
    return { skipped: false, eventKind };
  }

  throw new Error(`Unsupported EVENT_KIND: ${eventKind}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runFromEnv()
    .then((result) => {
      if (result.skipped) {
        console.log(`Skipped developer notification: ${result.reason}`);
        return;
      }
      console.log(`Developer ${result.eventKind} notification sent`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
