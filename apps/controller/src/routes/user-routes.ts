import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  updateAuthSourceResponseSchema,
  updateAuthSourceSchema,
  updateUserProfileResponseSchema,
  updateUserProfileSchema,
  userProfileResponseSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

export function registerUserRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/me",
      tags: ["User"],
      responses: {
        200: {
          content: {
            "application/json": { schema: userProfileResponseSchema },
          },
          description: "Current local user",
        },
      },
    }),
    async (c) => c.json(await container.localUserService.getProfile(), 200),
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/v1/me",
      tags: ["User"],
      request: {
        body: {
          content: { "application/json": { schema: updateUserProfileSchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: updateUserProfileResponseSchema },
          },
          description: "Updated local user",
        },
      },
    }),
    async (c) =>
      c.json(
        await container.localUserService.updateProfile(c.req.valid("json")),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/me/auth-source",
      tags: ["User"],
      request: {
        body: {
          content: { "application/json": { schema: updateAuthSourceSchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: updateAuthSourceResponseSchema },
          },
          description: "Updated auth source",
        },
      },
    }),
    async (c) =>
      c.json(
        await container.localUserService.updateAuthSource(c.req.valid("json")),
        200,
      ),
  );
}
