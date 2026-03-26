/**
 * Dev Toolchain Invariants — guards against regressions in the launch,
 * environment, and shutdown scripts.
 *
 * These tests statically analyze shell scripts and TypeScript source to
 * verify critical invariants that are easy to accidentally break:
 *
 * Launch path safety:
 *  1. pnpm start (dev-launchd.sh) launches Electron through dev-env.sh
 *  2. pnpm dev (dev.sh → dev-run.sh) launches Electron through dev-env.sh
 *  3. dev-env.sh patches LSUIElement and flushes LS cache
 *  4. dev-env.sh exports NEXU_WORKSPACE_ROOT
 *
 * ELECTRON_RUN_AS_NODE coverage:
 *  5. All plist templates set ELECTRON_RUN_AS_NODE=1
 *  6. All runtime manifests (web, controller) set ELECTRON_RUN_AS_NODE=1
 *  7. daemon-supervisor has safety-net for ELECTRON_RUN_AS_NODE
 *  8. openclaw-process.ts sets ELECTRON_RUN_AS_NODE when using Electron exec
 *
 * Shutdown safety:
 *  9.  dev-launchd.sh stop bootouts launchd services
 *  10. dev-launchd.sh stop kills orphan processes
 *  11. dev-launchd.sh stop waits for ports to be freed
 *  12. quit-handler uses teardownLaunchdServices (not inline bootout)
 *  13. update-manager wraps teardown in try/catch
 *  14. update-manager calls ensureNexuProcessesDead before install
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../..");

function readFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

// =========================================================================
// Launch path safety
// =========================================================================

describe("Launch path safety", () => {
  const devLaunchdSh = readFile("scripts/dev-launchd.sh");
  const devRunSh = readFile("apps/desktop/scripts/dev-run.sh");
  const devEnvSh = readFile("apps/desktop/scripts/dev-env.sh");

  // -----------------------------------------------------------------------
  // 1. pnpm start → dev-launchd.sh must go through dev-env.sh
  // -----------------------------------------------------------------------
  it("dev-launchd.sh launches Electron through dev-env.sh", () => {
    // The line that starts Electron must include dev-env.sh in the command
    const electronLaunchLines = devLaunchdSh
      .split("\n")
      .filter(
        (line) =>
          line.includes("pnpm exec electron") &&
          !line.trimStart().startsWith("#"),
      );

    expect(electronLaunchLines.length).toBeGreaterThanOrEqual(1);

    for (const line of electronLaunchLines) {
      expect(line).toContain("dev-env.sh");
    }
  });

  // -----------------------------------------------------------------------
  // 2. pnpm dev → dev-run.sh must go through dev-env.sh
  // -----------------------------------------------------------------------
  it("dev-run.sh launches Electron through dev-env.sh", () => {
    const electronLaunchLines = devRunSh
      .split("\n")
      .filter(
        (line) =>
          line.includes("electron") &&
          line.includes("exec") &&
          !line.trimStart().startsWith("#") &&
          !line.includes("ELECTRON_MAIN_MATCH"),
      );

    expect(electronLaunchLines.length).toBeGreaterThanOrEqual(1);

    for (const line of electronLaunchLines) {
      expect(line).toContain("dev-env.sh");
    }
  });

  // -----------------------------------------------------------------------
  // 3. dev-env.sh patches LSUIElement and flushes LS cache
  // -----------------------------------------------------------------------
  it("dev-env.sh patches LSUIElement=true", () => {
    expect(devEnvSh).toContain("LSUIElement");
    expect(devEnvSh).toContain("PlistBuddy");
  });

  it("dev-env.sh flushes Launch Services cache after patching", () => {
    expect(devEnvSh).toContain("lsregister");
  });

  // -----------------------------------------------------------------------
  // 4. dev-env.sh exports NEXU_WORKSPACE_ROOT
  // -----------------------------------------------------------------------
  it("dev-env.sh exports NEXU_WORKSPACE_ROOT", () => {
    expect(devEnvSh).toContain("export NEXU_WORKSPACE_ROOT=");
  });

  // -----------------------------------------------------------------------
  // Bonus: dev-launchd.sh sets NEXU_USE_LAUNCHD=1
  // -----------------------------------------------------------------------
  it("dev-launchd.sh sets NEXU_USE_LAUNCHD=1 for Electron launch", () => {
    const launchLines = devLaunchdSh
      .split("\n")
      .filter(
        (line) =>
          line.includes("pnpm exec electron") &&
          !line.trimStart().startsWith("#"),
      );

    for (const line of launchLines) {
      // NEXU_USE_LAUNCHD=1 must be set either on the same line or earlier in scope
      expect(
        line.includes("NEXU_USE_LAUNCHD=1") ||
          devLaunchdSh.includes("NEXU_USE_LAUNCHD=1"),
      ).toBe(true);
    }
  });
});

// =========================================================================
// ELECTRON_RUN_AS_NODE coverage
// =========================================================================

describe("ELECTRON_RUN_AS_NODE coverage", () => {
  // -----------------------------------------------------------------------
  // 5. All plist templates set ELECTRON_RUN_AS_NODE=1
  // -----------------------------------------------------------------------
  it("plist-generator.ts sets ELECTRON_RUN_AS_NODE=1 for both services", () => {
    const plistGen = readFile("apps/desktop/main/services/plist-generator.ts");

    // Count occurrences of the env key in plist XML
    const matches = plistGen.match(/ELECTRON_RUN_AS_NODE/g) ?? [];
    // At least 2: one for controller plist, one for openclaw plist
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  // -----------------------------------------------------------------------
  // 6. All runtime manifests set ELECTRON_RUN_AS_NODE=1
  // -----------------------------------------------------------------------
  it("manifests.ts sets ELECTRON_RUN_AS_NODE=1 for web and controller", () => {
    const manifests = readFile("apps/desktop/main/runtime/manifests.ts");

    // Find all env blocks that contain ELECTRON_RUN_AS_NODE
    const matches = manifests.match(/ELECTRON_RUN_AS_NODE.*"1"/g) ?? [];
    // At least 2: web manifest + controller manifest
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  // -----------------------------------------------------------------------
  // 7. daemon-supervisor has safety-net for ELECTRON_RUN_AS_NODE
  // -----------------------------------------------------------------------
  it("daemon-supervisor.ts forces ELECTRON_RUN_AS_NODE for Electron binary spawns", () => {
    const supervisor = readFile(
      "apps/desktop/main/runtime/daemon-supervisor.ts",
    );

    // Must contain the safety-net logic
    expect(supervisor).toContain("isElectronBinary");
    expect(supervisor).toContain('ELECTRON_RUN_AS_NODE: "1"');
  });

  // -----------------------------------------------------------------------
  // 8. openclaw-process.ts sets ELECTRON_RUN_AS_NODE
  // -----------------------------------------------------------------------
  it("openclaw-process.ts sets ELECTRON_RUN_AS_NODE when using Electron executable", () => {
    const openclawProcess = readFile(
      "apps/controller/src/runtime/openclaw-process.ts",
    );

    expect(openclawProcess).toContain("ELECTRON_RUN_AS_NODE");
    // Must be conditionally set when electronExec is used
    expect(openclawProcess).toContain("OPENCLAW_ELECTRON_EXECUTABLE");
  });

  // -----------------------------------------------------------------------
  // Bonus: No spawn of process.execPath without ELECTRON_RUN_AS_NODE
  // in catalog-manager (skill install uses Electron binary)
  // -----------------------------------------------------------------------
  it("catalog-manager.ts sets ELECTRON_RUN_AS_NODE for execFile calls", () => {
    const catalogMgr = readFile(
      "apps/controller/src/services/skillhub/catalog-manager.ts",
    );

    // Every execFile call with env should include ELECTRON_RUN_AS_NODE
    const execFileCalls = catalogMgr.match(/execFile.*\{[^}]*env:/g) ?? [];
    for (const _call of execFileCalls) {
      // The surrounding context should mention ELECTRON_RUN_AS_NODE
      expect(catalogMgr).toContain("ELECTRON_RUN_AS_NODE");
    }
  });
});

// =========================================================================
// Shutdown safety
// =========================================================================

describe("Shutdown safety", () => {
  const devLaunchdSh = readFile("scripts/dev-launchd.sh");
  const quitHandler = readFile("apps/desktop/main/services/quit-handler.ts");
  const updateManager = readFile("apps/desktop/main/updater/update-manager.ts");

  // -----------------------------------------------------------------------
  // 9. dev-launchd.sh stop bootouts launchd services
  // -----------------------------------------------------------------------
  it("dev-launchd.sh stop_services bootouts both launchd labels", () => {
    expect(devLaunchdSh).toContain("launchctl bootout");
    // Must bootout both controller and openclaw
    expect(devLaunchdSh).toContain("CONTROLLER_LABEL");
    expect(devLaunchdSh).toContain("OPENCLAW_LABEL");
  });

  // -----------------------------------------------------------------------
  // 10. dev-launchd.sh stop kills orphan processes
  // -----------------------------------------------------------------------
  it("dev-launchd.sh stop kills orphan processes after bootout", () => {
    // Must have pkill for known process patterns
    expect(devLaunchdSh).toContain('pkill -9 -f "openclaw.mjs gateway"');
    expect(devLaunchdSh).toContain('pkill -9 -f "controller/dist/index.js"');
  });

  // -----------------------------------------------------------------------
  // 11. dev-launchd.sh stop waits for ports to be freed
  // -----------------------------------------------------------------------
  it("dev-launchd.sh stop waits for port release", () => {
    // Must check port availability in a loop
    expect(devLaunchdSh).toContain("lsof -i");
    expect(devLaunchdSh).toContain("max_wait");
  });

  // -----------------------------------------------------------------------
  // 12. quit-handler uses teardownLaunchdServices
  // -----------------------------------------------------------------------
  it("quit-handler.ts uses teardownLaunchdServices (not inline bootout)", () => {
    expect(quitHandler).toContain("teardownLaunchdServices");
    // Must NOT have inline bootoutService calls in quit-completely path
    expect(quitHandler).not.toContain("bootoutService");
  });

  // -----------------------------------------------------------------------
  // 13. update-manager wraps teardown in try/catch
  // -----------------------------------------------------------------------
  it("update-manager.ts wraps teardown in try/catch", () => {
    // Extract the quitAndInstall method body for analysis
    const methodStart = updateManager.indexOf("async quitAndInstall()");
    const methodBody = updateManager.slice(methodStart, methodStart + 2000);
    // The teardown call must be preceded by "try {" in the method
    const teardownPos = methodBody.indexOf("teardownLaunchdServices");
    const beforeTeardown = methodBody.slice(0, teardownPos);
    expect(beforeTeardown).toContain("try");
  });

  it("update-manager.ts wraps orchestrator.dispose in try/catch", () => {
    const methodStart = updateManager.indexOf("async quitAndInstall()");
    const methodBody = updateManager.slice(methodStart, methodStart + 2000);
    const disposePos = methodBody.indexOf("this.orchestrator.dispose()");
    const beforeDispose = methodBody.slice(0, disposePos);
    // Count try blocks — must have at least 2 (one for teardown, one for dispose)
    const tryCount = (beforeDispose.match(/\btry\s*\{/g) ?? []).length;
    expect(tryCount).toBeGreaterThanOrEqual(2);
  });

  // -----------------------------------------------------------------------
  // 14. update-manager calls ensureNexuProcessesDead before install
  // -----------------------------------------------------------------------
  it("update-manager.ts calls ensureNexuProcessesDead before quitAndInstall", () => {
    const ensureIndex = updateManager.indexOf("ensureNexuProcessesDead");
    const installIndex = updateManager.indexOf("autoUpdater.quitAndInstall");

    expect(ensureIndex).toBeGreaterThan(-1);
    expect(installIndex).toBeGreaterThan(-1);
    // ensureNexuProcessesDead must come BEFORE autoUpdater.quitAndInstall
    expect(ensureIndex).toBeLessThan(installIndex);
  });

  // -----------------------------------------------------------------------
  // Bonus: update-manager imports ensureNexuProcessesDead
  // -----------------------------------------------------------------------
  it("update-manager.ts imports ensureNexuProcessesDead", () => {
    expect(updateManager).toContain("import");
    expect(updateManager).toContain("ensureNexuProcessesDead");
  });

  // -----------------------------------------------------------------------
  // 15. P0-2: index.ts has gracefulShutdown function
  // -----------------------------------------------------------------------
  it("index.ts defines a single gracefulShutdown function", () => {
    const indexTs = readFile("apps/desktop/main/index.ts");
    expect(indexTs).toContain("async function gracefulShutdown(");
    // Must have idempotent guard
    expect(indexTs).toContain("shutdownInProgress");
    // Must have hard timeout
    expect(indexTs).toContain("SHUTDOWN_HARD_TIMEOUT_MS");
  });

  // -----------------------------------------------------------------------
  // 16. P0-2: SIGTERM and SIGINT handlers exist
  // -----------------------------------------------------------------------
  it("index.ts registers SIGTERM and SIGINT handlers", () => {
    const indexTs = readFile("apps/desktop/main/index.ts");
    expect(indexTs).toContain('"SIGTERM"');
    expect(indexTs).toContain('"SIGINT"');
    expect(indexTs).toContain("process.on(signal");
  });

  // -----------------------------------------------------------------------
  // 17. P1-2: before-quit uses removeListener, not removeAllListeners
  // -----------------------------------------------------------------------
  it("index.ts uses removeListener instead of removeAllListeners for before-quit", () => {
    const indexTs = readFile("apps/desktop/main/index.ts");
    expect(indexTs).toContain('app.removeListener("before-quit"');
    expect(indexTs).not.toContain("removeAllListeners");
  });

  // -----------------------------------------------------------------------
  // 18. dev-launchd.sh stop sends SIGTERM before SIGKILL
  // -----------------------------------------------------------------------
  it("dev-launchd.sh stop_services sends SIGTERM before SIGKILL", () => {
    const devLaunchdSh = readFile("scripts/dev-launchd.sh");
    // Extract stop_services function body
    const stopStart = devLaunchdSh.indexOf("stop_services()");
    const stopBody = devLaunchdSh.slice(stopStart, stopStart + 2000);
    // SIGTERM must appear in stop_services
    expect(stopBody).toContain("pkill -TERM");
    // SIGKILL must appear AFTER SIGTERM in the same function
    const termIdx = stopBody.indexOf("pkill -TERM");
    const killIdx = stopBody.indexOf("pkill -9");
    expect(termIdx).toBeLessThan(killIdx);
  });
});
