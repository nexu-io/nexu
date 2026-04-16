/**
 * Launchd Startup Scenarios — smoke tests covering every bootstrap edge case:
 *
 * 1. Fresh cold start (no previous state)
 * 2. Attach to healthy running services
 * 3. Attach fails: controller unhealthy → teardown + cold start
 * 4. Attach fails: openclaw port not listening → teardown + cold start
 * 5. Port occupied → web server fallback to OS-assigned port
 * 6. Plist config drift → bootout + re-bootstrap
 * 7. NEXU_HOME mismatch → teardown stale services
 * 8. Services running but runtime-ports.json missing → teardown
 * 9. Previous Electron dead (stale PID) → fresh web port
 * 10. Stop via bootout → Start re-bootstraps from plist
 * 11. effectivePorts always returned (cold start and attach)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("node:child_process", () => ({
  // lsof (detectPortOccupier/findFreePort) → no occupier found
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      callback: (
        error: Error | null,
        result: { stdout: string; stderr: string },
      ) => void,
    ) => {
      callback(new Error("no process"), { stdout: "", stderr: "" });
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

vi.mock("node:net", () => {
  const createServer = vi.fn(() => ({
    once() {},
    listen(_port: number, _host: string, cb: () => void) {
      setTimeout(() => cb(), 0);
    },
    close(cb: () => void) {
      setTimeout(() => cb(), 0);
    },
  }));
  const createConnection = vi.fn(() => {
    // Return a mock socket that emits "connect" immediately
    const handlers: Record<string, (() => void)[]> = {};
    const socket = {
      once(event: string, cb: () => void) {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(cb);
        // Auto-emit "connect" on next tick to simulate healthy port
        if (event === "connect") {
          setTimeout(() => cb(), 0);
        }
      },
      destroy: vi.fn(),
      setTimeout: vi.fn(),
    };
    return socket;
  });

  return {
    default: {
      createServer,
      createConnection,
    },
    createServer,
    createConnection,
  };
});

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
  generatePlist: vi.fn((type: string) => `<plist>mock-${type}-v2</plist>`),
}));

const mockWebServer = {
  port: 50810,
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../apps/desktop/main/services/embedded-web-server", () => ({
  startEmbeddedWebServer: vi
    .fn()
    .mockImplementation((opts: { port: number }) => {
      // Simulate OS-assigned port when port=0
      mockWebServer.port = opts.port === 0 ? 59999 : opts.port;
      return Promise.resolve(mockWebServer);
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

function makeRuntimePorts(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    writtenAt: new Date().toISOString(),
    electronPid: 12345,
    controllerPort: 50800,
    openclawPort: 18789,
    webPort: 50810,
    nexuHome: "/tmp/nexu-home",
    isDev: true,
    ...overrides,
  });
}

function createReadyFetchResponse(ready = true) {
  return {
    status: ready ? 200 : 503,
    ok: ready,
    json: async () => ({ ready }),
  };
}

function mockRunningService(env?: Record<string, string>): {
  label: string;
  plistPath: string;
  status: string;
  pid: number;
  env?: Record<string, string>;
} {
  return {
    label: "test",
    plistPath: "",
    status: "running",
    pid: 1234,
    ...(env ? { env } : {}),
  };
}

function mockStoppedService() {
  return { label: "test", plistPath: "", status: "stopped" };
}

function mockUnknownService() {
  return { label: "test", plistPath: "", status: "unknown" };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Launchd Startup Scenarios", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    mockWebServer.port = 50810;

    // Restore embedded web server mock (some tests override it)
    const webServerMod = await import(
      "../../apps/desktop/main/services/embedded-web-server"
    );
    (
      webServerMod.startEmbeddedWebServer as ReturnType<typeof vi.fn>
    ).mockImplementation((opts: { port: number }) => {
      mockWebServer.port = opts.port === 0 ? 59999 : opts.port;
      return Promise.resolve(mockWebServer);
    });

    // Defaults: no services, not installed
    mockLaunchdManager.getServiceStatus.mockResolvedValue(mockUnknownService());
    mockLaunchdManager.isServiceInstalled.mockResolvedValue(false);
    mockLaunchdManager.installService.mockResolvedValue(undefined);
    mockLaunchdManager.startService.mockResolvedValue(undefined);
    mockLaunchdManager.bootoutService.mockResolvedValue(undefined);
    mockLaunchdManager.bootoutAndWaitForExit.mockResolvedValue(undefined);
    mockLaunchdManager.waitForExit.mockResolvedValue(undefined);
    mockLaunchdManager.rebootstrapFromPlist.mockResolvedValue(undefined);

    // Controller readiness probe succeeds
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(createReadyFetchResponse()),
    );
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // Scenario 1: Fresh cold start
  // -----------------------------------------------------------------------
  it("Scenario 1: fresh cold start installs and starts both services", async () => {
    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    expect(mockLaunchdManager.installService).toHaveBeenCalledTimes(2);
    expect(result.isAttach).toBe(false);
    expect(result.effectivePorts.controllerPort).toBe(50800);
    expect(result.effectivePorts.openclawPort).toBe(18789);
    expect(result.effectivePorts.webPort).toBe(50810);
  });

  // -----------------------------------------------------------------------
  // Scenario 2: Attach to healthy running services
  // -----------------------------------------------------------------------
  it("Scenario 2: attach to healthy running services reuses recovered ports", async () => {
    const fsMock = await import("node:fs/promises");
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      // cleanup phase reads controller plist — not found
      .mockRejectedValueOnce(new Error("ENOENT"))
      // cleanup phase reads openclaw plist — not found
      .mockRejectedValueOnce(new Error("ENOENT"))
      // stale session detection reads runtime-ports.json
      .mockResolvedValueOnce(makeRuntimePorts())
      // recover phase reads runtime-ports.json
      .mockResolvedValueOnce(makeRuntimePorts());

    // Both services running with correct NEXU_HOME
    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
    );

    // Health probes: controller HTTP ok, openclaw port listening
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(createReadyFetchResponse()),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    expect(result.isAttach).toBe(true);
    expect(result.effectivePorts.controllerPort).toBe(50800);
    expect(result.effectivePorts.webPort).toBe(50810);
    // Should NOT have installed fresh services
    expect(mockLaunchdManager.bootoutService).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Scenario 3: Controller unhealthy on attach → restart
  // -----------------------------------------------------------------------
  it("Scenario 3: controller unhealthy on attach triggers bootout + reinstall", async () => {
    const fsMock = await import("node:fs/promises");
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: controller plist
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: openclaw plist
      .mockResolvedValueOnce(makeRuntimePorts()) // stale session detection
      .mockResolvedValueOnce(makeRuntimePorts()); // recover phase

    // Both services report running
    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
    );

    // Controller readiness probe fails on attach, then succeeds after recovery
    let readyAttempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/internal/desktop/ready")) {
          readyAttempt++;
          return Promise.resolve(createReadyFetchResponse(readyAttempt >= 2));
        }
        return Promise.resolve(createReadyFetchResponse());
      }),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // Should have bootout the unhealthy controller
    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalled();
    // Should have reinstalled
    expect(mockLaunchdManager.installService).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Scenario 5: Web port occupied → fallback to OS-assigned port
  // -----------------------------------------------------------------------
  it("Scenario 5: web port occupied falls back to next port", async () => {
    const webServerMock = await import(
      "../../apps/desktop/main/services/embedded-web-server"
    );

    let callCount = 0;
    (
      webServerMock.startEmbeddedWebServer as ReturnType<typeof vi.fn>
    ).mockImplementation((opts: { port: number }) => {
      callCount++;
      if (callCount === 1) {
        // First call fails (port occupied)
        const err = Object.assign(new Error("EADDRINUSE"), {
          code: "EADDRINUSE",
        });
        return Promise.reject(err);
      }
      // Second call with port+1 succeeds
      mockWebServer.port = opts.port;
      return Promise.resolve(mockWebServer);
    });

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // Should have tried the next adjacent port after the first failure
    expect(webServerMock.startEmbeddedWebServer).toHaveBeenCalledTimes(2);
    const secondCall = (
      webServerMock.startEmbeddedWebServer as ReturnType<typeof vi.fn>
    ).mock.calls[1][0];
    expect(secondCall.port).toBe(50811); // webPort + 1

    // effectivePorts should reflect the actual bound port
    expect(result.effectivePorts.webPort).toBe(50811);
  });

  // -----------------------------------------------------------------------
  // Scenario 6: Plist config drift → bootout + re-bootstrap
  // -----------------------------------------------------------------------
  it("Scenario 6: plist content change triggers bootout + re-bootstrap", async () => {
    const fsMock = await import("node:fs/promises");

    // installService reads existing plist to compare
    // Return OLD content that differs from generated plist
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      // First call: runtime-ports.json → ENOENT
      .mockRejectedValueOnce(new Error("ENOENT"))
      // Second call: controller plist → old content
      .mockResolvedValueOnce("<plist>mock-controller-v1</plist>")
      // Third call: openclaw plist → old content
      .mockResolvedValueOnce("<plist>mock-openclaw-v1</plist>");

    // Services already registered
    mockLaunchdManager.isServiceInstalled.mockResolvedValue(true);
    let controllerStatusCalls = 0;
    let openclawStatusCalls = 0;
    mockLaunchdManager.getServiceStatus.mockImplementation((label: string) => {
      if (label.includes("controller")) {
        controllerStatusCalls++;
        return Promise.resolve(
          controllerStatusCalls <= 2
            ? mockStoppedService()
            : mockRunningService(),
        );
      }

      openclawStatusCalls++;
      return Promise.resolve(
        openclawStatusCalls <= 2 ? mockStoppedService() : mockRunningService(),
      );
    });

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // installService should detect drift and re-bootstrap
    expect(mockLaunchdManager.installService).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // Scenario 7: NEXU_HOME mismatch → teardown stale services
  // -----------------------------------------------------------------------
  it("Scenario 7: NEXU_HOME mismatch tears down stale services", async () => {
    const fsMock = await import("node:fs/promises");
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: controller plist
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: openclaw plist
      .mockResolvedValueOnce(makeRuntimePorts({ nexuHome: "/wrong/nexu-home" })) // stale session detection
      .mockResolvedValueOnce(
        makeRuntimePorts({ nexuHome: "/wrong/nexu-home" }),
      ); // recover phase

    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/wrong/nexu-home" }),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await bootstrapWithLaunchd(
      makeBootstrapEnv({ nexuHome: "/correct/nexu-home" }) as never,
    );

    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalled();
    // Should still install and start services after teardown
    expect(mockLaunchdManager.installService).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Scenario 8: Services running but runtime-ports.json missing → teardown
  // -----------------------------------------------------------------------
  it("Scenario 8: services running without runtime-ports.json are torn down", async () => {
    // readFile ENOENT for runtime-ports.json (default mock)
    // But services are running
    mockLaunchdManager.getServiceStatus.mockResolvedValue(mockRunningService());

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // Should teardown orphaned services
    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalled();
    // Then do clean install
    expect(mockLaunchdManager.installService).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Scenario 9: Previous Electron dead → fresh web port
  // -----------------------------------------------------------------------
  it("Scenario 9: dead Electron PID uses fresh web port instead of recovered", async () => {
    const fsMock = await import("node:fs/promises");
    const portsData = makeRuntimePorts({
      electronPid: 999999, // PID that doesn't exist
      webPort: 55555,
    });
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: controller plist
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: openclaw plist
      .mockResolvedValueOnce(portsData) // stale session detection
      .mockResolvedValueOnce(portsData); // recover phase

    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // Should use fresh web port (50810 from env) instead of recovered 55555
    // because the previous Electron is dead and its web server port is stale
    expect(result.effectivePorts.webPort).not.toBe(55555);
  });

  // -----------------------------------------------------------------------
  // Scenario 10: effectivePorts always present (cold start)
  // -----------------------------------------------------------------------
  it("Scenario 10: effectivePorts always returned on cold start", async () => {
    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    expect(result.effectivePorts).toBeDefined();
    expect(typeof result.effectivePorts.controllerPort).toBe("number");
    expect(typeof result.effectivePorts.openclawPort).toBe("number");
    expect(typeof result.effectivePorts.webPort).toBe("number");
    expect(typeof result.isAttach).toBe("boolean");
  });

  // -----------------------------------------------------------------------
  // Scenario 11: effectivePorts always present (attach)
  // -----------------------------------------------------------------------
  it("Scenario 11: effectivePorts always returned on attach", async () => {
    const fsMock = await import("node:fs/promises");
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: controller plist
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: openclaw plist
      .mockResolvedValueOnce(makeRuntimePorts()) // stale session detection
      .mockResolvedValueOnce(makeRuntimePorts()); // recover phase

    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    expect(result.effectivePorts).toBeDefined();
    expect(result.isAttach).toBe(true);
    expect(result.effectivePorts.controllerPort).toBe(50800);
  });

  // -----------------------------------------------------------------------
  // Scenario 12: runtime-ports.json written after bootstrap
  // -----------------------------------------------------------------------
  it("Scenario 12: runtime-ports.json is written with actual ports after bootstrap", async () => {
    const fsMock = await import("node:fs/promises");

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // writeFile should have been called for runtime-ports.json
    const writeCalls = (fsMock.writeFile as ReturnType<typeof vi.fn>).mock
      .calls;
    const portsWrite = writeCalls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("runtime-ports.json"),
    );
    expect(portsWrite).toBeDefined();

    // biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined above
    const written = JSON.parse(portsWrite![1] as string);
    expect(written.controllerPort).toBe(50800);
    expect(written.openclawPort).toBe(18789);
    expect(written.electronPid).toBe(process.pid);
  });

  // -----------------------------------------------------------------------
  // Scenario 13: Stale plist from different installation → cleanup
  // -----------------------------------------------------------------------
  it("Scenario 13: stale plist from different installation is cleaned up", async () => {
    const fsMock = await import("node:fs/promises");

    // readFile calls during cleanup:
    // 1. controller plist: stale content (different from what generatePlist produces)
    // 2. openclaw plist: stale content
    // Then runtime-ports.json and later reads: ENOENT
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("<plist>old-controller-from-v0.1.5</plist>")
      .mockResolvedValueOnce("<plist>old-openclaw-from-v0.1.5</plist>")
      .mockRejectedValue(new Error("ENOENT"));

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // Should have bootout stale services
    expect(mockLaunchdManager.bootoutService).toHaveBeenCalled();
    // Should have deleted stale plist files (unlink called)
    expect(fsMock.unlink).toHaveBeenCalled();
    // Should still install fresh services after cleanup
    expect(mockLaunchdManager.installService).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // Scenario 14: Non-stale plist (same cwd) is NOT cleaned up
  // -----------------------------------------------------------------------
  it("Scenario 14: plist with matching content is not cleaned up", async () => {
    const fsMock = await import("node:fs/promises");
    const plistGen = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    // readFile returns exactly what generatePlist produces → not stale
    const controllerPlist = (
      plistGen.generatePlist as ReturnType<typeof vi.fn>
    )("controller");
    const openclawPlist = (plistGen.generatePlist as ReturnType<typeof vi.fn>)(
      "openclaw",
    );
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(controllerPlist)
      .mockResolvedValueOnce(openclawPlist)
      .mockRejectedValue(new Error("ENOENT"));

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // Should NOT have tried to bootout (plist cwd matches)
    // Note: bootoutService may be called for other reasons, but unlink
    // should NOT have been called for plist files during cleanup phase
    const unlinkCalls = (fsMock.unlink as ReturnType<typeof vi.fn>).mock.calls;
    const plistUnlinks = unlinkCalls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && (call[0] as string).endsWith(".plist"),
    );
    expect(plistUnlinks).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Scenario 15: Controller port occupied → findFreePort picks next port
  // -----------------------------------------------------------------------
  it("Scenario 15: controller port conflict resolved via findFreePort", async () => {
    const netMock = await import("node:net");
    let listenCallCount = 0;
    (netMock.createServer as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
        return {
          once(event: string, cb: (...args: unknown[]) => void) {
            if (!handlers[event]) handlers[event] = [];
            handlers[event].push(cb);
          },
          listen(port: number, _host: string, cb: () => void) {
            listenCallCount++;
            if (port === 50800) {
              setTimeout(
                () => handlers.error?.[0]?.(new Error("EADDRINUSE")),
                0,
              );
            } else {
              setTimeout(() => cb(), 0);
            }
          },
          close(cb: () => void) {
            setTimeout(() => cb(), 0);
          },
        };
      },
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // Controller should have been moved to 50801
    expect(result.effectivePorts.controllerPort).toBe(50801);
    expect(listenCallCount).toBeGreaterThanOrEqual(2);
  });

  // -----------------------------------------------------------------------
  // Scenario 16: OpenClaw port occupied → findFreePort picks next port
  // -----------------------------------------------------------------------
  it("Scenario 16: openclaw port conflict resolved via findFreePort", async () => {
    const netMock = await import("node:net");
    (netMock.createServer as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
        return {
          once(event: string, cb: (...args: unknown[]) => void) {
            if (!handlers[event]) handlers[event] = [];
            handlers[event].push(cb);
          },
          listen(port: number, _host: string, cb: () => void) {
            if (port === 18789) {
              setTimeout(
                () => handlers.error?.[0]?.(new Error("EADDRINUSE")),
                0,
              );
            } else {
              setTimeout(() => cb(), 0);
            }
          },
          close(cb: () => void) {
            setTimeout(() => cb(), 0);
          },
        };
      },
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    expect(result.effectivePorts.openclawPort).toBe(18790);
  });

  // -----------------------------------------------------------------------
  // Scenario 17: isDev mismatch → recovered ports not reused
  // -----------------------------------------------------------------------
  it("Scenario 17: isDev mismatch skips port recovery", async () => {
    const fsMock = await import("node:fs/promises");
    const prodPorts = makeRuntimePorts({ isDev: false, controllerPort: 44444 });
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: controller plist
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: openclaw plist
      .mockResolvedValueOnce(prodPorts) // stale session detection
      .mockResolvedValueOnce(prodPorts); // recover phase

    // Services running (from a prod session)
    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/tmp/nexu-home" }),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(
      makeBootstrapEnv({ isDev: true }) as never,
    );

    // Should NOT reuse prod ports — use fresh defaults
    expect(result.effectivePorts.controllerPort).toBe(50800);
    expect(result.isAttach).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Scenario 18: App version mismatch tears down stale services
  // -----------------------------------------------------------------------
  it("Scenario 18: app version mismatch tears down stale services instead of attaching", async () => {
    const fsMock = await import("node:fs/promises");
    const ports = makeRuntimePorts({
      appVersion: "0.9.0",
      openclawStateDir: "/tmp/state",
      userDataPath: "/tmp/user-data",
      buildSource: "packaged",
    });
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce(ports)
      .mockResolvedValueOnce(ports);

    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(
      makeBootstrapEnv({
        appVersion: "1.0.0",
        userDataPath: "/tmp/user-data",
        buildSource: "packaged",
      }) as never,
    );

    expect(result.isAttach).toBe(false);
    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalled();
    expect(mockLaunchdManager.installService).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // Scenario 19: Build identity mismatch tears down stale services
  // -----------------------------------------------------------------------
  it("Scenario 19: build identity mismatch refuses cross-attach", async () => {
    const fsMock = await import("node:fs/promises");
    const ports = makeRuntimePorts({
      appVersion: "1.0.0",
      openclawStateDir: "/tmp/other-state",
      userDataPath: "/tmp/other-user-data",
      buildSource: "beta",
    });
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce(ports)
      .mockResolvedValueOnce(ports);

    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(
      makeBootstrapEnv({
        appVersion: "1.0.0",
        openclawStateDir: "/tmp/state",
        userDataPath: "/tmp/user-data",
        buildSource: "stable",
      }) as never,
    );

    expect(result.isAttach).toBe(false);
    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalled();
    expect(mockLaunchdManager.installService).toHaveBeenCalledTimes(2);
  }, 15000);

  // -----------------------------------------------------------------------
  // Scenario 20: Partial attach — only controller running
  // -----------------------------------------------------------------------
  it("Scenario 20: partial attach with only controller running still recovers ports", async () => {
    const fsMock = await import("node:fs/promises");
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: controller plist
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: openclaw plist
      .mockResolvedValueOnce(makeRuntimePorts()) // stale session detection
      .mockResolvedValueOnce(makeRuntimePorts()); // recover phase

    // Controller running, openclaw stopped
    mockLaunchdManager.getServiceStatus
      .mockResolvedValueOnce(
        mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
      ) // controller check 1
      .mockResolvedValueOnce(mockStoppedService()) // openclaw check 1
      .mockResolvedValueOnce(
        mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
      ) // controller health recheck
      .mockResolvedValueOnce(mockStoppedService()) // openclaw subsequent
      .mockResolvedValueOnce(mockStoppedService()) // controller after cleanup
      .mockResolvedValueOnce(mockStoppedService()) // openclaw after cleanup
      .mockResolvedValueOnce(mockRunningService({ PORT: "50800" })) // controller ensure
      .mockResolvedValueOnce(mockRunningService({ PORT: "50800" })) // controller validate
      .mockResolvedValueOnce(mockStoppedService()) // openclaw ensure
      .mockResolvedValue(mockRunningService()); // openclaw running afterwards

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // Should still recover ports (anyRunning = true)
    expect(result.effectivePorts.controllerPort).toBe(50800);
    // openclaw should be installed since it's not running
    expect(mockLaunchdManager.installService).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Scenario 19: Web server both attempts fail → bootstrap throws
  // -----------------------------------------------------------------------
  it("Scenario 19: web server startup failure propagates as error", async () => {
    const webServerMock = await import(
      "../../apps/desktop/main/services/embedded-web-server"
    );
    // All attempts fail with EADDRINUSE (5 adjacent ports + port 0 fallback)
    (
      webServerMock.startEmbeddedWebServer as ReturnType<typeof vi.fn>
    ).mockRejectedValue(
      Object.assign(new Error("EADDRINUSE"), { code: "EADDRINUSE" }),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await expect(
      bootstrapWithLaunchd(makeBootstrapEnv() as never),
    ).rejects.toThrow("all port attempts exhausted");
  });

  // -----------------------------------------------------------------------
  // Scenario 20: Prod labels used when isDev=false
  // -----------------------------------------------------------------------
  it("Scenario 20: prod mode uses non-dev labels and plist dir", async () => {
    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(
      makeBootstrapEnv({ isDev: false }) as never,
    );

    expect(result.labels.controller).toBe("io.nexu.controller");
    expect(result.labels.openclaw).toBe("io.nexu.openclaw");
  });

  // -----------------------------------------------------------------------
  // Scenario 21: Only controller plist stale, openclaw ok → partial cleanup
  // -----------------------------------------------------------------------
  it("Scenario 21: partial stale cleanup — only stale plist is removed", async () => {
    const fsMock = await import("node:fs/promises");
    const plistGen = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const currentOpenclawPlist = (
      plistGen.generatePlist as ReturnType<typeof vi.fn>
    )("openclaw");

    (fsMock.readFile as ReturnType<typeof vi.fn>)
      // controller plist: STALE
      .mockResolvedValueOnce("<plist>old-controller</plist>")
      // openclaw plist: CURRENT (matches generated)
      .mockResolvedValueOnce(currentOpenclawPlist)
      // runtime-ports.json: ENOENT (cleaned by stale cleanup)
      .mockRejectedValue(new Error("ENOENT"));

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // bootout should have been called (for stale controller)
    expect(mockLaunchdManager.bootoutService).toHaveBeenCalled();
    // unlink called for controller plist + runtime-ports.json
    const unlinkCalls = (fsMock.unlink as ReturnType<typeof vi.fn>).mock.calls;
    const controllerPlistUnlink = unlinkCalls.some(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("controller"),
    );
    expect(controllerPlistUnlink).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Scenario 22: controllerReady promise resolves on cold start
  // -----------------------------------------------------------------------
  it("Scenario 22: controllerReady promise resolves when controller responds", async () => {
    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // controllerReady should be a promise that resolves (fetch mock returns 200)
    await expect(result.controllerReady).resolves.toEqual({ ok: true });
  });

  // -----------------------------------------------------------------------
  // Scenario 23: controllerReady skipped on attach (already healthy)
  // -----------------------------------------------------------------------
  it("Scenario 23: attach skips controller readiness wait", async () => {
    const fsMock = await import("node:fs/promises");
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce(makeRuntimePorts()) // stale session detection
      .mockResolvedValueOnce(makeRuntimePorts()); // recover phase

    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // controllerReady should resolve immediately (already healthy)
    await expect(result.controllerReady).resolves.toEqual({ ok: true });
    expect(result.isAttach).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Scenario 24: Corrupted runtime-ports.json → treated as missing
  // -----------------------------------------------------------------------
  it("Scenario 24: corrupted runtime-ports.json is treated as missing", async () => {
    const fsMock = await import("node:fs/promises");
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: controller plist
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: openclaw plist
      .mockResolvedValueOnce("{{invalid json!!!") // stale session detection
      .mockResolvedValueOnce("{{invalid json!!!"); // recover phase

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // Should fall back to cold start with default ports
    expect(result.isAttach).toBe(false);
    expect(result.effectivePorts.controllerPort).toBe(50800);
  });

  // -----------------------------------------------------------------------
  // Scenario 25: Upgrade from pre-version runtime-ports forces clean restart
  // -----------------------------------------------------------------------
  it("Scenario 25: missing appVersion in recovered ports triggers clean cold start", async () => {
    const fsMock = await import("node:fs/promises");
    const legacyPorts = JSON.stringify({
      writtenAt: new Date().toISOString(),
      electronPid: 12345,
      controllerPort: 50800,
      openclawPort: 18789,
      webPort: 50810,
      nexuHome: "/tmp/nexu-home",
      isDev: true,
      userDataPath: "/tmp/user-data",
      buildSource: "stable",
    });

    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce(JSON.stringify(legacyPorts))
      .mockResolvedValueOnce(JSON.stringify(legacyPorts));

    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(
      makeBootstrapEnv({
        appVersion: "1.0.0",
        userDataPath: "/tmp/user-data",
        buildSource: "stable",
      }) as never,
    );

    expect(result.isAttach).toBe(false);
    expect(result.effectivePorts.controllerPort).toBe(50800);
    expect(mockLaunchdManager.installService).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // Scenario 26: stale force-quit session cleans runtime-ports and services
  // -----------------------------------------------------------------------
  it("Scenario 26: stale dead-electron session older than threshold is cleaned before restart", async () => {
    const fsMock = await import("node:fs/promises");
    const stalePorts = makeRuntimePorts({
      electronPid: 999999,
      writtenAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce(stalePorts);

    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    expect(result.isAttach).toBe(false);
    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalled();
    expect(fsMock.unlink).toHaveBeenCalledWith(
      expect.stringContaining("runtime-ports.json"),
    );
  });

  // -----------------------------------------------------------------------
  // Scenario 27: Packaged partial state + stale orphan openclaw process
  // -----------------------------------------------------------------------
  it("Scenario 27: packaged partial launchd state kills stale orphan openclaw and forces clean cold start", async () => {
    const fsMock = await import("node:fs/promises");
    const cpMock = await import("node:child_process");
    const netMock = await import("node:net");

    const recoveredPorts = makeRuntimePorts({
      isDev: false,
      appVersion: "1.0.0",
      userDataPath: "/tmp/user-data",
      buildSource: "stable",
      openclawStateDir: "/tmp/state",
    });

    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: controller plist
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: openclaw plist
      .mockResolvedValueOnce(recoveredPorts); // stale session + recovery source

    // Partial stale state: controller is launchd-running, openclaw is not.
    mockLaunchdManager.getServiceStatus
      .mockResolvedValueOnce(
        mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
      ) // orphan cleanup pre-check: controller
      .mockResolvedValueOnce(mockStoppedService()) // orphan cleanup pre-check: openclaw
      .mockResolvedValueOnce(
        mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
      ) // partial-attach check: controller
      .mockResolvedValueOnce(mockStoppedService()) // partial-attach check: openclaw
      .mockResolvedValueOnce(mockStoppedService()) // post-teardown controller
      .mockResolvedValueOnce(mockStoppedService()) // post-teardown openclaw
      .mockResolvedValueOnce(mockRunningService({ PORT: "50800" })) // controller ensure
      .mockResolvedValueOnce(mockRunningService({ PORT: "50800" })) // controller validate
      .mockResolvedValueOnce(mockStoppedService()) // openclaw ensure
      .mockResolvedValue(mockRunningService()); // openclaw running afterwards

    (netMock.createServer as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
        return {
          once(event: string, cb: (...args: unknown[]) => void) {
            if (!handlers[event]) handlers[event] = [];
            handlers[event].push(cb);
          },
          listen(port: number, _host: string, cb: () => void) {
            if (port === 18789) {
              setTimeout(
                () => handlers.error?.[0]?.(new Error("EADDRINUSE")),
                0,
              );
            } else {
              setTimeout(() => cb(), 0);
            }
          },
          close(cb: () => void) {
            setTimeout(() => cb(), 0);
          },
        };
      },
    );

    (cpMock.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (
        cmd: string,
        args: string[],
        callback: (
          error: Error | null,
          result: { stdout: string; stderr: string },
        ) => void,
      ) => {
        // stale openclaw occupier still on recovered port
        if (
          cmd === "lsof" &&
          args.some((arg: string) => arg.includes("18789"))
        ) {
          callback(null, { stdout: "77777\n", stderr: "" });
          return;
        }

        // getCurrentProcessTreePids() -> no children to exclude
        if (cmd === "pgrep" && args[0] === "-P") {
          callback(new Error("no process"), { stdout: "", stderr: "" });
          return;
        }

        // orphan openclaw process still present from dev runtime path
        if (cmd === "pgrep" && args[0] === "-f") {
          if (
            args[1]?.includes(
              "\\.tmp/slimclaw/dev-runtime/node_modules/openclaw/openclaw\\.mjs",
            )
          ) {
            callback(null, { stdout: "77777\n", stderr: "" });
            return;
          }

          callback(new Error("no process"), { stdout: "", stderr: "" });
          return;
        }

        callback(new Error("no process"), { stdout: "", stderr: "" });
      },
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(
      makeBootstrapEnv({
        isDev: false,
        appVersion: "1.0.0",
        userDataPath: "/tmp/user-data",
        buildSource: "stable",
      }) as never,
    );

    expect(result.isAttach).toBe(false);
    expect(result.effectivePorts.controllerPort).toBe(50800);
    expect(result.effectivePorts.openclawPort).toBeGreaterThanOrEqual(18789);

    // stale partial launchd state is torn down and waits for exit
    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalledWith(
      "io.nexu.controller",
      5000,
    );
    // stale runtime metadata is removed before clean bootstrap
    expect(fsMock.unlink).toHaveBeenCalledWith(
      expect.stringContaining("runtime-ports.json"),
    );
    expect(netMock.createServer).toHaveBeenCalled();
    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Scenario 28: Global openclaw steals port after launch → auto-reassign
  // -----------------------------------------------------------------------
  it("Scenario 28: port stolen — openclaw crashed, port occupied → reassignment", async () => {
    const netMock = await import("node:net");

    (netMock.createServer as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
        return {
          once(event: string, cb: (...a: unknown[]) => void) {
            if (!handlers[event]) handlers[event] = [];
            handlers[event].push(cb);
          },
          listen(port: number, _host: string, cb: () => void) {
            if (port === 18789) {
              setTimeout(
                () => handlers.error?.[0]?.(new Error("EADDRINUSE")),
                0,
              );
            } else {
              setTimeout(() => cb(), 0);
            }
          },
          close(cb: () => void) {
            setTimeout(() => cb(), 0);
          },
        };
      },
    );

    mockLaunchdManager.getServiceStatus.mockResolvedValue({
      status: "running",
      pid: 55555,
    });

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    expect(result.effectivePorts.openclawPort).toBe(18790);
  });

  // -----------------------------------------------------------------------
  // Scenario 29: Our openclaw owns the port → no reassignment needed
  // -----------------------------------------------------------------------
  it("Scenario 29: openclaw owns its port, no reassignment needed", async () => {
    const netMock = await import("node:net");
    (netMock.createServer as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({
        once() {},
        listen(_p: number, _h: string, cb: () => void) {
          setTimeout(() => cb(), 0);
        },
        close(cb: () => void) {
          setTimeout(() => cb(), 0);
        },
      }),
    );

    mockLaunchdManager.getServiceStatus.mockResolvedValue({
      status: "running",
      pid: 55555,
    });

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    expect(result.effectivePorts.openclawPort).toBe(18789);
  });

  // -----------------------------------------------------------------------
  // Scenario 30: controller exits immediately after start → retry on new port
  // -----------------------------------------------------------------------
  it("Scenario 30: controller launchd stop after start triggers single retry on new port", async () => {
    const fsMock = await import("node:fs/promises");
    let controllerRecovered = false;

    let openclawStatusCalls = 0;
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
            ? mockRunningService({ PORT: "50801" })
            : mockStoppedService(),
        );
      }

      openclawStatusCalls++;
      switch (openclawStatusCalls) {
        case 1:
          return Promise.resolve(mockStoppedService());
        case 2:
          return Promise.resolve(mockStoppedService());
        default:
          return Promise.resolve(mockRunningService());
      }
    });

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    expect(result.effectivePorts.controllerPort).toBe(50801);
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("runtime-ports.json.tmp"),
      expect.stringContaining('"controllerPort": 50801'),
      "utf8",
    );
  }, 15000);

  // -----------------------------------------------------------------------
  // Scenario 31: controller port unreachable after start → retry on new port
  // -----------------------------------------------------------------------
  it("Scenario 31: controller port unreachable while launchd is running triggers retry", async () => {
    const netMock = await import("node:net");

    let controllerStatusCalls = 0;
    let openclawStatusCalls = 0;
    mockLaunchdManager.getServiceStatus.mockImplementation((label: string) => {
      if (label.includes("controller")) {
        controllerStatusCalls++;
        switch (controllerStatusCalls) {
          case 1:
            return Promise.resolve(mockStoppedService());
          case 2:
            return Promise.resolve(mockStoppedService());
          case 3:
            return Promise.resolve(mockRunningService({ PORT: "50800" }));
          case 4:
            return Promise.resolve(mockRunningService({ PORT: "50800" }));
          case 5:
            return Promise.resolve(mockRunningService({ PORT: "50801" }));
          default:
            return Promise.resolve(mockRunningService({ PORT: "50801" }));
        }
      }

      openclawStatusCalls++;
      switch (openclawStatusCalls) {
        case 1:
          return Promise.resolve(mockStoppedService());
        case 2:
          return Promise.resolve(mockStoppedService());
        default:
          return Promise.resolve(mockRunningService());
      }
    });

    (netMock.createConnection as ReturnType<typeof vi.fn>).mockImplementation(
      ({ port }: { port: number }) => {
        const socket = {
          once(event: string, cb: () => void) {
            if (event === "connect" && port === 50801) {
              setTimeout(() => cb(), 0);
            }
            if (event === "error" && port === 50800) {
              setTimeout(() => cb(), 0);
            }
          },
          destroy: vi.fn(),
          setTimeout: vi.fn(),
        };
        return socket;
      },
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    expect(mockLaunchdManager.bootoutAndWaitForExit).toHaveBeenCalledWith(
      "io.nexu.controller.dev",
      5000,
    );
    expect(result.effectivePorts.controllerPort).toBe(50801);
  }, 15000);

  // -----------------------------------------------------------------------
  // Scenario 32: retry success writes effectivePorts to runtime-ports metadata
  // -----------------------------------------------------------------------
  it("Scenario 32: controller retry success persists new port in runtime metadata", async () => {
    const fsMock = await import("node:fs/promises");
    const netMock = await import("node:net");

    let controllerStatusCalls = 0;
    let openclawStatusCalls = 0;
    mockLaunchdManager.getServiceStatus.mockImplementation((label: string) => {
      if (label.includes("controller")) {
        controllerStatusCalls++;
        switch (controllerStatusCalls) {
          case 1:
            return Promise.resolve(mockStoppedService());
          case 2:
            return Promise.resolve(mockStoppedService());
          case 3:
            return Promise.resolve(mockRunningService({ PORT: "50800" }));
          case 4:
            return Promise.resolve(mockRunningService({ PORT: "50800" }));
          case 5:
            return Promise.resolve(mockRunningService({ PORT: "50801" }));
          default:
            return Promise.resolve(mockRunningService({ PORT: "50801" }));
        }
      }

      openclawStatusCalls++;
      switch (openclawStatusCalls) {
        case 1:
          return Promise.resolve(mockStoppedService());
        case 2:
          return Promise.resolve(mockStoppedService());
        default:
          return Promise.resolve(mockRunningService());
      }
    });

    (netMock.createConnection as ReturnType<typeof vi.fn>).mockImplementation(
      ({ port }: { port: number }) => {
        const socket = {
          once(event: string, cb: () => void) {
            if (event === "connect" && port === 50801) {
              setTimeout(() => cb(), 0);
            }
            if (event === "error" && port === 50800) {
              setTimeout(() => cb(), 0);
            }
          },
          destroy: vi.fn(),
          setTimeout: vi.fn(),
        };
        return socket;
      },
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    expect(fsMock.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("runtime-ports.json.tmp"),
      expect.stringContaining('"controllerPort": 50801'),
      "utf8",
    );
  }, 15000);

  // -----------------------------------------------------------------------
  // Scenario 33: retry failure throws explicit recovery error
  // -----------------------------------------------------------------------
  it("Scenario 33: controller retry failure reports recovery details", async () => {
    const netMock = await import("node:net");

    let controllerStatusCalls = 0;
    let openclawStatusCalls = 0;
    mockLaunchdManager.getServiceStatus.mockImplementation((label: string) => {
      if (label.includes("controller")) {
        controllerStatusCalls++;
        switch (controllerStatusCalls) {
          case 1:
            return Promise.resolve(mockStoppedService());
          case 2:
            return Promise.resolve(mockStoppedService());
          case 3:
            return Promise.resolve(mockRunningService({ PORT: "50800" }));
          case 4:
            return Promise.resolve(mockRunningService({ PORT: "50800" }));
          case 5:
            return Promise.resolve(mockRunningService({ PORT: "50801" }));
          default:
            return Promise.resolve(mockRunningService({ PORT: "50801" }));
        }
      }

      openclawStatusCalls++;
      switch (openclawStatusCalls) {
        case 1:
          return Promise.resolve(mockStoppedService());
        case 2:
          return Promise.resolve(mockStoppedService());
        default:
          return Promise.resolve(mockRunningService());
      }
    });

    (netMock.createConnection as ReturnType<typeof vi.fn>).mockImplementation(
      ({ port }: { port: number }) => {
        const socket = {
          once(event: string, cb: () => void) {
            if (event === "error" && (port === 50800 || port === 50801)) {
              setTimeout(() => cb(), 0);
            }
          },
          destroy: vi.fn(),
          setTimeout: vi.fn(),
        };
        return socket;
      },
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await expect(
      bootstrapWithLaunchd(makeBootstrapEnv() as never),
    ).rejects.toThrow(
      /Controller startup recovery failed .*originalPort=50800 .*retryPort=50801 .*finalProbeUrl=http:\/\/127\.0\.0\.1:50801\/api\/internal\/desktop\/ready .*runtimePortsValue=/,
    );
  }, 15000);

  // -----------------------------------------------------------------------
  // Scenario 34: transient controller warm-up does not trigger recovery
  // -----------------------------------------------------------------------
  it("Scenario 34: controller warm-up polling avoids unnecessary recovery", async () => {
    const netMock = await import("node:net");
    let controllerStatusCalls = 0;
    let openclawStatusCalls = 0;
    let readyAttempts = 0;
    mockLaunchdManager.getServiceStatus.mockImplementation((label: string) => {
      if (label.includes("controller")) {
        controllerStatusCalls++;
        return Promise.resolve(
          controllerStatusCalls <= 2
            ? mockStoppedService()
            : mockRunningService({ PORT: "50800" }),
        );
      }
      openclawStatusCalls++;
      return Promise.resolve(
        openclawStatusCalls <= 2 ? mockStoppedService() : mockRunningService(),
      );
    });
    (netMock.createConnection as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        const socket = {
          once(event: string, cb: () => void) {
            if (event === "connect") {
              setTimeout(() => cb(), 0);
            }
          },
          destroy: vi.fn(),
          setTimeout: vi.fn(),
        };
        return socket;
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/internal/desktop/ready")) {
          readyAttempts++;
          if (readyAttempts < 3) {
            return Promise.resolve({
              ok: false,
              status: 503,
              json: async () => ({ ready: false }),
            });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ ready: true }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ready: true }),
        });
      }),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    expect(result.effectivePorts.controllerPort).toBe(50800);
    expect(
      mockLaunchdManager.bootoutAndWaitForExit.mock.calls.some(
        (call) => call[0] === "io.nexu.controller.dev",
      ),
    ).toBe(false);
  }, 15000);

  // -----------------------------------------------------------------------
  // Scenario 35: retry port clamps at 65535 instead of probing 65536
  // -----------------------------------------------------------------------
  it("Scenario 35: controller retry port is clamped at 65535", async () => {
    const netMock = await import("node:net");
    const cpMock = await import("node:child_process");
    const execFileMock = cpMock.execFile as unknown as ReturnType<typeof vi.fn>;

    let controllerStatusCalls = 0;
    let openclawStatusCalls = 0;
    mockLaunchdManager.getServiceStatus.mockImplementation((label: string) => {
      if (label.includes("controller")) {
        controllerStatusCalls++;
        switch (controllerStatusCalls) {
          case 1:
          case 2:
            return Promise.resolve(mockStoppedService());
          case 3:
          case 4:
            return Promise.resolve(mockRunningService({ PORT: "65535" }));
          default:
            return Promise.resolve(mockRunningService({ PORT: "65535" }));
        }
      }

      openclawStatusCalls++;
      return Promise.resolve(
        openclawStatusCalls <= 2 ? mockStoppedService() : mockRunningService(),
      );
    });

    (netMock.createConnection as ReturnType<typeof vi.fn>).mockImplementation(
      ({ port }: { port: number }) => {
        const socket = {
          once(event: string, cb: () => void) {
            if (event === "connect" && port === 65535) {
              setTimeout(() => cb(), 0);
            }
            if (event === "error" && port === 65535) {
              setTimeout(() => cb(), 0);
            }
          },
          destroy: vi.fn(),
          setTimeout: vi.fn(),
        };
        return socket;
      },
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(
      makeBootstrapEnv({
        controllerPort: 65535,
        recoveredPorts: null,
      }) as never,
    );

    expect(result.effectivePorts.controllerPort).toBe(65535);
    expect(
      execFileMock.mock.calls.some((call) =>
        JSON.stringify(call).includes("65536"),
      ),
    ).toBe(false);
  }, 15000);
});
