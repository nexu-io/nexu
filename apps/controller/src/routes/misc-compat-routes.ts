import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  resolveClaimKeyQuerySchema,
  resolveClaimKeyResponseSchema,
  sharedSlackClaimResponseSchema,
  sharedSlackClaimSchema,
  validateInviteResponseSchema,
  validateInviteSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const desktopAuthorizeBodySchema = z.object({ deviceId: z.string() });
const desktopAuthorizeResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
const feishuOauthQuerySchema = z.object({
  workspaceKey: z.string().min(1),
  botId: z.string().min(1),
});
const feishuOauthResponseSchema = z.object({ url: z.string() });

export function registerMiscCompatRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/auth/desktop-authorize",
      tags: ["Auth"],
      request: {
        body: {
          content: {
            "application/json": { schema: desktopAuthorizeBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: desktopAuthorizeResponseSchema },
          },
          description: "Desktop authorize",
        },
      },
    }),
    async (c) => {
      desktopAuthorizeBodySchema.parse(c.req.valid("json"));
      return c.json({ ok: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/invite/validate",
      tags: ["Invite"],
      request: {
        body: {
          content: { "application/json": { schema: validateInviteSchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: validateInviteResponseSchema },
          },
          description: "Invite validate",
        },
      },
    }),
    async (c) => {
      const { code } = c.req.valid("json");
      return c.json(
        {
          valid: code.trim().length > 0,
          message: code.trim().length > 0 ? undefined : "Invalid invite code",
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/feishu/bind/oauth-url",
      tags: ["Feishu"],
      request: { query: feishuOauthQuerySchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: feishuOauthResponseSchema },
          },
          description: "Feishu bind url",
        },
      },
    }),
    async (c) => {
      const { workspaceKey, botId } = c.req.valid("query");
      return c.json(
        {
          url: `${container.env.webUrl}/feishu/bind?ws=${encodeURIComponent(workspaceKey)}&bot=${encodeURIComponent(botId)}`,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/shared-slack/resolve-claim-key",
      tags: ["Shared Slack App"],
      request: { query: resolveClaimKeyQuerySchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: resolveClaimKeyResponseSchema },
          },
          description: "Resolve claim",
        },
      },
    }),
    async (c) => {
      const { token } = c.req.valid("query");
      return c.json(
        { valid: token.trim().length > 0, expired: false, used: false },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/shared-slack/claim",
      tags: ["Shared Slack App"],
      request: {
        body: {
          content: { "application/json": { schema: sharedSlackClaimSchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: sharedSlackClaimResponseSchema },
          },
          description: "Shared slack claim",
        },
      },
    }),
    async (c) => {
      c.req.valid("json");
      return c.json({ ok: true, orgAuthorized: true }, 200);
    },
  );
}
