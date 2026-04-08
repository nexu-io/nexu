import { describe, expect, it, vi } from "vitest";
import { ensureDesktopControllerReady } from "../../apps/desktop/src/lib/controller-ready";

function createReadyResponse(ready: boolean) {
  return {
    ok: true,
    json: async () => ({ ready }),
  };
}

describe("ensureDesktopControllerReady", () => {
  it("returns immediately when the controller is already ready", async () => {
    const fetchImpl = vi.fn(async () => createReadyResponse(true));
    const startController = vi.fn(async () => undefined);

    const ready = await ensureDesktopControllerReady({
      readyUrl: "http://127.0.0.1:50810/api/internal/desktop/ready",
      fetchImpl,
      startController,
      attemptTimeoutMs: 0,
      pollIntervalMs: 0,
      requestTimeoutMs: 10,
    });

    expect(ready).toBe(true);
    expect(startController).not.toHaveBeenCalled();
  });

  it("restarts the controller once after the first polling window times out", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async () => createReadyResponse(false))
      .mockImplementationOnce(async () => createReadyResponse(true));
    const startController = vi.fn(async () => undefined);

    const ready = await ensureDesktopControllerReady({
      readyUrl: "http://127.0.0.1:50810/api/internal/desktop/ready",
      fetchImpl,
      startController,
      attemptTimeoutMs: 0,
      pollIntervalMs: 0,
      requestTimeoutMs: 10,
    });

    expect(ready).toBe(true);
    expect(startController).toHaveBeenCalledTimes(1);
  });

  it("fails cleanly when the controller never becomes ready and recovery is disabled", async () => {
    const fetchImpl = vi.fn(async () => createReadyResponse(false));

    const ready = await ensureDesktopControllerReady({
      readyUrl: "http://127.0.0.1:50810/api/internal/desktop/ready",
      fetchImpl,
      attemptTimeoutMs: 0,
      pollIntervalMs: 0,
      requestTimeoutMs: 10,
    });

    expect(ready).toBe(false);
  });

  it("fails when restarting the controller throws", async () => {
    const fetchImpl = vi.fn(async () => createReadyResponse(false));
    const startController = vi.fn(async () => {
      throw new Error("launchd kickstart failed");
    });

    const ready = await ensureDesktopControllerReady({
      readyUrl: "http://127.0.0.1:50810/api/internal/desktop/ready",
      fetchImpl,
      startController,
      attemptTimeoutMs: 0,
      pollIntervalMs: 0,
      requestTimeoutMs: 10,
    });

    expect(ready).toBe(false);
    expect(startController).toHaveBeenCalledTimes(1);
  });

  it("keeps polling after the last recovery attempt until the controller becomes ready", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async () => createReadyResponse(false))
      .mockImplementationOnce(async () => createReadyResponse(false))
      .mockImplementationOnce(async () => createReadyResponse(true));
    const startController = vi.fn(async () => undefined);

    const ready = await ensureDesktopControllerReady({
      readyUrl: "http://127.0.0.1:50810/api/internal/desktop/ready",
      fetchImpl,
      startController,
      attemptTimeoutMs: 0,
      finalAttemptTimeoutMs: 10_000,
      pollIntervalMs: 0,
      requestTimeoutMs: 10,
    });

    expect(ready).toBe(true);
    expect(startController).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("gives up the final recovery attempt once the bounded timeout elapses", async () => {
    const fetchImpl = vi.fn(async () => createReadyResponse(false));
    const startController = vi.fn(async () => undefined);

    const ready = await ensureDesktopControllerReady({
      readyUrl: "http://127.0.0.1:50810/api/internal/desktop/ready",
      fetchImpl,
      startController,
      attemptTimeoutMs: 0,
      finalAttemptTimeoutMs: 0,
      pollIntervalMs: 0,
      requestTimeoutMs: 10,
    });

    expect(ready).toBe(false);
    expect(startController).toHaveBeenCalledTimes(1);
  });
});
