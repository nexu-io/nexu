import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { allocateDesktopRuntimePorts } from "#desktop/main/runtime/port-allocation";
import type { PortAllocationError } from "#desktop/main/runtime/port-allocation";
import type { DesktopRuntimeConfig } from "#desktop/shared/runtime-config";

const servers: Array<import("node:net").Server> = [];

function createRuntimeConfig(input?: {
  controllerPort?: number;
  webPort?: number;
  openclawPort?: number;
}): DesktopRuntimeConfig {
  const controllerPort = input?.controllerPort ?? 61_000;
  const webPort = input?.webPort ?? 61_010;
  const openclawPort = input?.openclawPort ?? 61_020;

  return {
    buildInfo: {
      version: "0.0.0",
      source: "local-dev",
      branch: null,
      commit: null,
      builtAt: null,
    },
    updates: {
      autoUpdateEnabled: true,
    },
    ports: {
      controller: controllerPort,
      web: webPort,
    },
    urls: {
      controllerBase: `http://127.0.0.1:${controllerPort}`,
      web: `http://127.0.0.1:${webPort}`,
      openclawBase: `http://127.0.0.1:${openclawPort}`,
      nexuCloud: "https://nexu.io",
      nexuLink: null,
      updateFeed: null,
    },
    tokens: {
      gateway: "gw-secret-token",
    },
    paths: {
      nexuHome: "~/.nexu",
      openclawBin: "openclaw-wrapper",
    },
    desktopAuth: {
      name: "NexU Desktop",
      email: "desktop@nexu.local",
      password: "desktop-local-password",
    },
    sentryDsn: null,
  };
}

async function listenOnPort(port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  servers.push(server);
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        }),
    ),
  );
});

describe("desktop port allocation", () => {
  it("probes the next idle port when preferred ports are occupied", async () => {
    const runtimeConfig = createRuntimeConfig();
    await listenOnPort(runtimeConfig.ports.controller);
    await listenOnPort(runtimeConfig.ports.web);
    await listenOnPort(61_020);

    const result = await allocateDesktopRuntimePorts({}, runtimeConfig);

    expect(result.runtimeConfig.ports.controller).toBe(61_001);
    expect(result.runtimeConfig.ports.web).toBe(61_011);
    expect(result.runtimeConfig.urls.openclawBase).toBe(
      "http://127.0.0.1:61021",
    );
    expect(result.allocations).toEqual([
      {
        purpose: "controller",
        preferredPort: 61_000,
        port: 61_001,
        strategy: "probed",
        attemptDelta: 1,
      },
      {
        purpose: "web",
        preferredPort: 61_010,
        port: 61_011,
        strategy: "probed",
        attemptDelta: 1,
      },
      {
        purpose: "openclaw",
        preferredPort: 61_020,
        port: 61_021,
        strategy: "probed",
        attemptDelta: 1,
      },
    ]);
  });

  it("throws a classified error when explicit ports conflict inside the bundle", async () => {
    const runtimeConfig = createRuntimeConfig({
      controllerPort: 62_000,
      webPort: 62_000,
    });

    await expect(
      allocateDesktopRuntimePorts(
        {
          NEXU_CONTROLLER_PORT: "62000",
          NEXU_WEB_PORT: "62000",
        },
        runtimeConfig,
      ),
    ).rejects.toMatchObject<Partial<PortAllocationError>>({
      name: "PortAllocationError",
      code: "runtime_port_conflict",
      purpose: "bundle",
      preferredPort: 62_000,
    });
  });
});
