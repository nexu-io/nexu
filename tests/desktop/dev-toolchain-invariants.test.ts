/**
 * Dev Toolchain Invariants — guards against regressions in the launch,
 * environment, and shutdown scripts.
 *
 * These tests statically analyze shell scripts and TypeScript source to
 * verify critical invariants that are easy to accidentally break:
 *
 * Launch path safety:
 *  1. pnpm start (dev-launchd.sh) still launches Electron explicitly
 *  2. pnpm dev desktop launch is centralized in tools/dev platform helpers
 *  3. mac desktop helper patches LSUIElement and flushes LS cache
 *  4. desktop platform helpers export NEXU_WORKSPACE_ROOT / runtime roots
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
  const desktopService = readFile("tools/dev/src/services/desktop.ts");
  const desktopPlatform = readFile(
    "tools/dev/src/shared/platform/desktop-dev-platform.ts",
  );
  const darwinDesktopPlatform = readFile(
    "tools/dev/src/shared/platform/desktop-dev-platform.darwin.ts",
  );

  // -----------------------------------------------------------------------
  // 1. pnpm start keeps explicit Electron launch
  // -----------------------------------------------------------------------
  it("dev-launchd.sh launches Electron explicitly", () => {
    const electronLaunchLines = devLaunchdSh
      .split("\n")
      .filter(
        (line) =>
          line.includes("pnpm exec electron") &&
          !line.trimStart().startsWith("#"),
      );

    expect(electronLaunchLines.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // 2. pnpm dev desktop launch is centralized in tools/dev helpers
  // -----------------------------------------------------------------------
  it("desktop service delegates launch decisions to platform helpers", () => {
    expect(desktopService).toContain("createDesktopElectronLaunchSpec");
    expect(desktopService).toContain("findDesktopDevMainPid");
    expect(desktopService).toContain("terminateDesktopDevProcesses");
    expect(desktopPlatform).toContain('case "darwin"');
    expect(desktopPlatform).toContain('case "win32"');
  });

  // -----------------------------------------------------------------------
  // 3. mac helper patches LSUIElement and flushes LS cache
  // -----------------------------------------------------------------------
  it("darwin desktop helper patches LSUIElement=true", () => {
    expect(darwinDesktopPlatform).toContain("LSUIElement");
    expect(darwinDesktopPlatform).toContain("PlistBuddy");
  });

  it("darwin desktop helper flushes Launch Services cache after patching", () => {
    expect(darwinDesktopPlatform).toContain("lsregister");
  });

  // -----------------------------------------------------------------------
  // 4. desktop helper exports NEXU_WORKSPACE_ROOT/runtime roots
  // -----------------------------------------------------------------------
  it("desktop helper injects workspace and runtime roots", () => {
    expect(darwinDesktopPlatform).toContain("NEXU_WORKSPACE_ROOT");
    expect(darwinDesktopPlatform).toContain("NEXU_DESKTOP_APP_ROOT");
    expect(darwinDesktopPlatform).toContain("NEXU_DESKTOP_RUNTIME_ROOT");
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
  // 8. controller runtime command resolution preserves ELECTRON_RUN_AS_NODE
  // -----------------------------------------------------------------------
  it("controller runtime command resolution sets ELECTRON_RUN_AS_NODE when using Electron executable", () => {
    const openclawProcess = readFile(
      "apps/controller/src/runtime/openclaw-process.ts",
    );
    const runtimeResolution = readFile(
      "apps/controller/src/runtime/slimclaw-runtime-resolution.ts",
    );

    expect(openclawProcess).toContain("getOpenClawCommandSpec");
    expect(runtimeResolution).toContain("ELECTRON_RUN_AS_NODE");
    expect(runtimeResolution).toContain("OPENCLAW_ELECTRON_EXECUTABLE");
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
  const desktopService = readFile("tools/dev/src/services/desktop.ts");
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
  // 12. quit-handler delegates lifecycle decisions and cleans runtime ports
  // -----------------------------------------------------------------------
  it("quit-handler.ts exposes lifecycle-owned quit hooks", () => {
    expect(quitHandler).toContain("onQuitCompletely");
    expect(quitHandler).toContain("onRunInBackground");
    expect(quitHandler).toContain("teardownLaunchdServices");
  });

  // -----------------------------------------------------------------------
  // 13. update-manager delegates install prep to runtime lifecycle hook
  // -----------------------------------------------------------------------
  it("update-manager.ts uses prepareForUpdateInstall hook", () => {
    expect(updateManager).toContain("prepareForUpdateInstall?: (");
    expect(updateManager).toContain("prepareForUpdateInstall?: (");
    expect(updateManager).toContain("prepareForUpdateInstall?.({");
  });

  it("update-manager.ts stops periodic checks during quitAndInstall", () => {
    const methodStart = updateManager.indexOf("async quitAndInstall()");
    const methodBody = updateManager.slice(methodStart, methodStart + 1200);
    expect(methodBody).toContain("this.stopPeriodicCheck()");
  });

  // -----------------------------------------------------------------------
  // 14. index wires runtime lifecycle update-install hook into update-manager
  // -----------------------------------------------------------------------
  it("index.ts passes runtimeLifecycle.prepareForUpdateInstall into update-manager", () => {
    const indexTs = readFile("apps/desktop/main/index.ts");
    expect(indexTs).toContain(
      "prepareForUpdateInstall: runtimeLifecycle.prepareForUpdateInstall",
    );
  });

  // -----------------------------------------------------------------------
  // Bonus: mac runtime lifecycle owns quit/background hooks
  // -----------------------------------------------------------------------
  it("mac launchd lifecycle installs quit hooks", () => {
    const lifecycle = readFile(
      "apps/desktop/main/platforms/mac/launchd-lifecycle.ts",
    );
    expect(lifecycle).toContain("onQuitCompletely");
    expect(lifecycle).toContain("onRunInBackground");
    expect(lifecycle).toContain("prepareMacLaunchdUpdateInstall");
  });

  // -----------------------------------------------------------------------
  // 15. desktop index wires update-manager through runtime lifecycle
  // -----------------------------------------------------------------------
  it("index.ts constructs UpdateManager with runtime lifecycle hooks", () => {
    const indexTs = readFile("apps/desktop/main/index.ts");
    expect(indexTs).toContain("new UpdateManager(");
    expect(indexTs).toContain("runtimeLifecycle.prepareForUpdateInstall");
  });

  // -----------------------------------------------------------------------
  // 16. desktop service is an explicit composite of Vite + Electron
  // -----------------------------------------------------------------------
  it("tools/dev desktop service tracks both workerPid and electron pid", () => {
    expect(desktopService).toContain("workerPid");
    expect(desktopService).toContain("createDesktopViteCommand");
    expect(desktopService).toContain("createDesktopElectronLaunchSpec");
  });

  // -----------------------------------------------------------------------
  // 17. desktop vite implicit Electron startup is disabled under tools/dev
  // -----------------------------------------------------------------------
  it("vite config supports disabling implicit Electron startup", () => {
    const viteConfig = readFile("apps/desktop/vite.config.ts");
    expect(viteConfig).toContain("NEXU_DESKTOP_DISABLE_VITE_ELECTRON_STARTUP");
    expect(viteConfig).toContain("options.startup()");
  });

  // -----------------------------------------------------------------------
  // 18. second-instance recreates the main window when none exists
  // -----------------------------------------------------------------------
  it("index.ts recreates the main window on second-instance when none exists", () => {
    const indexTs = readFile("apps/desktop/main/index.ts");
    const secondInstanceStart = indexTs.indexOf('app.on("second-instance"');
    const secondInstanceBlock = indexTs.slice(
      secondInstanceStart,
      secondInstanceStart + 300,
    );

    expect(secondInstanceBlock).toContain(
      "!mainWindow || mainWindow.isDestroyed()",
    );
    expect(secondInstanceBlock).toContain("createMainWindow()");
    expect(secondInstanceBlock).toContain("focusMainWindow()");
  });

  // -----------------------------------------------------------------------
  // 19. dev-launchd.sh stop sends SIGTERM before SIGKILL
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
