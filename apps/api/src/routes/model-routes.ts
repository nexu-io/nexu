import * as fs from "node:fs";
import * as path from "node:path";
import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Model } from "@nexu/shared";
import { modelListResponseSchema } from "@nexu/shared";
import { PLATFORM_MODELS } from "../lib/models.js";

import type { AppBindings } from "../types.js";

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

/**
 * In desktop mode, load cloud models from credentials file.
 */
function getCloudModels(): Model[] {
  if (process.env.NEXU_DESKTOP_MODE !== "true") return [];

  const stateDir =
    process.env.OPENCLAW_STATE_DIR ?? path.join(process.cwd(), ".nexu-state");
  const credPath = path.join(stateDir, "cloud-credentials.json");
  if (!fs.existsSync(credPath)) return [];

  try {
    const creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    if (!Array.isArray(creds.cloudModels)) return [];
    return creds.cloudModels.map(
      (m: { id: string; name: string; provider?: string }) => ({
        id: `link/${m.id}`,
        name: m.name || m.id,
        provider: m.provider ?? "nexu",
        description: "Cloud model via Nexu Link",
      }),
    );
  } catch {
    return [];
  }
}

export function registerModelRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(listModelsRoute, async (c) => {
    const cloudModels = getCloudModels();
    const models = [...PLATFORM_MODELS, ...cloudModels];
    return c.json({ models }, 200);
  });
}
