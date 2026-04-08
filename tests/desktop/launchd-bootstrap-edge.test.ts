/**
 * Launchd Bootstrap edge-case tests — covers:
 * 1. isLaunchdBootstrapEnabled with packaged app (process.execPath without "node_modules")
 * 2. resolveLaunchdPaths packaged mode (detailed path validation)
 * 3. ensureNexuProcessesDead success-after-timeout path (processes die in final check)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Mocks (same shape as launchd-bootstrap.test.ts)
// ---------------------------------------------------------------------------

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/Users/testuser"),
  userInfo: vi.fn(() => ({ uid: 501 })),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
  unlink: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:net", () => ({
  createConnection: vi.fn(),
}));

const mockExecFile = vi.fn(
  (
    _cmd: string,
    _args: string[],
    cb?: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    if (cb) cb(null, "", "");
    return { stdout: "", stderr: "" };
  },
);

function resetExecFileMock(): void {
  mockExecFile.mockReset();
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      cb?: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (cb) cb(null, "", "");
      return { stdout: "", stderr: "" };
    },
  );
}
vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => ""),
  writeFileSync: vi.fn(),
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

    const { shouldUseMacLaunchdRuntime } = await import(
      "../../apps/desktop/main/platforms/mac/runtime"
    );

    expect(shouldUseMacLaunchdRuntime()).toBe(true);
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

    const { shouldUseMacLaunchdRuntime } = await import(
      "../../apps/desktop/main/platforms/mac/runtime"
    );

    expect(shouldUseMacLaunchdRuntime()).toBe(false);
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

    const { shouldUseMacLaunchdRuntime } = await import(
      "../../apps/desktop/main/platforms/mac/runtime"
    );

    expect(shouldUseMacLaunchdRuntime()).toBe(false);
  });

  it("env NEXU_USE_LAUNCHD=1 overrides packaged detection", async () => {
    Object.defineProperty(process, "execPath", {
      value: "/repo/node_modules/.bin/node",
      configurable: true,
    });
    process.env.NEXU_USE_LAUNCHD = "1";

    const { shouldUseMacLaunchdRuntime } = await import(
      "../../apps/desktop/main/platforms/mac/runtime"
    );

    expect(shouldUseMacLaunchdRuntime()).toBe(true);
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

    const { shouldUseMacLaunchdRuntime } = await import(
      "../../apps/desktop/main/platforms/mac/runtime"
    );

    expect(shouldUseMacLaunchdRuntime()).toBe(false);
  });
});

describe("resolveLaunchdPaths — packaged mode details", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    resetExecFileMock();
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });

    const fsMock = await import("node:fs");
    const existsSync = fsMock.existsSync as unknown as ReturnType<typeof vi.fn>;
    const readFileSync = fsMock.readFileSync as unknown as ReturnType<
      typeof vi.fn
    >;
    existsSync.mockImplementation(() => true);
    readFileSync.mockImplementation(() => "");
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("resolves all paths outside .app bundle in packaged mode", async () => {
    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const paths = await resolveLaunchdPaths(
      true,
      "/App.app/Contents/Resources",
      "1.0.0",
    );

    // Node runner extracted to ~/.nexu/runtime/nexu-runner.app/
    expect(normalizePath(paths.nodePath)).toContain(
      ".nexu/runtime/nexu-runner.app",
    );
    expect(normalizePath(paths.nodePath)).not.toContain("/App.app/Contents");
    // Controller extracted to ~/.nexu/runtime/controller-sidecar/
    expect(normalizePath(paths.controllerEntryPath)).toContain(
      ".nexu/runtime/controller-sidecar/dist/index.js",
    );
    expect(normalizePath(paths.controllerCwd)).toContain(
      ".nexu/runtime/controller-sidecar",
    );
  });

  it("resolves openclaw path from sidecar extraction", async () => {
    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const paths = await resolveLaunchdPaths(true, "/Resources", "1.0.0");

    // ensurePackagedOpenclawSidecar returns `${nexuHome}/openclaw-sidecar`
    // where nexuHome = /Users/testuser/.nexu
    expect(normalizePath(paths.openclawPath)).toBe(
      "/Users/testuser/.nexu/openclaw-sidecar/node_modules/openclaw/openclaw.mjs",
    );
    expect(normalizePath(paths.openclawCwd)).toBe(
      "/Users/testuser/.nexu/openclaw-sidecar",
    );
  });

  it("uses external node runner (not process.execPath) in packaged mode", async () => {
    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const paths = await resolveLaunchdPaths(true, "/Resources", "1.0.0");

    // Should NOT be process.execPath (which points inside .app)
    expect(paths.nodePath).not.toBe(process.execPath);
    expect(normalizePath(paths.nodePath)).toContain(
      "nexu-runner.app/Contents/MacOS/Nexu",
    );
  });

  it("falls back to in-bundle runner/controller paths when external extraction fails", async () => {
    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], cb?: unknown) => {
        const callback = cb as
          | ((
              err: Error | null,
              result: { stdout: string; stderr: string },
            ) => void)
          | undefined;

        if (cmd === "cp") {
          callback?.(new Error("disk full"), {
            stdout: "",
            stderr: "disk full",
          });
          return { stdout: "", stderr: "disk full" };
        }

        callback?.(null, { stdout: "", stderr: "" });
        return { stdout: "", stderr: "" };
      },
    );

    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const paths = await resolveLaunchdPaths(
      true,
      "/App.app/Contents/Resources",
      "1.0.0",
    );

    expect(paths.nodePath).toBe(process.execPath);
    expect(normalizePath(paths.controllerEntryPath)).toBe(
      "/App.app/Contents/Resources/runtime/controller/dist/index.js",
    );
    expect(normalizePath(paths.controllerCwd)).toBe(
      "/App.app/Contents/Resources/runtime/controller",
    );
    expect(normalizePath(paths.openclawCwd)).toBe(
      "/Users/testuser/.nexu/openclaw-sidecar",
    );
  });

  it("reuses an existing version-stamped external node runner without recloning", async () => {
    vi.clearAllMocks();
    const fsMock = await import("node:fs");
    const existsSync = fsMock.existsSync as unknown as ReturnType<typeof vi.fn>;
    const readFileSync = fsMock.readFileSync as unknown as ReturnType<
      typeof vi.fn
    >;

    existsSync.mockImplementation((target: string) => {
      const normalizedTarget = normalizePath(target);
      if (normalizedTarget.endsWith(".nexu-runner-version")) return true;
      if (normalizedTarget.includes("nexu-runner.app/Contents/MacOS/Nexu"))
        return true;
      return normalizedTarget.endsWith("Info.plist");
    });
    readFileSync.mockImplementation((target: string) => {
      if (normalizePath(target).endsWith(".nexu-runner-version"))
        return JSON.stringify({
          appVersion: "1.2.3",
          bundleVersion: null,
          arch: process.arch,
        });
      return "";
    });

    const { ensureExternalNodeRunner } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const runnerPath = await ensureExternalNodeRunner(
      "/App.app/Contents",
      "/Users/testuser/.nexu",
      "1.2.3",
    );

    expect(normalizePath(runnerPath)).toBe(
      "/Users/testuser/.nexu/runtime/nexu-runner.app/Contents/MacOS/Nexu",
    );
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("cleans interrupted runner staging directories before extracting again", async () => {
    vi.clearAllMocks();
    const fsMock = await import("node:fs");
    const fsPromisesMock = await import("node:fs/promises");
    const existsSync = fsMock.existsSync as unknown as ReturnType<typeof vi.fn>;
    const readFileSync = fsMock.readFileSync as unknown as ReturnType<
      typeof vi.fn
    >;
    const rename = fsPromisesMock.rename as unknown as ReturnType<typeof vi.fn>;

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb?: unknown) => {
        const callback = cb as
          | ((
              err: Error | null,
              result: { stdout: string; stderr: string },
            ) => void)
          | undefined;
        callback?.(null, { stdout: "", stderr: "" });
        return { stdout: "", stderr: "" };
      },
    );

    existsSync.mockImplementation((target: string) => {
      const normalizedTarget = normalizePath(target);
      if (normalizedTarget.endsWith("nexu-runner.app.staging")) return true;
      if (
        normalizedTarget.endsWith(
          "/Users/testuser/.nexu/runtime/nexu-runner.app.staging/Contents/MacOS/Nexu",
        )
      ) {
        return true;
      }
      if (normalizedTarget.endsWith("Info.plist")) return true;
      return false;
    });
    readFileSync.mockReturnValue("");

    const { ensureExternalNodeRunner } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await ensureExternalNodeRunner(
      "/App.app/Contents",
      "/Users/testuser/.nexu",
      "1.0.0",
    );

    expect(mockExecFile).toHaveBeenCalledWith(
      "rm",
      ["-rf", expect.stringMatching(/nexu-runner\.app\.staging$/)],
      expect.any(Function),
    );
    expect(rename).toHaveBeenCalledWith(
      expect.stringMatching(/nexu-runner\.app\.staging$/),
      expect.stringMatching(/nexu-runner\.app$/),
    );
  });

  it("clones the full app bundle so signed runner resources stay intact", async () => {
    vi.clearAllMocks();
    const fsMock = await import("node:fs");
    const existsSync = fsMock.existsSync as unknown as ReturnType<typeof vi.fn>;
    const readFileSync = fsMock.readFileSync as unknown as ReturnType<
      typeof vi.fn
    >;

    existsSync.mockImplementation((target: string) => {
      const normalizedTarget = normalizePath(target);
      if (normalizedTarget.endsWith(".nexu-runner-version")) return false;
      if (
        normalizedTarget.endsWith(
          "/Users/testuser/.nexu/runtime/nexu-runner.app.staging/Contents/MacOS/Nexu",
        )
      ) {
        return true;
      }
      if (normalizedTarget.endsWith("Info.plist")) return true;
      return false;
    });
    readFileSync.mockReturnValue("");

    const { ensureExternalNodeRunner } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await ensureExternalNodeRunner(
      "/Applications/Nexu.app/Contents",
      "/Users/testuser/.nexu",
      "1.0.0",
    );

    const cloneCall = mockExecFile.mock.calls.find((call) => call[0] === "cp");
    expect(cloneCall).toBeDefined();
    expect(cloneCall?.[1]).toEqual([
      "-Rc",
      "/Applications/Nexu.app",
      expect.stringMatching(/nexu-runner\.app\.staging$/),
    ]);
    expect(mockExecFile).not.toHaveBeenCalledWith(
      "cp",
      ["-c", "/Applications/Nexu.app/Contents/MacOS/Nexu", expect.any(String)],
      expect.any(Function),
    );
  });

  it("writes version stamp outside .app bundle to preserve code signature", async () => {
    vi.clearAllMocks();
    const fsMock = await import("node:fs");
    const existsSync = fsMock.existsSync as unknown as ReturnType<typeof vi.fn>;
    const readFileSync = fsMock.readFileSync as unknown as ReturnType<
      typeof vi.fn
    >;
    const writeFileSync = fsMock.writeFileSync as unknown as ReturnType<
      typeof vi.fn
    >;

    existsSync.mockImplementation((target: string) => {
      const normalizedTarget = normalizePath(target);
      if (normalizedTarget.endsWith(".nexu-runner-version")) return false;
      if (
        normalizedTarget.endsWith(
          "/Users/testuser/.nexu/runtime/nexu-runner.app.staging/Contents/MacOS/Nexu",
        )
      ) {
        return true;
      }
      return false;
    });
    readFileSync.mockReturnValue("");

    const { ensureExternalNodeRunner } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await ensureExternalNodeRunner(
      "/Applications/Nexu.app/Contents",
      "/Users/testuser/.nexu",
      "2.0.0",
    );

    // Stamp must be a sibling of the .app bundle, NOT inside it.
    // Writing inside the bundle breaks codesign sealed resources.
    const stampCalls = writeFileSync.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("nexu-runner"),
    );
    expect(stampCalls).toHaveLength(1);
    const stampPath = stampCalls[0][0] as string;
    expect(normalizePath(stampPath)).toBe(
      "/Users/testuser/.nexu/runtime/.nexu-runner-version",
    );
    // Must NOT be inside the .app bundle
    expect(stampPath).not.toContain("nexu-runner.app/");
    expect(JSON.parse(stampCalls[0][1] as string)).toEqual({
      appVersion: "2.0.0",
      bundleVersion: null,
      arch: process.arch,
    });
  });

  it("writes version stamp after atomic swap, not before", async () => {
    vi.clearAllMocks();
    const fsMock = await import("node:fs");
    const fspMock = await import("node:fs/promises");
    const existsSync = fsMock.existsSync as unknown as ReturnType<typeof vi.fn>;
    const readFileSync = fsMock.readFileSync as unknown as ReturnType<
      typeof vi.fn
    >;
    const writeFileSync = fsMock.writeFileSync as unknown as ReturnType<
      typeof vi.fn
    >;
    const rename = fspMock.rename as unknown as ReturnType<typeof vi.fn>;

    existsSync.mockImplementation((target: string) => {
      const normalizedTarget = normalizePath(target);
      if (normalizedTarget.endsWith(".nexu-runner-version")) return false;
      if (
        normalizedTarget.endsWith(
          "/Users/testuser/.nexu/runtime/nexu-runner.app.staging/Contents/MacOS/Nexu",
        )
      ) {
        return true;
      }
      return false;
    });
    readFileSync.mockReturnValue("");

    // Track call order
    const callOrder: string[] = [];
    rename.mockImplementation(() => {
      callOrder.push("rename");
      return Promise.resolve();
    });
    writeFileSync.mockImplementation((...args: unknown[]) => {
      if (
        typeof args[0] === "string" &&
        (args[0] as string).includes("nexu-runner")
      ) {
        callOrder.push("writeStamp");
      }
    });

    const { ensureExternalNodeRunner } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await ensureExternalNodeRunner(
      "/Applications/Nexu.app/Contents",
      "/Users/testuser/.nexu",
      "3.0.0",
    );

    // Stamp must be written AFTER the atomic rename, so a crash during
    // extraction leaves no stale stamp pointing at a half-built bundle.
    const renameIdx = callOrder.indexOf("rename");
    const stampIdx = callOrder.indexOf("writeStamp");
    expect(renameIdx).toBeGreaterThanOrEqual(0);
    expect(stampIdx).toBeGreaterThanOrEqual(0);
    expect(stampIdx).toBeGreaterThan(renameIdx);
  });
});

describe("checkCriticalPathsLocked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns locked=true when lsof finds a foreign process holding a critical path", async () => {
    mockExecFile.mockImplementation(
      (
        cmd: string,
        args: string[],
        maybeOptions?: unknown,
        maybeCb?: unknown,
      ) => {
        const callback = (
          typeof maybeCb === "function" ? maybeCb : maybeOptions
        ) as
          | ((
              err: Error | null,
              result: { stdout: string; stderr: string },
            ) => void)
          | undefined;

        if (cmd === "lsof" && args[1]?.includes("controller-sidecar")) {
          callback?.(null, {
            stdout: `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 99999 me txt REG 1,4 0 0 ${args[1]}/dist/index.js\n`,
            stderr: "",
          });
          return { stdout: "", stderr: "" };
        }
        callback?.(new Error("exit 1"), { stdout: "", stderr: "" });
        return { stdout: "", stderr: "" };
      },
    );

    const { checkCriticalPathsLocked } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await checkCriticalPathsLocked();

    expect(result.locked).toBe(true);
    expect(result.lockedPaths.map(normalizePath)).toContain(
      "/Users/testuser/.nexu/runtime/controller-sidecar",
    );
  });

  it("ignores lsof lines from the current process and reports unlocked", async () => {
    mockExecFile.mockImplementation(
      (
        cmd: string,
        _args: string[],
        maybeOptions?: unknown,
        maybeCb?: unknown,
      ) => {
        const callback = (
          typeof maybeCb === "function" ? maybeCb : maybeOptions
        ) as
          | ((
              err: Error | null,
              result: { stdout: string; stderr: string },
            ) => void)
          | undefined;

        if (cmd === "lsof") {
          callback?.(null, {
            stdout: `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nElectron ${process.pid} me txt REG 1,4 0 0 /Users/testuser/.nexu/runtime/nexu-runner.app/Contents/MacOS/Nexu\n`,
            stderr: "",
          });
          return { stdout: "", stderr: "" };
        }
        callback?.(new Error("exit 1"), { stdout: "", stderr: "" });
        return { stdout: "", stderr: "" };
      },
    );

    const { checkCriticalPathsLocked } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await checkCriticalPathsLocked();

    expect(result.locked).toBe(false);
    expect(result.lockedPaths).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// External runner path stability
// ---------------------------------------------------------------------------

describe("external runner — path stability and edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("version upgrade triggers re-extraction (old stamp !== new version)", async () => {
    const fsMock = await import("node:fs");
    const existsSync = fsMock.existsSync as unknown as ReturnType<typeof vi.fn>;
    const readFileSync = fsMock.readFileSync as unknown as ReturnType<
      typeof vi.fn
    >;

    // Mock: stamp exists with old version, binary exists, Info.plist exists
    existsSync.mockImplementation((target: string) => {
      const normalizedTarget = normalizePath(target);
      if (normalizedTarget.endsWith(".nexu-runner-version")) return true;
      if (normalizedTarget.includes("MacOS/Nexu")) return true;
      if (normalizedTarget.endsWith("Info.plist")) return true;
      return false;
    });
    readFileSync.mockImplementation((target: string) => {
      if (normalizePath(target).endsWith(".nexu-runner-version"))
        return JSON.stringify({ appVersion: "0.1.6", bundleVersion: null });
      return "";
    });

    // Mock execFile to succeed for all shell commands (rm, cp, mv, mkdir)
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        cb?: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (cb) cb(null, "", "");
        return { stdout: "", stderr: "" };
      },
    );

    const { ensureExternalNodeRunner } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await ensureExternalNodeRunner(
      "/App.app/Contents",
      "/Users/testuser/.nexu",
      "0.2.0", // new version — mismatch triggers re-extract
    );

    // Should have called cp (extraction happened, not fast-path)
    expect(mockExecFile).toHaveBeenCalled();
    const cpCalls = mockExecFile.mock.calls.filter((call) => call[0] === "cp");
    expect(cpCalls.length).toBeGreaterThan(0);
  });

  it("same app version but different bundle build triggers re-extraction", async () => {
    const fsMock = await import("node:fs");
    const existsSync = fsMock.existsSync as unknown as ReturnType<typeof vi.fn>;
    const readFileSync = fsMock.readFileSync as unknown as ReturnType<
      typeof vi.fn
    >;

    existsSync.mockImplementation((target: string) => {
      const normalizedTarget = normalizePath(target);
      if (normalizedTarget.endsWith(".nexu-runner-version")) return true;
      if (normalizedTarget.includes("MacOS/Nexu")) return true;
      if (normalizedTarget.endsWith("Info.plist")) return true;
      return false;
    });
    readFileSync.mockImplementation((target: string) => {
      const normalizedTarget = normalizePath(target);
      if (normalizedTarget.endsWith(".nexu-runner-version")) {
        return JSON.stringify({
          appVersion: "0.2.0",
          bundleVersion: "old-build",
        });
      }
      if (normalizedTarget.endsWith("Info.plist")) {
        return "<dict><key>CFBundleVersion</key><string>new-build</string></dict>";
      }
      return "";
    });
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        cb?: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (cb) cb(null, "", "");
        return { stdout: "", stderr: "" };
      },
    );

    const { ensureExternalNodeRunner } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await ensureExternalNodeRunner(
      "/App.app/Contents",
      "/Users/testuser/.nexu",
      "0.2.0",
    );

    const cpCalls = mockExecFile.mock.calls.filter((call) => call[0] === "cp");
    expect(cpCalls.length).toBeGreaterThan(0);
  });

  it("tears down prod launchd services before replacing stale extracted runtime", async () => {
    const fsMock = await import("node:fs");
    const existsSync = fsMock.existsSync as unknown as ReturnType<typeof vi.fn>;
    const readFileSync = fsMock.readFileSync as unknown as ReturnType<
      typeof vi.fn
    >;

    mockLaunchdManager.bootoutAndWaitForExit.mockResolvedValue(undefined);

    existsSync.mockImplementation((target: string) => {
      const normalizedTarget = normalizePath(target);
      if (normalizedTarget.endsWith(".nexu-runner-version")) return true;
      if (normalizedTarget.endsWith("controller-sidecar/.version-stamp")) {
        return true;
      }
      if (normalizedTarget.includes("nexu-runner.app/Contents/MacOS/Nexu")) {
        return true;
      }
      if (normalizedTarget.endsWith("controller-sidecar/dist/index.js")) {
        return true;
      }
      if (
        normalizedTarget.endsWith(
          "/Users/testuser/.nexu/runtime/nexu-runner.app.staging/Contents/MacOS/Nexu",
        )
      ) {
        return true;
      }
      if (
        normalizedTarget.endsWith(
          "/Users/testuser/.nexu/runtime/controller-sidecar.staging/dist/index.js",
        )
      ) {
        return true;
      }
      if (normalizedTarget.endsWith("Info.plist")) return true;
      return false;
    });
    readFileSync.mockImplementation((target: string) => {
      const normalizedTarget = normalizePath(target);
      if (normalizedTarget.endsWith(".nexu-runner-version")) {
        return JSON.stringify({
          appVersion: "1.0.0",
          bundleVersion: "old-build",
        });
      }
      if (normalizedTarget.endsWith("controller-sidecar/.version-stamp")) {
        return JSON.stringify({
          appVersion: "1.0.0",
          bundleVersion: "old-build",
        });
      }
      if (normalizedTarget.endsWith("Info.plist")) {
        return "<dict><key>CFBundleVersion</key><string>new-build</string><key>CFBundleExecutable</key><string>Nexu</string></dict>";
      }
      return "";
    });

    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await resolveLaunchdPaths(true, "/App.app/Contents/Resources", "1.0.0");

    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalledWith(
      "io.nexu.openclaw",
      5000,
    );
    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalledWith(
      "io.nexu.controller",
      5000,
    );
  });

  it("dev mode paths do NOT use external runner", async () => {
    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const paths = await resolveLaunchdPaths(false, "/ignored");

    // Dev mode should use process.execPath directly
    expect(paths.nodePath).toBe(process.execPath);
    expect(paths.nodePath).not.toContain("nexu-runner.app");
    // Controller path should be in repo, not ~/.nexu
    expect(normalizePath(paths.controllerEntryPath)).toContain(
      "apps/controller/dist/index.js",
    );
    expect(normalizePath(paths.controllerEntryPath)).not.toContain(
      "controller-sidecar",
    );
  });

  it("readBundleExecutableName reads CFBundleExecutable from Info.plist", async () => {
    const fsMock = await import("node:fs");
    const existsSync = fsMock.existsSync as unknown as ReturnType<typeof vi.fn>;
    const readFileSync = fsMock.readFileSync as unknown as ReturnType<
      typeof vi.fn
    >;

    existsSync.mockImplementation((target: string) => {
      const normalizedTarget = normalizePath(target);
      if (normalizedTarget.endsWith("Info.plist")) return true;
      if (
        normalizedTarget.endsWith(
          "/Users/testuser/.nexu/runtime/nexu-runner.app.staging/Contents/MacOS/MyCustomApp",
        )
      ) {
        return true;
      }
      if (normalizedTarget.endsWith(".nexu-runner-version")) return false;
      return false;
    });
    readFileSync.mockImplementation((target: string) => {
      if (normalizePath(target).endsWith("Info.plist")) {
        return "<dict><key>CFBundleExecutable</key><string>MyCustomApp</string></dict>";
      }
      return "";
    });
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        cb?: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (cb) cb(null, "", "");
        return { stdout: "", stderr: "" };
      },
    );

    const { ensureExternalNodeRunner } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await ensureExternalNodeRunner(
      "/App.app/Contents",
      "/Users/testuser/.nexu",
      "1.0.0",
    );

    // Should use the name from Info.plist, not hardcoded "Nexu"
    expect(normalizePath(result)).toContain("MacOS/MyCustomApp");
    expect(normalizePath(result)).not.toContain("MacOS/Nexu");
  });

  it("assertSafeRmTarget rejects shallow paths", async () => {
    // assertSafeRmTarget is not exported, but we can test it indirectly:
    // if nexuHome were somehow "/" or "", the rm -rf would be on a shallow path
    // and ensureExternalNodeRunner should throw before executing rm.
    const fsMock = await import("node:fs");
    (fsMock.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      false,
    );
    (
      fsMock.readFileSync as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue("");

    const { ensureExternalNodeRunner } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    // nexuHome = "/x" → runnerRoot = "/x/runtime/nexu-runner.app" (3 segments, OK)
    // But if nexuHome = "" → runnerRoot = "runtime/nexu-runner.app" (2 segments, should fail)
    await expect(
      ensureExternalNodeRunner("/App.app/Contents", "", "1.0.0"),
    ).rejects.toThrow(/shallow path/i);
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
      (cmd: string, _args: string[], cb?: unknown) => {
        const callback = cb as
          | ((
              err: Error | null,
              result: { stdout: string; stderr: string },
            ) => void)
          | undefined;
        if (cmd === "pgrep") {
          const pids = pidSequences[callIndex] ?? [];
          callIndex++;
          if (pids.length === 0) {
            callback?.(Object.assign(new Error("exit 1"), { code: 1 }), {
              stdout: "",
              stderr: "",
            });
          } else {
            callback?.(null, { stdout: pids.join("\n"), stderr: "" });
          }
          return { stdout: "", stderr: "" };
        }
        // lsof or other commands
        callback?.(null, { stdout: "", stderr: "" });
        return { stdout: "", stderr: "" };
      },
    );
  }

  it("returns clean=true immediately when no processes found", async () => {
    setupPgrepSequence([
      [], // controller pattern
      [], // openclaw.mjs pattern
      [], // openclaw path pattern
      [], // repo openclaw-gateway pattern
      [], // packaged openclaw-gateway pattern
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
      // First round of pgrep (5 patterns): processes found
      // Second round of pgrep (5 patterns): gone
      setupPgrepSequence([
        // Round 0, first findNexuProcessPids call (5 pattern checks)
        [99001],
        [99002],
        [],
        [],
        [],
        // Round 1, second findNexuProcessPids call after interval (5 pattern checks)
        [],
        [],
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
        (cmd: string, _args: string[], cb?: unknown) => {
          const callback = cb as
            | ((
                err: Error | null,
                result: { stdout: string; stderr: string },
              ) => void)
            | undefined;
          if (cmd === "pgrep") {
            pgrepCallCount++;
            // Return processes for the first many calls (inside the timeout loop),
            // then return empty for final check.
            // With 5 patterns per findNexuProcessPids call, and a very short
            // timeout + interval, the loop runs ~1-2 times.
            // The final check (after the while loop) should return empty.
            // We'll make the first 10 calls return PIDs (2 rounds of 5 patterns),
            // and anything after return empty.
            if (pgrepCallCount <= 10) {
              callback?.(null, { stdout: "88001\n", stderr: "" });
            } else {
              callback?.(Object.assign(new Error("exit 1"), { code: 1 }), {
                stdout: "",
                stderr: "",
              });
            }
            return { stdout: "", stderr: "" };
          }
          callback?.(null, { stdout: "", stderr: "" });
          return { stdout: "", stderr: "" };
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
        (cmd: string, _args: string[], cb?: unknown) => {
          const callback = cb as
            | ((
                err: Error | null,
                result: { stdout: string; stderr: string },
              ) => void)
            | undefined;
          if (cmd === "pgrep") {
            callback?.(null, { stdout: "77001\n", stderr: "" });
            return { stdout: "", stderr: "" };
          }
          callback?.(null, { stdout: "", stderr: "" });
          return { stdout: "", stderr: "" };
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
