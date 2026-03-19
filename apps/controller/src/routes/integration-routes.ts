import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  connectIntegrationResponseSchema,
  connectIntegrationSchema,
  integrationListResponseSchema,
  integrationResponseSchema,
  refreshIntegrationSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const integrationIdParamSchema = z.object({ integrationId: z.string() });
const errorSchema = z.object({ message: z.string() });

export function registerIntegrationRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/integrations",
      tags: ["Integrations"],
      responses: {
        200: {
          content: {
            "application/json": { schema: integrationListResponseSchema },
          },
          description: "Integrations",
        },
      },
    }),
    async (c) =>
      c.json(await container.integrationService.listIntegrations(), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/integrations/connect",
      tags: ["Integrations"],
      request: {
        body: {
          content: { "application/json": { schema: connectIntegrationSchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: connectIntegrationResponseSchema },
          },
          description: "Connection initiated",
        },
      },
    }),
    async (c) =>
      c.json(
        await container.integrationService.connectIntegration(
          c.req.valid("json"),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/integrations/{integrationId}/refresh",
      tags: ["Integrations"],
      request: {
        params: integrationIdParamSchema,
        body: {
          content: { "application/json": { schema: refreshIntegrationSchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: integrationResponseSchema },
          },
          description: "Refreshed integration",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Not found",
        },
      },
    }),
    async (c) => {
      const { integrationId } = c.req.valid("param");
      const integration = await container.integrationService.refreshIntegration(
        integrationId,
        c.req.valid("json"),
      );
      if (integration === null) {
        return c.json({ message: "Integration not found" }, 404);
      }
      return c.json(integration, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/integrations/{integrationId}",
      tags: ["Integrations"],
      request: { params: integrationIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: integrationResponseSchema },
          },
          description: "Disconnected integration",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Not found",
        },
      },
    }),
    async (c) => {
      const { integrationId } = c.req.valid("param");
      const integration =
        await container.integrationService.deleteIntegration(integrationId);
      if (integration === null) {
        return c.json({ message: "Integration not found" }, 404);
      }
      return c.json(integration, 200);
    },
  );
}
