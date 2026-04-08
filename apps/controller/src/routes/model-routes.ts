import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  minimaxOauthCancelResponseSchema,
  minimaxOauthStartBodySchema,
  minimaxOauthStartResponseSchema,
  minimaxOauthStatusResponseSchema,
  modelListResponseSchema,
  providerListResponseSchema,
  providerResponseSchema,
  quotaFallbackResponseSchema,
  restoreManagedBodySchema,
  upsertProviderBodySchema,
  verifyProviderBodySchema,
  verifyProviderResponseSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import { supportedByokProviderIds } from "../lib/byok-providers.js";
import type { ControllerBindings } from "../types.js";

const providerIdParamSchema = z.object({
  providerId: z.enum(supportedByokProviderIds),
});

export function registerModelRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/models",
      tags: ["Models"],
      responses: {
        200: {
          content: { "application/json": { schema: modelListResponseSchema } },
          description: "Model list",
        },
      },
    }),
    async (c) => c.json(await container.modelProviderService.listModels(), 200),
  );

  app.openapi(
    createRoute({
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
    }),
    async (c) =>
      c.json(await container.modelProviderService.listProviders(), 200),
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/v1/providers/{providerId}",
      tags: ["Providers"],
      request: {
        params: providerIdParamSchema,
        body: {
          content: { "application/json": { schema: upsertProviderBodySchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ provider: providerResponseSchema }),
            },
          },
          description: "Updated provider",
        },
        201: {
          content: {
            "application/json": {
              schema: z.object({ provider: providerResponseSchema }),
            },
          },
          description: "Created provider",
        },
      },
    }),
    async (c) => {
      const { providerId } = c.req.valid("param");
      const beforeInventory =
        await container.modelProviderService.getInventoryStatus();
      const result = await container.modelProviderService.upsertProvider(
        providerId,
        c.req.valid("json"),
      );
      const modelResult =
        await container.modelProviderService.ensureValidDefaultModel();
      await container.openclawSyncService.syncAll();
      const afterInventory =
        await container.modelProviderService.getInventoryStatus();
      if (
        !beforeInventory.hasKnownInventory &&
        afterInventory.hasKnownInventory
      ) {
        await container.desktopLocalService.restartRuntime();
      }
      return c.json(
        {
          provider: result.provider,
          modelAutoSelected: modelResult.changed ? modelResult : undefined,
        },
        result.created ? 201 : 200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/providers/{providerId}",
      tags: ["Providers"],
      request: { params: providerIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: z.object({ ok: z.boolean() }) },
          },
          description: "Deleted provider",
        },
      },
    }),
    async (c) => {
      const { providerId } = c.req.valid("param");
      const ok =
        await container.modelProviderService.deleteProvider(providerId);
      const modelResult =
        await container.modelProviderService.ensureValidDefaultModel();
      await container.openclawSyncService.syncAll();
      return c.json(
        {
          ok,
          modelAutoSelected: modelResult.changed ? modelResult : undefined,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/providers/minimax/oauth/status",
      tags: ["Providers"],
      responses: {
        200: {
          content: {
            "application/json": { schema: minimaxOauthStatusResponseSchema },
          },
          description: "MiniMax OAuth status",
        },
      },
    }),
    async (c) =>
      c.json(await container.modelProviderService.getMiniMaxOauthStatus(), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/providers/minimax/oauth/login",
      tags: ["Providers"],
      request: {
        body: {
          content: {
            "application/json": { schema: minimaxOauthStartBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: minimaxOauthStartResponseSchema },
          },
          description: "Start MiniMax OAuth login",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const status = await container.modelProviderService.startMiniMaxOauth(
        body.region,
      );
      return c.json({ ...status, started: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/providers/minimax/oauth/login",
      tags: ["Providers"],
      responses: {
        200: {
          content: {
            "application/json": { schema: minimaxOauthCancelResponseSchema },
          },
          description: "Cancel MiniMax OAuth login",
        },
      },
    }),
    async (c) => {
      const status = await container.modelProviderService.cancelMiniMaxOauth();
      return c.json({ ...status, cancelled: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/providers/{providerId}/verify",
      tags: ["Providers"],
      request: {
        params: providerIdParamSchema,
        body: {
          content: { "application/json": { schema: verifyProviderBodySchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: verifyProviderResponseSchema },
          },
          description: "Verify provider",
        },
      },
    }),
    async (c) => {
      const { providerId } = c.req.valid("param");
      return c.json(
        await container.modelProviderService.verifyProvider(
          providerId,
          c.req.valid("json"),
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/quota/fallback-to-byok",
      tags: ["Quota"],
      responses: {
        200: {
          content: {
            "application/json": { schema: quotaFallbackResponseSchema },
          },
          description: "Trigger automatic fallback to BYOK provider",
        },
      },
    }),
    async (c) => {
      const result = await container.quotaFallbackService.triggerFallback();
      return c.json({ ok: result.success, newModelId: result.newModelId }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/quota/restore-managed",
      tags: ["Quota"],
      request: {
        body: {
          content: { "application/json": { schema: restoreManagedBodySchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: quotaFallbackResponseSchema },
          },
          description: "Restore default model to managed (cloud) model",
        },
      },
    }),
    async (c) => {
      const { managedModelId } = c.req.valid("json");
      const result =
        await container.quotaFallbackService.restoreManaged(managedModelId);
      return c.json({ ok: result.success, newModelId: result.newModelId }, 200);
    },
  );
}
