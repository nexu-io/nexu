import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  getDefaultProviderBaseUrls,
  getProviderRuntimePolicy,
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
      path: "/api/v1/model-providers/{providerId}/oauth/start",
      tags: ["Model Providers"],
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
      path: "/api/v1/model-providers/{providerId}/oauth/status",
      tags: ["Model Providers"],
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

          const existingConfig =
            await container.modelProviderService.getModelProviderConfigDocument();
          const runtimePolicy = getProviderRuntimePolicy(providerId);
          const existingProvider = existingConfig.providers[providerId];
          const baseUrl =
            existingProvider?.baseUrl ??
            getDefaultProviderBaseUrls(providerId)[0];
          if (!baseUrl) {
            return c.json(
              { ...flowStatus, error: "Unknown provider base URL" },
              200,
            );
          }
          const { apiKey: _previousApiKey, ...existingProviderWithoutApiKey } =
            existingProvider ?? {};
          const nextProvider = {
            ...existingProviderWithoutApiKey,
            enabled: true,
            displayName: existingProvider?.displayName ?? "OpenAI",
            baseUrl,
            auth: "oauth" as const,
            oauthProfileRef: completed.profile.provider,
            models,
          };

          existingConfig.providers[providerId] = {
            ...nextProvider,
            ...(runtimePolicy?.apiKind ? { api: runtimePolicy.apiKind } : {}),
            models: models.map((modelId) => ({
              id: modelId,
              name: modelId,
              reasoning: false,
              input: ["text"] as Array<"text" | "image">,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
              contextWindow: 0,
              maxTokens: 0,
              ...(runtimePolicy?.apiKind ? { api: runtimePolicy.apiKind } : {}),
            })),
          };

          await container.modelProviderService.setModelProviderConfigDocument(
            existingConfig,
          );
          return c.json({ ...flowStatus, models }, 200);
        }
      }

      return c.json(flowStatus, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/model-providers/{providerId}/oauth/provider-status",
      tags: ["Model Providers"],
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
      path: "/api/v1/model-providers/{providerId}/oauth/disconnect",
      tags: ["Model Providers"],
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
      const wasConnected = (
        await container.openclawAuthService.getProviderOAuthStatus(providerId)
      ).connected;
      const ok =
        await container.openclawAuthService.disconnectOAuth(providerId);
      if (ok && wasConnected) {
        const existingConfig =
          await container.modelProviderService.getModelProviderConfigDocument();
        if (existingConfig.providers[providerId]) {
          delete existingConfig.providers[providerId];
          await container.modelProviderService.setModelProviderConfigDocument(
            existingConfig,
          );
        }
        await container.modelProviderService.ensureValidDefaultModel();
      }
      return c.json({ ok }, 200);
    },
  );
}
