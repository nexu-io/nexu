/**
 * Launchd Bootstrap tests — covers the full startup sequence:
 * - Port recovery from runtime-ports.json
 * - Attach to running services
 * - Fresh install + start
 * - Edge cases: stale services, NEXU_HOME mismatch, port conflicts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    openclawPath: "/repo/openclaw-runtime/node_modules/openclaw/openclaw.mjs",
    openclawConfigPath: "/tmp/state/openclaw.json",
    openclawStateDir: "/tmp/state",
    controllerCwd: "/repo/apps/controller",
    openclawCwd: "/repo",
    nexuHome: "/tmp/nexu-home",
    plistDir: "/tmp/test-plist",
    webUrl: "http://127.0.0.1:50810",
    openclawSkillsDir: "/tmp/state/skills",
    skillhubStaticSkillsDir: "/repo/apps/desktop/static/bundled-skills",
    platformTemplatesDir: "/repo/apps/controller/static/platform-templates",
    openclawBinPath: "/repo/openclaw-runtime/bin/openclaw",
    openclawExtensionsDir: "/repo/node_modules/openclaw/extensions",
    skillNodePath: "/repo/apps/desktop/node_modules",
    openclawTmpDir: "/tmp/state/tmp",
    proxyEnv: {
      NO_PROXY: "localhost,127.0.0.1,::1",
    },
    controllerStartupValidationTimeoutMs: 500,
    ...overrides,
  };
}

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
    const { isLaunchdBootstrapEnabled } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    expect(isLaunchdBootstrapEnabled()).toBe(true);
  });

  it("returns false when NEXU_USE_LAUNCHD=0", async () => {
    process.env.NEXU_USE_LAUNCHD = "0";
    const { isLaunchdBootstrapEnabled } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    expect(isLaunchdBootstrapEnabled()).toBe(false);
  });

  it("returns false in CI", async () => {
    process.env.CI = "true";
    process.env.NEXU_USE_LAUNCHD = undefined;
    const { isLaunchdBootstrapEnabled } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    expect(isLaunchdBootstrapEnabled()).toBe(false);
  });
});

describe("getDefaultPlistDir", () => {
  it("returns repo-local dir for dev", async () => {
    const { getDefaultPlistDir } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const dir = getDefaultPlistDir(true);
    expect(dir).toContain(".tmp/launchd");
  });

  it("returns ~/Library/LaunchAgents for prod", async () => {
    const { getDefaultPlistDir } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const dir = getDefaultPlistDir(false);
    expect(dir).toBe("/Users/testuser/Library/LaunchAgents");
  });
});

describe("getLogDir", () => {
  it("returns nexuHome/logs when nexuHome is provided", async () => {
    const { getLogDir } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    expect(getLogDir("/custom/home")).toBe("/custom/home/logs");
  });

  it("returns ~/.nexu/logs when nexuHome is not provided", async () => {
    const { getLogDir } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    expect(getLogDir()).toBe("/Users/testuser/.nexu/logs");
  });
});

describe("resolveLaunchdPaths", () => {
  it("resolves dev paths from workspace root", async () => {
    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const paths = await resolveLaunchdPaths(false, "/ignored");

    expect(paths.controllerEntryPath).toContain(
      "apps/controller/dist/index.js",
    );
    expect(paths.openclawPath).toContain(
      "openclaw-runtime/node_modules/openclaw/openclaw.mjs",
    );
    expect(paths.controllerCwd).toContain("apps/controller");
  });

  it("resolves packaged paths to external locations outside .app", async () => {
    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const paths = await resolveLaunchdPaths(true, "/Resources", "1.0.0");

    // Node runner should be outside .app (in ~/.nexu/runtime/nexu-runner.app/)
    expect(paths.nodePath).toContain(".nexu/runtime/nexu-runner.app");
    expect(paths.nodePath).not.toContain("/Resources");
    // Controller should be outside .app (in ~/.nexu/runtime/controller-sidecar/)
    expect(paths.controllerEntryPath).toContain(
      ".nexu/runtime/controller-sidecar/dist/index.js",
    );
    expect(paths.controllerCwd).toContain(".nexu/runtime/controller-sidecar");
  });
});

describe("bootstrapWithLaunchd", () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
      vi.fn().mockResolvedValue({ status: 200, ok: true }),
    );
  });

  afterEach(() => {
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
  }, 15000);

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

describe("isLaunchdBootstrapEnabled edge cases", () => {
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

    const { isLaunchdBootstrapEnabled } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    expect(isLaunchdBootstrapEnabled()).toBe(true);
  });

  it("returns false when not on macOS even if packaged", async () => {
    process.env.NEXU_USE_LAUNCHD = undefined;
    process.env.CI = undefined;
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "execPath", {
      value: "/Applications/Nexu.app/Contents/MacOS/Nexu",
    });

    const { isLaunchdBootstrapEnabled } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    expect(isLaunchdBootstrapEnabled()).toBe(false);
  });

  it("returns false when execPath contains node_modules (dev mode)", async () => {
    process.env.NEXU_USE_LAUNCHD = undefined;
    process.env.CI = undefined;
    Object.defineProperty(process, "platform", { value: "darwin" });
    Object.defineProperty(process, "execPath", {
      value:
        "/repo/node_modules/.pnpm/electron/dist/Electron.app/Contents/MacOS/Electron",
    });

    const { isLaunchdBootstrapEnabled } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    expect(isLaunchdBootstrapEnabled()).toBe(false);
  });
});
