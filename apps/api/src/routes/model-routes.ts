import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Model } from "@nexu/shared";
import {
  linkCatalogResponseSchema,
  modelListResponseSchema,
  providerListResponseSchema,
  providerResponseSchema,
  upsertProviderBodySchema,
  verifyProviderBodySchema,
  verifyProviderResponseSchema,
} from "@nexu/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "../db/index.js";
import { modelProviders } from "../db/schema/index.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { PLATFORM_MODELS } from "../lib/models.js";
import {
  buildProviderUrl,
  normalizeProviderBaseUrl,
} from "../lib/provider-base-url.js";

import type { AppBindings } from "../types.js";

// ── Route Definitions ────────────────────────────────────────────

const listModelsRoute = createRoute({
  method: "get",
  path: "/api/v1/models",
  tags: ["Models"],
  responses: {
    200: {
      content: {
        "application/json": { schema: modelListResponseSchema },
      },
      description: "Available models",
    },
  },
});

const providerIdParam = z.object({ providerId: z.string() });

const listProvidersRoute = createRoute({
  method: "get",
  path: "/api/v1/providers",
  tags: ["Providers"],
  responses: {
    200: {
      content: {
        "application/json": { schema: providerListResponseSchema },
      },
      description: "Provider list",
    },
  },
});

const upsertProviderRoute = createRoute({
  method: "put",
  path: "/api/v1/providers/{providerId}",
  tags: ["Providers"],
  request: {
    params: providerIdParam,
    body: {
      content: {
        "application/json": { schema: upsertProviderBodySchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ provider: providerResponseSchema }),
        },
      },
      description: "Updated",
    },
    201: {
      content: {
        "application/json": {
          schema: z.object({ provider: providerResponseSchema }),
        },
      },
      description: "Created",
    },
  },
});

const deleteProviderRoute = createRoute({
  method: "delete",
  path: "/api/v1/providers/{providerId}",
  tags: ["Providers"],
  request: {
    params: providerIdParam,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean() }),
        },
      },
      description: "Deleted",
    },
  },
});

const verifyProviderRoute = createRoute({
  method: "post",
  path: "/api/v1/providers/{providerId}/verify",
  tags: ["Providers"],
  request: {
    params: providerIdParam,
    body: {
      content: {
        "application/json": { schema: verifyProviderBodySchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: verifyProviderResponseSchema },
      },
      description: "Verification result",
    },
  },
});

const linkCatalogRoute = createRoute({
  method: "get",
  path: "/api/v1/link-catalog",
  tags: ["Models"],
  responses: {
    200: {
      content: {
        "application/json": { schema: linkCatalogResponseSchema },
      },
      description: "Link cloud model catalog",
    },
  },
});

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Read cached cloud models from credentials file.
 */
function readCachedCloudModels(): {
  id: string;
  name: string;
  provider?: string;
}[] {
  if (process.env.NEXU_DESKTOP_MODE !== "true") return [];

  const stateDir =
    process.env.OPENCLAW_STATE_DIR ?? path.join(process.cwd(), ".nexu-state");
  const credPath = path.join(stateDir, "cloud-credentials.json");
  if (!fs.existsSync(credPath)) return [];

  try {
    const creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    return Array.isArray(creds.cloudModels) ? creds.cloudModels : [];
  } catch {
    return [];
  }
}

/**
 * In desktop mode, load cloud models from credentials file.
 * Model IDs are passed through as-is (no prefix) since gateway routes them
 * to Link gateway based on cloud-credentials.json configuration.
 */
function getCloudModels(): Model[] {
  return readCachedCloudModels().map((m) => ({
    id: m.id,
    name: m.name || m.id,
    provider: m.provider ?? "nexu",
    description: "Cloud model via Nexu Link",
  }));
}

/**
 * Load BYOK provider models from DB.
 */
async function getByokModels(): Promise<Model[]> {
  try {
    const providers = await db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.enabled, true));
    const models: Model[] = [];
    for (const p of providers) {
      const modelIds: string[] = JSON.parse(p.modelsJson || "[]");
      for (const mid of modelIds) {
        models.push({
          id: `${p.providerId}/${mid}`,
          name: mid,
          provider: p.providerId,
        });
      }
    }
    return models;
  } catch {
    return [];
  }
}

const PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  siliconflow: "https://api.siliconflow.com/v1",
  ppio: "https://api.ppinfra.com/v3/openai",
  openrouter: "https://openrouter.ai/api/v1",
  minimax: "https://api.minimaxi.com/anthropic",
  kimi: "https://api.moonshot.cn/v1",
  glm: "https://open.bigmodel.cn/api/paas/v4",
  moonshot: "https://api.moonshot.cn/v1",
  zai: "https://open.bigmodel.cn/api/paas/v4",
};

function getVerifyUrl(providerId: string, baseUrl?: string | null): string {
  const customVerifyUrl = buildProviderUrl(baseUrl, "/models");
  if (customVerifyUrl) return customVerifyUrl;
  const base = PROVIDER_BASE_URLS[providerId];
  if (base) return buildProviderUrl(base, "/models") ?? "";
  return "";
}

// ── Route Registration ───────────────────────────────────────────

export function registerModelRoutes(app: OpenAPIHono<AppBindings>) {
  // List available models (platform + cloud + BYOK)
  app.openapi(listModelsRoute, async (c) => {
    const cloudModels = getCloudModels();
    const byokModels = await getByokModels();
    const isDesktop = process.env.NEXU_DESKTOP_MODE === "true";
    const baseModels = isDesktop ? cloudModels : PLATFORM_MODELS;
    const models = [...baseModels, ...byokModels];
    return c.json({ models }, 200);
  });

  // List configured BYOK providers
  app.openapi(listProvidersRoute, async (c) => {
    const providers = await db.select().from(modelProviders);
    const result = providers.map((p) => ({
      id: p.id,
      providerId: p.providerId,
      displayName: p.displayName,
      enabled: p.enabled,
      baseUrl: p.baseUrl,
      hasApiKey: Boolean(p.encryptedApiKey),
      modelsJson: p.modelsJson,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
    return c.json({ providers: result });
  });

  // Create or update a BYOK provider (upsert by providerId)
  app.openapi(upsertProviderRoute, async (c) => {
    const { providerId } = c.req.valid("param");
    const body = c.req.valid("json");

    // Check if provider already exists
    const [existing] = await db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.providerId, providerId));

    const now = new Date().toISOString();

    if (existing) {
      // Update
      const updates: Record<string, unknown> = { updatedAt: now };
      if (body.apiKey !== undefined)
        updates.encryptedApiKey = encrypt(body.apiKey);
      if (body.baseUrl !== undefined) {
        updates.baseUrl = normalizeProviderBaseUrl(body.baseUrl);
      }
      if (body.enabled !== undefined) updates.enabled = body.enabled;
      if (body.displayName !== undefined)
        updates.displayName = body.displayName;
      if (body.modelsJson !== undefined) updates.modelsJson = body.modelsJson;

      await db
        .update(modelProviders)
        .set(updates)
        .where(eq(modelProviders.providerId, providerId));

      const [updated] = await db
        .select()
        .from(modelProviders)
        .where(eq(modelProviders.providerId, providerId));

      if (!updated) {
        return c.json(
          {
            provider: {
              id: "",
              providerId,
              displayName: null,
              enabled: false,
              baseUrl: null,
              hasApiKey: false,
              modelsJson: null,
            },
          },
          200,
        );
      }

      return c.json(
        {
          provider: {
            id: updated.id,
            providerId: updated.providerId,
            displayName: updated.displayName,
            enabled: updated.enabled,
            baseUrl: updated.baseUrl,
            hasApiKey: Boolean(updated.encryptedApiKey),
            modelsJson: updated.modelsJson,
          },
        },
        200,
      );
    }

    // Create
    if (!body.apiKey) {
      return c.json(
        {
          provider: {
            id: "",
            providerId,
            displayName: null,
            enabled: false,
            baseUrl: null,
            hasApiKey: false,
            modelsJson: null,
          },
        },
        200,
      );
    }

    const displayName =
      body.displayName ??
      {
        anthropic: "Anthropic",
        openai: "OpenAI",
        google: "Google AI",
        siliconflow: "SiliconFlow",
        ppio: "PPIO",
        openrouter: "OpenRouter",
        minimax: "MiniMax",
        kimi: "Kimi",
        glm: "GLM",
        moonshot: "Kimi",
        zai: "GLM",
        custom: "Custom",
      }[providerId] ??
      providerId;

    const newProvider = {
      id: crypto.randomUUID(),
      providerId,
      displayName,
      encryptedApiKey: encrypt(body.apiKey),
      baseUrl: normalizeProviderBaseUrl(body.baseUrl),
      enabled: body.enabled ?? true,
      modelsJson: body.modelsJson ?? "[]",
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(modelProviders).values(newProvider);

    return c.json(
      {
        provider: {
          id: newProvider.id,
          providerId: newProvider.providerId,
          displayName: newProvider.displayName,
          enabled: newProvider.enabled,
          baseUrl: newProvider.baseUrl,
          hasApiKey: true,
          modelsJson: newProvider.modelsJson,
        },
      },
      201,
    );
  });

  // Delete a BYOK provider
  app.openapi(deleteProviderRoute, async (c) => {
    const { providerId } = c.req.valid("param");
    await db
      .delete(modelProviders)
      .where(eq(modelProviders.providerId, providerId));
    return c.json({ ok: true });
  });

  // Verify a provider's API key by calling its models endpoint
  app.openapi(verifyProviderRoute, async (c) => {
    const { providerId } = c.req.valid("param");
    const body = c.req.valid("json");

    const verifyUrl = getVerifyUrl(providerId, body.baseUrl);
    if (!verifyUrl) {
      return c.json({
        valid: false,
        error: "Unknown provider and no baseUrl given",
      });
    }

    try {
      // Anthropic uses a different auth header
      const headers: Record<string, string> =
        providerId === "anthropic"
          ? {
              "x-api-key": body.apiKey,
              "anthropic-version": "2023-06-01",
            }
          : { Authorization: `Bearer ${body.apiKey}` };

      const res = await fetch(verifyUrl, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return c.json({ valid: false, error: `HTTP ${res.status}` });
      }

      const data = (await res.json()) as {
        data?: Array<{ id: string }>;
      };
      const models = Array.isArray(data.data) ? data.data.map((m) => m.id) : [];

      return c.json({ valid: true, models });
    } catch (err) {
      return c.json({
        valid: false,
        error: err instanceof Error ? err.message : "Request failed",
      });
    }
  });

  // List Link cloud model catalog (providers + models from link.* schema)
  app.openapi(linkCatalogRoute, async (c) => {
    // Desktop mode: read cloud models from credentials file, or fetch from Link
    if (process.env.NEXU_DESKTOP_MODE === "true") {
      try {
        const stateDir =
          process.env.OPENCLAW_STATE_DIR ??
          path.join(process.cwd(), ".nexu-state");
        const credPath = path.join(stateDir, "cloud-credentials.json");
        if (fs.existsSync(credPath)) {
          const creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));
          let cloudModels: Array<{
            id: string;
            name: string;
            provider?: string;
          }> = creds.cloudModels ?? [];

          // If no cached models, try fetching from Link gateway
          if (cloudModels.length === 0 && creds.encryptedApiKey) {
            const linkUrl =
              creds.linkGatewayUrl ?? process.env.NEXU_LINK_URL ?? null;
            if (linkUrl) {
              try {
                const apiKey = decrypt(creds.encryptedApiKey);
                const res = await fetch(`${linkUrl}/v1/models`, {
                  headers: { Authorization: `Bearer ${apiKey}` },
                  signal: AbortSignal.timeout(10_000),
                });
                if (res.ok) {
                  const data = (await res.json()) as {
                    data?: Array<{ id: string; owned_by?: string }>;
                  };
                  if (Array.isArray(data.data)) {
                    cloudModels = data.data.map((m) => ({
                      id: m.id,
                      name: m.id,
                      provider: m.owned_by,
                    }));
                    // Cache back to credentials file
                    creds.cloudModels = cloudModels;
                    if (!creds.linkGatewayUrl) creds.linkGatewayUrl = linkUrl;
                    fs.writeFileSync(credPath, JSON.stringify(creds, null, 2));
                  }
                }
              } catch {
                /* fetch failed, return empty */
              }
            }
          }

          if (cloudModels.length > 0) {
            const map = new Map<
              string,
              {
                id: string;
                name: string;
                kind: string;
                models: Array<{
                  id: string;
                  name: string;
                  externalName: string;
                  inputPrice: string | null;
                  outputPrice: string | null;
                }>;
              }
            >();
            for (const m of cloudModels) {
              const provId = m.provider ?? "nexu";
              if (!map.has(provId)) {
                map.set(provId, {
                  id: provId,
                  name: provId,
                  kind: "cloud",
                  models: [],
                });
              }
              map.get(provId)?.models.push({
                id: m.id,
                name: m.name || m.id,
                externalName: m.id,
                inputPrice: null,
                outputPrice: null,
              });
            }
            return c.json({ providers: Array.from(map.values()) });
          }
        }
      } catch {
        /* fall through */
      }
      return c.json({ providers: [] });
    }

    try {
      const { rows } = await pool.query(`
        SELECT
          p.id   AS provider_id,
          p.name AS provider_name,
          p.kind,
          m.id   AS model_id,
          m.name AS model_name,
          m.external_name,
          m.input_price,
          m.output_price
        FROM link.providers p
        JOIN link.models m ON m.provider_id = p.id
        WHERE p.status = 'active' AND m.status = 'active'
        ORDER BY p.name, m.name
      `);

      const map = new Map<
        string,
        {
          id: string;
          name: string;
          kind: string;
          models: Array<{
            id: string;
            name: string;
            externalName: string;
            inputPrice: string | null;
            outputPrice: string | null;
          }>;
        }
      >();

      for (const r of rows) {
        if (!map.has(r.provider_id)) {
          map.set(r.provider_id, {
            id: r.provider_id,
            name: r.provider_name,
            kind: r.kind,
            models: [],
          });
        }
        map.get(r.provider_id)?.models.push({
          id: r.model_id,
          name: r.model_name,
          externalName: r.external_name,
          inputPrice: r.input_price,
          outputPrice: r.output_price,
        });
      }

      return c.json({ providers: Array.from(map.values()) });
    } catch {
      return c.json({ providers: [] });
    }
  });
}
