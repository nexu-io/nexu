import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { bots, gatewayPools } from "../db/schema/index.js";
import { encrypt } from "../lib/crypto.js";
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

/**
 * Desktop-only internal routes for cloud connection management.
 * Only registered when NEXU_DESKTOP_MODE=true.
 * No auth required — localhost-only trust boundary.
 */
export function registerDesktopLocalRoutes(app: OpenAPIHono<AppBindings>) {
  // Readiness probe — frontend gates on this before rendering the webview.
  // Returns 200 when API + DB are responsive and at least one bot is configured.
  app.get("/api/internal/desktop/ready", async (c) => {
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
  app.post("/api/internal/desktop/cloud-connect", async (c) => {
    // Reject if already polling or connected
    if (pollingState) {
      return c.json({ error: "Connection attempt already in progress" }, 409);
    }
    const existing = loadCredentials();
    if (existing) {
      return c.json({ error: "Already connected. Disconnect first." }, 409);
    }

    const cloudApiUrl = getCloudApiUrl();
    const deviceId = randomUUID();
    const deviceSecret = randomUUID();
    const deviceSecretHash = createHash("sha256")
      .update(deviceSecret)
      .digest("hex");

    // Register device on cloud
    const res = await fetch(`${cloudApiUrl}/api/auth/device-register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, deviceSecretHash }),
    });

    if (!res.ok) {
      const body = await res.text();
      return c.json({ error: `Failed to register device: ${body}` }, 502);
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
    return c.json({ browserUrl });
  });

  // Query current cloud connection status
  app.get("/api/internal/desktop/cloud-status", (c) => {
    const creds = loadCredentials();
    if (creds) {
      return c.json({
        connected: true,
        polling: false,
        userName: creds.userName,
        userEmail: creds.userEmail,
        connectedAt: creds.connectedAt,
        models: creds.cloudModels ?? [],
      });
    }

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
  app.put("/api/internal/desktop/default-model", async (c) => {
    const body = (await c.req.json()) as { modelId?: string };
    if (!body.modelId) {
      return c.json({ error: "modelId is required" }, 400);
    }

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
  app.get("/api/internal/desktop/default-model", (c) => {
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
  app.put("/api/internal/desktop/cloud-models", async (c) => {
    const creds = loadCredentials();
    if (!creds) {
      return c.json({ error: "Not connected to cloud" }, 400);
    }

    const body = (await c.req.json()) as { enabledModelIds?: string[] };
    const enabledIds = body.enabledModelIds;
    if (!Array.isArray(enabledIds)) {
      return c.json({ error: "enabledModelIds must be an array" }, 400);
    }

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
  app.post("/api/internal/desktop/cloud-disconnect", (c) => {
    // Cancel any active polling
    if (pollingState) {
      pollingState.abortController.abort();
      pollingState = null;
    }

    clearCredentials();

    return c.json({ ok: true });
  });
}
