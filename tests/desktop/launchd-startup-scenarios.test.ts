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

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/Users/testuser"),
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
}));

vi.mock("node:net", () => ({
  createConnection: vi.fn(() => {
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
  }),
}));

const mockLaunchdManager = {
  getServiceStatus: vi.fn(),
  installService: vi.fn(),
  startService: vi.fn(),
  stopServiceGracefully: vi.fn(),
  bootoutService: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebServer.port = 50810;

    // Defaults: no services, not installed
    mockLaunchdManager.getServiceStatus.mockResolvedValue(mockUnknownService());
    mockLaunchdManager.isServiceInstalled.mockResolvedValue(false);
    mockLaunchdManager.installService.mockResolvedValue(undefined);
    mockLaunchdManager.startService.mockResolvedValue(undefined);
    mockLaunchdManager.bootoutService.mockResolvedValue(undefined);
    mockLaunchdManager.waitForExit.mockResolvedValue(undefined);
    mockLaunchdManager.rebootstrapFromPlist.mockResolvedValue(undefined);

    // Controller readiness probe succeeds
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200, ok: true }),
    );
  });

  afterEach(() => {
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
      // recover phase reads runtime-ports.json
      .mockResolvedValueOnce(makeRuntimePorts());

    // Both services running with correct NEXU_HOME
    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
    );

    // Health probes: controller HTTP ok, openclaw port listening
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200, ok: true }),
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
      .mockResolvedValueOnce(makeRuntimePorts());

    // Both services report running
    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
    );

    // Controller health probe FAILS
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // Should have bootout the unhealthy controller
    expect(mockLaunchdManager.bootoutService).toHaveBeenCalled();
    // Should have reinstalled
    expect(mockLaunchdManager.installService).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Scenario 5: Web port occupied → fallback to OS-assigned port
  // -----------------------------------------------------------------------
  it("Scenario 5: web port occupied falls back to OS-assigned port", async () => {
    const webServerMock = await import(
      "../../apps/desktop/main/services/embedded-web-server"
    );

    let callCount = 0;
    (
      webServerMock.startEmbeddedWebServer as ReturnType<typeof vi.fn>
    ).mockImplementation((_opts: { port: number }) => {
      callCount++;
      if (callCount === 1) {
        // First call fails (port occupied)
        return Promise.reject(new Error("EADDRINUSE"));
      }
      // Second call with port=0 succeeds
      mockWebServer.port = 59999;
      return Promise.resolve(mockWebServer);
    });

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // Should have tried port=0 on fallback
    expect(webServerMock.startEmbeddedWebServer).toHaveBeenCalledTimes(2);
    const secondCall = (
      webServerMock.startEmbeddedWebServer as ReturnType<typeof vi.fn>
    ).mock.calls[1][0];
    expect(secondCall.port).toBe(0);

    // effectivePorts should reflect the actual bound port
    expect(result.effectivePorts.webPort).toBe(59999);
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
    mockLaunchdManager.getServiceStatus.mockResolvedValue(mockStoppedService());

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
      .mockResolvedValueOnce(
        makeRuntimePorts({ nexuHome: "/wrong/nexu-home" }),
      );

    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/wrong/nexu-home" }),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await bootstrapWithLaunchd(
      makeBootstrapEnv({ nexuHome: "/correct/nexu-home" }) as never,
    );

    expect(mockLaunchdManager.bootoutService).toHaveBeenCalled();
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
    expect(mockLaunchdManager.bootoutService).toHaveBeenCalled();
    // Then do clean install
    expect(mockLaunchdManager.installService).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Scenario 9: Previous Electron dead → fresh web port
  // -----------------------------------------------------------------------
  it("Scenario 9: dead Electron PID uses fresh web port instead of recovered", async () => {
    const fsMock = await import("node:fs/promises");
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: controller plist
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: openclaw plist
      .mockResolvedValueOnce(
        makeRuntimePorts({
          electronPid: 999999, // PID that doesn't exist
          webPort: 55555,
        }),
      );

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
      .mockResolvedValueOnce(makeRuntimePorts());

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
    const cpMock = await import("node:child_process");
    let lsofCallCount = 0;
    (cpMock.execFile as ReturnType<typeof vi.fn>).mockImplementation(
      (
        _cmd: string,
        args: string[],
        callback: (
          error: Error | null,
          result: { stdout: string; stderr: string },
        ) => void,
      ) => {
        // lsof for port 50800 → occupied; 50801 → free
        if (args.some((a: string) => a.includes("50800"))) {
          lsofCallCount++;
          callback(null, { stdout: "99999\n", stderr: "" });
        } else {
          callback(new Error("no process"), { stdout: "", stderr: "" });
        }
      },
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // Controller should have been moved to 50801
    expect(result.effectivePorts.controllerPort).toBe(50801);
    expect(lsofCallCount).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Scenario 16: OpenClaw port occupied → findFreePort picks next port
  // -----------------------------------------------------------------------
  it("Scenario 16: openclaw port conflict resolved via findFreePort", async () => {
    const cpMock = await import("node:child_process");
    (cpMock.execFile as ReturnType<typeof vi.fn>).mockImplementation(
      (
        _cmd: string,
        args: string[],
        callback: (
          error: Error | null,
          result: { stdout: string; stderr: string },
        ) => void,
      ) => {
        if (args.some((a: string) => a.includes("18789"))) {
          callback(null, { stdout: "88888\n", stderr: "" });
        } else {
          callback(new Error("no process"), { stdout: "", stderr: "" });
        }
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
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: controller plist
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: openclaw plist
      .mockResolvedValueOnce(
        makeRuntimePorts({ isDev: false, controllerPort: 44444 }),
      );

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
  // Scenario 18: Partial attach — only controller running
  // -----------------------------------------------------------------------
  it("Scenario 18: partial attach with only controller running still recovers ports", async () => {
    const fsMock = await import("node:fs/promises");
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: controller plist
      .mockRejectedValueOnce(new Error("ENOENT")) // cleanup: openclaw plist
      .mockResolvedValueOnce(makeRuntimePorts());

    // Controller running, openclaw stopped
    mockLaunchdManager.getServiceStatus
      .mockResolvedValueOnce(
        mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
      ) // controller check 1
      .mockResolvedValueOnce(mockStoppedService()) // openclaw check 1
      .mockResolvedValueOnce(
        mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
      ) // controller health recheck
      .mockResolvedValue(mockStoppedService()); // openclaw subsequent

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
    (webServerMock.startEmbeddedWebServer as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("EADDRINUSE"))
      .mockRejectedValueOnce(new Error("EADDRINUSE"));

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    await expect(
      bootstrapWithLaunchd(makeBootstrapEnv() as never),
    ).rejects.toThrow("EADDRINUSE");
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
    await expect(result.controllerReady).resolves.toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Scenario 23: controllerReady skipped on attach (already healthy)
  // -----------------------------------------------------------------------
  it("Scenario 23: attach skips controller readiness wait", async () => {
    const fsMock = await import("node:fs/promises");
    (fsMock.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce(makeRuntimePorts());

    mockLaunchdManager.getServiceStatus.mockResolvedValue(
      mockRunningService({ NEXU_HOME: "/tmp/nexu-home", PORT: "50800" }),
    );

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // controllerReady should resolve immediately (already healthy)
    await expect(result.controllerReady).resolves.toBeUndefined();
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
      .mockResolvedValueOnce("{{invalid json!!!"); // runtime-ports.json

    const { bootstrapWithLaunchd } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    const result = await bootstrapWithLaunchd(makeBootstrapEnv() as never);

    // Should fall back to cold start with default ports
    expect(result.isAttach).toBe(false);
    expect(result.effectivePorts.controllerPort).toBe(50800);
  });
});
