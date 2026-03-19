import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  cloudConnectResponseSchema,
  cloudDisconnectResponseSchema,
  cloudModelsBodySchema,
  cloudModelsResponseSchema,
  cloudStatusResponseSchema,
} from "@nexu/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { bots, gatewayPools } from "../db/schema/index.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import { publishPoolConfigSnapshot } from "../services/runtime/pool-config-service.js";
import type { AppBindings } from "../types.js";

/**
 * In-memory state for the cloud connection polling flow.
 * Only one connection attempt can be active at a time.
 */
let pollingState: {
  deviceId: string;
  deviceSecret: string;
  abortController: AbortController;
} | null = null;

/**
 * On-disk credential file structure.
 */
interface CloudCredentials {
  encryptedApiKey: string;
  userId: string;
  userName: string;
  userEmail: string;
  connectedAt: string;
  linkGatewayUrl?: string;
  cloudModels?: Array<{ id: string; name: string; provider?: string }>;
}

function getCredentialsPath(): string {
  const stateDir =
    process.env.OPENCLAW_STATE_DIR ?? path.join(process.cwd(), ".nexu-state");
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  return path.join(stateDir, "cloud-credentials.json");
}

function loadCredentials(): CloudCredentials | null {
  const p = getCredentialsPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function saveCredentials(creds: CloudCredentials): void {
  fs.writeFileSync(getCredentialsPath(), JSON.stringify(creds, null, 2));
}

function clearCredentials(): void {
  const p = getCredentialsPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function getCloudApiUrl(): string {
  return process.env.NEXU_CLOUD_URL ?? "https://nexu.io";
}

function getLinkGatewayUrl(): string | null {
  return process.env.NEXU_LINK_URL ?? null;
}

/**
 * Fetch available models from the Link gateway using the user's API key.
 * Returns the model list or null on failure (non-critical — connection still succeeds).
 */
async function fetchCloudModels(
  linkUrl: string,
  apiKey: string,
): Promise<Array<{ id: string; name: string; provider?: string }> | null> {
  try {
    const res = await fetch(`${linkUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: Array<{ id: string; owned_by?: string }>;
    };
    if (!Array.isArray(data.data)) return null;
    return data.data.map((m) => ({
      id: m.id,
      name: m.id,
      provider: m.owned_by,
    }));
  } catch {
    return null;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });
}

/**
 * Background polling task.
 * Polls cloud API until authorization is completed, expired, or timeout.
 */
async function pollCloudForAuthorization(
  cloudApiUrl: string,
  deviceId: string,
  deviceSecret: string,
  signal: AbortSignal,
): Promise<void> {
  const maxAttempts = 100; // 3s * 100 = 5 min

  for (let i = 0; i < maxAttempts; i++) {
    try {
      await sleep(3000, signal);
    } catch {
      // Aborted (user cancelled or disconnect)
      return;
    }

    if (signal.aborted) return;

    try {
      const res = await fetch(`${cloudApiUrl}/api/auth/device-poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, deviceSecret }),
        signal,
      });
      const data = (await res.json()) as {
        status: string;
        apiKey?: string;
        userId?: string;
        userName?: string;
        userEmail?: string;
      };

      if (data.status === "completed" && data.apiKey) {
        // Fetch cloud models from Link gateway (best-effort)
        const linkUrl = getLinkGatewayUrl();
        let cloudModels:
          | Array<{ id: string; name: string; provider?: string }>
          | undefined;
        if (linkUrl) {
          cloudModels =
            (await fetchCloudModels(linkUrl, data.apiKey)) ?? undefined;
        }

        // Guard: user may have disconnected while we were fetching models
        if (signal.aborted) return;

        // Store credentials to disk (API key encrypted)
        saveCredentials({
          encryptedApiKey: encrypt(data.apiKey),
          userId: data.userId ?? "",
          userName: data.userName ?? "",
          userEmail: data.userEmail ?? "",
          connectedAt: new Date().toISOString(),
          linkGatewayUrl: linkUrl ?? undefined,
          cloudModels,
        });

        // Push config snapshot so gateway picks up the new link provider
        try {
          const [pool] = await db
            .select({ id: gatewayPools.id })
            .from(gatewayPools)
            .where(eq(gatewayPools.poolName, "default"));
          if (pool) {
            await publishPoolConfigSnapshot(db, pool.id);
          }
        } catch (err) {
          logger.error({
            message: "cloud_reconnect_snapshot_failed",
            error: err,
          });
        }

        pollingState = null;
        return;
      }

      if (data.status === "expired") {
        pollingState = null;
        return;
      }
    } catch (_err) {
      if (signal.aborted) return;
      // Network error — continue polling
    }
  }

  // Timeout
  pollingState = null;
}

// ── Route Definitions ────────────────────────────────────────────

const cloudStatusRoute = createRoute({
  method: "get",
  path: "/api/internal/desktop/cloud-status",
  tags: ["Desktop"],
  responses: {
    200: {
      content: {
        "application/json": { schema: cloudStatusResponseSchema },
      },
      description: "Cloud connection status",
    },
  },
});

const cloudConnectRoute = createRoute({
  method: "post",
  path: "/api/internal/desktop/cloud-connect",
  tags: ["Desktop"],
  responses: {
    200: {
      content: {
        "application/json": { schema: cloudConnectResponseSchema },
      },
      description: "Connection initiated",
    },
  },
});

const cloudDisconnectRoute = createRoute({
  method: "post",
  path: "/api/internal/desktop/cloud-disconnect",
  tags: ["Desktop"],
  responses: {
    200: {
      content: {
        "application/json": { schema: cloudDisconnectResponseSchema },
      },
      description: "Disconnected",
    },
  },
});

const cloudModelsRoute = createRoute({
  method: "put",
  path: "/api/internal/desktop/cloud-models",
  tags: ["Desktop"],
  request: {
    body: {
      content: {
        "application/json": { schema: cloudModelsBodySchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: cloudModelsResponseSchema },
      },
      description: "Models updated",
    },
  },
});

const defaultModelBodySchema = z.object({
  modelId: z.string(),
});

const defaultModelSetRoute = createRoute({
  method: "put",
  path: "/api/internal/desktop/default-model",
  tags: ["Desktop"],
  request: {
    body: {
      content: {
        "application/json": { schema: defaultModelBodySchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean(), modelId: z.string() }),
        },
      },
      description: "Default model set",
    },
  },
});

const defaultModelGetRoute = createRoute({
  method: "get",
  path: "/api/internal/desktop/default-model",
  tags: ["Desktop"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ modelId: z.string().nullable() }),
        },
      },
      description: "Current default model",
    },
  },
});

const readyRoute = createRoute({
  method: "get",
  path: "/api/internal/desktop/ready",
  tags: ["Desktop"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ready: z.boolean() }),
        },
      },
      description: "Ready",
    },
    503: {
      content: {
        "application/json": {
          schema: z.object({
            ready: z.boolean(),
            reason: z.string().optional(),
          }),
        },
      },
      description: "Not ready",
    },
  },
});

// ── Route Registration ───────────────────────────────────────────

/**
 * Desktop-only internal routes for cloud connection management.
 * Only registered when NEXU_DESKTOP_MODE=true.
 * No auth required — localhost-only trust boundary.
 */
export function registerDesktopLocalRoutes(app: OpenAPIHono<AppBindings>) {
  // Readiness probe
  app.openapi(readyRoute, async (c) => {
    try {
      const botRows = await db.select({ id: bots.id }).from(bots).limit(1);

      if (botRows.length === 0) {
        return c.json({ ready: false, reason: "no bots configured" }, 503);
      }

      return c.json({ ready: true });
    } catch {
      return c.json({ ready: false, reason: "database not ready" }, 503);
    }
  });

  // Initiate cloud connection: generate device ID, register on cloud, start polling
  app.openapi(cloudConnectRoute, async (c) => {
    logger.info({
      message: "desktop_cloud_connect_requested",
      polling_in_progress: pollingState !== null,
      already_connected: Boolean(loadCredentials()),
    });
    // Reject if already polling or connected
    if (pollingState) {
      logger.info({
        message: "desktop_cloud_connect_rejected",
        reason: "already_in_progress",
      });
      return c.json({ error: "Connection attempt already in progress" });
    }
    const existing = loadCredentials();
    if (existing) {
      logger.info({
        message: "desktop_cloud_connect_rejected",
        reason: "already_connected",
        user_id: existing.userId,
      });
      return c.json({ error: "Already connected. Disconnect first." });
    }

    const cloudApiUrl = getCloudApiUrl();
    const deviceId = randomUUID();
    const deviceSecret = randomUUID();
    const deviceSecretHash = createHash("sha256")
      .update(deviceSecret)
      .digest("hex");

    // Register device on cloud
    const registerUrl = `${cloudApiUrl}/api/auth/device-register`;
    let res: Response;
    try {
      res = await fetch(registerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, deviceSecretHash }),
      });
    } catch (err) {
      return c.json({
        error: `Cloud unreachable: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    if (!res.ok) {
      const body = await res.text();
      logger.warn({
        message: "desktop_cloud_connect_register_failed",
        status: res.status,
        body,
      });
      return c.json({ error: `Failed to register device: ${body}` });
    }

    // Start background polling
    const abortController = new AbortController();
    pollingState = { deviceId, deviceSecret, abortController };
    pollCloudForAuthorization(
      cloudApiUrl,
      deviceId,
      deviceSecret,
      abortController.signal,
    );

    const browserUrl = `${cloudApiUrl}/auth?desktop=1&device_id=${deviceId}`;
    logger.info({
      message: "desktop_cloud_connect_started",
      device_id: deviceId,
    });
    return c.json({ browserUrl });
  });

  // Query current cloud connection status
  app.openapi(cloudStatusRoute, (c) => {
    const creds = loadCredentials();
    if (creds) {
      logger.info({
        message: "desktop_cloud_status_checked",
        connected: true,
        polling: false,
        user_id: creds.userId,
      });
      return c.json({
        connected: true,
        polling: false,
        userName: creds.userName,
        userEmail: creds.userEmail,
        connectedAt: creds.connectedAt,
        models: creds.cloudModels ?? [],
      });
    }

    logger.info({
      message: "desktop_cloud_status_checked",
      connected: false,
      polling: pollingState !== null,
    });
    return c.json({
      connected: false,
      polling: pollingState !== null,
      userName: null,
      userEmail: null,
      connectedAt: null,
      models: [],
    });
  });

  // Set default model and trigger config regeneration
  app.openapi(defaultModelSetRoute, async (c) => {
    const body = c.req.valid("json");

    // Write to desktop-config.json
    const stateDir =
      process.env.OPENCLAW_STATE_DIR ?? path.join(process.cwd(), ".nexu-state");
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    const configPath = path.join(stateDir, "desktop-config.json");

    let cfg: Record<string, unknown> = {};
    try {
      if (fs.existsSync(configPath)) {
        cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }
    } catch {
      /* ignore parse errors */
    }
    cfg.selectedModelId = body.modelId;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

    // Also update all bots in DB so per-agent model is consistent.
    try {
      await db.update(bots).set({ modelId: body.modelId });
    } catch (err) {
      logger.error({ message: "default_model_bot_update_failed", error: err });
    }

    // Trigger config snapshot so gateway picks up the change
    try {
      const [pool] = await db
        .select({ id: gatewayPools.id })
        .from(gatewayPools)
        .where(eq(gatewayPools.poolName, "default"));
      if (pool) {
        await publishPoolConfigSnapshot(db, pool.id);
      }
    } catch (err) {
      logger.error({ message: "default_model_snapshot_failed", error: err });
    }

    return c.json({ ok: true, modelId: body.modelId });
  });

  // Get current default model
  app.openapi(defaultModelGetRoute, (c) => {
    const stateDir =
      process.env.OPENCLAW_STATE_DIR ?? path.join(process.cwd(), ".nexu-state");
    const configPath = path.join(stateDir, "desktop-config.json");
    try {
      if (fs.existsSync(configPath)) {
        const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        return c.json({ modelId: cfg.selectedModelId ?? null });
      }
    } catch {
      /* ignore */
    }
    return c.json({ modelId: null });
  });

  // Update enabled cloud models and trigger config regeneration
  app.openapi(cloudModelsRoute, async (c) => {
    const creds = loadCredentials();
    if (!creds) {
      return c.json({ ok: false });
    }

    const body = c.req.valid("json");
    const enabledIds = body.enabledModelIds;

    // Filter cloudModels to only include enabled ones
    const allModels = creds.cloudModels ?? [];
    const enabledSet = new Set(enabledIds);
    creds.cloudModels = allModels.filter((m) => enabledSet.has(m.id));
    saveCredentials(creds);

    // Trigger config snapshot so gateway picks up the change
    try {
      const [pool] = await db
        .select({ id: gatewayPools.id })
        .from(gatewayPools)
        .where(eq(gatewayPools.poolName, "default"));
      if (pool) {
        await publishPoolConfigSnapshot(db, pool.id);
      }
    } catch (err) {
      logger.error({ message: "cloud_models_snapshot_failed", error: err });
    }

    return c.json({ ok: true, models: creds.cloudModels });
  });

  // Disconnect from cloud: clear credentials, cancel polling
  app.openapi(cloudDisconnectRoute, async (c) => {
    logger.info({
      message: "desktop_cloud_disconnect_requested",
      polling_in_progress: pollingState !== null,
      had_credentials: Boolean(loadCredentials()),
    });
    // Cancel any active polling
    if (pollingState) {
      pollingState.abortController.abort();
      pollingState = null;
    }

    clearCredentials();

    // Push config snapshot so gateway removes the link provider
    try {
      const [pool] = await db
        .select({ id: gatewayPools.id })
        .from(gatewayPools)
        .where(eq(gatewayPools.poolName, "default"));
      if (pool) {
        await publishPoolConfigSnapshot(db, pool.id);
      }
    } catch (err) {
      logger.error({ message: "cloud_disconnect_snapshot_failed", error: err });
    }

    return c.json({ ok: true });
  });
}

/**
 * Refresh cloud models from the Link gateway on startup.
 * Compares with cached models and updates credentials + gateway config if changed.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function refreshCloudModelsOnStartup(): Promise<void> {
  if (process.env.NEXU_DESKTOP_MODE !== "true") return;

  const creds = loadCredentials();
  if (!creds?.encryptedApiKey) return;

  const linkUrl = creds.linkGatewayUrl ?? getLinkGatewayUrl();
  if (!linkUrl) return;

  try {
    const apiKey = decrypt(creds.encryptedApiKey);
    const freshModels = await fetchCloudModels(linkUrl, apiKey);
    if (!freshModels || freshModels.length === 0) return;

    // Compare with cached models
    const cachedIds = new Set((creds.cloudModels ?? []).map((m) => m.id));
    const freshIds = new Set(freshModels.map((m) => m.id));
    const same =
      cachedIds.size === freshIds.size &&
      [...cachedIds].every((id) => freshIds.has(id));
    if (same) return;

    logger.info({
      message: "cloud_models_refreshed",
      added: freshModels.filter((m) => !cachedIds.has(m.id)).map((m) => m.id),
      removed: [...cachedIds].filter((id) => !freshIds.has(id)),
    });

    creds.cloudModels = freshModels;
    saveCredentials(creds);

    // Push updated config to gateway
    const [pool] = await db
      .select({ id: gatewayPools.id })
      .from(gatewayPools)
      .where(eq(gatewayPools.poolName, "default"));
    if (pool) {
      await publishPoolConfigSnapshot(db, pool.id);
    }
  } catch (err) {
    logger.error({ message: "cloud_models_refresh_failed", error: err });
  }
}
