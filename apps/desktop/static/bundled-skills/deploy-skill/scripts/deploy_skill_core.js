import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_FILENAME = "deploy-skill.json";
const JOBS_FILENAME = "deploy-skill-jobs.json";
const NEXU_CONFIG_FILENAME = "config.json";
const GENERATED_DIRNAME = "deploy-skill-generated";
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
const NEXU_POSTER_FILE = "assets/poster.png";
const NEXU_PORTRAIT_DIR = "assets/portraits";
const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);
const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const FINAL_HOST = "nexu.space";
const FINAL_PATH_PREFIX = "/deploy/";
const FALLBACK_HOST_SUFFIX = ".pages.dev";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(SCRIPT_DIR, "../templates");
const DISTILL_AVATAR_ROOT = path.join(
  TEMPLATE_ROOT,
  "distill-campaign",
  "assets/portraits",
);
const require = createRequire(import.meta.url);

let cachedJSZip;

function loadJSZip() {
  if (cachedJSZip) {
    return cachedJSZip;
  }

  try {
    const loaded = require("jszip");
    cachedJSZip = loaded?.default ?? loaded;
    return cachedJSZip;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `deploy-skill requires jszip to be bundled into this desktop runtime (${reason}).`,
    );
  }
}

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

function buildNexuCloudCandidatePaths(nexuHome) {
  const home = os.homedir();
  const raw = [
    path.resolve(nexuConfigPath(nexuHome)),
    path.resolve(
      home,
      "Library",
      "Application Support",
      "@nexu",
      "desktop",
      ".nexu",
      NEXU_CONFIG_FILENAME,
    ),
    path.resolve(home, ".nexu", NEXU_CONFIG_FILENAME),
  ];
  const seen = new Set();
  const unique = [];
  for (const candidate of raw) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    unique.push(candidate);
  }
  return unique;
}

async function resolveNexuCloudCredentials(nexuHome) {
  const candidates = buildNexuCloudCandidatePaths(nexuHome);
  const triedMissing = [];
  for (const candidate of candidates) {
    const cfg = await readJsonFile(candidate, null);
    if (cfg === null) {
      triedMissing.push(candidate);
      continue;
    }
    const desktop =
      cfg &&
      typeof cfg === "object" &&
      cfg.desktop &&
      typeof cfg.desktop === "object"
        ? cfg.desktop
        : null;
    const cloud =
      desktop && desktop.cloud && typeof desktop.cloud === "object"
        ? desktop.cloud
        : null;
    if (!cloud) {
      // This config file has no desktop.cloud section at all — it is not an
      // authoritative source for Nexu cloud credentials, so keep searching.
      triedMissing.push(candidate);
      continue;
    }
    // This file declares a cloud config — it is authoritative. Either accept
    // it or fail here without falling through to the next candidate.
    if (cloud.connected !== true) {
      return {
        ok: false,
        reason: "not-connected",
        path: candidate,
      };
    }
    const apiKey = typeof cloud.apiKey === "string" ? cloud.apiKey.trim() : "";
    if (apiKey.length === 0) {
      return {
        ok: false,
        reason: "no-api-key",
        path: candidate,
      };
    }
    return { ok: true, apiKey, path: candidate };
  }
  return { ok: false, reason: "no-config-found", tried: triedMissing };
}

function describeNexuCredentialsError(result) {
  if (result.reason === "no-config-found") {
    const lines = result.tried
      .map((candidate) => `  - ${candidate}`)
      .join("\n");
    return (
      "deploy-skill could not find a Nexu cloud configuration with a logged-in account. " +
      "Please log in to the Nexu desktop app (or initialize your Nexu config), then retry.\n" +
      "Paths checked:\n" +
      lines
    );
  }
  if (result.reason === "not-connected") {
    return (
      `deploy-skill found a Nexu config at ${result.path}, but desktop.cloud.connected is not true. ` +
      "Please re-log in to your Nexu account via the Nexu desktop app, then retry."
    );
  }
  if (result.reason === "no-api-key") {
    return (
      `deploy-skill found a Nexu config at ${result.path}, but desktop.cloud.apiKey is missing or empty. ` +
      "Please re-log in to your Nexu account via the Nexu desktop app, then retry."
    );
  }
  return "deploy-skill could not resolve Nexu cloud credentials.";
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
  const posterMetric = content.metrics[0];
  const secondaryMetrics = content.metrics.slice(1);
  const BAR_ICONS = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px;flex-shrink:0;"><path d="M11 2.04935V13H21.9506C21.4489 18.0533 17.1853 22 12 22C6.47715 22 2 17.5228 2 12C2 6.81462 5.94668 2.55107 11 2.04935ZM13 0.542847C18.5535 1.02121 22.9788 5.4465 23.4571 11H13V0.542847Z"></path></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px;flex-shrink:0;"><path d="M3 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3ZM12.0606 11.6829L5.64722 6.2377L4.35278 7.7623L12.0731 14.3171L19.6544 7.75616L18.3456 6.24384L12.0606 11.6829Z"></path></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px;flex-shrink:0;"><path d="M19.2486 6.87221C19.4894 6.63146 19.8364 6.52969 20.1691 6.60221C20.5017 6.67474 20.7748 6.91221 20.8935 7.23129C21.8177 9.71627 21.2825 12.6245 19.2824 14.6248C17.3072 16.6001 14.4469 17.1462 11.9814 16.269L7.96873 20.2817C6.79716 21.4533 4.89766 21.4533 3.72609 20.2817C2.55452 19.1101 2.55452 17.2106 3.72609 16.039L7.73878 12.0264C6.8616 9.56086 7.40766 6.70062 9.38295 4.72534C11.3798 2.72875 14.2813 2.19203 16.7634 3.10949C17.0831 3.22767 17.3209 3.50092 17.3938 3.83386C17.4666 4.16665 17.3647 4.51341 17.1238 4.75434L14.7677 7.11044C14.1823 7.69617 14.1823 8.64605 14.7677 9.23176C15.3534 9.81746 16.3032 9.81728 16.889 9.23176L19.2486 6.87221Z"></path></svg>',
    '<svg width="13" height="13" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;"><path d="M44 24C42.7848 28.6903 36.038 32.4667 33 32.9997C30.5696 38.9691 24.038 39.5327 21 38.9997L25 32.9997C20.5443 32.5733 15.0253 27.9544 13 26.0001C10.3861 28.8504 6.19409 31.0805 4 31.9688C7.64557 24.2939 5.51899 17.3097 4 15.0001C6.83544 15.0001 11.1435 18.2235 13 20.0001C15.0253 17.8681 21.962 14.8879 25 13.9997L21 8.99979C28.6962 8.147 32.1561 11.868 33 14C40.6962 15.7056 43.6624 21.6904 44 24Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="36" cy="24.0001" r="2" fill="#fff"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px;flex-shrink:0;"><path d="M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20Z"></path></svg>',
  ];
  const BAR_FILL_CLASSES = ["", "red", "orange", "mint", ""];
  const barsMarkup = secondaryMetrics
    .map((metric, index) => {
      const icon = BAR_ICONS[index % BAR_ICONS.length];
      const fill = BAR_FILL_CLASSES[index % BAR_FILL_CLASSES.length];
      const width = percentageFromMetricValue(metric.value);
      return `
        <div class="bar-item">
          <label>
            <span style="display:inline-flex;align-items:center;gap:5px;">${icon}${escapeHtml(metric.label)}</span>
            <span>${escapeHtml(metric.value)}</span>
          </label>
          <div class="bar-track"><div class="bar-fill${fill ? ` ${fill}` : ""}" style="width:${width}%"></div></div>
        </div>`;
    })
    .join("");
  const DIM_ICONS = ["🔥", "💪", "💀", "💰", "🐾", "👥", "⭐", "💊"];
  const analysisMarkup = content.qaCards
    .map(
      (card, index) => `
        <div class="dim-item">
          <div class="dim-header">
            <div class="dim-icon">${DIM_ICONS[index % DIM_ICONS.length]}</div>
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
          <div class="chat-avatar">${dialog.speaker === "bot" ? `<img src="${NEXU_PORTRAIT_DIR}/${escapeHtml(selectedAvatar.fileName)}" alt="${escapeHtml(content.title)}" />` : "👤"}</div>
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
<html lang="zh-CN" data-theme="dark">
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
                  <img id="avatar-img" src="${NEXU_PORTRAIT_DIR}/${escapeHtml(selectedAvatar.fileName)}" alt="${escapeHtml(content.title)}" />
                </div>
              </div>
            </div>
            <div class="avatar-hint">点击切换 · 1/1</div>
          </div>
          <div class="profile-info">
            <div class="profile-name">${escapeHtml(content.title)}</div>
            <div class="profile-sub">${escapeHtml(content.subtitle)}</div>
            <div class="social-tags social-tags--vertical" style="margin-bottom:0">${socialTags}</div>
          </div>
        </div>
        <a class="generate-btn" href="${ROAST_SKILL_URL}" target="_blank" rel="noreferrer">⭐ 生成我的赛博分身 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M16.0037 9.41421L7.39712 18.0208L5.98291 16.6066L14.5895 8H7.00373V6H18.0037V17H16.0037V9.41421Z"></path></svg></a>

        <div class="share-section">
          <div class="sec-title">分享</div>
          <div class="share-row" style="flex-direction:column;gap:10px;">
            <div style="display:flex;gap:10px;">
              <button class="share-btn" id="share-x" type="button" onclick="share('X')">𝕏 分享</button>
              <button class="share-btn" id="share-rednote" type="button" onclick="share('rednote')">📕 小红书</button>
            </div>
            <div style="display:flex;gap:10px;">
              <button class="share-btn" id="share-jike" type="button" onclick="share('jike')">⚡ 即刻</button>
              <button class="share-btn" id="share-poster" type="button" onclick="openPoster()">📸 海报</button>
            </div>
            <div style="display:flex;gap:10px;">
              <a class="share-btn" id="github-link" href="${NEXU_REPO_URL}" target="_blank" rel="noreferrer" style="text-decoration:none;"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.744 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg> GitHub<span class="github-stars" id="github-stars" aria-label="GitHub stars"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg><span id="github-stars-count">—</span></span></a>
            </div>
          </div>
        </div>
      </div>

      <div class="right-side">
        <div class="page-wrap">

          <div class="tab-nav" id="tab-nav">
            <button class="tab-btn active" type="button" data-target="sec-metrics">核心指标</button>
            <button class="tab-btn" type="button" data-target="sec-roast">深度扒皮</button>
            <button class="tab-btn" type="button" data-target="sec-chat">和我对话</button>
            <button class="tab-btn" type="button" data-target="sec-skill">技能文件</button>
          </div>

          <div class="card" id="sec-metrics">
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

          <div class="card" id="sec-roast">
            <div class="sec-title">深度扒皮</div>
            <div class="dim-list">${analysisMarkup}</div>
          </div>

          <div class="card" id="sec-chat">
            <div class="sec-title">和我对话</div>
            <div class="chat-list">${dialogMarkup}</div>
            <div class="chat-prompts">${promptMarkup}</div>
            <a href="${ROAST_SKILL_URL}" target="_blank" rel="noreferrer" class="skill-unlock-btn">⚡ 安装 Skill 解锁对话</a>
          </div>

          <div class="card" id="sec-skill">
            <div class="sec-title">技能文件</div>
            <div class="code-block">
              <code>${escapeHtml(content.installText)}</code>
              <button class="code-copy" id="copy-btn" type="button">复制</button>
            </div>
            <div class="skill-progress">
              <div class="skill-progress-header"><span>${escapeHtml(content.ctaText)}</span><span>${escapeHtml(posterMetric.value)}</span></div>
              <div class="progress-track"><div class="progress-fill"></div></div>
            </div>
            <a class="download-btn" href="${NEXU_REPO_URL}" target="_blank" rel="noreferrer">⬇ 下载 nexu</a>
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
        <div class="poster-image-wrap">
          <img src="${NEXU_POSTER_FILE}" alt="分享海报" class="poster-image" />
          <div class="poster-text-layer">
            <div class="poster-text-title">${escapeHtml(content.title)}</div>
            <div class="poster-text-sub">${escapeHtml(content.subtitle)}</div>
            <div class="poster-text-score">${escapeHtml(posterMetric.value)}</div>
            <div class="poster-text-score-label">${escapeHtml(posterMetric.label)}</div>
            <div class="poster-text-species">${escapeHtml(content.posterSpeciesEmoji)} ${escapeHtml(content.posterSpeciesName)}</div>
          </div>
        </div>
        <div class="poster-btns">
          <a href="${NEXU_POSTER_FILE}" download="poster.png" class="poster-save">保存</a>
          <button class="poster-close" type="button" onclick="closePoster()">关闭</button>
        </div>
      </div>
    </div>

    <script>
      const shareText = ${JSON.stringify("我刚用 AI 扒了自己一层皮，来看看我的赛博分身 👉")};
      const installCommand = ${JSON.stringify(content.installText)};
      const avatarImgs = [${JSON.stringify(`${NEXU_PORTRAIT_DIR}/${selectedAvatar.fileName}`)}];
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

      document.getElementById("tab-nav").addEventListener("click", function(event) {
        const btn = event.target.closest(".tab-btn");
        if (!btn) return;
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const target = document.getElementById(btn.dataset.target);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      const tabSections = ["sec-metrics", "sec-roast", "sec-chat", "sec-skill"];
      function updateActiveTab() {
        const offset = 130;
        const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 40;
        let current = nearBottom ? tabSections[tabSections.length - 1] : tabSections[0];
        if (!nearBottom) {
          tabSections.forEach((id) => {
            const el = document.getElementById(id);
            if (el && el.getBoundingClientRect().top <= offset) current = id;
          });
        }
        document.querySelectorAll(".tab-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.target === current);
        });
      }
      window.addEventListener("scroll", updateActiveTab, { passive: true });
      updateActiveTab();

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

      function formatStarCount(n) {
        if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
        if (n >= 10000) return (n / 1000).toFixed(1).replace(/\\.0$/, "") + "k";
        if (n >= 1000) return (n / 1000).toFixed(1).replace(/\\.0$/, "") + "k";
        return String(n);
      }

      (function fetchGithubStars() {
        const container = document.getElementById("github-stars");
        const countEl = document.getElementById("github-stars-count");
        if (!container || !countEl) return;
        fetch("https://api.github.com/repos/nexu-io/nexu", {
          headers: { Accept: "application/vnd.github+json" },
        })
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => {
            if (!data) return;
            const formatted = formatStarCount(data.stargazers_count);
            if (formatted === null) return;
            countEl.textContent = formatted;
            container.classList.add("github-stars--loaded");
          })
          .catch(() => {
            // leave the placeholder in place; fetch failure should not
            // degrade the rest of the page.
          });
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
    [NEXU_POSTER_FILE]: await readFile(
      path.join(TEMPLATE_ROOT, "distill-campaign", NEXU_POSTER_FILE),
    ),
    [`${NEXU_PORTRAIT_DIR}/${selectedAvatar.fileName}`]: selectedAvatar.bytes,
  };
}

async function createTemplateZip(nexuHome, templateId, files) {
  const JSZip = loadJSZip();
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
  let parsed;
  try {
    parsed = new URL(job.resultUrl);
  } catch {
    throw new Error(
      "deploy-skill guard check failed: final success link must be on nexu.space/deploy/<slug>.",
    );
  }
  if (
    parsed.host !== FINAL_HOST ||
    !parsed.pathname.startsWith(FINAL_PATH_PREFIX)
  ) {
    throw new Error(
      "deploy-skill guard check failed: final success link must be on nexu.space/deploy/<slug>.",
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
  const credentials = await resolveNexuCloudCredentials(nexuHome);
  if (!credentials.ok) {
    throw new Error(describeNexuCredentialsError(credentials));
  }
  return {
    baseUrl: validateBaseUrl(config.baseUrl),
    apiKey: credentials.apiKey,
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
