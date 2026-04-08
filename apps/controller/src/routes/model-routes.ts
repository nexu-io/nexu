import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  isCustomProviderTemplate,
  isSupportedByokProviderId,
  minimaxOauthCancelResponseSchema,
  minimaxOauthStartBodySchema,
  minimaxOauthStartResponseSchema,
  minimaxOauthStatusResponseSchema,
  modelListResponseSchema,
  modelProviderConfigDocumentEnvelopeSchema,
  persistedModelsConfigSchema,
  providerRegistryResponseSchema,
  quotaFallbackResponseSchema,
  restoreManagedBodySchema,
  supportedByokProviderIds,
  validateProviderInstanceBodySchema,
  verifyProviderBodySchema,
  verifyProviderResponseSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const providerIdParamSchema = z.object({
  providerId: z.enum(supportedByokProviderIds),
});

const verifyProviderIdParamSchema = z.object({
  providerId: z
    .string()
    .refine(
      (providerId) =>
        isSupportedByokProviderId(providerId) ||
        isCustomProviderTemplate(providerId),
      {
        message: "Unsupported provider",
      },
    ),
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
      path: "/api/v1/model-providers/registry",
      tags: ["Model Providers"],
      responses: {
        200: {
          content: {
            "application/json": { schema: providerRegistryResponseSchema },
          },
          description: "Model provider registry",
        },
      },
    }),
    async (c) =>
      c.json(
        { registry: container.modelProviderService.listProviderRegistry() },
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/model-providers/config",
      tags: ["Model Providers"],
      responses: {
        200: {
          content: {
            "application/json": {
              schema: modelProviderConfigDocumentEnvelopeSchema,
            },
          },
          description: "Model provider config document",
        },
      },
    }),
    async (c) =>
      c.json(
        {
          config:
            await container.modelProviderService.getModelProviderConfigDocument(),
        },
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/v1/model-providers/config",
      tags: ["Model Providers"],
      request: {
        body: {
          content: {
            "application/json": { schema: persistedModelsConfigSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: modelProviderConfigDocumentEnvelopeSchema,
            },
          },
          description: "Updated model provider config document",
        },
      },
    }),
    async (c) => {
      const beforeInventory =
        await container.modelProviderService.getInventoryStatus();
      const config =
        await container.modelProviderService.setModelProviderConfigDocument(
          c.req.valid("json"),
        );
      const afterInventory =
        await container.modelProviderService.getInventoryStatus();
      if (
        !beforeInventory.hasKnownInventory &&
        afterInventory.hasKnownInventory
      ) {
        await container.desktopLocalService.restartRuntime();
      }
      return c.json({ config }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/model-providers/instances/validate",
      tags: ["Model Providers"],
      request: {
        body: {
          content: {
            "application/json": { schema: validateProviderInstanceBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: verifyProviderResponseSchema },
          },
          description: "Validate model provider instance credentials",
        },
      },
    }),
    async (c) => {
      const { instanceKey, ...input } = c.req.valid("json");
      return c.json(
        await container.modelProviderService.verifyProviderInstance(
          instanceKey,
          input,
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/model-providers/{providerId}/validate",
      tags: ["Model Providers"],
      request: {
        params: verifyProviderIdParamSchema,
        body: {
          content: { "application/json": { schema: verifyProviderBodySchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: verifyProviderResponseSchema },
          },
          description: "Validate model provider credentials",
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
      method: "get",
      path: "/api/v1/model-providers/minimax/oauth/status",
      tags: ["Model Providers"],
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
      path: "/api/v1/model-providers/minimax/oauth/login",
      tags: ["Model Providers"],
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
      path: "/api/v1/model-providers/minimax/oauth/login",
      tags: ["Model Providers"],
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
