import { beforeEach, describe, expect, it, vi } from "vitest";

const getListeningPortPid = vi.fn();
const waitForListeningPortPid = vi.fn();
const waitFor = vi.fn(async (attempt: () => Promise<unknown>) => attempt());
const terminateProcess = vi.fn(async () => {});
const spawnHiddenProcess = vi.fn(async () => ({
  pid: 1234,
  child: {},
  dispose: vi.fn(),
}));
const waitForProcessStart = vi.fn(async () => {});
const ensureParentDirectory = vi.fn(async () => {});
const ensureDirectory = vi.fn(async () => {});
const writeDevLock = vi.fn(async () => {});
const readDevLock = vi.fn(async () => {
  const error = new Error("ENOENT") as Error & { code?: string };
  error.code = "ENOENT";
  throw error;
});

vi.mock("@nexu/dev-utils", () => ({
  createNodeOptions: () => "--conditions=development",
  ensureDirectory,
  ensureParentDirectory,
  getListeningPortPid,
  readDevLock,
  removeDevLock: vi.fn(async () => {}),
  repoRootPath: "/repo",
  resolveTsxPaths: () => ({ cliPath: "/repo/node_modules/tsx/cli.mjs" }),
  spawnHiddenProcess,
  terminateProcess,
  waitFor,
  waitForListeningPortPid,
  waitForProcessStart,
  writeDevLock,
}));

vi.mock("../../scripts/dev/src/shared/dev-runtime-config.js", () => ({
  createControllerInjectedEnv: () => ({}),
  createDesktopInjectedEnv: () => ({}),
  createWebInjectedEnv: () => ({}),
  getScriptsDevRuntimeConfig: () => ({
    controllerPort: 50800,
    webPort: 50810,
    openclawPort: 18789,
    openclawBaseUrl: "http://127.0.0.1:18789",
  }),
}));

vi.mock("../../scripts/dev/src/shared/logger.js", () => ({
  getScriptsDevLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../scripts/dev/src/shared/logs.js", () => ({
  readLogTailFromFile: vi.fn(),
}));

vi.mock("../../scripts/dev/src/shared/paths.js", () => ({
  controllerDevLockPath: "/tmp/controller.pid",
  controllerSupervisorPath: "/repo/scripts/dev/src/supervisors/controller.ts",
  getControllerDevLogPath: () => "/tmp/controller.log",
  getWebDevLogPath: () => "/tmp/web.log",
  webDevLockPath: "/tmp/web.pid",
  webSupervisorPath: "/repo/scripts/dev/src/supervisors/web.ts",
}));

vi.mock("../../scripts/dev/src/shared/trace.js", () => ({
  createDevMarkerArgs: () => [],
}));

describe("scripts/dev stale listener recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
  });

  it("kills a stale controller listener before spawning the controller service", async () => {
    getListeningPortPid
      .mockResolvedValueOnce(9000)
      .mockRejectedValueOnce(new Error("gone"));
    waitForListeningPortPid
      .mockResolvedValueOnce(18789)
      .mockResolvedValueOnce(50800);

    const { startControllerDevProcess } = await import(
      "../../scripts/dev/src/services/controller"
    );

    const snapshot = await startControllerDevProcess({
      sessionId: "controller-session",
    });

    expect(terminateProcess).toHaveBeenCalledWith(9000);
    expect(spawnHiddenProcess).toHaveBeenCalledOnce();
    expect(snapshot.workerPid).toBe(50800);
  });

  it("kills a stale web listener before spawning the web service", async () => {
    getListeningPortPid
      .mockResolvedValueOnce(9100)
      .mockRejectedValueOnce(new Error("gone"));
    waitForListeningPortPid.mockResolvedValueOnce(50810);

    const { startWebDevProcess } = await import(
      "../../scripts/dev/src/services/web"
    );

    const snapshot = await startWebDevProcess({ sessionId: "web-session" });

    expect(terminateProcess).toHaveBeenCalledWith(9100);
    expect(spawnHiddenProcess).toHaveBeenCalledOnce();
    expect(snapshot.listenerPid).toBe(50810);
  });
});
