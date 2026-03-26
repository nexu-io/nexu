/**
 * Launchd Bootstrap edge-case tests — covers:
 * 1. isLaunchdBootstrapEnabled with packaged app (process.execPath without "node_modules")
 * 2. resolveLaunchdPaths packaged mode (detailed path validation)
 * 3. ensureNexuProcessesDead success-after-timeout path (processes die in final check)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (same shape as launchd-bootstrap.test.ts)
// ---------------------------------------------------------------------------

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/Users/testuser"),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:net", () => ({
  createConnection: vi.fn(),
}));

const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

const mockLaunchdManager = {
  getServiceStatus: vi.fn(),
  installService: vi.fn(),
  startService: vi.fn(),
  stopServiceGracefully: vi.fn(),
  bootoutService: vi.fn(),
  bootoutAndWaitForExit: vi.fn(),
  waitForExit: vi.fn(),
  isServiceInstalled: vi.fn(),
  hasPlistFile: vi.fn(),
  isServiceRegistered: vi.fn(),
  getPlistDir: vi.fn(() => "/tmp/test-plist"),
  getDomain: vi.fn(() => "gui/501"),
};

vi.mock("../../apps/desktop/main/services/launchd-manager", () => ({
  LaunchdManager: vi.fn(() => mockLaunchdManager),
  SERVICE_LABELS: {
    controller: (isDev: boolean) =>
      isDev ? "io.nexu.controller.dev" : "io.nexu.controller",
    openclaw: (isDev: boolean) =>
      isDev ? "io.nexu.openclaw.dev" : "io.nexu.openclaw",
  },
}));

vi.mock("../../apps/desktop/main/services/plist-generator", () => ({
  generatePlist: vi.fn(() => "<plist>mock</plist>"),
}));

vi.mock("../../apps/desktop/main/services/embedded-web-server", () => ({
  startEmbeddedWebServer: vi.fn().mockResolvedValue({
    close: vi.fn().mockResolvedValue(undefined),
    port: 50810,
  }),
}));

vi.mock("../../apps/desktop/main/runtime/manifests", () => ({
  ensurePackagedOpenclawSidecar: vi.fn(
    (_runtimeDir: string, nexuHome: string) => `${nexuHome}/openclaw-sidecar`,
  ),
}));

vi.mock("../../apps/desktop/shared/workspace-paths", () => ({
  getWorkspaceRoot: vi.fn(() => "/repo"),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isLaunchdBootstrapEnabled — packaged app detection", () => {
  const originalEnv = { ...process.env };
  const originalPlatform = process.platform;
  const originalExecPath = process.execPath;

  afterEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(process, "platform", { value: originalPlatform });
    Object.defineProperty(process, "execPath", { value: originalExecPath });
  });

  it("returns true for packaged macOS app (execPath without node_modules)", async () => {
    // Simulate a packaged Electron app path
    Object.defineProperty(process, "execPath", {
      value: "/Applications/Nexu.app/Contents/MacOS/Nexu",
      configurable: true,
    });
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    // Clear env overrides
    Reflect.deleteProperty(process.env, "NEXU_USE_LAUNCHD");
    Reflect.deleteProperty(process.env, "CI");

    const { isLaunchdBootstrapEnabled } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    expect(isLaunchdBootstrapEnabled()).toBe(true);
  });

  it("returns false for dev mode (execPath contains node_modules)", async () => {
    Object.defineProperty(process, "execPath", {
      value: "/repo/node_modules/.bin/node",
      configurable: true,
    });
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    Reflect.deleteProperty(process.env, "NEXU_USE_LAUNCHD");
    Reflect.deleteProperty(process.env, "CI");

    const { isLaunchdBootstrapEnabled } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    expect(isLaunchdBootstrapEnabled()).toBe(false);
  });

  it("returns false for packaged non-macOS app", async () => {
    Object.defineProperty(process, "execPath", {
      value: "C:\\Program Files\\Nexu\\Nexu.exe",
      configurable: true,
    });
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    Reflect.deleteProperty(process.env, "NEXU_USE_LAUNCHD");
    Reflect.deleteProperty(process.env, "CI");

    const { isLaunchdBootstrapEnabled } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    expect(isLaunchdBootstrapEnabled()).toBe(false);
  });

  it("env NEXU_USE_LAUNCHD=1 overrides packaged detection", async () => {
    Object.defineProperty(process, "execPath", {
      value: "/repo/node_modules/.bin/node",
      configurable: true,
    });
    process.env.NEXU_USE_LAUNCHD = "1";

    const { isLaunchdBootstrapEnabled } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    expect(isLaunchdBootstrapEnabled()).toBe(true);
  });

  it("env NEXU_USE_LAUNCHD=0 overrides even on packaged macOS", async () => {
    Object.defineProperty(process, "execPath", {
      value: "/Applications/Nexu.app/Contents/MacOS/Nexu",
      configurable: true,
    });
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    process.env.NEXU_USE_LAUNCHD = "0";

    const { isLaunchdBootstrapEnabled } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    expect(isLaunchdBootstrapEnabled()).toBe(false);
  });
});

describe("resolveLaunchdPaths — packaged mode details", () => {
  it("resolves packaged paths from resourcesPath", async () => {
    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const paths = resolveLaunchdPaths(true, "/App.app/Contents/Resources");

    expect(paths.controllerEntryPath).toBe(
      "/App.app/Contents/Resources/runtime/controller/dist/index.js",
    );
    expect(paths.controllerCwd).toBe(
      "/App.app/Contents/Resources/runtime/controller",
    );
    expect(paths.nodePath).toBe(process.execPath);
  });

  it("resolves openclaw path from sidecar extraction", async () => {
    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const paths = resolveLaunchdPaths(true, "/Resources");

    // ensurePackagedOpenclawSidecar returns `${nexuHome}/openclaw-sidecar`
    // where nexuHome = /Users/testuser/.nexu
    expect(paths.openclawPath).toBe(
      "/Users/testuser/.nexu/openclaw-sidecar/node_modules/openclaw/openclaw.mjs",
    );
    expect(paths.openclawCwd).toBe("/Users/testuser/.nexu/openclaw-sidecar");
  });

  it("uses process.execPath as nodePath in packaged mode", async () => {
    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const paths = resolveLaunchdPaths(true, "/Resources");

    expect(paths.nodePath).toBe(process.execPath);
  });
});

describe("ensureNexuProcessesDead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Helper: setup pgrep responses. Each call to pgrep returns the next set of PIDs.
   * An empty array means pgrep exits with code 1 (no matches).
   */
  function setupPgrepSequence(pidSequences: number[][]): void {
    let callIndex = 0;
    mockExecFile.mockImplementation(
      (
        cmd: string,
        _args: string[],
        callback: (
          error: Error | null,
          result: { stdout: string; stderr: string },
        ) => void,
      ) => {
        if (cmd === "pgrep") {
          const pids = pidSequences[callIndex] ?? [];
          callIndex++;
          if (pids.length === 0) {
            callback(Object.assign(new Error("exit 1"), { code: 1 }), {
              stdout: "",
              stderr: "",
            });
          } else {
            callback(null, {
              stdout: pids.join("\n"),
              stderr: "",
            });
          }
          return;
        }
        // lsof or other commands
        callback(null, { stdout: "", stderr: "" });
      },
    );
  }

  it("returns clean=true immediately when no processes found", async () => {
    setupPgrepSequence([
      [], // controller pattern
      [], // openclaw.mjs pattern
      [], // openclaw-gateway pattern
    ]);

    const { ensureNexuProcessesDead } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await ensureNexuProcessesDead({
      timeoutMs: 500,
      intervalMs: 50,
    });

    expect(result.clean).toBe(true);
    expect(result.remainingPids).toEqual([]);
  });

  it("returns clean=true when processes die after SIGKILL in loop", async () => {
    // Mock process.kill to not throw
    const originalKill = process.kill;
    const mockKill = vi.fn();
    process.kill = mockKill as unknown as typeof process.kill;

    try {
      // First round of pgrep (3 patterns): processes found
      // Second round of pgrep (3 patterns): still found (after SIGKILL)
      // Third round of pgrep (3 patterns): gone
      setupPgrepSequence([
        // Round 0, first findNexuProcessPids call (3 pattern checks)
        [99001],
        [99002],
        [],
        // Round 1, second findNexuProcessPids call after interval (3 pattern checks)
        [],
        [],
        [],
      ]);

      const { ensureNexuProcessesDead } = await import(
        "../../apps/desktop/main/services/launchd-bootstrap"
      );

      const result = await ensureNexuProcessesDead({
        timeoutMs: 2000,
        intervalMs: 10,
      });

      expect(result.clean).toBe(true);
      expect(result.remainingPids).toEqual([]);

      // Should have sent SIGKILL to the found processes
      expect(mockKill).toHaveBeenCalledWith(99001, "SIGKILL");
      expect(mockKill).toHaveBeenCalledWith(99002, "SIGKILL");
    } finally {
      process.kill = originalKill;
    }
  });

  it("returns clean=true on final check after timeout loop (success-after-timeout)", async () => {
    // This tests the specific path where:
    // 1. Processes persist through the entire timeout loop
    // 2. Final check after timeout shows they are now dead
    const originalKill = process.kill;
    const mockKill = vi.fn();
    process.kill = mockKill as unknown as typeof process.kill;

    try {
      let pgrepCallCount = 0;
      mockExecFile.mockImplementation(
        (
          cmd: string,
          _args: string[],
          callback: (
            error: Error | null,
            result: { stdout: string; stderr: string },
          ) => void,
        ) => {
          if (cmd === "pgrep") {
            pgrepCallCount++;
            // Return processes for the first many calls (inside the timeout loop),
            // then return empty for final check.
            // With 3 patterns per findNexuProcessPids call, and a very short
            // timeout + interval, the loop runs ~1-2 times.
            // The final check (after the while loop) should return empty.
            // We'll make the first 6 calls return PIDs (2 rounds of 3 patterns),
            // and anything after return empty.
            if (pgrepCallCount <= 6) {
              callback(null, { stdout: "88001\n", stderr: "" });
            } else {
              callback(Object.assign(new Error("exit 1"), { code: 1 }), {
                stdout: "",
                stderr: "",
              });
            }
            return;
          }
          callback(null, { stdout: "", stderr: "" });
        },
      );

      const { ensureNexuProcessesDead } = await import(
        "../../apps/desktop/main/services/launchd-bootstrap"
      );

      const result = await ensureNexuProcessesDead({
        timeoutMs: 50,
        intervalMs: 10,
      });

      expect(result.clean).toBe(true);
      expect(result.remainingPids).toEqual([]);
    } finally {
      process.kill = originalKill;
    }
  });

  it("returns clean=false when processes survive timeout and final check", async () => {
    const originalKill = process.kill;
    const mockKill = vi.fn();
    process.kill = mockKill as unknown as typeof process.kill;

    try {
      // All pgrep calls return processes (they never die)
      mockExecFile.mockImplementation(
        (
          cmd: string,
          _args: string[],
          callback: (
            error: Error | null,
            result: { stdout: string; stderr: string },
          ) => void,
        ) => {
          if (cmd === "pgrep") {
            callback(null, { stdout: "77001\n", stderr: "" });
            return;
          }
          callback(null, { stdout: "", stderr: "" });
        },
      );

      const { ensureNexuProcessesDead } = await import(
        "../../apps/desktop/main/services/launchd-bootstrap"
      );

      const result = await ensureNexuProcessesDead({
        timeoutMs: 50,
        intervalMs: 10,
      });

      expect(result.clean).toBe(false);
      expect(result.remainingPids).toContain(77001);
    } finally {
      process.kill = originalKill;
    }
  });
});
