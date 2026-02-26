import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  runtimePoolConfigResponseSchema,
  runtimePoolHeartbeatSchema,
  runtimePoolRegisterSchema,
} from "@nexu/shared";
import { z } from "zod";

const envSchema = z.object({
  RUNTIME_POOL_ID: z.string().min(1),
  INTERNAL_TRPC_TOKEN: z.string().min(1),
  OPENCLAW_CONFIG_PATH: z.string().min(1),
  RUNTIME_API_BASE_URL: z.string().url().default("http://localhost:3000"),
  RUNTIME_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  RUNTIME_POLL_JITTER_MS: z.coerce.number().int().nonnegative().default(300),
  RUNTIME_MAX_BACKOFF_MS: z.coerce.number().int().positive().default(30000),
  RUNTIME_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  RUNTIME_HEARTBEAT_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5000),
  RUNTIME_POD_IP: z.string().optional(),
  OPENCLAW_GATEWAY_READY_URL: z.string().url().optional(),
});

const env = envSchema.parse(process.env);

interface RuntimeState {
  status: "active" | "degraded" | "unhealthy";
  lastSeenVersion: number;
  lastConfigHash: string;
}

const state: RuntimeState = {
  status: "active",
  lastSeenVersion: 0,
  lastConfigHash: "",
};

function log(message: string, context?: Record<string, unknown>): void {
  if (context) {
    console.log(`[runtime-sidecar] ${message}`, context);
    return;
  }
  console.log(`[runtime-sidecar] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${env.RUNTIME_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-token": env.INTERNAL_TRPC_TOKEN,
      ...(init?.headers ?? {}),
    },
    signal: withTimeout(env.RUNTIME_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `request failed: ${response.status} ${response.statusText} ${text}`,
    );
  }

  return response.json() as Promise<unknown>;
}

async function waitGatewayReady(): Promise<void> {
  if (!env.OPENCLAW_GATEWAY_READY_URL) {
    return;
  }

  for (;;) {
    try {
      const response = await fetch(env.OPENCLAW_GATEWAY_READY_URL, {
        signal: withTimeout(env.RUNTIME_REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        log("gateway is ready");
        return;
      }
    } catch {
      // noop
    }

    await sleep(1000);
  }
}

async function atomicWriteConfig(configJson: string): Promise<void> {
  await mkdir(dirname(env.OPENCLAW_CONFIG_PATH), { recursive: true });
  const tempPath = `${env.OPENCLAW_CONFIG_PATH}.tmp`;
  await writeFile(tempPath, configJson, "utf8");
  await rename(tempPath, env.OPENCLAW_CONFIG_PATH);
}

async function registerPool(): Promise<void> {
  const input = runtimePoolRegisterSchema.parse({
    poolId: env.RUNTIME_POOL_ID,
    podIp: env.RUNTIME_POD_IP,
    status: "active",
  });

  await fetchJson("/api/internal/pools/register", {
    method: "POST",
    body: JSON.stringify(input),
  });

  log("pool registered", { poolId: env.RUNTIME_POOL_ID });
}

async function sendHeartbeat(): Promise<void> {
  const input = runtimePoolHeartbeatSchema.parse({
    poolId: env.RUNTIME_POOL_ID,
    podIp: env.RUNTIME_POD_IP,
    status: state.status,
    lastSeenVersion: state.lastSeenVersion,
    timestamp: new Date().toISOString(),
  });

  await fetchJson("/api/internal/pools/heartbeat", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function pollLatestConfig(): Promise<boolean> {
  const response = await fetchJson(
    `/api/internal/pools/${env.RUNTIME_POOL_ID}/config/latest`,
    {
      method: "GET",
    },
  );

  const payload = runtimePoolConfigResponseSchema.parse(response);
  if (payload.configHash === state.lastConfigHash) {
    return false;
  }

  const configJson = JSON.stringify(payload.config, null, 2);
  await atomicWriteConfig(configJson);

  state.lastConfigHash = payload.configHash;
  state.lastSeenVersion = payload.version;
  state.status = "active";

  log("applied new pool config", {
    poolId: payload.poolId,
    version: payload.version,
    hash: payload.configHash,
  });

  return true;
}

async function runHeartbeatLoop(): Promise<never> {
  for (;;) {
    try {
      await sendHeartbeat();
    } catch (error) {
      log("heartbeat failed", {
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }

    await sleep(env.RUNTIME_HEARTBEAT_INTERVAL_MS);
  }
}

async function runPollLoop(): Promise<never> {
  let backoffMs = env.RUNTIME_POLL_INTERVAL_MS;

  for (;;) {
    try {
      const changed = await pollLatestConfig();
      backoffMs = env.RUNTIME_POLL_INTERVAL_MS;

      const jitter = Math.floor(
        Math.random() * (env.RUNTIME_POLL_JITTER_MS + 1),
      );
      await sleep(env.RUNTIME_POLL_INTERVAL_MS + jitter);

      if (changed) {
        await sendHeartbeat();
      }
    } catch (error) {
      state.status = "degraded";
      log("config poll failed", {
        error: error instanceof Error ? error.message : "unknown_error",
        retryInMs: backoffMs,
      });
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, env.RUNTIME_MAX_BACKOFF_MS);
    }
  }
}

async function main(): Promise<void> {
  log("starting runtime sidecar", { poolId: env.RUNTIME_POOL_ID });
  await waitGatewayReady();
  await registerPool();

  void runHeartbeatLoop();
  await runPollLoop();
}

main().catch((error: unknown) => {
  console.error("[runtime-sidecar] fatal error", {
    error: error instanceof Error ? error.message : "unknown_error",
  });
  process.exitCode = 1;
});
