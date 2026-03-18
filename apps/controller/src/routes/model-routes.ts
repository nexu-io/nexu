import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  linkCatalogResponseSchema,
  modelListResponseSchema,
  providerListResponseSchema,
  providerResponseSchema,
  upsertProviderBodySchema,
  verifyProviderBodySchema,
  verifyProviderResponseSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const providerIdParamSchema = z.object({ providerId: z.string() });

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
      const result = await container.modelProviderService.upsertProvider(
        providerId,
        c.req.valid("json"),
      );
      return c.json({ provider: result.provider }, result.created ? 201 : 200);
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
      return c.json(
        { ok: await container.modelProviderService.deleteProvider(providerId) },
        200,
      );
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
      method: "get",
      path: "/api/v1/link-catalog",
      tags: ["Models"],
      responses: {
        200: {
          content: {
            "application/json": { schema: linkCatalogResponseSchema },
          },
          description: "Link catalog placeholder",
        },
      },
    }),
    async (c) =>
      c.json(await container.desktopLocalService.getLinkCatalog(), 200),
  );
}
