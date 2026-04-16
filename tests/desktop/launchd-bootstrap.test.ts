/**
 * Launchd Bootstrap tests — covers the full startup sequence:
 * - Port recovery from runtime-ports.json
 * - Attach to running services
 * - Fresh install + start
 * - Edge cases: stale services, NEXU_HOME mismatch, port conflicts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

const mockSlimclawRuntimeRoot =
  "/repo/packages/slimclaw/.dist-runtime/openclaw";

function buildRuntimeArtifacts(runtimeRoot: string) {
  return {
    entryPath: `${runtimeRoot}/node_modules/openclaw/openclaw.mjs`,
    binPath: `${runtimeRoot}/bin/openclaw`,
    builtinExtensionsDir: `${runtimeRoot}/node_modules/openclaw/extensions`,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/Users/testuser"),
  userInfo: vi.fn(() => ({ uid: 501 })),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => ""),
  writeFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      cb?: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (cb) cb(null, "", "");
      return { stdout: "", stderr: "" };
    },
  ),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
  unlink: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:net", () => ({
  default: {
    createServer: vi.fn(() => ({
      once() {},
      listen(_p: number, _h: string, cb: () => void) {
        setTimeout(() => cb(), 0);
      },
      close(cb: () => void) {
        setTimeout(() => cb(), 0);
      },
    })),
  },
  createConnection: vi.fn(() => {
    const socket = {
      once(event: string, cb: () => void) {
        if (event === "connect") setTimeout(() => cb(), 0);
      },
      destroy: vi.fn(),
      setTimeout: vi.fn(),
    };
    return socket;
  }),
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
  }),
}));

vi.mock("../../apps/desktop/main/runtime/manifests", () => ({
  ensurePackagedOpenclawSidecar: vi.fn(() => "/app/openclaw-sidecar"),
}));

vi.mock("../../apps/desktop/shared/workspace-paths", () => ({
  getWorkspaceRoot: vi.fn(() => "/repo"),
}));

vi.mock("@nexu/slimclaw", () => ({
  getSlimclawRuntimeRoot: vi.fn(() => mockSlimclawRuntimeRoot),
  resolveSlimclawRuntimePaths: vi.fn(() => ({
    runtimeRoot: mockSlimclawRuntimeRoot,
    descriptorPath: "/repo/.tmp/slimclaw/runtime-descriptor.json",
    descriptor: {
      version: 1,
      fingerprint: "test-fingerprint",
      preparedAt: new Date(0).toISOString(),
      openclawVersion: "1.0.0",
      relativeTo: "runtimeRoot",
      paths: {
        entryPath: "node_modules/openclaw/openclaw.mjs",
        binPath: "bin/openclaw",
        builtinExtensionsDir: "node_modules/openclaw/extensions",
      },
    },
    ...buildRuntimeArtifacts(mockSlimclawRuntimeRoot),
  })),
  resolveSlimclawRuntimeArtifacts: vi.fn((runtimeRoot: string) =>
    buildRuntimeArtifacts(runtimeRoot),
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBootstrapEnv(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    isDev: true,
    controllerPort: 50800,
    openclawPort: 18789,
    webPort: 50810,
    webRoot: "/repo/apps/web/dist",
    nodePath: "/usr/local/bin/node",
    controllerEntryPath: "/repo/apps/controller/dist/index.js",
    openclawPath: `${mockSlimclawRuntimeRoot}/node_modules/openclaw/openclaw.mjs`,
    openclawConfigPath: "/tmp/state/openclaw.json",
    openclawStateDir: "/tmp/state",
    controllerCwd: "/repo/apps/controller",
    openclawCwd: mockSlimclawRuntimeRoot,
    nexuHome: "/tmp/nexu-home",
    plistDir: "/tmp/test-plist",
    webUrl: "http://127.0.0.1:50810",
    openclawSkillsDir: "/tmp/state/skills",
    skillhubStaticSkillsDir: "/repo/apps/desktop/static/bundled-skills",
    platformTemplatesDir: "/repo/apps/controller/static/platform-templates",
    openclawBinPath: `${mockSlimclawRuntimeRoot}/bin/openclaw`,
    openclawExtensionsDir: `${mockSlimclawRuntimeRoot}/node_modules/openclaw/extensions`,
    skillNodePath: "/repo/apps/desktop/node_modules",
    openclawTmpDir: "/tmp/state/tmp",
    proxyEnv: {
      NO_PROXY: "localhost,127.0.0.1,::1",
    },
    controllerStartupValidationTimeoutMs: 500,
    ...overrides,
  };
}

const originalPlatform = process.platform;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isLaunchdBootstrapEnabled", () => {
  const originalEnv = { ...process.env };
  const originalPlatform = process.platform;

  afterEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("returns true when NEXU_USE_LAUNCHD=1", async () => {
    process.env.NEXU_USE_LAUNCHD = "1";
    const { shouldUseMacLaunchdRuntime } = await import(
      "../../apps/desktop/main/platforms/mac/runtime"
    );
    expect(shouldUseMacLaunchdRuntime()).toBe(true);
  });

  it("returns false when NEXU_USE_LAUNCHD=0", async () => {
    process.env.NEXU_USE_LAUNCHD = "0";
    const { shouldUseMacLaunchdRuntime } = await import(
      "../../apps/desktop/main/platforms/mac/runtime"
    );
    expect(shouldUseMacLaunchdRuntime()).toBe(false);
  });

  it("returns false in CI", async () => {
    process.env.CI = "true";
    process.env.NEXU_USE_LAUNCHD = undefined;
    const { shouldUseMacLaunchdRuntime } = await import(
      "../../apps/desktop/main/platforms/mac/runtime"
    );
    expect(shouldUseMacLaunchdRuntime()).toBe(false);
  });

  it("returns true for packaged macOS by default", async () => {
    Object.defineProperty(process, "execPath", {
      value: "/Applications/Nexu.app/Contents/MacOS/Nexu",
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

    expect(shouldUseMacLaunchdRuntime()).toBe(true);
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
});

describe("getDefaultPlistDir", () => {
  it("returns repo-local dir for dev", async () => {
    const { getDefaultPlistDir } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const dir = getDefaultPlistDir(true);
    expect(normalizePath(dir)).toContain(".tmp/launchd");
  });

  it("returns ~/Library/LaunchAgents for prod", async () => {
    const { getDefaultPlistDir } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const dir = getDefaultPlistDir(false);
    expect(normalizePath(dir)).toBe("/Users/testuser/Library/LaunchAgents");
  });
});

describe("getLogDir", () => {
  it("returns nexuHome/logs when nexuHome is provided", async () => {
    const { getLogDir } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    expect(normalizePath(getLogDir("/custom/home"))).toBe("/custom/home/logs");
  });

  it("returns ~/.nexu/logs when nexuHome is not provided", async () => {
    const { getLogDir } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    expect(normalizePath(getLogDir())).toBe("/Users/testuser/.nexu/logs");
  });
});

describe("resolveLaunchdPaths", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("resolves dev paths from workspace root", async () => {
    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const paths = await resolveLaunchdPaths(false, "/ignored");

    expect(normalizePath(paths.controllerEntryPath)).toContain(
      "apps/controller/dist/index.js",
    );
    expect(normalizePath(paths.openclawPath)).toContain(
      "packages/slimclaw/.dist-runtime/openclaw/node_modules/openclaw/openclaw.mjs",
    );
    expect(normalizePath(paths.openclawBinPath)).toContain(
      "packages/slimclaw/.dist-runtime/openclaw/bin/openclaw",
    );
    expect(normalizePath(paths.openclawExtensionsDir)).toContain(
      "packages/slimclaw/.dist-runtime/openclaw/node_modules/openclaw/extensions",
    );
    expect(normalizePath(paths.openclawCwd)).toContain(
      "packages/slimclaw/.dist-runtime/openclaw",
    );
    expect(normalizePath(paths.controllerCwd)).toContain("apps/controller");
  });

  it("resolves packaged paths to external locations outside .app", async () => {
    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const paths = await resolveLaunchdPaths(true, "/Resources", "1.0.0");

    // Node runner should be outside .app (in ~/.nexu/runtime/nexu-runner.app/)
    expect(normalizePath(paths.nodePath)).toContain(
      ".nexu/runtime/nexu-runner.app",
    );
    expect(normalizePath(paths.nodePath)).not.toContain("/Resources");
    // Controller should be outside .app (in ~/.nexu/runtime/controller-sidecar/)
    expect(normalizePath(paths.controllerEntryPath)).toContain(
      ".nexu/runtime/controller-sidecar/dist/index.js",
    );
    expect(normalizePath(paths.controllerCwd)).toContain(
      ".nexu/runtime/controller-sidecar",
    );
  });
});

describe("bootstrapWithLaunchd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });

    // Default: no services running, not installed
    mockLaunchdManager.getServiceStatus.mockResolvedValue({
      label: "test",
      plistPath: "",
      status: "unknown",
    });
    mockLaunchdManager.isServiceInstalled.mockResolvedValue(false);
    mockLaunchdManager.installService.mockResolvedValue(undefined);
    mockLaunchdManager.startService.mockResolvedValue(undefined);
    mockLaunchdManager.bootoutAndWaitForExit.mockResolvedValue(undefined);

    // Mock fetch for controller readiness probe
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: vi.fn().mockResolvedValue({ ready: true }),
      }),
    );
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    vi.unstubAllGlobals();
  });

  it("installs and starts both services on fresh boot", async () => {
    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const env = makeBootstrapEnv();
    const result = await bootstrapWithLaunchd(env as never);

    // Both services should have been installed
    expect(mockLaunchdManager.installService).toHaveBeenCalledTimes(2);

    // Fresh start (not attach)
    expect(result.isAttach).toBe(false);
    expect(result.effectivePorts).toBeDefined();

    // Labels should be dev labels
    expect(result.labels.controller).toBe("io.nexu.controller.dev");
    expect(result.labels.openclaw).toBe("io.nexu.openclaw.dev");
  });

  it("always calls installService to detect plist changes", async () => {
    mockLaunchdManager.isServiceInstalled.mockResolvedValue(true);
    let controllerRecovered = false;
    mockLaunchdManager.bootoutAndWaitForExit.mockImplementation(
      (label: string) => {
        if (label.includes("controller")) {
          controllerRecovered = true;
        }
        return Promise.resolve(undefined);
      },
    );
    mockLaunchdManager.getServiceStatus.mockImplementation((label: string) => {
      if (label.includes("controller")) {
        return Promise.resolve(
          controllerRecovered
            ? { label: "test", plistPath: "", status: "running", pid: 1234 }
            : { label: "test", plistPath: "", status: "stopped" },
        );
      }

      return Promise.resolve(
        controllerRecovered
          ? { label: "test", plistPath: "", status: "running", pid: 1234 }
          : { label: "test", plistPath: "", status: "stopped" },
      );
    });

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // installService is always called so it can detect plist content changes
    expect(mockLaunchdManager.installService).toHaveBeenCalled();
  }, 30000);

  it("passes Langfuse env through to generated plists", async () => {
    const plistGenerator = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const generatePlistMock = plistGenerator.generatePlist as ReturnType<
      typeof vi.fn
    >;

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await bootstrapWithLaunchd(
      makeBootstrapEnv({
        langfusePublicKey: "pk_test",
        langfuseSecretKey: "sk_test",
        langfuseBaseUrl: "https://langfuse.example.com",
      }) as never,
    );

    expect(generatePlistMock).toHaveBeenCalledWith(
      "controller",
      expect.objectContaining({
        langfusePublicKey: "pk_test",
        langfuseSecretKey: "sk_test",
        langfuseBaseUrl: "https://langfuse.example.com",
      }),
    );
    expect(generatePlistMock).toHaveBeenCalledWith(
      "openclaw",
      expect.objectContaining({
        langfusePublicKey: "pk_test",
        langfuseSecretKey: "sk_test",
        langfuseBaseUrl: "https://langfuse.example.com",
      }),
    );
  });

  it("tears down services on NEXU_HOME mismatch", async () => {
    const fsMock = await import("node:fs/promises");
    // runtime-ports.json exists with matching isDev
    (fsMock.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({
        writtenAt: new Date().toISOString(),
        electronPid: 12345,
        controllerPort: 50800,
        openclawPort: 18789,
        webPort: 50810,
        nexuHome: "/wrong/home",
        isDev: true,
      }),
    );

    // Both services running with wrong NEXU_HOME
    mockLaunchdManager.getServiceStatus.mockResolvedValue({
      label: "test",
      plistPath: "",
      status: "running",
      pid: 1234,
      env: { NEXU_HOME: "/wrong/home" },
    });

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await bootstrapWithLaunchd(
      makeBootstrapEnv({ nexuHome: "/correct/home" }) as never,
    );

    // Should have tried to bootout stale services
    expect(mockLaunchdManager.bootoutService).toHaveBeenCalled();
  });

  it("uses prod labels when isDev is false", async () => {
    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(
      makeBootstrapEnv({ isDev: false }) as never,
    );

    expect(result.labels.controller).toBe("io.nexu.controller");
    expect(result.labels.openclaw).toBe("io.nexu.openclaw");
  });
});

describe("shouldUseMacLaunchdRuntime edge cases", () => {
  const originalEnv = { ...process.env };
  const originalPlatform = process.platform;
  const originalExecPath = process.execPath;

  afterEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(process, "platform", { value: originalPlatform });
    Object.defineProperty(process, "execPath", { value: originalExecPath });
  });

  it("returns true when packaged on macOS (execPath without node_modules)", async () => {
    process.env.NEXU_USE_LAUNCHD = undefined;
    process.env.CI = undefined;
    Object.defineProperty(process, "platform", { value: "darwin" });
    Object.defineProperty(process, "execPath", {
      value: "/Applications/Nexu.app/Contents/MacOS/Nexu",
    });

    const { shouldUseMacLaunchdRuntime } = await import(
      "../../apps/desktop/main/platforms/mac/runtime"
    );
    expect(shouldUseMacLaunchdRuntime()).toBe(true);
  });

  it("returns false when not on macOS even if packaged", async () => {
    process.env.NEXU_USE_LAUNCHD = undefined;
    process.env.CI = undefined;
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "execPath", {
      value: "/Applications/Nexu.app/Contents/MacOS/Nexu",
    });

    const { shouldUseMacLaunchdRuntime } = await import(
      "../../apps/desktop/main/platforms/mac/runtime"
    );
    expect(shouldUseMacLaunchdRuntime()).toBe(false);
  });

  it("returns false when execPath contains node_modules (dev mode)", async () => {
    process.env.NEXU_USE_LAUNCHD = undefined;
    process.env.CI = undefined;
    Object.defineProperty(process, "platform", { value: "darwin" });
    Object.defineProperty(process, "execPath", {
      value:
        "/repo/node_modules/.pnpm/electron/dist/Electron.app/Contents/MacOS/Electron",
    });

    const { shouldUseMacLaunchdRuntime } = await import(
      "../../apps/desktop/main/platforms/mac/runtime"
    );
    expect(shouldUseMacLaunchdRuntime()).toBe(false);
  });
});
