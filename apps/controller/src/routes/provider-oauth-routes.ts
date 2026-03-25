import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  oauthProviderStatusResponseSchema,
  oauthStartResponseSchema,
  oauthStatusResponseSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

// Known models for OpenAI Codex subscription (ChatGPT Plus/Pro OAuth).
// Source: https://docs.openclaw.ai/providers/openai
// Codex tokens lack api.model.read scope, so models can't be fetched dynamically.
const OPENAI_CODEX_KNOWN_MODELS = ["gpt-5.4"];

const providerIdParamSchema = z.object({ providerId: z.string() });

export function registerProviderOAuthRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/providers/{providerId}/oauth/start",
      tags: ["Provider OAuth"],
      request: {
        params: providerIdParamSchema,
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: oauthStartResponseSchema },
          },
          description: "OAuth flow started",
        },
      },
    }),
    async (c) => {
      const { providerId } = c.req.valid("param");
      const result =
        await container.openclawAuthService.startOAuthFlow(providerId);
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/providers/{providerId}/oauth/status",
      tags: ["Provider OAuth"],
      request: {
        params: providerIdParamSchema,
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: oauthStatusResponseSchema },
          },
          description: "Current OAuth flow status",
        },
      },
    }),
    async (c) => {
      const { providerId } = c.req.valid("param");
      const flowStatus = container.openclawAuthService.getFlowStatus();

      if (flowStatus.status === "completed") {
        const completed = container.openclawAuthService.consumeCompleted();
        if (completed) {
          const models =
            completed.models.length > 0
              ? completed.models
              : OPENAI_CODEX_KNOWN_MODELS;

          await container.modelProviderService.upsertProvider(providerId, {
            displayName: "OpenAI",
            enabled: true,
            apiKey: null,
            modelsJson: JSON.stringify(models),
          });
          await container.openclawSyncService.syncAll();
          return c.json({ ...flowStatus, models }, 200);
        }
      }

      return c.json(flowStatus, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/providers/{providerId}/oauth/provider-status",
      tags: ["Provider OAuth"],
      request: {
        params: providerIdParamSchema,
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: oauthProviderStatusResponseSchema,
            },
          },
          description: "OAuth provider connection status",
        },
      },
    }),
    async (c) => {
      const { providerId } = c.req.valid("param");
      const status =
        await container.openclawAuthService.getProviderOAuthStatus(providerId);
      return c.json(status, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/providers/{providerId}/oauth/disconnect",
      tags: ["Provider OAuth"],
      request: {
        params: providerIdParamSchema,
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ ok: z.boolean() }),
            },
          },
          description: "OAuth provider disconnected",
        },
      },
    }),
    async (c) => {
      const { providerId } = c.req.valid("param");
      const ok =
        await container.openclawAuthService.disconnectOAuth(providerId);
      return c.json({ ok }, 200);
    },
  );
}
