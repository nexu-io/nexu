import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  process.stderr.write(`[e2e:playwright] ${message}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isCoverageEnabled(env = process.env) {
  return env.NEXU_DESKTOP_E2E_COVERAGE === "1";
}

async function waitFor(fn, description, timeoutMs = 60_000, intervalMs = 500) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const detail = lastError instanceof Error ? ` (${lastError.message})` : "";
  throw new Error(`Timed out waiting for ${description}${detail}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    mode: "full",
    appPath: process.env.PACKAGED_APP ?? null,
    executablePath: process.env.PACKAGED_EXECUTABLE ?? null,
    zipPath: process.env.NEXU_DESKTOP_E2E_ZIP_PATH ?? null,
    userDataDir: process.env.PACKAGED_USER_DATA_DIR ?? null,
    captureDir: process.env.NEXU_DESKTOP_E2E_CAPTURE_DIR ?? null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (["full", "model", "update", "login"].includes(arg)) {
      args.mode = arg;
      continue;
    }
    if (arg === "--app") {
      args.appPath = argv[++i];
      continue;
    }
    if (arg === "--exe") {
      args.executablePath = argv[++i];
      continue;
    }
    if (arg === "--zip") {
      args.zipPath = argv[++i];
      continue;
    }
    if (arg === "--user-data") {
      args.userDataDir = argv[++i];
      continue;
    }
    if (arg === "--capture-dir") {
      args.captureDir = argv[++i];
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Fake provider server (for model switch scenario)
// ---------------------------------------------------------------------------

async function createFakeProviderServer() {
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push(`${req.method} ${url.pathname}`);
    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET" && url.pathname === "/v1/models") {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          object: "list",
          data: [
            { id: "test-a", object: "model", owned_by: "nexu-e2e" },
            { id: "test-b", object: "model", owned_by: "nexu-e2e" },
          ],
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const payload = raw ? JSON.parse(raw) : {};
      const model =
        typeof payload.model === "string" ? payload.model : "unknown";
      res.writeHead(200);
      res.end(
        JSON.stringify({
          id: "chatcmpl-e2e",
          object: "chat.completion",
          model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: `model=${model}` },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(
    address && typeof address === "object",
    "fake provider server failed to bind",
  );
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    async close() {
      await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Update feed server
// ---------------------------------------------------------------------------

async function buildUpdateFeedServer(zipPath, version) {
  const zipBuffer = await readFile(zipPath);
  const sha512 = createHash("sha512").update(zipBuffer).digest("base64");
  const zipName = path.basename(zipPath);
  const zipSize = zipBuffer.byteLength;
  const requests = [];

  const latestMacYml = [
    `version: ${version}`,
    "files:",
    `  - url: ${zipName}`,
    `    sha512: ${sha512}`,
    `    size: ${zipSize}`,
    `path: ${zipName}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-03-28T00:00:00.000Z'",
    "releaseNotes: 'Desktop packaged E2E update feed'",
  ].join("\n");

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push(`${req.method} ${url.pathname}`);
    if (url.pathname === "/latest-mac.yml") {
      res.writeHead(200, { "Content-Type": "text/yaml" });
      res.end(latestMacYml);
      return;
    }
    if (url.pathname === `/${zipName}`) {
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": String(zipSize),
      });
      res.end(zipBuffer);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(
    address && typeof address === "object",
    "update feed server failed to bind",
  );
  return {
    feedUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Plist version helpers
// ---------------------------------------------------------------------------

async function extractVersionFromInfoPlist(appPath) {
  const plist = await readFile(
    path.join(appPath, "Contents", "Info.plist"),
    "utf8",
  );
  const match = plist.match(
    /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/,
  );
  if (!match) throw new Error("Unable to read CFBundleShortVersionString");
  return match[1];
}

async function patchInfoPlistVersion(appPath, nextVersion) {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  const plist = await readFile(plistPath, "utf8");
  const updated = plist
    .replace(
      /(<key>CFBundleShortVersionString<\/key>\s*<string>)([^<]+)(<\/string>)/,
      `$1${nextVersion}$3`,
    )
    .replace(
      /(<key>CFBundleVersion<\/key>\s*<string>)([^<]+)(<\/string>)/,
      `$1${nextVersion}$3`,
    );
  await writeFile(plistPath, updated, "utf8");
}

// ---------------------------------------------------------------------------
// App launch via Playwright
// ---------------------------------------------------------------------------

async function launchPackagedApp({ executablePath, env }) {
  const { _electron: electron } = await import("playwright");
  const app = await electron.launch({ executablePath, env });
  const page = await app.firstWindow();
  const coverageCollector = await createChromiumCoverageCollector({
    app,
    initialPage: page,
    captureDir:
      env.NEXU_DESKTOP_E2E_CAPTURE_DIR ??
      process.env.NEXU_DESKTOP_E2E_CAPTURE_DIR,
    scenarioName: env.NEXU_DESKTOP_E2E_SCENARIO_NAME ?? "unknown",
    enabled: isCoverageEnabled(env),
  });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(
    () => Boolean(window.nexuHost?.invoke),
    undefined,
    { timeout: 60_000 },
  );
  return { app, page, coverageCollector };
}

function shouldPersistCoverageTarget(url) {
  if (typeof url !== "string") return false;
  const normalizedUrl = url.trim();
  if (!normalizedUrl) return false;
  if (normalizedUrl === "about:blank") return false;
  if (normalizedUrl.startsWith("data:")) return false;
  if (normalizedUrl.startsWith("chrome-error://")) return false;
  if (normalizedUrl.startsWith("devtools://")) return false;
  if (normalizedUrl.startsWith("chrome-devtools://")) return false;
  return true;
}

function inferCoverageTargetType({ page, initialPage, url }) {
  if (page === initialPage) return "main-window";
  if (
    typeof url === "string" &&
    (url.includes(":50810") ||
      url.includes("/workspace") ||
      url.includes("/welcome") ||
      url.includes("/home"))
  ) {
    return "webview";
  }
  return "window";
}

function sanitizeCoverageLabel(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function getCoverageRunContext(env = process.env) {
  return {
    coverageRunId: env.NEXU_DESKTOP_E2E_COVERAGE_RUN_ID ?? null,
    workflowRunId: env.NEXU_DESKTOP_E2E_WORKFLOW_RUN_ID ?? null,
    gitSha: env.NEXU_DESKTOP_E2E_GIT_SHA ?? null,
    source: env.NEXU_DESKTOP_E2E_SOURCE ?? null,
    mode: env.MODE ?? null,
    startedAt: env.NEXU_DESKTOP_E2E_COVERAGE_STARTED_AT ?? null,
  };
}

async function writeCoverageScenarioMetadata({
  captureDir,
  scenarioName,
  env,
}) {
  if (!isCoverageEnabled(env) || !captureDir) {
    return;
  }

  const rawDir = path.join(captureDir, "coverage", "raw");
  await mkdir(rawDir, { recursive: true });
  const payload = {
    scenarioName,
    recordedAt: new Date().toISOString(),
    ...getCoverageRunContext(env),
  };
  await writeFile(
    path.join(rawDir, `scenario-${sanitizeCoverageLabel(scenarioName)}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

async function createChromiumCoverageCollector({
  app,
  initialPage,
  captureDir,
  scenarioName,
  enabled,
}) {
  if (!enabled) {
    return {
      enabled: false,
      async discoverTargets() {},
      async flushAll() {},
    };
  }

  assert(captureDir, "Chromium coverage requires captureDir");

  const rawDir = path.join(captureDir, "coverage", "raw", "chromium");
  await mkdir(rawDir, { recursive: true });

  const launchId = `${Date.now()}-${process.pid}`;
  const scenarioLabel = sanitizeCoverageLabel(scenarioName);
  const coverageRunContext = getCoverageRunContext();
  let targetCounter = 0;
  const trackedPages = new Map();
  const pendingFinalizers = new Set();

  const trackPage = async (page, discoveryReason) => {
    if (!page || trackedPages.has(page)) return;

    const targetId = `target-${String(++targetCounter).padStart(3, "0")}`;
    const entry = {
      targetId,
      page,
      discoveredBy: discoveryReason,
      firstSeenAt: new Date().toISOString(),
      firstUrl: page.url(),
      session: null,
      finalized: false,
    };
    trackedPages.set(page, entry);

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        entry.lastUrl = frame.url();
      }
    });

    page.on("close", () => {
      const finalizePromise = finalizePage(page, "page-close").catch(
        (error) => {
          log(
            `Coverage finalize failed for ${entry.targetId} on close: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      );
      pendingFinalizers.add(finalizePromise);
      finalizePromise.finally(() => pendingFinalizers.delete(finalizePromise));
    });

    try {
      entry.session = await page.context().newCDPSession(page);
      await entry.session.send("Profiler.enable");
      await entry.session.send("Profiler.startPreciseCoverage", {
        callCount: true,
        detailed: true,
      });
      log(
        `Started Chromium precise coverage for ${targetId}: ${page.url() || "(blank)"}`,
      );
    } catch (error) {
      entry.startError = error instanceof Error ? error.message : String(error);
      log(
        `Failed to start Chromium precise coverage for ${targetId}: ${entry.startError}`,
      );
    }
  };

  const discoverTargets = async () => {
    await Promise.all(
      app.windows().map((page) => trackPage(page, "window-scan")),
    );
  };

  const finalizePage = async (page, finalizeReason) => {
    const entry = trackedPages.get(page);
    if (!entry || entry.finalized) return;
    entry.finalized = true;

    const url = entry.lastUrl ?? page.url() ?? entry.firstUrl ?? "";
    const targetType = inferCoverageTargetType({ page, initialPage, url });

    let result = [];
    let stopError = null;

    if (entry.session) {
      try {
        const response = await entry.session.send(
          "Profiler.takePreciseCoverage",
        );
        result = Array.isArray(response?.result) ? response.result : [];
      } catch (error) {
        stopError = error instanceof Error ? error.message : String(error);
      }

      try {
        await entry.session.send("Profiler.stopPreciseCoverage");
      } catch (error) {
        stopError ??= error instanceof Error ? error.message : String(error);
      }

      try {
        await entry.session.send("Profiler.disable");
      } catch (error) {
        stopError ??= error instanceof Error ? error.message : String(error);
      }
    }

    if (!shouldPersistCoverageTarget(url)) {
      log(
        `Skipping Chromium coverage artifact for ${entry.targetId}: ${url || "(blank)"}`,
      );
      return;
    }

    const payload = {
      targetId: entry.targetId,
      targetType,
      scenarioName,
      ...coverageRunContext,
      discoveredBy: entry.discoveredBy,
      firstSeenAt: entry.firstSeenAt,
      finalizedAt: new Date().toISOString(),
      finalizeReason,
      url,
      firstUrl: entry.firstUrl,
      startError: entry.startError ?? null,
      stopError,
      result,
    };

    await writeFile(
      path.join(rawDir, `${scenarioLabel}-${launchId}-${entry.targetId}.json`),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
  };

  const onWindow = (page) => {
    void trackPage(page, "window-event");
  };

  app.on("window", onWindow);
  await trackPage(initialPage, "initial-window");
  await discoverTargets();

  return {
    enabled: true,
    async discoverTargets() {
      await discoverTargets();
    },
    async flushAll(finalizeReason) {
      await discoverTargets();
      await Promise.all(
        [...trackedPages.keys()].map((page) =>
          finalizePage(page, finalizeReason),
        ),
      );
      await Promise.all([...pendingFinalizers]);
      app.off("window", onWindow);
    },
  };
}

function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function clickQuitDialog() {
  // Wait for the quit dialog to appear (Electron needs time to process before-quit)
  await sleep(2000);

  for (let i = 0; i < 30; i++) {
    for (const label of ["完全退出", "Quit Completely"]) {
      try {
        // Try every window, not just window 1
        for (const winIdx of [1, 2, 3]) {
          try {
            await execFileAsync("osascript", [
              "-e",
              `tell application "System Events" to tell process "Nexu" to click button "${label}" of window ${winIdx}`,
            ]);
            log(`Clicked "${label}" on window ${winIdx}`);
            return true;
          } catch {
            /* try next window */
          }
        }
        // Also try sheet (modal) on each window
        for (const winIdx of [1, 2]) {
          try {
            await execFileAsync("osascript", [
              "-e",
              `tell application "System Events" to tell process "Nexu" to click button "${label}" of sheet 1 of window ${winIdx}`,
            ]);
            log(`Clicked "${label}" on sheet of window ${winIdx}`);
            return true;
          } catch {
            /* try next */
          }
        }
      } catch {
        /* try next label */
      }
    }
    await sleep(500);
  }
  log("WARNING: failed to click quit dialog after 30 attempts");
  return false;
}

async function quitPackagedApp(page, app, coverageCollector) {
  await coverageCollector?.flushAll("pre-quit").catch((error) => {
    log(
      `Chromium coverage flush failed before quit: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  const closePromise = app.waitForEvent("close").catch(() => null);

  // Try IPC quit first (preferred — no dialog)
  const electronPid = app.process().pid;
  try {
    await page.evaluate(async () => {
      await window.nexuHost.invoke("app:quit", { decision: "quit-completely" });
    });
    log("Quit via app:quit IPC");
    await Promise.race([
      closePromise,
      sleep(15_000).then(() => {
        log("IPC quit timeout, force killing");
        try {
          if (electronPid) process.kill(electronPid, "SIGKILL");
        } catch {
          /* already dead */
        }
      }),
    ]);
    return;
  } catch {
    log("app:quit IPC unavailable, using SIGTERM + osascript");
  }

  // Fallback: SIGTERM the Electron process to trigger before-quit → quit dialog
  if (electronPid) {
    process.kill(electronPid, "SIGTERM");
  }

  // Click the quit dialog that appears after SIGTERM
  await clickQuitDialog();

  await Promise.race([
    closePromise,
    sleep(15_000).then(() => {
      log("Quit timeout, force killing");
      try {
        if (electronPid) process.kill(electronPid, "SIGKILL");
      } catch {
        /* already dead */
      }
    }),
  ]);
}

async function waitForDesktopReady() {
  // Controller readiness — also returns runtime ports
  const readyPayload = await waitFor(async () => {
    const r = await fetch("http://127.0.0.1:50800/api/internal/desktop/ready");
    if (!r.ok) return false;
    const p = await r.json();
    return p?.ready === true ? p : false;
  }, "controller ready");

  await waitFor(async () => {
    const r = await fetch("http://127.0.0.1:50810/api/internal/desktop/ready");
    return r.ok;
  }, "web ready");

  // Discover actual openclaw port from controller readiness payload or
  // fall back to scanning common ports. The port may differ from 18789
  // if another service occupied it.
  const ocPort = readyPayload?.openclawPort ?? 18789;
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${ocPort}/health`);
    return r.ok;
  }, `openclaw health (port ${ocPort})`);
}

// ---------------------------------------------------------------------------
// Scenario: Model Switch
// ---------------------------------------------------------------------------

async function runModelSwitchScenario({ page, userDataDir, captureDir }) {
  const controllerBase = await page.evaluate(async () => {
    const r = await window.nexuHost.invoke(
      "env:get-controller-base-url",
      undefined,
    );
    return r.controllerBaseUrl;
  });
  log(`Controller: ${controllerBase}`);

  log("Starting fake provider");
  const provider = await createFakeProviderServer();
  log(`Fake provider at ${provider.baseUrl}`);

  try {
    log("Verifying provider");
    const verifyRes = await fetch(
      `${controllerBase}/api/v1/model-providers/openai/validate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ apiKey: "sk-e2e", baseUrl: provider.baseUrl }),
      },
    );
    assert(verifyRes.ok, `verify failed: ${verifyRes.status}`);
    const verifyData = await verifyRes.json();
    assert(verifyData.valid === true, `invalid provider: ${verifyData.valid}`);
    log("Provider verified");

    log("Upserting provider");
    const upsertRes = await fetch(
      `${controllerBase}/api/v1/model-providers/config`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          mode: "merge",
          providers: {
            openai: {
              enabled: true,
              displayName: "OpenAI E2E",
              baseUrl: provider.baseUrl,
              auth: "api-key",
              api: "openai-completions",
              apiKey: "sk-e2e",
              models: [
                { id: "test-a", name: "test-a", api: "openai-completions" },
                { id: "test-b", name: "test-b", api: "openai-completions" },
              ],
            },
          },
        }),
      },
    );
    assert(upsertRes.ok, `upsert failed: ${upsertRes.status}`);
    log("Provider upserted");

    log("Listing models");
    const modelsRes = await fetch(`${controllerBase}/api/v1/models`);
    assert(modelsRes.ok, `list models failed: ${modelsRes.status}`);
    const modelsData = await modelsRes.json();
    const modelIds = (modelsData.models ?? []).map((m) => m.id);
    const modelA = modelIds.find((id) => id.endsWith("/test-a"));
    const modelB = modelIds.find((id) => id.endsWith("/test-b"));
    assert(modelA, "model test-a missing");
    assert(modelB, "model test-b missing");
    log(`Models: ${modelA}, ${modelB}`);

    const runtimeModelPath = path.join(
      userDataDir,
      "runtime",
      "openclaw",
      "state",
      "nexu-runtime-model.json",
    );

    const switchModel = async (modelId) => {
      log(`Switching to ${modelId}`);
      const r = await fetch(
        `${controllerBase}/api/internal/desktop/default-model`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(15_000),
          body: JSON.stringify({ modelId }),
        },
      );
      assert(r.ok, `switch failed: ${r.status}`);
      await waitFor(async () => {
        const raw = await readFile(runtimeModelPath, "utf8");
        const parsed = JSON.parse(raw);
        // selectedModelRef may have a provider prefix (e.g. "byok_openai/openai/test-a")
        const ref = parsed.selectedModelRef ?? "";
        return ref === modelId || ref.endsWith(`/${modelId}`) ? parsed : false;
      }, `runtime model -> ${modelId}`);
      log(`Switched to ${modelId}`);
    };

    await switchModel(modelA);
    await switchModel(modelB);

    await writeFile(
      path.join(captureDir, "fake-provider-requests.json"),
      `${JSON.stringify(provider.requests, null, 2)}\n`,
      "utf8",
    );
    log("Model switch scenario PASSED");
  } finally {
    await provider.close();
  }
}

// ---------------------------------------------------------------------------
// Scenario: Update
// ---------------------------------------------------------------------------

async function runUpdateScenario({ appPath, zipPath, captureDir }) {
  assert(zipPath, "update scenario requires zipPath");

  const currentVersion = await extractVersionFromInfoPlist(appPath);
  const downgradedVersion = "0.0.1-e2e";
  log(`Update: ${downgradedVersion} -> ${currentVersion}`);
  await patchInfoPlistVersion(appPath, downgradedVersion);

  const updateFeed = await buildUpdateFeedServer(zipPath, currentVersion);
  log(`Update feed at ${updateFeed.feedUrl}`);

  const runRoot = await mkdtemp(path.join(os.tmpdir(), "nexu-update-e2e-"));
  const userDataDir = path.join(runRoot, "user-data");
  const homeDir = path.join(runRoot, "home");

  let app;
  let page;
  let coverageCollector;
  try {
    ({ app, page, coverageCollector } = await launchPackagedApp({
      executablePath: path.join(appPath, "Contents", "MacOS", "Nexu"),
      env: {
        ...process.env,
        NEXU_UPDATE_FEED_URL: updateFeed.feedUrl,
        NEXU_DESKTOP_USER_DATA_ROOT: userDataDir,
        NEXU_DESKTOP_E2E_CAPTURE_DIR: captureDir,
        NEXU_DESKTOP_E2E_SCENARIO_NAME: "update",
        HOME: homeDir,
      },
    }));

    await waitForDesktopReady();
    log("Update app ready");

    const initialVersion = await page.evaluate(async () => {
      const r = await window.nexuHost.invoke(
        "update:get-current-version",
        undefined,
      );
      return r.version;
    });
    assert(
      initialVersion === downgradedVersion,
      `expected ${downgradedVersion}, got ${initialVersion}`,
    );

    const updateAvailable = await page.evaluate(async () => {
      const r = await window.nexuHost.invoke("update:check", undefined);
      return r.updateAvailable;
    });
    assert(updateAvailable === true, "no update available");
    log("Update detected");

    const downloadOk = await page.evaluate(async () => {
      const r = await window.nexuHost.invoke("update:download", undefined);
      return r.ok;
    });
    assert(downloadOk === true, "download failed");
    log("Update downloaded");

    await coverageCollector?.flushAll("pre-update-install");

    const waitForClose = app.waitForEvent("close").catch(() => null);
    await page.evaluate(async () => {
      await window.nexuHost.invoke("update:install", undefined);
    });
    await waitForClose;
    log("Update install triggered, waiting for version change");

    await waitFor(
      async () => {
        const v = await extractVersionFromInfoPlist(appPath);
        return v === currentVersion;
      },
      `version -> ${currentVersion}`,
      90_000,
      1_000,
    );

    await writeFile(
      path.join(captureDir, "update-feed-requests.json"),
      `${JSON.stringify(updateFeed.requests, null, 2)}\n`,
      "utf8",
    );
    log("Update scenario PASSED");
  } finally {
    await coverageCollector?.flushAll("finally").catch(() => {});
    if (app) await app.close().catch(() => {});
    await updateFeed.close();
  }
}

// ---------------------------------------------------------------------------
// Scenario: Login + Agent Ready
// ---------------------------------------------------------------------------

async function getWebviewPage(app, coverageCollector, timeout = 30_000) {
  // The web app runs inside a <webview> tag, which appears as a separate window in Playwright.
  // We need to find the window whose URL points to the embedded web server (port 50810).
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await coverageCollector?.discoverTargets();
    const windows = app.windows();
    for (const w of windows) {
      const url = w.url();
      if (
        url.includes("50810") ||
        url.includes("workspace") ||
        url.includes("welcome")
      ) {
        log(`Found webview page: ${url}`);
        return w;
      }
    }
    log(
      `Waiting for webview... (${windows.length} windows: ${windows.map((w) => w.url()).join(", ")})`,
    );
    await sleep(2000);
  }
  throw new Error("Webview page not found");
}

async function runLoginScenario({ app, page, captureDir, coverageCollector }) {
  const controllerBase = await page.evaluate(async () => {
    const r = await window.nexuHost.invoke(
      "env:get-controller-base-url",
      undefined,
    );
    return r.controllerBaseUrl;
  });

  // Check if already logged in
  const statusRes = await fetch(
    `${controllerBase}/api/internal/desktop/cloud-status`,
  );
  if (statusRes.ok) {
    const status = await statusRes.json();
    if (status?.connected) {
      log("Already logged in, skipping login flow");
      return;
    }
  }

  // Step 1: Find the webview page (web app runs inside <webview>)
  log(`Main window URL: ${page.url()}`);
  const webPage = await getWebviewPage(app, coverageCollector);
  await webPage.waitForLoadState("domcontentloaded");

  // Save webview HTML for debugging
  const webHtml = await webPage.content();
  await writeFile(path.join(captureDir, "webview-page.html"), webHtml, "utf8");
  log(`Webview URL: ${webPage.url()}`);

  // Step 2: Click "使用 nexu 账号" button on welcome page
  log("Looking for login button in webview...");
  const loginButton = webPage
    .locator("button")
    .filter({ hasText: /nexu/i })
    .first();
  await loginButton.waitFor({ state: "visible", timeout: 30_000 });
  log("Found login button, clicking...");
  log("Found login button, clicking...");

  // The browser URL is opened via IPC on the main window (not webview)
  let authBrowserUrl = null;
  const browserUrlPromise = page.evaluate(() => {
    return new Promise((resolve) => {
      const origInvoke = window.nexuHost.invoke;
      window.nexuHost.invoke = async function (channel, payload) {
        if (channel === "shell:open-external" && payload?.url) {
          resolve(payload.url);
        }
        return origInvoke.call(this, channel, payload);
      };
    });
  });

  await loginButton.click();
  log("Login button clicked, waiting for browser URL...");

  // Step 2: Capture the browser URL that was opened
  authBrowserUrl = await Promise.race([
    browserUrlPromise,
    sleep(15_000).then(() => null),
  ]);

  if (authBrowserUrl) {
    log(`Browser auth URL: ${authBrowserUrl}`);
    await writeFile(
      path.join(captureDir, "auth-browser-url.txt"),
      `${authBrowserUrl}\n`,
      "utf8",
    );
  } else {
    // Fallback: check via the controller API
    log("Could not capture browser URL via IPC hook, checking controller...");
  }

  // Step 3: Wait for login to complete (user completes in browser)
  // The backend polls device-poll every 3s, frontend polls cloud-status every 2s
  log("Waiting for login to complete in browser (up to 5 minutes)...");
  log(">>> Please complete login in the browser that just opened <<<");

  await waitFor(
    async () => {
      const r = await fetch(
        `${controllerBase}/api/internal/desktop/cloud-status`,
      );
      if (!r.ok) return false;
      const data = await r.json();
      if (data?.connected) {
        log(
          `Logged in as: ${data.userName ?? "unknown"} (${data.userEmail ?? ""})`,
        );
        return data;
      }
      if (data?.polling) {
        return false; // still waiting for browser auth
      }
      return false;
    },
    "cloud login to complete",
    300_000, // 5 minutes
    2_000,
  );
  log("Login completed");

  // Step 4: Wait for navigation to /workspace (homepage)
  log("Waiting for redirect to workspace...");
  await webPage.waitForURL("**/workspace**", { timeout: 30_000 }).catch(() => {
    log("URL did not change to /workspace, checking if we're already there");
  });

  const currentUrl = webPage.url();
  log(`Current URL: ${currentUrl}`);
  assert(
    currentUrl.includes("workspace") || currentUrl.includes("home"),
    `Expected workspace page, got: ${currentUrl}`,
  );
  log("On workspace/home page");

  // Step 5: Wait for agent status to become "运行中" (alive)
  log("Waiting for agent to become alive...");
  await waitFor(
    async () => {
      const r = await fetch(`${controllerBase}/api/v1/channels/live-status`);
      if (!r.ok) return false;
      const data = await r.json();
      if (data?.agent?.alive) {
        log(
          `Agent alive with model: ${data.agent.modelName ?? data.agent.modelId ?? "unknown"}`,
        );
        return data;
      }
      log(
        `Agent status: alive=${data?.agent?.alive}, gatewayConnected=${data?.gatewayConnected}`,
      );
      return false;
    },
    "agent to become alive (运行中)",
    120_000, // 2 minutes
    3_000,
  );

  await writeFile(
    path.join(captureDir, "login-scenario-result.json"),
    `${JSON.stringify(
      { status: "passed", timestamp: new Date().toISOString() },
      null,
      2,
    )}\n`,
    "utf8",
  );
  log("Login + Agent Ready scenario PASSED");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assert(args.appPath, "Missing --app or PACKAGED_APP");
  assert(args.executablePath, "Missing --exe or PACKAGED_EXECUTABLE");
  assert(args.userDataDir, "Missing --user-data or PACKAGED_USER_DATA_DIR");
  assert(
    args.captureDir,
    "Missing --capture-dir or NEXU_DESKTOP_E2E_CAPTURE_DIR",
  );

  await stat(args.executablePath);
  await stat(args.appPath);
  await mkdir(args.captureDir, { recursive: true });

  const homeDir = path.dirname(path.dirname(path.dirname(args.userDataDir)));
  const launchEnv = {
    ...process.env,
    NEXU_DESKTOP_USER_DATA_ROOT: args.userDataDir,
    NEXU_DESKTOP_E2E_CAPTURE_DIR: args.captureDir,
    HOME: homeDir,
  };

  await writeCoverageScenarioMetadata({
    captureDir: args.captureDir,
    scenarioName: args.mode,
    env: launchEnv,
  });

  let app;
  let page;
  let coverageCollector;
  try {
    if (args.mode === "login") {
      ({ app, page, coverageCollector } = await launchPackagedApp({
        executablePath: args.executablePath,
        env: { ...launchEnv, NEXU_DESKTOP_E2E_SCENARIO_NAME: "login" },
      }));
      await waitForDesktopReady();
      await runLoginScenario({
        app,
        page,
        captureDir: args.captureDir,
        coverageCollector,
      });
      await quitPackagedApp(page, app, coverageCollector);
      app = null;
      page = null;
      coverageCollector = null;
    }

    if (args.mode === "model" || args.mode === "full") {
      ({ app, page, coverageCollector } = await launchPackagedApp({
        executablePath: args.executablePath,
        env: { ...launchEnv, NEXU_DESKTOP_E2E_SCENARIO_NAME: "model" },
      }));
      await waitForDesktopReady();
      await coverageCollector?.discoverTargets();
      await runModelSwitchScenario({
        page,
        userDataDir: args.userDataDir,
        captureDir: args.captureDir,
      });
      await quitPackagedApp(page, app, coverageCollector);
      app = null;
      page = null;
      coverageCollector = null;
    }

    if (args.mode === "update" || args.mode === "full") {
      await runUpdateScenario({
        appPath: args.appPath,
        zipPath: args.zipPath,
        captureDir: args.captureDir,
      });
    }
  } finally {
    await coverageCollector?.flushAll("finally").catch(() => {});
    if (app) await app.close().catch(() => {});
  }
}

await main();
