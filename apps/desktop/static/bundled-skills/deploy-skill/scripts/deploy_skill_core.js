import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const CONFIG_FILENAME = "deploy-skill.json";
const JOBS_FILENAME = "deploy-skill-jobs.json";
const NEXU_CONFIG_FILENAME = "config.json";
const GENERATED_DIRNAME = "deploy-skill-generated";
const DISTILL_AVATAR_ROOT =
  "/Users/alche/Downloads/distill-campaign-clone/images";
const DISTILL_PORTRAIT_MAP = Object.freeze({
  "portrait-1": "05ece7aece7d5a8c3ad9aae3ecfbd20b_pixian_ai.png",
  "portrait-2": "1d8f55fb0ef3d2a6149d2d999aa79c06_pixian_ai.png",
  "portrait-3": "24a229ae040e9ccb578c01cc6821a2f2_pixian_ai.png",
  "portrait-4": "4b7b55f162dafff58baf54d05463eb5e_pixian_ai.png",
  "portrait-5": "b0ed8642ea2fdfbf2e6440772bc9d89b_pixian_ai.png",
  "portrait-6": "bd74a1adfbec68bf008cba7ce62d22b6_pixian_ai.png",
  "portrait-7": "f1763ea5ebb1d7b6cc1ddcf41b177f40_pixian_ai.png",
});
const NEXU_REPO_URL = "https://github.com/nexu-io/nexu";
const ROAST_SKILL_URL = "https://github.com/nexu-io/roast-skill";
const NEXU_LOGO_FILE = "assets/logo.png";
const NEXU_QR_FILE = "assets/qr.png";
const NEXU_POSTER_BG_FILE = "assets/poster-bg.png";
const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);
const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const FINAL_HOST_SUFFIX = ".nexu.space";
const FALLBACK_HOST_SUFFIX = ".pages.dev";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(SCRIPT_DIR, "../templates");

function configPath(nexuHome) {
  return path.join(nexuHome, CONFIG_FILENAME);
}

function jobsPath(nexuHome) {
  return path.join(nexuHome, JOBS_FILENAME);
}

function nexuConfigPath(nexuHome) {
  return path.join(nexuHome, NEXU_CONFIG_FILENAME);
}

function nowIso(nowImpl = () => new Date()) {
  return nowImpl().toISOString();
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return fallbackValue;
      }
    }
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function validateBaseUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
    return url.toString().replace(/\/+$/u, "");
  } catch {
    throw new Error("deploy-skill baseUrl must be a valid http(s) URL.");
  }
}

export async function loadPageDeployConfig(nexuHome) {
  return readJsonFile(configPath(nexuHome), {});
}

async function loadLocalNexuConfig(nexuHome) {
  return readJsonFile(nexuConfigPath(nexuHome), {});
}

export async function savePageDeployConfig(nexuHome, config) {
  const nextConfig = {
    baseUrl: validateBaseUrl(config.baseUrl),
  };
  await writeJsonFile(configPath(nexuHome), nextConfig);
  return nextConfig;
}

export async function loadPageDeployJobs(nexuHome) {
  return readJsonFile(jobsPath(nexuHome), []);
}

async function savePageDeployJobs(nexuHome, jobs) {
  await writeJsonFile(jobsPath(nexuHome), jobs);
}

function generatedDir(nexuHome) {
  return path.join(nexuHome, GENERATED_DIRNAME);
}

function assertValidZipPath(zipPath, stats) {
  if (!stats.isFile()) {
    throw new Error(`Zip path is not a file: ${zipPath}`);
  }
  if (path.extname(zipPath).toLowerCase() !== ".zip") {
    throw new Error("Static deploy requires a .zip file.");
  }
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`deploy-skill requires ${fieldName}.`);
  }
  return value.trim();
}

function stringLength(value) {
  return Array.from(value).length;
}

function assertStringLength(value, fieldName, min, max) {
  if (typeof value !== "string") {
    throw new Error(
      `deploy-skill template field ${fieldName} must be a string.`,
    );
  }
  const length = stringLength(value.trim());
  if (length < min || length > max) {
    throw new Error(
      `deploy-skill template field ${fieldName} must be ${min}-${max} characters.`,
    );
  }
  return value.trim();
}

function assertPlainText(value, fieldName, min, max) {
  const text = assertStringLength(value, fieldName, min, max);
  if (/\r|\n/u.test(text)) {
    throw new Error(
      `deploy-skill template field ${fieldName} must not contain newlines.`,
    );
  }
  if (/<[^>]+>/u.test(text)) {
    throw new Error(
      `deploy-skill template field ${fieldName} must not contain HTML.`,
    );
  }
  if (/[`*_>#]/u.test(text)) {
    throw new Error(
      `deploy-skill template field ${fieldName} must not contain markdown.`,
    );
  }
  return text;
}

function assertExactText(value, fieldName, expected) {
  if (typeof value !== "string" || value !== expected) {
    throw new Error(
      `deploy-skill template field ${fieldName} must match the required fixed value.`,
    );
  }
  return value;
}

function assertMetricLabel(value, fieldName, min, max) {
  const label = assertStringLength(value, fieldName, min, max);
  if (/\r|\n/u.test(label) || /<[^>]+>/u.test(label)) {
    throw new Error(
      `deploy-skill template field ${fieldName} must be plain text.`,
    );
  }
  return label;
}

function assertMetricValue(value, fieldName, { allowPercent = false } = {}) {
  if (typeof value !== "string") {
    throw new Error(
      `deploy-skill template field ${fieldName} must be a string.`,
    );
  }
  const text = value.trim();
  if (allowPercent) {
    if (!/^\d+%$/u.test(text)) {
      throw new Error(
        `deploy-skill template field ${fieldName} must be a percentage string.`,
      );
    }
    return text;
  }
  if (!/^\d+$/u.test(text)) {
    throw new Error(
      `deploy-skill template field ${fieldName} must be a numeric string without percent notation.`,
    );
  }
  return text;
}

function assertPortraitId(value) {
  if (typeof value !== "string" || !(value in DISTILL_PORTRAIT_MAP)) {
    throw new Error(
      `deploy-skill template field portraitId must be one of: ${Object.keys(DISTILL_PORTRAIT_MAP).join(", ")}.`,
    );
  }
  return value;
}

async function readRequiredFile(filePath) {
  return readFile(filePath, "utf8");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function percentageFromMetricValue(value) {
  const match = String(value).match(/(\d+(?:\.\d+)?)/u);
  if (!match) {
    return 50;
  }
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) {
    return 50;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function assertArrayLength(value, fieldName, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(
      `deploy-skill template field ${fieldName} must contain ${min}-${max} items.`,
    );
  }
  return value;
}

function parseTemplateContent(templateId, payload) {
  if (templateId !== "distill-campaign") {
    throw new Error(`deploy-skill unknown template: ${templateId}`);
  }
  if (typeof payload !== "object" || payload === null) {
    throw new Error("deploy-skill template content must be a JSON object.");
  }

  const title = assertStringLength(payload.title, "title", 2, 10);
  const subtitle = assertNonEmptyString(payload.subtitle, "subtitle");
  if (
    stringLength(subtitle) < 15 ||
    stringLength(subtitle) > 30 ||
    !subtitle.includes("牛马指数") ||
    !subtitle.includes("/100") ||
    !subtitle.includes("—")
  ) {
    throw new Error(
      "deploy-skill template field subtitle must be 15-30 characters and include 牛马指数, /100, and —.",
    );
  }
  const description = assertPlainText(
    payload.description,
    "description",
    150,
    250,
  );
  const ctaText = assertExactText(
    payload.ctaText,
    "ctaText",
    "⭐ 生成我的牛马锐评",
  );
  const installText = assertExactText(
    payload.installText,
    "installText",
    "复制链接发给你的 nexu agent：https://github.com/nexu-io/roast-skill",
  );
  const tags = assertArrayLength(payload.tags, "tags", 1, 8).map((tag, index) =>
    assertStringLength(tag, `tags[${index}]`, 2, 8),
  );
  const metrics = assertArrayLength(payload.metrics, "metrics", 4, 6).map(
    (metric, index) => {
      if (typeof metric !== "object" || metric === null) {
        throw new Error(
          `deploy-skill template field metrics[${index}] is invalid.`,
        );
      }
      const labelMin = index === 0 ? 6 : 6;
      const labelMax = index === 0 ? 10 : 12;
      return {
        label: assertMetricLabel(
          metric.label,
          `metrics[${index}].label`,
          labelMin,
          labelMax,
        ),
        value:
          index === 0
            ? assertMetricValue(metric.value, `metrics[${index}].value`)
            : assertMetricValue(metric.value, `metrics[${index}].value`, {
                allowPercent: true,
              }),
      };
    },
  );
  const qaCards = assertArrayLength(payload.qaCards, "qaCards", 2, 3).map(
    (card, index) => {
      if (typeof card !== "object" || card === null) {
        throw new Error(
          `deploy-skill template field qaCards[${index}] is invalid.`,
        );
      }
      return {
        question: assertPlainText(
          card.question,
          `qaCards[${index}].question`,
          3,
          8,
        ),
        answer: assertPlainText(
          card.answer,
          `qaCards[${index}].answer`,
          80,
          150,
        ),
      };
    },
  );
  const dialogs = assertArrayLength(payload.dialogs, "dialogs", 3, 6).map(
    (dialog, index) => {
      if (typeof dialog !== "object" || dialog === null) {
        throw new Error(
          `deploy-skill template field dialogs[${index}] is invalid.`,
        );
      }
      const speaker = assertNonEmptyString(
        dialog.speaker,
        `dialogs[${index}].speaker`,
      ).toLowerCase();
      if (speaker !== "bot" && speaker !== "user") {
        throw new Error(
          `deploy-skill template field dialogs[${index}].speaker must be bot or user.`,
        );
      }
      return {
        speaker,
        text: assertPlainText(dialog.text, `dialogs[${index}].text`, 15, 80),
      };
    },
  );

  return {
    title,
    subtitle,
    portraitId: assertPortraitId(payload.portraitId),
    tags,
    metrics,
    description,
    qaCards,
    dialogs,
    ctaText,
    installText,
    posterSpeciesEmoji: assertStringLength(
      payload.posterSpeciesEmoji,
      "posterSpeciesEmoji",
      1,
      4,
    ),
    posterSpeciesName: assertStringLength(
      payload.posterSpeciesName,
      "posterSpeciesName",
      3,
      8,
    ),
    posterSpeciesSub: assertStringLength(
      payload.posterSpeciesSub,
      "posterSpeciesSub",
      5,
      8,
    ),
  };
}

function renderDistillCampaignHtml(content, selectedAvatar) {
  const socialTags = content.tags
    .slice(0, 8)
    .map(
      (tag, index) =>
        `<span class="stag stag-${["purple", "cyan", "orange", "teal", "mint"][index % 5]}">${escapeHtml(tag)}</span>`,
    )
    .join("");
  const posterTagsMarkup = content.tags
    .slice(0, 8)
    .map(
      (tag, index) =>
        `<span class="poster-tag stag stag-${["purple", "cyan", "orange", "teal", "mint"][index % 5]}">${escapeHtml(tag)}</span>`,
    )
    .join("");
  const posterTagChunks = posterTagsMarkup
    .split("</span>")
    .filter(Boolean)
    .map((part) => `${part}</span>`);
  const posterTagsRowOne = posterTagChunks.slice(0, 4).join("");
  const posterTagsRowTwo = posterTagChunks.slice(4, 8).join("");
  const posterMetric = content.metrics[0];
  const secondaryMetrics = content.metrics.slice(1);
  const barsMarkup = secondaryMetrics
    .map(
      (metric, index) => `
        <div class="bar-item">
          <label>${escapeHtml(metric.label)} <span>${escapeHtml(metric.value)}</span></label>
          <div class="bar-track">
            <div class="bar-fill ${index === secondaryMetrics.length - 1 ? "mint" : index === secondaryMetrics.length - 2 ? "orange" : ""}" style="width:${percentageFromMetricValue(metric.value)}%"></div>
          </div>
        </div>`,
    )
    .join("");
  const analysisMarkup = content.qaCards
    .map(
      (card, index) => `
        <div class="dim-item">
          <div class="dim-header">
            <div class="dim-icon">${["🔥", "💪", "💀"][index % 3]}</div>
            <div class="dim-title">${escapeHtml(card.question)}</div>
          </div>
          <div class="dim-body">${escapeHtml(card.answer)}</div>
        </div>`,
    )
    .join("");
  const dialogMarkup = content.dialogs
    .map(
      (dialog) => `
        <div class="chat-msg ${dialog.speaker}">
          <div class="chat-avatar">${dialog.speaker === "bot" ? `<img src="images/${escapeHtml(selectedAvatar.fileName)}" alt="${escapeHtml(content.title)}" />` : "👤"}</div>
          <div class="chat-bubble">${escapeHtml(dialog.text)}</div>
        </div>`,
    )
    .join("");
  const promptMarkup = content.tags
    .slice(0, 4)
    .map(
      (tag) =>
        `<button class="chat-prompt-btn" type="button">${escapeHtml(tag)}</button>`,
    )
    .join("");
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(content.title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <header class="site-header">
      <div class="site-header-inner">
        <img src="${NEXU_LOGO_FILE}" alt="nexu" class="site-logo" id="site-logo" />
        <button class="theme-toggle" id="theme-toggle" type="button" onclick="toggleTheme()" title="切换主题">☽</button>
      </div>
    </header>

    <div class="layout">
      <div class="left-side">
        <div class="profile-main">
          <div class="profile-left">
            <div class="avatar-wrap" id="avatar-wrap" onclick="cycleAvatar()">
              <div class="avatar-ring">
                <div class="avatar-inner">
                  <img id="avatar-img" src="images/${escapeHtml(selectedAvatar.fileName)}" alt="${escapeHtml(content.title)}" />
                </div>
              </div>
            </div>
            <div class="avatar-hint">点击切换 · 1/1</div>
          </div>
          <div class="profile-info">
            <div class="profile-name">${escapeHtml(content.title)}</div>
            <div class="profile-sub">${escapeHtml(content.subtitle)}</div>
            <div class="social-tags" style="margin-bottom:0">${socialTags}</div>
          </div>
        </div>
        <a class="generate-btn" href="${ROAST_SKILL_URL}" target="_blank" rel="noreferrer">⭐ 生成我的赛博分身</a>
      </div>

      <div class="right-side">
        <div class="page-wrap">
          <div class="card">
            <div class="sec-title">核心指标</div>
            <div class="stats-row">
              <div class="stat-box">
                <div class="stat-val">${escapeHtml(posterMetric.value)}</div>
                <div class="stat-label">${escapeHtml(posterMetric.label)}</div>
              </div>
              <div class="stat-box species-card">
                <div class="species-emoji">${escapeHtml(content.posterSpeciesEmoji)}</div>
                <div class="species-info">
                  <div class="species-name">${escapeHtml(content.posterSpeciesName)}</div>
                  <div class="species-sub">${escapeHtml(content.posterSpeciesSub)}</div>
                </div>
              </div>
            </div>
            <div class="roast-text" style="margin-top:16px;">${escapeHtml(content.description)}</div>
            <div class="bar-list" style="margin-top:20px;">${barsMarkup}</div>
          </div>

          <div class="card">
            <div class="sec-title">AI 扒皮</div>
            <div class="roast-text">${escapeHtml(content.description)}</div>
          </div>

          <div class="card">
            <div class="sec-title">深度扒皮</div>
            <div class="dim-list">${analysisMarkup}</div>
          </div>

          <div class="card">
            <div class="sec-title">和我对话</div>
            <div class="chat-list">${dialogMarkup}</div>
            <div class="chat-prompts">${promptMarkup}</div>
            <a href="${ROAST_SKILL_URL}" target="_blank" rel="noreferrer" class="skill-unlock-btn">⚡ 安装 Skill 解锁对话</a>
          </div>

          <div class="card">
            <div class="sec-title">技能文件</div>
            <div class="code-block">
              <code>${escapeHtml(content.installText)}</code>
              <button class="code-copy" id="copy-btn">复制</button>
            </div>
            <div class="skill-progress">
              <div class="skill-progress-header"><span>${escapeHtml(content.ctaText)}</span><span>${escapeHtml(posterMetric.value)}</span></div>
              <div class="progress-track"><div class="progress-fill"></div></div>
            </div>
            <a class="download-btn" href="${NEXU_REPO_URL}" target="_blank" rel="noreferrer">⬇ 下载 nexu</a>
          </div>

          <div class="card">
            <div class="sec-title">分享</div>
            <div class="share-row">
              <button class="share-btn" id="share-x" type="button" onclick="share('X')">𝕏 分享</button>
              <button class="share-btn" id="share-rednote" type="button" onclick="share('rednote')">📕 小红书</button>
              <button class="share-btn" id="share-jike" type="button" onclick="share('jike')">⚡ 即刻</button>
              <button class="share-btn" id="share-poster" type="button" onclick="openPoster()">📸 海报</button>
            </div>
          </div>

          <footer>
            Made with <a href="${NEXU_REPO_URL}" target="_blank" rel="noreferrer">nexu</a> · 🔥 安装 roast-skill 生成你的赛博分身
          </footer>
        </div>
      </div>
    </div>

    <div class="poster-overlay" id="poster-overlay">
      <div class="poster-modal">
        <h3>分享海报</h3>
        <p>长按保存图片，分享给好友</p>
        <div class="poster-card">
          <div class="poster-canvas">
            <div class="poster-paper"></div>
            <div class="poster-outer-frame">
              <div class="poster-inner-frame">
                <div class="poster-artwork"></div>
                <div class="poster-avatar-wrap">
                  <img class="poster-avatar" src="images/${escapeHtml(selectedAvatar.fileName)}" alt="${escapeHtml(content.title)}" />
                </div>
                <div class="poster-title">${escapeHtml(content.title)}</div>
                <div class="poster-divider"></div>
                <div class="poster-tags poster-tags-row poster-tags-row-1">${posterTagsRowOne}</div>
                <div class="poster-tags poster-tags-row poster-tags-row-2">${posterTagsRowTwo}</div>
                <div class="poster-species-card">
                  <div class="poster-species-emoji">${escapeHtml(content.posterSpeciesEmoji)}</div>
                  <div class="poster-species-copy">
                    <div class="poster-species-name">${escapeHtml(content.posterSpeciesName)}</div>
                    <div class="poster-species-sub">${escapeHtml(content.posterSpeciesSub)}</div>
                  </div>
                </div>
                <div class="poster-stat-card">
                  <div class="poster-score">${escapeHtml(posterMetric.value)}</div>
                  <div class="poster-score-label">${escapeHtml(posterMetric.label)}</div>
                </div>
                <div class="poster-qr-block">
                  <img src="${NEXU_QR_FILE}" alt="Nexu QR code" class="poster-qr-image" />
                </div>
                <div class="poster-orbit" aria-hidden="true">
                  <div class="poster-orbit-blue poster-orbit-blue-a"></div>
                  <div class="poster-orbit-blue poster-orbit-blue-b"></div>
                  <div class="poster-orbit-blue poster-orbit-blue-c"></div>
                  <div class="poster-orbit-blue poster-orbit-blue-d"></div>
                  <div class="poster-orbit-ring poster-orbit-ring-outer"></div>
                  <div class="poster-orbit-ring poster-orbit-ring-inner"></div>
                </div>
              </div>
            </div>
            <div class="poster-footer">Github：https://github.com/nexu-io/nexu</div>
          </div>
        </div>
        </div>
        <div class="poster-btns">
          <button class="poster-close" type="button" onclick="closePoster()">关闭</button>
        </div>
      </div>
    </div>

    <script>
      const shareText = ${JSON.stringify("我刚用 AI 扒了自己一层皮，来看看我的赛博分身 👉")};
      const installCommand = ${JSON.stringify(content.installText)};
      const avatarImgs = [${JSON.stringify(`images/${selectedAvatar.fileName}`)}];
      let avatarIdx = 0;

      function cycleAvatar() {
        avatarIdx = (avatarIdx + 1) % avatarImgs.length;
        const img = document.getElementById("avatar-img");
        img.style.opacity = "0";
        setTimeout(() => {
          img.src = avatarImgs[avatarIdx];
          img.style.opacity = "1";
        }, 200);
        document.querySelector(".avatar-hint").textContent = \`点击切换 · \${avatarIdx + 1}/\${avatarImgs.length}\`;
      }

      function share(platform) {
        const text = encodeURIComponent(shareText);
        const url = encodeURIComponent(window.location.href);
        const links = {
          X: \`https://twitter.com/intent/tweet?text=\${text}&url=\${url}\`,
          rednote: "xhsdiscover://post",
          jike: "https://web.okjike.com/",
        };
        if (links[platform]) {
          window.open(links[platform], "_blank");
        }
      }

      function openPoster() {
        document.getElementById("poster-overlay").classList.add("open");
      }

      function closePoster() {
        document.getElementById("poster-overlay").classList.remove("open");
      }

      document.getElementById("poster-overlay").addEventListener("click", function(event) {
        if (event.target === this) {
          closePoster();
        }
      });

      document.getElementById("copy-btn").addEventListener("click", function() {
        navigator.clipboard.writeText(installCommand).then(() => {
          this.textContent = "已复制！";
          setTimeout(() => {
            this.textContent = "复制";
          }, 1800);
        });
      });

      function toggleTheme() {
        const html = document.documentElement;
        const nextTheme = html.dataset.theme === "light" ? "dark" : "light";
        html.dataset.theme = nextTheme;
        document.getElementById("theme-toggle").textContent =
          nextTheme === "light" ? "☀" : "☽";
        localStorage.setItem("theme", nextTheme);
      }

      (function() {
        const saved = localStorage.getItem("theme") || "dark";
        document.documentElement.dataset.theme = saved;
        document.getElementById("theme-toggle").textContent =
          saved === "light" ? "☀" : "☽";
      })();
    </script>
  </body>
</html>`;
}

async function selectPortraitAvatar(portraitId) {
  const fileName = DISTILL_PORTRAIT_MAP[portraitId];
  if (!fileName) {
    throw new Error("deploy-skill template field portraitId is invalid.");
  }
  await stat(DISTILL_AVATAR_ROOT);
  const filePath = path.join(DISTILL_AVATAR_ROOT, fileName);
  const fileStats = await stat(filePath).catch(() => null);
  if (!fileStats?.isFile()) {
    throw new Error("deploy-skill template is missing avatar images.");
  }
  return {
    fileName,
    bytes: await readFile(filePath),
  };
}

async function renderTemplateFiles(templateId, content, deps = {}) {
  if (templateId !== "distill-campaign") {
    throw new Error(`deploy-skill unknown template: ${templateId}`);
  }
  const selectedAvatar = await selectPortraitAvatar(content.portraitId);
  return {
    "index.html": renderDistillCampaignHtml(content, selectedAvatar),
    "styles.css": await readRequiredFile(
      path.join(TEMPLATE_ROOT, "distill-campaign", "styles.css"),
    ),
    [NEXU_LOGO_FILE]: await readFile(
      path.join(TEMPLATE_ROOT, "distill-campaign", NEXU_LOGO_FILE),
    ),
    [NEXU_QR_FILE]: await readFile(
      path.join(TEMPLATE_ROOT, "distill-campaign", NEXU_QR_FILE),
    ),
    [NEXU_POSTER_BG_FILE]: await readFile(
      path.join(TEMPLATE_ROOT, "distill-campaign", NEXU_POSTER_BG_FILE),
    ),
    [`images/${selectedAvatar.fileName}`]: selectedAvatar.bytes,
  };
}

async function createTemplateZip(nexuHome, templateId, files) {
  const zip = new JSZip();
  for (const [fileName, content] of Object.entries(files)) {
    zip.file(fileName, content);
  }

  const outputDir = generatedDir(nexuHome);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `rendered-${templateId}.zip`);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  await writeFile(outputPath, bytes);
  return outputPath;
}

function parseAcceptedResponse(payload) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.jobId !== "string" ||
    payload.jobId.length === 0
  ) {
    throw new Error("Remote deploy-skill response is missing jobId.");
  }
  if (payload.taskType !== "static-deploy") {
    throw new Error(
      "Remote deploy-skill response returned unexpected taskType.",
    );
  }
  if (payload.status !== "queued" && payload.status !== "running") {
    throw new Error("Remote deploy-skill response returned unexpected status.");
  }
  if (typeof payload.createdAt !== "string" || payload.createdAt.length === 0) {
    throw new Error("Remote deploy-skill response is missing createdAt.");
  }
  return payload;
}

function parseStatusResponse(payload) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.jobId !== "string" ||
    typeof payload.status !== "string"
  ) {
    throw new Error("Remote deploy-skill status response is malformed.");
  }
  return payload;
}

function assertPersistedSubmitState(job, accepted) {
  if (job.jobId !== accepted.jobId) {
    throw new Error(
      "deploy-skill guard check failed: persisted jobId mismatch.",
    );
  }
  if (job.status !== accepted.status) {
    throw new Error(
      "deploy-skill guard check failed: persisted status mismatch.",
    );
  }
  if (!ACTIVE_JOB_STATUSES.has(job.status)) {
    throw new Error(
      `deploy-skill guard check failed: unexpected persisted submit status ${job.status}.`,
    );
  }
}

function assertTerminalSuccessState(job) {
  if (job.status !== "succeeded") {
    throw new Error(
      `deploy-skill guard check failed: expected succeeded status, got ${job.status}.`,
    );
  }
  if (typeof job.resultUrl !== "string" || job.resultUrl.length === 0) {
    throw new Error(
      "deploy-skill guard check failed: remote success is missing final link.",
    );
  }
  if (!job.resultUrl.endsWith(FINAL_HOST_SUFFIX)) {
    throw new Error(
      "deploy-skill guard check failed: final success link must use nexu.space.",
    );
  }
}

function fallbackMessage(job) {
  if (
    typeof job.resultUrl === "string" &&
    job.resultUrl.endsWith(FALLBACK_HOST_SUFFIX)
  ) {
    return {
      status: "timeout-fallback",
      message: `Your page has been deployed to the temporary domain ${job.resultUrl}. If you cannot access this domain, you can retry deploy again.`,
      job,
    };
  }

  throw new Error(
    `Deploy-skill job ${job.jobId} is still in progress. Check again later.`,
  );
}

function buildJobRecord(input, accepted, nowImpl) {
  const timestamp = nowIso(nowImpl);
  return {
    jobId: accepted.jobId,
    zipPath: input.zipPath,
    botId: input.botId,
    chatId: input.chatId,
    chatType: input.chatType,
    channel: input.channel,
    to: input.to ?? null,
    threadId: input.threadId ?? null,
    accountId: input.accountId ?? null,
    sessionKey: input.sessionKey ?? null,
    userId: input.userId ?? null,
    templateId: input.templateId ?? null,
    contentFile: input.contentFile ?? null,
    generatedZipPath: input.generatedZipPath ?? null,
    status: accepted.status,
    createdAt: accepted.createdAt,
    updatedAt: timestamp,
    resultUrl: null,
    deploymentUrl: null,
    error: null,
  };
}

function buildFollowUpInstruction(jobId) {
  return {
    sessions_spawn: {
      instruction: `Wait for deploy-skill job ${jobId} to complete, then tell the user exactly: Your website is ready, the link is {link}. Use command: node scripts/deploy_skill.js wait-and-deliver --job-id ${jobId}`,
      runTimeoutSeconds: 900,
    },
  };
}

function upsertJob(jobs, nextJob) {
  const withoutCurrent = jobs.filter((job) => job.jobId !== nextJob.jobId);
  return [...withoutCurrent, nextJob];
}

async function resolveConfig(nexuHome) {
  const config = await loadPageDeployConfig(nexuHome);
  if (typeof config.baseUrl !== "string" || config.baseUrl.length === 0) {
    throw new Error("deploy-skill baseUrl is not configured. Run setup first.");
  }
  const nexuConfig = await loadLocalNexuConfig(nexuHome);
  const cloudConfig =
    nexuConfig &&
    typeof nexuConfig === "object" &&
    nexuConfig.desktop &&
    typeof nexuConfig.desktop === "object" &&
    nexuConfig.desktop.cloud &&
    typeof nexuConfig.desktop.cloud === "object"
      ? nexuConfig.desktop.cloud
      : null;
  if (!cloudConfig || cloudConfig.connected !== true) {
    throw new Error(
      "deploy-skill requires you to log in to your Nexu account to get a valid API key, then retry this skill.",
    );
  }
  if (
    typeof cloudConfig.apiKey !== "string" ||
    cloudConfig.apiKey.trim().length === 0
  ) {
    throw new Error(
      "deploy-skill requires you to log in to your Nexu account to get a valid API key, then retry this skill.",
    );
  }
  return {
    baseUrl: validateBaseUrl(config.baseUrl),
    apiKey: cloudConfig.apiKey.trim(),
  };
}

export async function submitPageDeployJob(input, deps = {}) {
  const config = await resolveConfig(input.nexuHome);
  const botId = assertNonEmptyString(input.botId, "botId");
  const chatId = assertNonEmptyString(input.chatId, "chatId");
  const chatType = assertNonEmptyString(input.chatType, "chatType");
  const channel = assertNonEmptyString(input.channel, "channel");
  const to =
    typeof input.to === "string" && input.to.trim().length > 0
      ? input.to.trim()
      : null;
  const zipStats = await stat(input.zipPath);
  assertValidZipPath(input.zipPath, zipStats);

  const fileBytes = await readFile(input.zipPath);
  const form = new FormData();
  form.set(
    "file",
    new File([fileBytes], path.basename(input.zipPath), {
      type: "application/zip",
    }),
  );
  form.set("taskType", "static-deploy");
  form.set("botId", botId);
  form.set("sessionId", input.sessionKey ?? chatId);
  if (input.userId) {
    form.set("userId", input.userId);
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(`${config.baseUrl}/v1/remote-executions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  });
  const payload = await response.json();
  if (!response.ok) {
    const message =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : `Remote deploy-skill request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  const accepted = parseAcceptedResponse(payload);
  const jobs = await loadPageDeployJobs(input.nexuHome);
  const nextJob = buildJobRecord(
    {
      ...input,
      botId,
      chatId,
      chatType,
      channel,
      to,
    },
    accepted,
    deps.nowImpl,
  );
  await savePageDeployJobs(input.nexuHome, upsertJob(jobs, nextJob));
  assertPersistedSubmitState(nextJob, accepted);

  return {
    job: nextJob,
    spawnPayload: buildFollowUpInstruction(nextJob.jobId),
    accepted,
  };
}

export async function submitPageDeployTemplateJob(input, deps = {}) {
  const templateId = assertNonEmptyString(input.templateId, "templateId");
  const contentFile = assertNonEmptyString(input.contentFile, "contentFile");
  const contentPayload = JSON.parse(await readRequiredFile(contentFile));
  const templateContent = parseTemplateContent(templateId, contentPayload);
  const renderedFiles = await renderTemplateFiles(
    templateId,
    templateContent,
    deps,
  );
  const zipPath = await createTemplateZip(
    input.nexuHome,
    templateId,
    renderedFiles,
  );

  return submitPageDeployJob(
    {
      ...input,
      zipPath,
      templateId,
      contentFile,
      generatedZipPath: zipPath,
    },
    deps,
  );
}

function mergeJobWithStatus(job, payload, nowImpl) {
  const nextStatus =
    typeof payload.status === "string"
      ? payload.status
      : String(payload.status);
  if (
    !ACTIVE_JOB_STATUSES.has(nextStatus) &&
    !TERMINAL_JOB_STATUSES.has(nextStatus)
  ) {
    throw new Error(
      `Remote deploy-skill status response returned unexpected status ${nextStatus}.`,
    );
  }

  const nextError =
    payload.error && typeof payload.error === "object"
      ? {
          code:
            typeof payload.error.code === "string" ? payload.error.code : null,
          message:
            typeof payload.error.message === "string"
              ? payload.error.message
              : null,
          hint:
            typeof payload.error.hint === "string" ? payload.error.hint : null,
          retryable: payload.error.retryable === true,
        }
      : null;

  return {
    ...job,
    status: nextStatus,
    updatedAt: nowIso(nowImpl),
    resultUrl:
      typeof payload.result?.url === "string" ? payload.result.url : null,
    deploymentUrl:
      typeof payload.result?.deploymentUrl === "string"
        ? payload.result.deploymentUrl
        : null,
    error: nextError,
  };
}

export async function queryPageDeployJob(input, deps = {}) {
  const config = await resolveConfig(input.nexuHome);
  const jobs = await loadPageDeployJobs(input.nexuHome);
  const currentJob = jobs.find((job) => job.jobId === input.jobId);
  if (!currentJob) {
    throw new Error(`Unknown deploy-skill job: ${input.jobId}`);
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${config.baseUrl}/v1/remote-executions/${input.jobId}`,
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    },
  );
  const payload = await response.json();
  if (!response.ok) {
    const message =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : `Remote deploy-skill query failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  const statusPayload = parseStatusResponse(payload);
  const nextJob = mergeJobWithStatus(currentJob, statusPayload, deps.nowImpl);
  await savePageDeployJobs(input.nexuHome, upsertJob(jobs, nextJob));
  return nextJob;
}

export async function waitForPageDeployJob(input, deps = {}) {
  const sleepImpl =
    deps.sleepImpl ??
    ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));

  for (let index = 0; index < input.maxPolls; index += 1) {
    const job = await queryPageDeployJob(
      { nexuHome: input.nexuHome, jobId: input.jobId },
      deps,
    );

    if (job.status === "succeeded" && job.resultUrl) {
      assertTerminalSuccessState(job);
      return {
        status: "succeeded",
        message: `Your website is ready, the link is ${job.resultUrl}`,
        job,
      };
    }

    if (job.status === "succeeded") {
      assertTerminalSuccessState(job);
    }

    if (job.status === "failed" || job.status === "cancelled") {
      const failureMessage =
        job.error?.message ??
        "Deploy-skill execution failed for an unknown reason.";
      const failureHint = job.error?.hint ? ` ${job.error.hint}` : "";
      return {
        status: job.status,
        message: `${failureMessage}${failureHint}`,
        job,
      };
    }

    if (index < input.maxPolls - 1) {
      await sleepImpl(input.pollIntervalMs);
    }
  }

  const latestJobs = await loadPageDeployJobs(input.nexuHome);
  const latestJob = latestJobs.find((job) => job.jobId === input.jobId);
  if (!latestJob) {
    throw new Error(`Unknown deploy-skill job: ${input.jobId}`);
  }

  return fallbackMessage(latestJob);
}

export async function recoverPendingPageDeployJobs(input) {
  const jobs = await loadPageDeployJobs(input.nexuHome);
  return jobs
    .filter((job) => ACTIVE_JOB_STATUSES.has(job.status))
    .map((job) => ({
      jobId: job.jobId,
      spawnPayload: buildFollowUpInstruction(job.jobId),
    }));
}
