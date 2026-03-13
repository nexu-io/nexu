import { createHash, randomUUID } from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { encrypt } from "../lib/crypto.js";
import type { AppBindings } from "../types.js";
import * as fs from "node:fs";
import * as path from "node:path";

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
      const res = await fetch(`${cloudApiUrl}/api/auth/desktop-poll`, {
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
    } catch (err) {
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
  // Initiate cloud connection: generate device ID, register on cloud, start polling
  app.post("/api/internal/desktop/cloud-connect", async (c) => {
    // Reject if already polling or connected
    if (pollingState) {
      return c.json({ error: "Connection attempt already in progress" }, 409);
    }
    const existing = loadCredentials();
    if (existing) {
      return c.json(
        { error: "Already connected. Disconnect first." },
        409,
      );
    }

    const cloudApiUrl = getCloudApiUrl();
    const deviceId = randomUUID();
    const deviceSecret = randomUUID();
    const deviceSecretHash = createHash("sha256")
      .update(deviceSecret)
      .digest("hex");

    // Register device on cloud
    const res = await fetch(
      `${cloudApiUrl}/api/auth/desktop-device-register`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, deviceSecretHash }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      return c.json(
        { error: `Failed to register device: ${body}` },
        502,
      );
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
