import path from "node:path";
/**
 * Lifecycle Teardown Smoke Tests
 *
 * Covers the unified teardownLaunchdServices() function and its edge cases:
 *
 * 1. Happy path: bootout both services, delete runtime-ports, kill orphans
 * 2. bootout fails for one service — continues with the other
 * 3. bootout succeeds but process survives — SIGKILL via saved PID
 * 4. Both bootout fail — orphan killer still runs
 * 5. runtime-ports.json missing — no error
 * 6. pgrep finds orphan processes — they are killed
 * 7. pgrep finds no orphans — no error
 * 8. Self-PID is excluded from orphan kill
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/Users/testuser"),
  userInfo: vi.fn(() => ({ uid: 501 })),
}));

const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
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
  rebootstrapFromPlist: vi.fn(),
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
    port: 50810,
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../apps/desktop/main/runtime/manifests", () => ({
  ensurePackagedOpenclawSidecar: vi.fn(() => "/app/openclaw-sidecar"),
}));

vi.mock("../../apps/desktop/shared/workspace-paths", () => ({
  getWorkspaceRoot: vi.fn(() => "/repo"),
}));

vi.mock("@nexu/slimclaw", () => ({
  getSlimclawRuntimeRoot: vi.fn(() =>
    path.join("/repo", "packages", "slimclaw", ".dist-runtime", "openclaw"),
  ),
  resolveSlimclawRuntimeArtifacts: vi.fn(() => ({
    entryPath: path.join(
      "/repo",
      "packages",
      "slimclaw",
      ".dist-runtime",
      "openclaw",
      "node_modules",
      "openclaw",
      "openclaw.mjs",
    ),
    binPath: path.join(
      "/repo",
      "packages",
      "slimclaw",
      ".dist-runtime",
      "openclaw",
      "bin",
      "openclaw",
    ),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const labels = {
  controller: "io.nexu.controller",
  openclaw: "io.nexu.openclaw",
};

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const repoControllerPattern = escapeRegexLiteral(
  path.join("/repo", "apps", "controller", "dist", "index.js"),
);
const repoOpenclawPattern = escapeRegexLiteral(
  path.join(
    "/repo",
    "packages",
    "slimclaw",
    ".dist-runtime",
    "openclaw",
    "node_modules",
    "openclaw",
    "openclaw.mjs",
  ),
);
const repoOpenclawBinPattern = escapeRegexLiteral(
  path.join(
    "/repo",
    "packages",
    "slimclaw",
    ".dist-runtime",
    "openclaw",
    "bin",
    "openclaw",
  ),
);
const packagedControllerPattern = escapeRegexLiteral(
  path.join(
    "/Users/testuser",
    ".nexu",
    "runtime",
    "controller-sidecar",
    "dist",
    "index.js",
  ),
);
const packagedOpenclawPattern = "\\.nexu/(runtime/)?openclaw-sidecar";
const packagedOpenclawBinPattern =
  "\\.nexu/(runtime/)?openclaw-sidecar/.*/openclaw(?:\\.cmd)?";

function setupPgrepMock(matches: Record<string, number[]>): void {
  mockExecFile.mockImplementation(
    (
      cmd: string,
      args: string[],
      callback: (
        error: Error | null,
        result: { stdout: string; stderr: string },
      ) => void,
    ) => {
      if (cmd === "pgrep") {
        const pattern = args[1]; // pgrep -f <pattern>
        const pids = matches[pattern];
        if (pids && pids.length > 0) {
          callback(null, {
            stdout: pids.join("\n"),
            stderr: "",
          });
        } else {
          callback(new Error("no matches"), { stdout: "", stderr: "" });
        }
        return;
      }
      // Default: command succeeds
      callback(null, { stdout: "", stderr: "" });
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("teardownLaunchdServices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLaunchdManager.bootoutAndWaitForExit.mockResolvedValue(undefined);
    mockLaunchdManager.bootoutService.mockResolvedValue(undefined);
    mockLaunchdManager.waitForExit.mockResolvedValue(undefined);
    mockLaunchdManager.getServiceStatus.mockResolvedValue({
      label: "test",
      plistPath: "",
      status: "unknown",
    });

    // Default: pgrep returns no matches
    setupPgrepMock({});
  });

  // -----------------------------------------------------------------------
  // 1. Happy path
  // -----------------------------------------------------------------------
  it("bootouts both services, deletes runtime-ports, and runs orphan cleanup", async () => {
    const fsMock = await import("node:fs/promises");

    const { teardownLaunchdServices } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await teardownLaunchdServices({
      launchd: mockLaunchdManager as never,
      labels,
      plistDir: "/tmp/test-plist",
    });

    // Both services should have been bootout + waited
    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalledTimes(2);
    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalledWith(
      "io.nexu.openclaw",
      5000,
    );
    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalledWith(
      "io.nexu.controller",
      5000,
    );

    // runtime-ports.json should be deleted
    const unlinkCalls = (fsMock.unlink as ReturnType<typeof vi.fn>).mock.calls;
    const portsUnlink = unlinkCalls.some(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("runtime-ports.json"),
    );
    expect(portsUnlink).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 2. One service bootout fails — other still proceeds
  // -----------------------------------------------------------------------
  it("continues teardown if one service bootout fails", async () => {
    mockLaunchdManager.bootoutAndWaitForExit
      .mockRejectedValueOnce(new Error("bootout failed for openclaw"))
      .mockResolvedValueOnce(undefined);

    const { teardownLaunchdServices } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    // Should NOT throw
    await teardownLaunchdServices({
      launchd: mockLaunchdManager as never,
      labels,
      plistDir: "/tmp/test-plist",
    });

    // Both should have been attempted
    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // 3. Both bootout fail — orphan killer still runs
  // -----------------------------------------------------------------------
  it("runs orphan kill even when both bootouts fail", async () => {
    mockLaunchdManager.bootoutAndWaitForExit
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"));

    // pgrep finds orphan processes
    setupPgrepMock({
      [packagedControllerPattern]: [99901],
      [packagedOpenclawPattern]: [99902],
      [packagedOpenclawBinPattern]: [99903],
    });

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const { teardownLaunchdServices } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await teardownLaunchdServices({
      launchd: mockLaunchdManager as never,
      labels,
      plistDir: "/tmp/test-plist",
    });

    // Orphan processes should be killed
    expect(killSpy).toHaveBeenCalledWith(99901, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(99902, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(99903, "SIGKILL");

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 4. runtime-ports.json missing — no error
  // -----------------------------------------------------------------------
  it("handles missing runtime-ports.json gracefully", async () => {
    const fsMock = await import("node:fs/promises");
    (fsMock.unlink as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ENOENT"),
    );

    const { teardownLaunchdServices } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    // Should NOT throw
    await teardownLaunchdServices({
      launchd: mockLaunchdManager as never,
      labels,
      plistDir: "/tmp/test-plist",
    });

    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // 5. pgrep finds orphans — they are killed
  // -----------------------------------------------------------------------
  it("kills orphan processes found by pgrep", async () => {
    setupPgrepMock({
      [repoControllerPattern]: [10001],
      [repoOpenclawPattern]: [10002, 10003],
      [repoOpenclawBinPattern]: [10004],
      [packagedOpenclawPattern]: [10005],
      [packagedOpenclawBinPattern]: [10006],
    });

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const { teardownLaunchdServices } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await teardownLaunchdServices({
      launchd: mockLaunchdManager as never,
      labels,
      plistDir: "/tmp/test-plist",
    });

    expect(killSpy).toHaveBeenCalledWith(10001, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(10002, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(10003, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(10004, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(10005, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(10006, "SIGKILL");

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 6. pgrep finds no orphans — no kill calls
  // -----------------------------------------------------------------------
  it("does not kill anything when pgrep finds no orphans", async () => {
    setupPgrepMock({}); // All patterns return no matches

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const { teardownLaunchdServices } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await teardownLaunchdServices({
      launchd: mockLaunchdManager as never,
      labels,
      plistDir: "/tmp/test-plist",
    });

    // process.kill should not be called (no orphans)
    expect(killSpy).not.toHaveBeenCalled();

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 7. Self-PID excluded from orphan kill
  // -----------------------------------------------------------------------
  it("excludes own PID from orphan kill list", async () => {
    const selfPid = process.pid;
    setupPgrepMock({
      [repoControllerPattern]: [selfPid, 99999],
    });

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const { teardownLaunchdServices } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await teardownLaunchdServices({
      launchd: mockLaunchdManager as never,
      labels,
      plistDir: "/tmp/test-plist",
    });

    // Should kill 99999 but NOT self
    expect(killSpy).toHaveBeenCalledWith(99999, "SIGKILL");
    expect(killSpy).not.toHaveBeenCalledWith(selfPid, "SIGKILL");

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 8. Custom timeout is passed through
  // -----------------------------------------------------------------------
  it("passes custom timeout to bootoutAndWaitForExit", async () => {
    const { teardownLaunchdServices } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await teardownLaunchdServices({
      launchd: mockLaunchdManager as never,
      labels,
      plistDir: "/tmp/test-plist",
      timeoutMs: 10000,
    });

    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalledWith(
      "io.nexu.openclaw",
      10000,
    );
    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalledWith(
      "io.nexu.controller",
      10000,
    );
  });

  // -----------------------------------------------------------------------
  // 9. Openclaw is torn down before controller (dependency order)
  // -----------------------------------------------------------------------
  it("tears down openclaw before controller (dependency order)", async () => {
    const callOrder: string[] = [];
    mockLaunchdManager.bootoutAndWaitForExit.mockImplementation(
      async (label: string) => {
        callOrder.push(label);
      },
    );

    const { teardownLaunchdServices } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await teardownLaunchdServices({
      launchd: mockLaunchdManager as never,
      labels,
      plistDir: "/tmp/test-plist",
    });

    expect(callOrder[0]).toBe("io.nexu.openclaw");
    expect(callOrder[1]).toBe("io.nexu.controller");
  });
});

// ---------------------------------------------------------------------------
// ensureNexuProcessesDead
// ---------------------------------------------------------------------------

describe("ensureNexuProcessesDead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLaunchdManager.bootoutAndWaitForExit.mockResolvedValue(undefined);
  });

  // -----------------------------------------------------------------------
  // 1. No processes → returns clean immediately
  // -----------------------------------------------------------------------
  it("returns clean=true immediately when no Nexu processes found", async () => {
    setupPgrepMock({}); // No matches

    const { ensureNexuProcessesDead } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await ensureNexuProcessesDead({
      timeoutMs: 2000,
      intervalMs: 100,
    });

    expect(result.clean).toBe(true);
    expect(result.remainingPids).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // 2. Processes die after first SIGKILL → returns clean
  // -----------------------------------------------------------------------
  it("returns clean=true after killing surviving processes", async () => {
    let round = 0;
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
          round++;
          if (round <= 1) {
            // First round: process found
            callback(null, { stdout: "88888\n", stderr: "" });
          } else {
            // Second round: process gone
            callback(new Error("no matches"), { stdout: "", stderr: "" });
          }
          return;
        }
        callback(null, { stdout: "", stderr: "" });
      },
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const { ensureNexuProcessesDead } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await ensureNexuProcessesDead({
      timeoutMs: 5000,
      intervalMs: 50,
    });

    expect(result.clean).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(88888, "SIGKILL");

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 3. Process survives until timeout → returns clean=false
  // -----------------------------------------------------------------------
  it("returns clean=false with remainingPids when timeout expires", async () => {
    // Process always found
    setupPgrepMock({
      [repoControllerPattern]: [77777],
    });

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const { ensureNexuProcessesDead } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await ensureNexuProcessesDead({
      timeoutMs: 300,
      intervalMs: 50,
    });

    expect(result.clean).toBe(false);
    expect(result.remainingPids).toContain(77777);
    // Should have attempted SIGKILL multiple times
    const sigkillCalls = killSpy.mock.calls.filter(
      (call) => call[0] === 77777 && call[1] === "SIGKILL",
    );
    expect(sigkillCalls.length).toBeGreaterThanOrEqual(2);

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 4. Multiple processes across patterns — all killed
  // -----------------------------------------------------------------------
  it("kills processes matching all patterns", async () => {
    setupPgrepMock({
      [repoControllerPattern]: [11111],
      [repoOpenclawPattern]: [22222],
      [repoOpenclawBinPattern]: [33333],
      [packagedOpenclawPattern]: [44444],
      [packagedOpenclawBinPattern]: [55555],
    });

    // After first round of kills, all processes die
    let killed = false;
    mockExecFile.mockImplementation(
      (
        cmd: string,
        args: string[],
        callback: (
          error: Error | null,
          result: { stdout: string; stderr: string },
        ) => void,
      ) => {
        if (cmd === "pgrep") {
          if (!killed) {
            const pattern = args[1];
            const matches: Record<string, string> = {
              [repoControllerPattern]: "11111",
              [repoOpenclawPattern]: "22222",
              [repoOpenclawBinPattern]: "33333",
              [packagedOpenclawPattern]: "44444",
              [packagedOpenclawBinPattern]: "55555",
            };
            if (matches[pattern]) {
              callback(null, { stdout: matches[pattern], stderr: "" });
            } else {
              callback(new Error("no matches"), { stdout: "", stderr: "" });
            }
          } else {
            callback(new Error("no matches"), { stdout: "", stderr: "" });
          }
          return;
        }
        callback(null, { stdout: "", stderr: "" });
      },
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      killed = true;
      return true;
    });

    const { ensureNexuProcessesDead } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await ensureNexuProcessesDead({
      timeoutMs: 5000,
      intervalMs: 50,
    });

    expect(result.clean).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(11111, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(22222, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(33333, "SIGKILL");

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 5. SIGKILL throws ESRCH (process already gone) — handled gracefully
  // -----------------------------------------------------------------------
  it("handles ESRCH when process dies between pgrep and kill", async () => {
    let round = 0;
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
          round++;
          if (round <= 1) {
            callback(null, { stdout: "55555\n", stderr: "" });
          } else {
            callback(new Error("no matches"), { stdout: "", stderr: "" });
          }
          return;
        }
        callback(null, { stdout: "", stderr: "" });
      },
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });

    const { ensureNexuProcessesDead } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    // Should NOT throw
    const result = await ensureNexuProcessesDead({
      timeoutMs: 2000,
      intervalMs: 50,
    });

    expect(result.clean).toBe(true);

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 6. Self-PID excluded from detection
  // -----------------------------------------------------------------------
  it("excludes own PID from detected processes", async () => {
    const selfPid = process.pid;
    setupPgrepMock({
      [repoControllerPattern]: [selfPid],
    });

    const { ensureNexuProcessesDead } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await ensureNexuProcessesDead({
      timeoutMs: 500,
      intervalMs: 50,
    });

    // Self-PID should be filtered out → clean
    expect(result.clean).toBe(true);
    expect(result.remainingPids).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // 7. process.kill throws non-ESRCH error (e.g. EPERM)
  // -----------------------------------------------------------------------
  it("handles EPERM from process.kill gracefully (does not crash)", async () => {
    let round = 0;
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
          round++;
          if (round <= 1) {
            callback(null, { stdout: "44444\n", stderr: "" });
          } else {
            callback(new Error("no matches"), { stdout: "", stderr: "" });
          }
          return;
        }
        callback(null, { stdout: "", stderr: "" });
      },
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("EPERM") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    });

    const { ensureNexuProcessesDead } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    // Should NOT throw even though kill throws EPERM
    const result = await ensureNexuProcessesDead({
      timeoutMs: 2000,
      intervalMs: 50,
    });

    // Process disappeared in round 2 (pgrep no matches), so clean
    expect(result.clean).toBe(true);
    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 8. Deduplication: same PID from multiple patterns counted once
  // -----------------------------------------------------------------------
  it("deduplicates PIDs found across multiple pgrep patterns", async () => {
    // Same PID 55555 matches both patterns
    setupPgrepMock({
      [repoControllerPattern]: [55555],
      [repoOpenclawPattern]: [55555],
      [packagedOpenclawPattern]: [55555],
      [repoOpenclawBinPattern]: [55555],
      [packagedOpenclawBinPattern]: [55555],
    });

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const { teardownLaunchdServices } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await teardownLaunchdServices({
      launchd: mockLaunchdManager as never,
      labels,
      plistDir: "/tmp/test-plist",
    });

    // Should kill 55555 only once (deduplicated by findNexuProcessPids)
    const killCalls = killSpy.mock.calls.filter(
      (call) => call[0] === 55555 && call[1] === "SIGKILL",
    );
    expect(killCalls.length).toBe(1);

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 9. Authoritative launchd PID detection works without pgrep matches
  // -----------------------------------------------------------------------
  it("kills packaged runner processes discovered only via launchctl labels", async () => {
    let launchdPidAlive = true;

    mockExecFile.mockImplementation(
      (
        cmd: string,
        args: string[],
        callback: (
          error: Error | null,
          result: { stdout: string; stderr: string },
        ) => void,
      ) => {
        if (cmd === "launchctl") {
          if (launchdPidAlive && args[1]?.includes("io.nexu.controller")) {
            callback(null, { stdout: "pid = 45678\n", stderr: "" });
          } else {
            callback(new Error("service not found"), {
              stdout: "",
              stderr: "",
            });
          }
          return;
        }

        if (cmd === "pgrep") {
          callback(new Error("no matches"), { stdout: "", stderr: "" });
          return;
        }

        callback(null, { stdout: "", stderr: "" });
      },
    );

    const originalKill = process.kill;
    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((pid: number, signal?: string | number) => {
        if (signal === 0) {
          return true;
        }
        if (pid === 45678 && signal === "SIGKILL") {
          launchdPidAlive = false;
          return true;
        }
        return originalKill(pid, signal as never);
      });

    const { ensureNexuProcessesDead } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await ensureNexuProcessesDead({
      timeoutMs: 500,
      intervalMs: 10,
    });

    expect(result.clean).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(45678, "SIGKILL");

    killSpy.mockRestore();
  });
});
