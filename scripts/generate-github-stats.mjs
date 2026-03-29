#!/usr/bin/env node
/**
 * Generates a "GitHub Stats" SVG — pixel-accurate replica of the reference design.
 * Usage: GITHUB_TOKEN=xxx node scripts/generate-github-stats.mjs [owner/repo] [out.svg]
 */
const OWNER = (process.argv[2] ?? "nexu-io/nexu").split("/")[0];
const REPO = (process.argv[2] ?? "nexu-io/nexu").split("/")[1];
const OUT = process.argv[3] ?? "docs/github-metrics.svg";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const headers = {
  Accept: "application/vnd.github+json",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function api(path, retries = 4) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(`https://api.github.com${path}`, { headers });
    if (res.status === 202) {
      console.log(`  ${path} → 202, retry ${i + 1}...`);
      await new Promise((r) => setTimeout(r, 4000));
      continue;
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
    return res.json();
  }
  return [];
}
async function searchCount(q) {
  const res = await fetch(
    `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=1`,
    { headers },
  );
  return res.ok ? ((await res.json()).total_count ?? 0) : 0;
}
function pct(cur, prev) {
  return prev === 0 ? (cur > 0 ? 100 : 0) : ((cur - prev) / prev) * 100;
}

async function fetchData() {
  const now = new Date();
  const d30 = new Date(now - 30 * 86400000);
  const d60 = new Date(now - 60 * 86400000);
  const iso30 = d30.toISOString().slice(0, 10);
  const iso60 = d60.toISOString().slice(0, 10);
  const isoNow = now.toISOString().slice(0, 10);

  const [ioCur, ioPrev, icCur, icPrev, prCur, prPrev, _repoInfo, contributors] =
    await Promise.all([
      searchCount(`repo:${OWNER}/${REPO} is:issue created:${iso30}..${isoNow}`),
      searchCount(`repo:${OWNER}/${REPO} is:issue created:${iso60}..${iso30}`),
      searchCount(
        `repo:${OWNER}/${REPO} is:issue is:closed closed:${iso30}..${isoNow}`,
      ),
      searchCount(
        `repo:${OWNER}/${REPO} is:issue is:closed closed:${iso60}..${iso30}`,
      ),
      searchCount(`repo:${OWNER}/${REPO} is:pr created:${iso30}..${isoNow}`),
      searchCount(`repo:${OWNER}/${REPO} is:pr created:${iso60}..${iso30}`),
      api(`/repos/${OWNER}/${REPO}`),
      api(`/repos/${OWNER}/${REPO}/stats/contributors`),
    ]);

  const commitActivity = await api(
    `/repos/${OWNER}/${REPO}/stats/commit_activity`,
  );

  // Fetch recent issues & PRs via list API for accurate daily counts
  async function listItems(type, params = "") {
    const items = [];
    for (let page = 1; page <= 3; page++) {
      const data = await api(
        `/repos/${OWNER}/${REPO}/${type}?state=all&per_page=100&page=${page}&sort=created&direction=desc${params}`,
      ).catch(() => []);
      if (!Array.isArray(data) || !data.length) break;
      items.push(...data);
      if (new Date(data[data.length - 1].created_at) < d30) break;
    }
    return items;
  }

  const [recentIssues, recentPRs] = await Promise.all([
    listItems("issues", "&filter=all"),
    listItems("pulls"),
  ]);

  // Daily buckets (10 days — denser, more visual)
  const days = 10;
  const dIO = new Array(days).fill(0);
  const dIC = new Array(days).fill(0);
  const dPO = new Array(days).fill(0);
  const dPC = new Array(days).fill(0);
  const dPush = new Array(days).fill(0);

  for (const issue of recentIssues) {
    if (issue.pull_request) continue;
    const created = Math.floor((now - new Date(issue.created_at)) / 86400000);
    if (created >= 0 && created < days) dIO[days - 1 - created]++;
    if (issue.closed_at) {
      const closed = Math.floor((now - new Date(issue.closed_at)) / 86400000);
      if (closed >= 0 && closed < days) dIC[days - 1 - closed]++;
    }
  }
  for (const pr of recentPRs) {
    const created = Math.floor((now - new Date(pr.created_at)) / 86400000);
    if (created >= 0 && created < days) dPO[days - 1 - created]++;
    if (pr.closed_at) {
      const closed = Math.floor((now - new Date(pr.closed_at)) / 86400000);
      if (closed >= 0 && closed < days) dPC[days - 1 - closed]++;
    }
  }

  // Pushes from commit_activity (daily breakdown)
  if (Array.isArray(commitActivity)) {
    for (const week of commitActivity.slice(-2)) {
      for (let dd = 0; dd < 7; dd++) {
        const dayDate = new Date(week.week * 1000 + dd * 86400000);
        const ago = Math.floor((now - dayDate) / 86400000);
        if (ago >= 0 && ago < days) dPush[days - 1 - ago] = week.days[dd];
      }
    }
  }

  // Pushes MoM
  let pushCur = 0;
  let pushPrev = 0;
  if (Array.isArray(commitActivity) && commitActivity.length >= 8) {
    pushCur = commitActivity.slice(-4).reduce((s, w) => s + w.total, 0);
    pushPrev = commitActivity.slice(-8, -4).reduce((s, w) => s + w.total, 0);
  }

  // 30-day heatmap
  const heatmap = new Array(30).fill(0);
  if (Array.isArray(commitActivity)) {
    for (const week of commitActivity.slice(-5)) {
      for (let d = 0; d < 7; d++) {
        const dayDate = new Date(week.week * 1000 + d * 86400000);
        const ago = Math.floor((now - dayDate) / 86400000);
        if (ago >= 0 && ago < 30) heatmap[29 - ago] = week.days[d];
      }
    }
  }
  const totalContrib = heatmap.reduce((a, b) => a + b, 0) + ioCur + prCur;

  // Issue ratio
  const ratio = icCur > 0 ? ioCur / icCur : ioCur;
  const ratioPrev = icPrev > 0 ? ioPrev / icPrev : ioPrev;

  // Top contributors
  const topC = [];
  if (Array.isArray(contributors)) {
    for (const c of contributors) {
      const weeks = (c.weeks || []).slice(-4);
      const commits = weeks.reduce((s, w) => s + w.c, 0);
      if (commits > 0)
        topC.push({
          login: c.author?.login ?? "unknown",
          commits,
          weeks: weeks.map((w) => w.c),
        });
    }
    topC.sort((a, b) => b.commits - a.commits);
    topC.splice(5);
  }

  return {
    totalContrib,
    heatmap,
    ratio,
    ratioDelta: ratio - ratioPrev,
    ratioPct: pct(ratio, ratioPrev),
    prCur,
    prDelta: prCur - prPrev,
    prPct: pct(prCur, prPrev),
    pushCur,
    pushDelta: pushCur - pushPrev,
    pushPct: pct(pushCur, pushPrev),
    dIO,
    dIC,
    dPO,
    dPC,
    dPush,
    topC,
  };
}

// ─── SVG Rendering (1:1 replica of reference design) ─────────────────────────

function render(d) {
  const W = 960;
  const pad = 32;
  const cw = W - pad * 2;
  const cardGap = 14;
  const cardW = Math.floor((cw - cardGap * 2) / 3);

  // Heatmap colors (pink/magenta like reference)
  const hmMax = Math.max(...d.heatmap, 1);
  const hmColor = (v) =>
    v === 0
      ? "#ebedf0"
      : v / hmMax <= 0.25
        ? "#ffb3c6"
        : v / hmMax <= 0.5
          ? "#ff7096"
          : v / hmMax <= 0.75
            ? "#e8457a"
            : "#c9184a";

  let hmSquares = "";
  for (let i = 0; i < d.heatmap.length; i++)
    hmSquares += `<rect x="${i * 14}" y="0" width="10" height="10" rx="2" fill="${hmColor(d.heatmap[i])}"/>`;

  // Bar chart renderer
  function bars(d1, d2, c1, c2, title, titleIcon, legendItems) {
    const n = d1.length;
    const ch = 90;
    const minH = 4;
    const totalBarArea = cardW - 36;
    const groupW = Math.floor(totalBarArea / n);
    const barGap = Math.max(3, Math.floor(groupW * 0.2));
    const bw = d2 ? Math.floor((groupW - barGap) / 2) : groupW - barGap;
    const max = Math.max(...d1, ...(d2 || [0]), 1);
    let svg = "";
    for (let i = 0; i < n; i++) {
      const gx = 18 + i * groupW;
      if (d2) {
        const h1 = d1[i] > 0 ? Math.max((d1[i] / max) * ch, minH) : 0;
        const h2 = d2[i] > 0 ? Math.max((d2[i] / max) * ch, minH) : 0;
        svg += `<rect x="${gx}" y="${40 + ch - h1}" width="${bw}" height="${h1}" fill="${c1}" rx="2"/>`;
        svg += `<rect x="${gx + bw + 1}" y="${40 + ch - h2}" width="${bw}" height="${h2}" fill="${c2}" rx="2"/>`;
      } else {
        const h1 = d1[i] > 0 ? Math.max((d1[i] / max) * ch, minH) : 0;
        svg += `<rect x="${gx + Math.floor(bw / 2)}" y="${40 + ch - h1}" width="${bw}" height="${h1}" fill="${c1}" rx="2"/>`;
      }
    }
    // Legend dots
    let lx = cardW - 16;
    let legend = "";
    for (let li = legendItems.length - 1; li >= 0; li--) {
      const item = legendItems[li];
      const tw = item.label.length * 6.5 + 18;
      lx -= tw;
      legend += `<circle cx="${lx}" cy="18" r="4" fill="${item.color}"/>`;
      legend += `<text x="${lx + 10}" y="22" font-size="11" fill="#656d76">${item.label}</text>`;
    }
    return `<g>
      <rect width="${cardW}" height="148" rx="10" fill="white" stroke="#d0d7de" stroke-width="1"/>
      ${titleIcon}
      <text x="38" y="23" font-size="14" font-weight="600" fill="#1f2328">${title}</text>
      ${legend}
      ${svg}
    </g>`;
  }

  // KPI card renderer
  function kpi(title, value, delta, pctVal, titleColor) {
    const up = delta >= 0;
    const arrow = up ? "↑" : "↓";
    const arrowCol = up ? "#1a7f37" : "#cf222e";
    const sign = delta >= 0 ? "+" : "";
    const deltaStr = Number.isInteger(delta) ? String(delta) : delta.toFixed(2);
    return `<g>
      <rect width="${cardW}" height="76" rx="10" fill="white" stroke="#d0d7de" stroke-width="1"/>
      <text x="16" y="30" font-size="15" font-weight="700" fill="${titleColor}">${value} ${title}</text>
      <text x="16" y="54" font-size="12.5" fill="#656d76">${sign}${deltaStr} (${Math.abs(pctVal).toFixed(2)}%)</text>
      <text x="${cardW - 16}" y="54" text-anchor="end" font-size="12.5" font-weight="600" fill="${arrowCol}">${arrow} past month</text>
    </g>`;
  }

  // Contributor mini heatmap (compact green squares like reference)
  function miniHM(weeks) {
    const mx = Math.max(...weeks, 1);
    let s = "";
    const cols = weeks.length * 2;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < 3; r++) {
        const wk = Math.floor(c / 2);
        const v = ((weeks[wk] || 0) * (3 - r + (c % 2) * 0.5)) / 4;
        const color =
          v > mx * 0.5
            ? "#216e39"
            : v > mx * 0.2
              ? "#40c463"
              : v > mx * 0.02
                ? "#9be9a8"
                : "#ebedf0";
        s += `<rect x="${c * 5}" y="${r * 5}" width="4" height="4" rx="0.8" fill="${color}"/>`;
      }
    }
    return s;
  }

  // Icons (SVG paths mimicking the reference)
  const contribIcon = `<g transform="translate(14, 11)">
    ${[0, 6, 12, 18].map((x) => [0, 6, 12].map((y) => `<rect x="${x}" y="${y}" width="4" height="4" rx="0.5" fill="#c9184a" opacity="0.7"/>`).join("")).join("")}
  </g>`;

  const issueIcon = `<circle cx="22" cy="18" r="8" fill="none" stroke="#0969da" stroke-width="2"/>
    <circle cx="22" cy="18" r="2.5" fill="#0969da"/>`;

  const prIcon = `<g transform="translate(14, 8)">
    <circle cx="4" cy="5" r="3" fill="none" stroke="#8250df" stroke-width="1.8"/>
    <circle cx="4" cy="19" r="3" fill="none" stroke="#8250df" stroke-width="1.8"/>
    <line x1="4" y1="8" x2="4" y2="16" stroke="#8250df" stroke-width="1.8"/>
    <circle cx="16" cy="19" r="3" fill="none" stroke="#8250df" stroke-width="1.8"/>
    <path d="M16 16 L16 10 Q16 5 11 5 L8 5" fill="none" stroke="#8250df" stroke-width="1.8"/>
  </g>`;

  const pushIcon = `<g transform="translate(14, 10)">
    <rect x="2" y="10" width="16" height="10" rx="2" fill="none" stroke="#bc4c00" stroke-width="1.8"/>
    <path d="M10 14 L10 2 M6 6 L10 2 L14 6" fill="none" stroke="#bc4c00" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;

  // Contributors section
  let contribs = "";
  const cStartX = 168;
  const cSpacing = Math.floor((cw - cStartX - 20) / Math.max(d.topC.length, 1));
  for (let i = 0; i < d.topC.length; i++) {
    const c = d.topC[i];
    const x = cStartX + i * cSpacing;
    contribs += `<g transform="translate(${x}, 0)">
      <text font-size="11" font-weight="500" fill="#1f2328" font-family="monospace">${c.login}</text>
      <g transform="translate(0, 5)">${miniHM(c.weeks)}</g>
    </g>`;
  }

  const H = 396;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><style>text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}</style></defs>
<rect width="${W}" height="${H}" fill="#fff"/>

<!-- Contributions row -->
<g transform="translate(${pad}, 16)">
  <rect width="${cw}" height="42" rx="8" fill="#f6f8fa" stroke="#d0d7de" stroke-width="1"/>
  ${contribIcon}
  <text x="42" y="28" font-size="14" font-weight="600" fill="#c9184a">${d.totalContrib} Contributions in the Last 30 Days</text>
  <g transform="translate(${cw - d.heatmap.length * 14 - 14}, 16)">${hmSquares}</g>
</g>

<!-- KPI cards row -->
<g transform="translate(${pad}, 74)">
  <g transform="translate(0, 0)">${kpi("Opened/Closed Issue Ratio", d.ratio.toFixed(2), d.ratioDelta, d.ratioPct, "#1f2328")}</g>
  <g transform="translate(${cardW + cardGap}, 0)">${kpi("Pull Requests Opened", d.prCur, d.prDelta, d.prPct, "#8250df")}</g>
  <g transform="translate(${(cardW + cardGap) * 2}, 0)">${kpi("Pushes", d.pushCur, d.pushDelta, d.pushPct, "#bc4c00")}</g>
</g>

<!-- Bar charts row -->
<g transform="translate(${pad}, 168)">
  <g transform="translate(0, 0)">${bars(
    d.dIO,
    d.dIC,
    "#54aeff",
    "#0969da",
    "Issues",
    issueIcon,
    [
      { color: "#54aeff", label: "Opened" },
      { color: "#0969da", label: "Closed" },
    ],
  )}</g>
  <g transform="translate(${cardW + cardGap}, 0)">${bars(
    d.dPO,
    d.dPC,
    "#e085d0",
    "#8250df",
    "Pull Requests",
    prIcon,
    [
      { color: "#e085d0", label: "Opened" },
      { color: "#8250df", label: "Closed" },
    ],
  )}</g>
  <g transform="translate(${(cardW + cardGap) * 2}, 0)">${bars(d.dPush, null, "#f97316", null, "Pushes", pushIcon, [{ color: "#f97316", label: "Pushes" }])}</g>
</g>

<!-- Top Contributors -->
<g transform="translate(${pad}, 334)">
  <rect width="${cw}" height="42" rx="8" fill="#f6f8fa" stroke="#d0d7de" stroke-width="1"/>
  <g transform="translate(14, 16)">
    <text font-size="13" font-weight="600" fill="#1a7f37">
      <tspan fill="#c9184a" font-size="14">&#x2764;</tspan>
      <tspan dx="4">Top Contributors</tspan>
    </text>
  </g>
  <g transform="translate(0, 10)">${contribs}</g>
</g>

<!-- Footer -->
<text x="${W / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#8b949e">Updated ${new Date().toISOString().slice(0, 10)} · ${OWNER}/${REPO}</text>
</svg>`;
}

// ─── Main ────────────────────────────────────────────────────────────────────
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

async function main() {
  console.log(`Fetching ${OWNER}/${REPO} ...`);
  const data = await fetchData();
  console.log(
    `  Contributions: ${data.totalContrib}, PRs: ${data.prCur}, Pushes: ${data.pushCur}`,
  );
  console.log(
    `  Issue ratio: ${data.ratio.toFixed(2)} (Δ${data.ratioDelta.toFixed(2)})`,
  );
  console.log(`  Contributors: ${data.topC.map((c) => c.login).join(", ")}`);
  const svg = render(data);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, svg, "utf-8");
  console.log(`→ ${OUT} (${(svg.length / 1024).toFixed(1)} KB)`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
