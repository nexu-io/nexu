#!/usr/bin/env node

const WEBHOOK_TIMEOUT_MS = 30_000;
const LLM_TIMEOUT_MS = 90_000;

const THEME_CONFIG = {
  "tech-news": {
    emoji: "🔥",
    titleZh: "技术资讯",
    titleEn: "Tech News",
    color: "red",
    discordColor: 0xef4444,
  },
  "tech-eco": {
    emoji: "🧩",
    titleZh: "技术生态",
    titleEn: "Tech Ecosystem",
    color: "purple",
    discordColor: 0xa855f7,
  },
  "ai-products": {
    emoji: "🏆",
    titleZh: "AI 产品榜单",
    titleEn: "AI Products",
    color: "orange",
    discordColor: 0xf97316,
  },
  weekly: {
    emoji: "📰",
    titleZh: "周报",
    titleEn: "Weekly Digest",
    color: "blue",
    discordColor: 0x3b82f6,
  },
  weekend: {
    emoji: "🎲",
    titleZh: "Weekend Pick",
    titleEn: "Weekend Pick",
    color: "turquoise",
    discordColor: 0x14b8a6,
  },
};

const THEME_PROMPTS = {
  "tech-news": `从今日技术圈热点中筛选 3-5 条最有深度的资讯（AI 新模型、开源框架重大更新、行业技术事件等）。
每条必须有"为什么开发者应该关注"的点评，不做搬运式罗列。优先深度技术内容而非产品发布公告。`,

  "tech-eco": `从近期 GitHub Trending 中选一个最值得推荐的 Skill / 插件 / 开源工具，做深度推荐。
必须包含：是什么 → 解决什么问题 → 3 步上手 → 真实使用案例或作品展示。只推一个，但说透。`,

  "ai-products": `从 GitHub Trending (AI)、ProductHunt、HackerNews 中挑 5-7 个最值得关注的 AI 产品。
不做热度排名复读机，每个产品必须点评：技术栈是什么、开发者能从中学到什么、与同类有何不同。`,

  weekly: `总结本周技术圈最重要的 5-7 条新闻/动态。
每条用一句话概括 + 一句为什么重要。最后附一段"本周思考"，给开发者一个有启发的观点。`,

  weekend: `推荐一个有趣的 Side Project、开发者 Meme 或轻松技术故事。
口吻轻松幽默，让开发者周末看到会心一笑。内容简短，1-2 个板块即可。`,
};

function getBeijingDateString() {
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return beijing.toISOString().split("T")[0];
}

async function fetchHackerNewsTop(limit = 15) {
  try {
    const res = await fetch(
      "https://hacker-news.firebaseio.com/v0/topstories.json",
      { signal: AbortSignal.timeout(10_000) },
    );
    const ids = await res.json();
    const stories = await Promise.all(
      ids.slice(0, limit).map(async (id) => {
        const r = await fetch(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
          { signal: AbortSignal.timeout(5_000) },
        );
        return r.json();
      }),
    );
    return stories
      .filter((s) => s?.title)
      .map((s) => ({
        title: s.title,
        url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
        score: s.score,
        comments: s.descendants || 0,
      }));
  } catch {
    console.warn("Failed to fetch HackerNews, continuing without it");
    return [];
  }
}

export async function fetchNexuIssues(token, limit = 8) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/nexu-io/nexu/issues?labels=good-first-issue&state=open&per_page=${limit}&sort=created&direction=desc`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "nexu-daily-content-bot",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const issues = await res.json();
    return Array.isArray(issues)
      ? issues.map((i) => ({
          title: i.title,
          url: i.html_url,
          number: i.number,
          labels: i.labels.map((l) => l.name),
        }))
      : [];
  } catch {
    console.warn("Failed to fetch Nexu issues, continuing without them");
    return [];
  }
}

function buildBilingualPrompt(theme, hnStories, dateStr) {
  const newsContext =
    hnStories.length > 0
      ? `\n\nToday's HackerNews top stories (use as reference, pick the best ones):\n${hnStories.map((s, i) => `${i + 1}. ${s.title} (${s.score} pts, ${s.comments} comments) ${s.url}`).join("\n")}`
      : "";

  return `You are the tech content editor for the Nexu open-source community. You write daily content for developer groups.

Date: ${dateStr}
Theme: ${theme.emoji} ${theme.titleEn}

${THEME_PROMPTS[theme.key] ?? THEME_PROMPTS["tech-news"]}
${newsContext}

## Output format

Output a single JSON object with BOTH Chinese and English versions (nothing else, just JSON):

{
  "zh": {
    "headline": "中文标题（15字以内，有吸引力）",
    "sections": [
      {
        "title": "板块标题",
        "items": [
          { "text": "中文内容描述（1-2句，精炼有信息量）", "url": "link or empty string" }
        ]
      }
    ],
    "footer": "中文结尾金句（面向开发者，有态度）"
  },
  "en": {
    "headline": "English headline (concise, engaging)",
    "sections": [
      {
        "title": "Section title",
        "items": [
          { "text": "English description (1-2 sentences, informative)", "url": "link or empty string" }
        ]
      }
    ],
    "footer": "English closing quote (developer-minded, opinionated)"
  }
}

## Style guidelines

Chinese version (飞书):
- 面向中文开发者，技术术语保留英文（Agent、Skill、PR、Issue）
- 有观点、有态度，不要营销腔
- 简洁有力，每条 1-2 句

English version (Discord):
- For a global developer audience, professional yet approachable
- Opinionated and insightful, not just a news dump
- Concise, 1-2 sentences per item
- Technical terms used naturally`;
}

async function callLLM(prompt, apiBase, apiKey, model) {
  const res = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 3000,
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`LLM returned non-JSON: ${raw.slice(0, 300)}`);
  }
  return JSON.parse(jsonMatch[0]);
}

// --- Feishu card (Chinese) ---

function buildFeishuCard(theme, content, dateStr) {
  const elements = [];

  elements.push({
    tag: "markdown",
    content: `📅 **${dateStr}** · ${theme.emoji} ${theme.titleZh}`,
  });
  elements.push({ tag: "hr" });

  for (const section of content.sections) {
    elements.push({ tag: "markdown", content: `**${section.title}**` });
    const itemTexts = section.items
      .map((item) =>
        item.url ? `• ${item.text} → [查看](${item.url})` : `• ${item.text}`,
      )
      .join("\n");
    elements.push({ tag: "markdown", content: itemTexts });
  }

  elements.push({ tag: "hr" });
  elements.push({ tag: "markdown", content: `💬 ${content.footer}` });

  elements.push({
    tag: "column_set",
    flex_mode: "flow",
    columns: [
      {
        tag: "column",
        width: "auto",
        elements: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "Good First Issue" },
            url: "https://github.com/nexu-io/nexu/labels/good-first-issue",
            type: "default",
          },
        ],
      },
      {
        tag: "column",
        width: "auto",
        elements: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "贡献者指南" },
            url: "https://docs.nexu.io/zh/guide/first-pr",
            type: "default",
          },
        ],
      },
      {
        tag: "column",
        width: "auto",
        elements: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "贡献奖励" },
            url: "https://docs.nexu.io/zh/guide/contributor-rewards",
            type: "default",
          },
        ],
      },
    ],
  });

  return {
    msg_type: "interactive",
    card: {
      schema: "2.0",
      header: {
        title: {
          tag: "plain_text",
          content: `${theme.emoji} ${content.headline}`,
        },
        template: theme.color,
      },
      body: { direction: "vertical", elements },
    },
  };
}

// --- Discord embed (English) ---

function buildDiscordEmbed(theme, content, dateStr) {
  const description = content.sections
    .map((section) => {
      const items = section.items
        .map((item) =>
          item.url ? `• ${item.text} → [Link](${item.url})` : `• ${item.text}`,
        )
        .join("\n");
      return `**${section.title}**\n${items}`;
    })
    .join("\n\n");

  return {
    embeds: [
      {
        title: `${theme.emoji} ${content.headline}`,
        description,
        color: theme.discordColor,
        footer: {
          text: `💬 ${content.footer}`,
        },
        timestamp: new Date().toISOString(),
        author: {
          name: `Nexu Daily · ${dateStr}`,
          url: "https://github.com/nexu-io/nexu",
          icon_url:
            "https://avatars.githubusercontent.com/u/195935545?s=200&v=4",
        },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "Good First Issue",
            url: "https://github.com/nexu-io/nexu/labels/good-first-issue",
          },
          {
            type: 2,
            style: 5,
            label: "Contributor Guide",
            url: "https://docs.nexu.io/en/guide/first-pr",
          },
          {
            type: 2,
            style: 5,
            label: "Rewards",
            url: "https://docs.nexu.io/en/guide/contributor-rewards",
          },
        ],
      },
    ],
  };
}

// --- Webhook delivery ---

function parseWebhookUrls(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

async function sendWebhook(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webhook failed (${res.status}): ${text}`);
  }

  const body = await res.json().catch(() => null);
  if (body && typeof body === "object" && "code" in body && body.code !== 0) {
    throw new Error(`Webhook business error (${body.code}): ${body.msg}`);
  }
}

async function broadcastWebhook(urls, payload, label) {
  if (urls.length === 0) return;
  const results = await Promise.allSettled(
    urls.map((url) => sendWebhook(url, payload)),
  );
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const fail = results.filter((r) => r.status === "rejected");
  console.log(`  ${label}: ${ok}/${results.length} succeeded`);
  if (fail.length > 0) {
    const msgs = fail.map((f) => f.reason?.message ?? String(f.reason));
    console.warn(`  ${label} failures: ${msgs.join("; ")}`);
  }
  if (fail.length === results.length) {
    throw fail[0].reason;
  }
}

// --- Main ---

export async function run(env = process.env) {
  const contentTheme = env.CONTENT_THEME || "tech-news";
  const feishuRaw = env.FEISHU_WEBHOOK_URL;
  const discordRaw = env.DISCORD_WEBHOOK_URL;
  const llmApiBase =
    env.LLM_API_BASE ||
    env.LITELLM_ENDPOINT ||
    "https://litellm.powerformer.net/v1";
  const llmApiKey = env.LLM_API_KEY || env.LITELLM_API_KEY;
  const llmModel = env.LLM_MODEL || "anthropic/claude-sonnet-4";

  const feishuUrls = parseWebhookUrls(feishuRaw);
  const discordUrls = parseWebhookUrls(discordRaw);

  if (feishuUrls.length === 0 && discordUrls.length === 0) {
    throw new Error(
      "At least one of FEISHU_WEBHOOK_URL or DISCORD_WEBHOOK_URL is required",
    );
  }
  if (!llmApiKey) {
    throw new Error("LLM_API_KEY (or LITELLM_API_KEY) is required");
  }

  const theme = THEME_CONFIG[contentTheme];
  if (!theme) {
    throw new Error(`Unknown CONTENT_THEME: ${contentTheme}`);
  }
  theme.key = contentTheme;

  const dateStr = getBeijingDateString();
  console.log(
    `Theme: ${theme.emoji} ${theme.titleZh} / ${theme.titleEn} (${dateStr})`,
  );

  const hnStories = await fetchHackerNewsTop(15);
  console.log(`Fetched ${hnStories.length} HN stories`);

  const prompt = buildBilingualPrompt(theme, hnStories, dateStr);
  console.log("Calling LLM for bilingual content generation...");
  const bilingual = await callLLM(prompt, llmApiBase, llmApiKey, llmModel);

  if (!bilingual.zh || !bilingual.en) {
    throw new Error("LLM did not return both zh and en content");
  }

  console.log(`Generated ZH: "${bilingual.zh.headline}"`);
  console.log(`Generated EN: "${bilingual.en.headline}"`);

  if (feishuUrls.length > 0) {
    const feishuCard = buildFeishuCard(theme, bilingual.zh, dateStr);
    await broadcastWebhook(feishuUrls, feishuCard, "Feishu");
  }

  if (discordUrls.length > 0) {
    const discordEmbed = buildDiscordEmbed(theme, bilingual.en, dateStr);
    await broadcastWebhook(discordUrls, discordEmbed, "Discord");
  }

  console.log("Daily content push completed");
  return {
    skipped: false,
    theme: contentTheme,
    headlineZh: bilingual.zh.headline,
    headlineEn: bilingual.en.headline,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run()
    .then((result) => {
      if (result.skipped) {
        console.log(`Skipped: ${result.reason}`);
        return;
      }
      console.log(
        `Sent: [${result.theme}] ZH: ${result.headlineZh} | EN: ${result.headlineEn}`,
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
