import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installRuntimeAt } from "./install-runtime.mjs";
import { computeFingerprint } from "./postinstall-cache.mjs";
import {
  precompileFeishuPlugin,
  prepareBuiltinWeixinPlugin,
} from "./prepare-hot-plugins.mjs";
import { pruneRuntimeAt } from "./prune-runtime.mjs";
import { exists } from "./utils.mjs";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(packageRoot, ".dist-runtime", "openclaw");
const nodeModulesDir = path.join(runtimeDir, "node_modules");
const cacheFilePath = path.join(runtimeDir, ".postinstall-cache.json");
const criticalRuntimeFiles = [
  path.join("node_modules", "openclaw", "dist"),
  path.join("node_modules", "@whiskeysockets", "baileys", "lib", "index.js"),
  path.join(
    "node_modules",
    "@whiskeysockets",
    "baileys",
    "WAProto",
    "index.js",
  ),
  path.join("node_modules", "@whiskeysockets", "baileys", "package.json"),
];

function formatDurationMs(durationMs) {
  return `${(durationMs / 1000).toFixed(3)}s`;
}

async function timedStep(stepName, fn, timings) {
  const startedAt = performance.now();
  console.log(`[slimclaw:prepare][timing] start ${stepName}`);
  try {
    return await fn();
  } finally {
    const durationMs = performance.now() - startedAt;
    timings.push({ stepName, durationMs });
    console.log(
      `[slimclaw:prepare][timing] done ${stepName} duration=${formatDurationMs(durationMs)}`,
    );
  }
}

async function readCachedFingerprint() {
  if (!(await exists(cacheFilePath))) {
    return null;
  }

  try {
    const content = await readFile(cacheFilePath, "utf8");
    const parsed = JSON.parse(content);
    return typeof parsed.fingerprint === "string" ? parsed.fingerprint : null;
  } catch {
    return null;
  }
}

async function hasCompleteRuntimeInstall() {
  for (const relativePath of criticalRuntimeFiles) {
    if (!(await exists(path.join(runtimeDir, relativePath)))) {
      return false;
    }
  }

  return true;
}

export async function prepareSlimclawOwnedRuntimeInstall() {
  const timings = [];
  const totalStartedAt = performance.now();
  const fingerprint = await timedStep(
    "compute-fingerprint",
    async () => computeFingerprint(runtimeDir),
    timings,
  );
  const cachedFingerprint = await timedStep(
    "read-cached-fingerprint",
    async () => readCachedFingerprint(),
    timings,
  );
  const verification = await timedStep(
    "verify-runtime-install",
    async () => {
      const hasNodeModules = await exists(nodeModulesDir);
      const hasCompleteRuntime = hasNodeModules
        ? await hasCompleteRuntimeInstall()
        : false;
      return { hasNodeModules, hasCompleteRuntime };
    },
    timings,
  );
  const { hasNodeModules, hasCompleteRuntime } = verification;
  let cacheHit = false;
  let missReason = "fingerprint_changed";

  if (
    hasNodeModules &&
    hasCompleteRuntime &&
    cachedFingerprint === fingerprint
  ) {
    cacheHit = true;
    console.log("slimclaw runtime unchanged, skipping install:pruned.");
    const totalDurationMs = performance.now() - totalStartedAt;
    console.log(
      `[slimclaw:prepare][timing] summary total=${formatDurationMs(totalDurationMs)} cacheHit=true`,
    );
    return;
  }

  if (!hasNodeModules) {
    missReason = "node_modules_missing";
    console.log(
      "slimclaw runtime node_modules missing, running install:pruned.",
    );
  } else if (!hasCompleteRuntime) {
    missReason = "critical_files_missing";
    console.log(
      "slimclaw runtime critical files missing, running install:pruned.",
    );
  } else if (cachedFingerprint === null) {
    missReason = "cache_missing";
    console.log("slimclaw runtime cache missing, running install:pruned.");
  } else {
    missReason = "fingerprint_changed";
    console.log("slimclaw runtime inputs changed, running install:pruned.");
  }

  await timedStep(
    "install",
    async () => installRuntimeAt(runtimeDir, "pruned"),
    timings,
  );
  await timedStep("prune", async () => pruneRuntimeAt(runtimeDir), timings);
  const weixinResult = await timedStep(
    "prepare-builtin-weixin-plugin",
    async () => prepareBuiltinWeixinPlugin(runtimeDir),
    timings,
  );
  console.log(
    `[slimclaw:prepare][timing] prepared plugin=${weixinResult.pluginId} files=${weixinResult.transpiledCount}`,
  );
  const hotPluginResult = await timedStep(
    "precompile-hot-plugins",
    async () => precompileFeishuPlugin(runtimeDir),
    timings,
  );
  console.log(
    `[slimclaw:prepare][timing] precompiled plugin=${hotPluginResult.pluginId} files=${hotPluginResult.transpiledCount}${hotPluginResult.startupExperimentMode ? ` startupExperiment=${hotPluginResult.startupExperimentMode}` : ""}`,
  );

  await timedStep(
    "write-cache",
    async () =>
      writeFile(
        cacheFilePath,
        `${JSON.stringify(
          {
            fingerprint,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
    timings,
  );

  console.log("slimclaw runtime cache updated.");
  const totalDurationMs = performance.now() - totalStartedAt;
  console.log("[slimclaw:prepare][timing] summary");
  for (const timing of timings) {
    console.log(
      `[slimclaw:prepare][timing] ${timing.stepName}=${formatDurationMs(timing.durationMs)}`,
    );
  }
  console.log(
    `[slimclaw:prepare][timing] total=${formatDurationMs(totalDurationMs)} cacheHit=${cacheHit} missReason=${missReason}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await prepareSlimclawOwnedRuntimeInstall();
  } catch (error) {
    console.error("slimclaw-owned runtime prepare failed.");
    throw error;
  }
}
