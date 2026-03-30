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
    if (["full", "model", "update", "login"].includes(arg)) { args.mode = arg; continue; }
    if (arg === "--app") { args.appPath = argv[++i]; continue; }
    if (arg === "--exe") { args.executablePath = argv[++i]; continue; }
    if (arg === "--zip") { args.zipPath = argv[++i]; continue; }
    if (arg === "--user-data") { args.userDataDir = argv[++i]; continue; }
    if (arg === "--capture-dir") { args.captureDir = argv[++i]; continue; }
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
      res.end(JSON.stringify({
        object: "list",
        data: [
          { id: "test-a", object: "model", owned_by: "nexu-e2e" },
          { id: "test-b", object: "model", owned_by: "nexu-e2e" },
        ],
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const payload = raw ? JSON.parse(raw) : {};
      const model = typeof payload.model === "string" ? payload.model : "unknown";
      res.writeHead(200);
      res.end(JSON.stringify({
        id: "chatcmpl-e2e", object: "chat.completion", model,
        choices: [{ index: 0, message: { role: "assistant", content: `model=${model}` }, finish_reason: "stop" }],
      }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object", "fake provider server failed to bind");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    async close() {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
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
      res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": String(zipSize) });
      res.end(zipBuffer);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object", "update feed server failed to bind");
  return {
    feedUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

// ---------------------------------------------------------------------------
// Plist version helpers
// ---------------------------------------------------------------------------

async function extractVersionFromInfoPlist(appPath) {
  const plist = await readFile(path.join(appPath, "Contents", "Info.plist"), "utf8");
  const match = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
  if (!match) throw new Error("Unable to read CFBundleShortVersionString");
  return match[1];
}

async function patchInfoPlistVersion(appPath, nextVersion) {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  const plist = await readFile(plistPath, "utf8");
  const updated = plist
    .replace(/(<key>CFBundleShortVersionString<\/key>\s*<string>)([^<]+)(<\/string>)/, `$1${nextVersion}$3`)
    .replace(/(<key>CFBundleVersion<\/key>\s*<string>)([^<]+)(<\/string>)/, `$1${nextVersion}$3`);
  await writeFile(plistPath, updated, "utf8");
}

// ---------------------------------------------------------------------------
// App launch via Playwright
// ---------------------------------------------------------------------------

async function launchPackagedApp({ executablePath, env }) {
  const { _electron: electron } = await import("playwright");
  const app = await electron.launch({ executablePath, env });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => Boolean(window.nexuHost?.invoke), undefined, { timeout: 60_000 });
  return { app, page };
}

function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) { reject(new Error(stderr || stdout || error.message)); return; }
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
          } catch { /* try next window */ }
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
          } catch { /* try next */ }
        }
      } catch { /* try next label */ }
    }
    await sleep(500);
  }
  log("WARNING: failed to click quit dialog after 30 attempts");
  return false;
}

async function quitPackagedApp(page, app) {
  const closePromise = app.waitForEvent("close").catch(() => null);

  // Try IPC quit first (preferred — no dialog)
  try {
    await page.evaluate(async () => {
      await window.nexuHost.invoke("app:quit", { decision: "quit-completely" });
    });
    log("Quit via app:quit IPC");
    await closePromise;
    return;
  } catch {
    log("app:quit IPC unavailable, using SIGTERM + osascript");
  }

  // Fallback: SIGTERM the Electron process to trigger before-quit → quit dialog
  const electronPid = app.process().pid;
  if (electronPid) {
    process.kill(electronPid, "SIGTERM");
  }

  // Click the quit dialog that appears after SIGTERM
  await clickQuitDialog();

  await Promise.race([
    closePromise,
    sleep(15_000).then(() => {
      log("Quit timeout, force killing");
      if (electronPid) process.kill(electronPid, "SIGKILL").catch?.(() => {});
    }),
  ]);
}

async function waitForDesktopReady() {
  await waitFor(async () => {
    const r = await fetch("http://127.0.0.1:50800/api/internal/desktop/ready");
    if (!r.ok) return false;
    const p = await r.json();
    return p?.ready === true ? p : false;
  }, "controller ready");

  await waitFor(async () => {
    const r = await fetch("http://127.0.0.1:50810/api/internal/desktop/ready");
    return r.ok;
  }, "web ready");

  await waitFor(async () => {
    const r = await fetch("http://127.0.0.1:18789/health");
    return r.ok;
  }, "openclaw health");
}

// ---------------------------------------------------------------------------
// Scenario: Model Switch
// ---------------------------------------------------------------------------

async function runModelSwitchScenario({ page, userDataDir, captureDir }) {
  const controllerBase = await page.evaluate(async () => {
    const r = await window.nexuHost.invoke("env:get-controller-base-url", undefined);
    return r.controllerBaseUrl;
  });
  log(`Controller: ${controllerBase}`);

  log("Starting fake provider");
  const provider = await createFakeProviderServer();
  log(`Fake provider at ${provider.baseUrl}`);

  try {
    log("Verifying provider");
    const verifyRes = await fetch(`${controllerBase}/api/v1/providers/openai/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ apiKey: "sk-e2e", baseUrl: provider.baseUrl }),
    });
    assert(verifyRes.ok, `verify failed: ${verifyRes.status}`);
    const verifyData = await verifyRes.json();
    assert(verifyData.valid === true, `invalid provider: ${verifyData.valid}`);
    log("Provider verified");

    log("Upserting provider");
    const upsertRes = await fetch(`${controllerBase}/api/v1/providers/openai`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        apiKey: "sk-e2e", baseUrl: provider.baseUrl, enabled: true,
        displayName: "OpenAI E2E", authMode: "apiKey",
        modelsJson: JSON.stringify(["test-a", "test-b"]),
      }),
    });
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

    const runtimeModelPath = path.join(userDataDir, "runtime", "openclaw", "state", "nexu-runtime-model.json");

    const switchModel = async (modelId) => {
      log(`Switching to ${modelId}`);
      const r = await fetch(`${controllerBase}/api/internal/desktop/default-model`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ modelId }),
      });
      assert(r.ok, `switch failed: ${r.status}`);
      await waitFor(async () => {
        const raw = await readFile(runtimeModelPath, "utf8");
        const parsed = JSON.parse(raw);
        // selectedModelRef may have a provider prefix (e.g. "byok_openai/openai/test-a")
        const ref = parsed.selectedModelRef ?? "";
        return (ref === modelId || ref.endsWith(`/${modelId}`)) ? parsed : false;
      }, `runtime model -> ${modelId}`);
      log(`Switched to ${modelId}`);
    };

    await switchModel(modelA);
    await switchModel(modelB);

    await writeFile(path.join(captureDir, "fake-provider-requests.json"), JSON.stringify(provider.requests, null, 2) + "\n", "utf8");
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

  let app, page;
  try {
    ({ app, page } = await launchPackagedApp({
      executablePath: path.join(appPath, "Contents", "MacOS", "Nexu"),
      env: {
        ...process.env,
        NEXU_UPDATE_FEED_URL: updateFeed.feedUrl,
        NEXU_DESKTOP_USER_DATA_ROOT: userDataDir,
        HOME: homeDir,
      },
    }));

    await waitForDesktopReady();
    log("Update app ready");

    const initialVersion = await page.evaluate(async () => {
      const r = await window.nexuHost.invoke("update:get-current-version", undefined);
      return r.version;
    });
    assert(initialVersion === downgradedVersion, `expected ${downgradedVersion}, got ${initialVersion}`);

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

    await writeFile(path.join(captureDir, "update-feed-requests.json"), JSON.stringify(updateFeed.requests, null, 2) + "\n", "utf8");
    log("Update scenario PASSED");
  } finally {
    if (app) await app.close().catch(() => {});
    await updateFeed.close();
  }
}

// ---------------------------------------------------------------------------
// Scenario: Login + Agent Ready
// ---------------------------------------------------------------------------

async function getWebviewPage(app, timeout = 30_000) {
  // The web app runs inside a <webview> tag, which appears as a separate window in Playwright.
  // We need to find the window whose URL points to the embedded web server (port 50810).
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const windows = app.windows();
    for (const w of windows) {
      const url = w.url();
      if (url.includes("50810") || url.includes("workspace") || url.includes("welcome")) {
        log(`Found webview page: ${url}`);
        return w;
      }
    }
    log(`Waiting for webview... (${windows.length} windows: ${windows.map(w => w.url()).join(", ")})`);
    await sleep(2000);
  }
  throw new Error("Webview page not found");
}

async function runLoginScenario({ app, page, captureDir }) {
  const controllerBase = await page.evaluate(async () => {
    const r = await window.nexuHost.invoke("env:get-controller-base-url", undefined);
    return r.controllerBaseUrl;
  });

  // Check if already logged in
  const statusRes = await fetch(`${controllerBase}/api/internal/desktop/cloud-status`);
  if (statusRes.ok) {
    const status = await statusRes.json();
    if (status?.connected) {
      log("Already logged in, skipping login flow");
      return;
    }
  }

  // Step 1: Find the webview page (web app runs inside <webview>)
  log(`Main window URL: ${page.url()}`);
  const webPage = await getWebviewPage(app);
  await webPage.waitForLoadState("domcontentloaded");

  // Save webview HTML for debugging
  const webHtml = await webPage.content();
  await writeFile(path.join(captureDir, "webview-page.html"), webHtml, "utf8");
  log(`Webview URL: ${webPage.url()}`);

  // Step 2: Click "使用 nexu 账号" button on welcome page
  log("Looking for login button in webview...");
  const loginButton = webPage.locator("button").filter({ hasText: /nexu/i }).first();
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
    await writeFile(path.join(captureDir, "auth-browser-url.txt"), authBrowserUrl + "\n", "utf8");
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
      const r = await fetch(`${controllerBase}/api/internal/desktop/cloud-status`);
      if (!r.ok) return false;
      const data = await r.json();
      if (data?.connected) {
        log(`Logged in as: ${data.userName ?? "unknown"} (${data.userEmail ?? ""})`);
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
  assert(currentUrl.includes("workspace") || currentUrl.includes("home"), `Expected workspace page, got: ${currentUrl}`);
  log("On workspace/home page");

  // Step 5: Wait for agent status to become "运行中" (alive)
  log("Waiting for agent to become alive...");
  await waitFor(
    async () => {
      const r = await fetch(`${controllerBase}/api/v1/channels/live-status`);
      if (!r.ok) return false;
      const data = await r.json();
      if (data?.agent?.alive) {
        log(`Agent alive with model: ${data.agent.modelName ?? data.agent.modelId ?? "unknown"}`);
        return data;
      }
      log(`Agent status: alive=${data?.agent?.alive}, gatewayConnected=${data?.gatewayConnected}`);
      return false;
    },
    "agent to become alive (运行中)",
    120_000, // 2 minutes
    3_000,
  );

  await writeFile(
    path.join(captureDir, "login-scenario-result.json"),
    JSON.stringify({ status: "passed", timestamp: new Date().toISOString() }, null, 2) + "\n",
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
  assert(args.captureDir, "Missing --capture-dir or NEXU_DESKTOP_E2E_CAPTURE_DIR");

  await stat(args.executablePath);
  await stat(args.appPath);
  await mkdir(args.captureDir, { recursive: true });

  const homeDir = path.dirname(path.dirname(path.dirname(args.userDataDir)));
  const launchEnv = {
    ...process.env,
    NEXU_DESKTOP_USER_DATA_ROOT: args.userDataDir,
    HOME: homeDir,
  };

  let app, page;
  try {
    if (args.mode === "login") {
      ({ app, page } = await launchPackagedApp({ executablePath: args.executablePath, env: launchEnv }));
      await waitForDesktopReady();
      await runLoginScenario({ app, page, captureDir: args.captureDir });
      await quitPackagedApp(page, app);
      app = null;
    }

    if (args.mode === "model" || args.mode === "full") {
      ({ app, page } = await launchPackagedApp({ executablePath: args.executablePath, env: launchEnv }));
      await waitForDesktopReady();
      await runModelSwitchScenario({ page, userDataDir: args.userDataDir, captureDir: args.captureDir });
      await quitPackagedApp(page, app);
      app = null;
    }

    if (args.mode === "update" || args.mode === "full") {
      await runUpdateScenario({ appPath: args.appPath, zipPath: args.zipPath, captureDir: args.captureDir });
    }
  } finally {
    if (app) await app.close().catch(() => {});
  }
}

await main();
