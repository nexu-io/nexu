import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "../../apps/controller/src/app/container.js";
import { registerDesktopRoutes } from "../../apps/controller/src/routes/desktop-routes.js";
import { createRuntimeState } from "../../apps/controller/src/runtime/state.js";
import type { ControllerBindings } from "../../apps/controller/src/types.js";

function createContainer(
  bootPhase: ReturnType<typeof createRuntimeState>["bootPhase"],
) {
  const runtimeState = createRuntimeState();
  runtimeState.bootPhase = bootPhase;
  runtimeState.status = bootPhase === "ready" ? "active" : "starting";

  return {
    env: {
      openclawStateDir: "/tmp/openclaw/state",
    },
    runtimeState,
    controlPlaneHealth: {
      probe: vi.fn(async () => ({
        ok: true,
        phase: "ready",
        checkedAt: new Date().toISOString(),
        latencyMs: 1,
        wsConnected: true,
        checks: {
          health: true,
          status: true,
          configGet: true,
        },
        errors: {
          health: null,
          status: null,
          configGet: null,
        },
        lastError: null,
      })),
    },
    configStore: {
      listBots: vi.fn(async () => []),
    },
  } as unknown as ControllerContainer;
}

describe("desktop ready route", () => {
  it("reports not ready before bootstrap reaches ready", async () => {
    const app = new OpenAPIHono<ControllerBindings>();
    registerDesktopRoutes(app, createContainer("stabilizing-runtime"));

    const response = await app.request("/api/internal/desktop/ready");
    const payload = (await response.json()) as {
      ready: boolean;
      coreReady: boolean;
      degraded: boolean;
      bootPhase: string;
      controlPlane: { ok: boolean };
    };

    expect(response.status).toBe(200);
    expect(payload.controlPlane.ok).toBe(true);
    expect(payload.bootPhase).toBe("stabilizing-runtime");
    expect(payload.coreReady).toBe(false);
    expect(payload.degraded).toBe(false);
    expect(payload.ready).toBe(false);
  });

  it("reports ready only after bootstrap reaches ready", async () => {
    const app = new OpenAPIHono<ControllerBindings>();
    registerDesktopRoutes(app, createContainer("ready"));

    const response = await app.request("/api/internal/desktop/ready");
    const payload = (await response.json()) as {
      ready: boolean;
      coreReady: boolean;
      degraded: boolean;
      bootPhase: string;
    };

    expect(response.status).toBe(200);
    expect(payload.bootPhase).toBe("ready");
    expect(payload.coreReady).toBe(true);
    expect(payload.degraded).toBe(false);
    expect(payload.ready).toBe(true);
  });

  it("reports degraded when control plane is ready but runtime is not fully active", async () => {
    const container = createContainer("ready");
    container.runtimeState.status = "degraded";
    const app = new OpenAPIHono<ControllerBindings>();
    registerDesktopRoutes(app, container);

    const response = await app.request("/api/internal/desktop/ready");
    const payload = (await response.json()) as {
      ready: boolean;
      coreReady: boolean;
      degraded: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload.coreReady).toBe(true);
    expect(payload.degraded).toBe(true);
    expect(payload.ready).toBe(false);
  });
});
