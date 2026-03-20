import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  cloudConnectResponseSchema,
  cloudDisconnectResponseSchema,
  cloudModelsBodySchema,
  cloudModelsResponseSchema,
  cloudRefreshResponseSchema,
  cloudStatusResponseSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const defaultModelBodySchema = z.object({ modelId: z.string() });
const defaultModelResponseSchema = z.object({ modelId: z.string().nullable() });
const defaultModelSetResponseSchema = z.object({
  ok: z.boolean(),
  modelId: z.string(),
  configPushed: z.boolean(),
});

export function registerDesktopCompatRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/internal/desktop/cloud-status",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudStatusResponseSchema },
          },
          description: "Cloud status",
        },
      },
    }),
    async (c) =>
      c.json(await container.desktopLocalService.getCloudStatus(), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/cloud-connect",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudConnectResponseSchema },
          },
          description: "Cloud connect",
        },
      },
    }),
    async (c) =>
      c.json(await container.desktopLocalService.connectCloud(), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/cloud-refresh",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudRefreshResponseSchema },
          },
          description: "Cloud refresh",
        },
      },
    }),
    async (c) => {
      const status = await container.desktopLocalService.refreshCloudStatus();
      await container.modelProviderService.ensureValidDefaultModel();
      const { configPushed } = await container.openclawSyncService.syncAll();
      return c.json({ ...status, configPushed }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/cloud-disconnect",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudDisconnectResponseSchema },
          },
          description: "Cloud disconnect",
        },
      },
    }),
    async (c) =>
      c.json(await container.desktopLocalService.disconnectCloud(), 200),
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/internal/desktop/cloud-models",
      tags: ["Desktop"],
      request: {
        body: {
          content: { "application/json": { schema: cloudModelsBodySchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: cloudModelsResponseSchema },
          },
          description: "Cloud models",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      return c.json(
        await container.desktopLocalService.setCloudModels(
          body.enabledModelIds,
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/internal/desktop/default-model",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: defaultModelResponseSchema },
          },
          description: "Default model",
        },
      },
    }),
    async (c) => {
      const runtime = await container.runtimeConfigService.getRuntimeConfig();
      return c.json({ modelId: runtime.defaultModelId ?? null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/internal/desktop/default-model",
      tags: ["Desktop"],
      request: {
        body: {
          content: { "application/json": { schema: defaultModelBodySchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: defaultModelSetResponseSchema },
          },
          description: "Set default model",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      await container.desktopLocalService.setDefaultModel(body.modelId);
      // Immediately sync so OpenClaw picks up the change
      const { configPushed } = await container.openclawSyncService.syncAll();
      return c.json({ ok: true, modelId: body.modelId, configPushed }, 200);
    },
  );
}
