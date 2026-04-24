#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RELEASE_LIMIT = 3;

function parseArgs(argv) {
  const args = { lang: "zh", limit: DEFAULT_RELEASE_LIMIT, query: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--lang" && argv[i + 1]) {
      args.lang = argv[i + 1] === "en" ? "en" : "zh";
      i += 1;
      continue;
    }
    if (arg === "--limit" && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        args.limit = Math.min(value, 10);
      }
      i += 1;
      continue;
    }
    if (arg === "--query" && argv[i + 1]) {
      args.query = argv[i + 1].trim();
      i += 1;
    }
  }
  return args;
}

function withTimeout(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return AbortSignal.timeout(timeoutMs);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "nexu-skill/collect-nexu-identity",
      accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    },
    signal: withTimeout(),
  });
  if (!response.ok) {
    throw new Error(`${url} -> HTTP ${response.status}`);
  }
  return await response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "nexu-skill/collect-nexu-identity",
      accept: "application/json",
    },
    signal: withTimeout(),
  });
  if (!response.ok) {
    throw new Error(`${url} -> HTTP ${response.status}`);
  }
  return await response.json();
}

function decodeHtmlEntities(text) {
  return text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#x2F;", "/");
}

function stripHtml(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<(br|\/p|\/li|\/h\d|\/div)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/\t/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeText(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractQueryKeywords(query) {
  const text = normalizeText(query);
  if (!text) return [];

  const latinWords = text.match(/[a-z0-9][a-z0-9-]{1,}/g) ?? [];
  const cjkChunks = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const coarseChunks = [];

  for (const chunk of cjkChunks) {
    coarseChunks.push(chunk);
    if (chunk.length > 4) {
      coarseChunks.push(chunk.slice(0, 4));
      coarseChunks.push(chunk.slice(-4));
    }
  }

  return uniqueNonEmpty([...latinWords, ...coarseChunks]).slice(0, 12);
}

function detectTopic(query) {
  const text = normalizeText(query);
  if (!text) return "general";
  if (/(谁|是什么|介绍|what is|who is|是谁|是什么产品)/i.test(text)) {
    return "identity";
  }
  if (/(更新|版本|release|changelog|最近|latest|新版本|发布)/i.test(text)) {
    return "updates";
  }
  if (/(渠道|飞书|slack|discord|telegram|whatsapp|wechat|接入|im|channel)/i.test(text)) {
    return "channels";
  }
  if (/(功能|能力|能做什么|可以做什么|支持什么|feature|capability|skill)/i.test(text)) {
    return "capabilities";
  }
  if (/(开源|隐私|byok|模型|本地|local|open source|openclaw|electron)/i.test(text)) {
    return "architecture";
  }
  return "general";
}

function scoreLine(line, keywords, topic) {
  const text = normalizeText(line);
  let score = 0;

  for (const keyword of keywords) {
    if (text.includes(keyword)) score += 3;
  }

  const topicPatterns = {
    identity:
      /(next to you|next u|openclaw|开源|桌面客户端|desktop client|agent|智能桌面客户端|im)/i,
    updates:
      /(v\d+\.\d+\.\d+|release|发布|更新|seedance|startup|recent|最新)/i,
    channels:
      /(飞书|slack|discord|telegram|whatsapp|wechat|channel|接入|im)/i,
    capabilities:
      /(skills|视频|生成|graphical|图形化|模型|byok|支持|功能)/i,
    architecture:
      /(open source|开源|local|本地|electron|openclaw|隐私|byok|模型)/i,
    general:
      /(nexu|openclaw|开源|飞书|slack|discord|release|更新)/i,
  };

  if (topicPatterns[topic]?.test(text)) score += 2;
  if (/nexu|openclaw/i.test(text)) score += 1;

  return score;
}

function selectRelevantLines(candidates, query, topic, limit = 5) {
  const keywords = extractQueryKeywords(query);
  const scored = candidates
    .map((line) => ({ line, score: scoreLine(line, keywords, topic) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const ranked = scored.length > 0 ? scored.map((item) => item.line) : candidates;
  return uniqueNonEmpty(ranked).slice(0, limit);
}

function pickMeaningfulLines(text, limit = 4) {
  const ignoredPatterns = [
    /^Introduction$/i,
    /^介绍$/i,
    /^Get started$/i,
    /^快速导航$/i,
    /^Blog$/i,
    /^All$/i,
    /^Announcements$/i,
    /^Guides$/i,
    /^Use Cases$/i,
    /^Menu\b/i,
    /^Sidebar\b/i,
    /^Return to top$/i,
    /^Star us\b/i,
    /^Download\b/i,
    /^English\b/i,
  ];

  const lines = uniqueNonEmpty(text.split("\n")).filter((line) => {
    if (line.length < 18) return false;
    if (ignoredPatterns.some((pattern) => pattern.test(line))) return false;
    return true;
  });

  const preferred = lines.filter((line) =>
    /(nexu|OpenClaw|飞书|Slack|Discord|桌面客户端|desktop client|BYOK|开源)/i.test(
      line,
    ),
  );

  return uniqueNonEmpty([...preferred, ...lines]).slice(0, limit);
}

function extractPageTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  return decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim());
}

function extractBlogPosts(html, limit = 5) {
  const matches = html.matchAll(/href="(\/blog\/[^"#?]+)"[\s\S]*?>([\s\S]*?)<\/a>/gi);
  const posts = [];
  const seen = new Set();

  for (const match of matches) {
    const url = `https://nexu.io${match[1]}`;
    const text = compressBlogTitle(
      stripHtml(match[2]).replace(/\s+/g, " ").trim(),
    );
    if (!text || text.length < 16) continue;
    if (/^(Blog|Read more)$/i.test(text)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    posts.push({ title: text, url });
    if (posts.length >= limit) break;
  }

  return posts;
}

function compressBlogTitle(text) {
  let value = text
    .replace(
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}[\s\S]*$/i,
      "",
    )
    .replace(/^(Announcements|Guides|Use Cases)\s+/i, "")
    .trim();

  const bringsIndex = value.search(/\sv\d+\.\d+\.\d+\s+brings\s/i);
  if (bringsIndex > 0) {
    value = value.slice(0, bringsIndex).trim();
  }

  const sentenceIndex = value.indexOf(". ");
  if (sentenceIndex > 0) {
    value = value.slice(0, sentenceIndex).trim();
  }

  if (value.length > 140) {
    value = `${value.slice(0, 137).trim()}...`;
  }

  return value;
}

function cleanMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_~>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractReleaseHighlights(body, limit = 3) {
  const lines = body
    .split("\n")
    .map((line) => cleanMarkdown(line))
    .filter((line) => line.length >= 12);

  return uniqueNonEmpty(lines).slice(0, limit);
}

async function collectDocs(lang) {
  const url = lang === "en" ? "https://docs.nexu.io/" : "https://docs.nexu.io/zh/";
  const html = await fetchText(url);
  const text = stripHtml(html);
  return {
    url,
    title: extractPageTitle(html),
    summary: pickMeaningfulLines(text, 4),
  };
}

async function collectBlog() {
  const url = "https://nexu.io/blog";
  const html = await fetchText(url);
  const text = stripHtml(html);
  return {
    url,
    title: extractPageTitle(html),
    summary: pickMeaningfulLines(text, 4),
    recentPosts: extractBlogPosts(html, 5),
  };
}

async function collectReleases(limit) {
  const url = `https://api.github.com/repos/nexu-io/nexu/releases?per_page=${limit}`;
  const releases = await fetchJson(url);
  const normalized = releases.map((release) => ({
    tag: release.tag_name ?? null,
    name: release.name ?? release.tag_name ?? null,
    publishedAt: release.published_at ?? null,
    url: release.html_url ?? null,
    highlights: extractReleaseHighlights(release.body ?? "", 3),
  }));

  return {
    url: "https://github.com/nexu-io/nexu/releases",
    latest: normalized[0] ?? null,
    recent: normalized,
  };
}

function buildBriefing(result, args) {
  const docsSummary = result.sources.docs?.summary ?? [];
  const blogPosts = result.sources.blog?.recentPosts ?? [];
  const latestRelease = result.sources.releases?.latest;
  const topic = detectTopic(args.query);
  const query = args.query.trim();

  const docsPreferred = docsSummary.filter((line) =>
    /(nexu|OpenClaw|飞书|Slack|Discord|桌面客户端|desktop client|BYOK|开源)/i.test(
      line,
    ),
  );

  const identityPoints = uniqueNonEmpty([
    ...docsPreferred,
    ...docsSummary,
  ]).slice(0, 3);

  const momentumPoints = [];
  if (blogPosts[0]?.title) {
    momentumPoints.push(`Recent blog focus: ${blogPosts[0].title}`);
  }
  if (blogPosts[1]?.title) {
    momentumPoints.push(`Another recent blog signal: ${blogPosts[1].title}`);
  }
  if (latestRelease?.tag || latestRelease?.name) {
    const label = latestRelease.name || latestRelease.tag;
    momentumPoints.push(`Latest release: ${label}`);
  }
  for (const highlight of (latestRelease?.highlights ?? []).filter((line) =>
    !/highlights$/i.test(line),
  )) {
    momentumPoints.push(`Release highlight: ${highlight}`);
  }

  const candidateLines = uniqueNonEmpty([
    ...identityPoints,
    ...docsSummary,
    ...blogPosts.map((post) => `Blog: ${post.title}`),
    ...(latestRelease?.tag || latestRelease?.name
      ? [`Latest release: ${latestRelease.name || latestRelease.tag}`]
      : []),
    ...((latestRelease?.highlights ?? []).filter((line) => !/highlights$/i.test(line))),
  ]);

  const relevantPoints = selectRelevantLines(candidateLines, query, topic, 5);

  const sourceCoverage = {
    docs: Boolean(result.sources.docs),
    blog: Boolean(result.sources.blog),
    releases: Boolean(result.sources.releases),
  };

  let recentUpdate = null;
  if (latestRelease?.tag || latestRelease?.name) {
    recentUpdate = {
      label: latestRelease.name || latestRelease.tag,
      publishedAt: latestRelease.publishedAt,
      highlights: (latestRelease.highlights ?? []).filter(
        (line) => !/highlights$/i.test(line),
      ),
    };
  } else if (blogPosts[0]?.title) {
    recentUpdate = {
      label: blogPosts[0].title,
      publishedAt: null,
      highlights: [],
    };
  }

  return {
    question: query,
    topic,
    identityPoints,
    momentumPoints: uniqueNonEmpty(momentumPoints).slice(0, 5),
    relevantPoints,
    recentUpdate,
    sourceCoverage,
    answerRules: [
      "Answer the user's nexu question directly.",
      "Ground the answer in docs/blog/releases instead of memory.",
      "Use the most relevant points for the detected topic first.",
      "Mention a recent release or blog update when it helps answer the question.",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const warnings = [];
  const sources = {};

  for (const task of [
    ["docs", () => collectDocs(args.lang)],
    ["blog", () => collectBlog()],
    ["releases", () => collectReleases(args.limit)],
  ]) {
    const [key, runner] = task;
    try {
      sources[key] = await runner();
    } catch (error) {
      warnings.push(
        `${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    language: args.lang,
    query: args.query,
    warnings,
    sources,
    briefing: buildBriefing({ sources }, args),
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
