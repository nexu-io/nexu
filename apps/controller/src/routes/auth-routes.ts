import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const signUpBodySchema = z.object({
  name: z.string(),
  email: z.string().email(),
  password: z.string(),
});

const signInBodySchema = z.object({
  email: z.string().email(),
  password: z.string(),
  rememberMe: z.boolean().optional(),
});

function sessionCookieHeader(): string {
  return "nexu_session=desktop-local-session; Path=/; HttpOnly; SameSite=Lax";
}

export function registerAuthRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.get("/api/auth/get-session", async (c) => {
    c.header("Set-Cookie", sessionCookieHeader());
    return c.json(await container.localUserService.getSession(), 200);
  });

  app.post("/api/auth/sign-up/email", async (c) => {
    signUpBodySchema.parse(await c.req.json());
    c.header("Set-Cookie", sessionCookieHeader());
    return c.json(await container.localUserService.signUp(), 200);
  });

  app.post("/api/auth/sign-in/email", async (c) => {
    signInBodySchema.parse(await c.req.json());
    c.header("Set-Cookie", sessionCookieHeader());
    return c.json(await container.localUserService.signIn(), 200);
  });

  app.post("/api/auth/sign-out", async (c) => {
    c.header(
      "Set-Cookie",
      "nexu_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    return c.json({ ok: true }, 200);
  });
}
