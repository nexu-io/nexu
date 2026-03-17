import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { Span } from "./lib/trace-decorator.js";
import { authMiddleware } from "./middleware/auth.js";
import { desktopAuthMiddleware } from "./middleware/desktop-auth.js";
import {
  errorMiddleware,
  logHandledError,
  resolveErrorHandling,
} from "./middleware/error-middleware.js";
import { requestLoggerMiddleware } from "./middleware/request-logger.js";
import { requestTraceMiddleware } from "./middleware/request-trace.js";
import {
  registerArtifactInternalRoutes,
  registerArtifactRoutes,
} from "./routes/artifact-routes.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerBotRoutes } from "./routes/bot-routes.js";
import {
  registerChannelRoutes,
  registerSlackOAuthCallback,
} from "./routes/channel-routes.js";
import {
  registerClaimPublicRoutes,
  registerClaimRoutes,
} from "./routes/claim-routes.js";
import { registerComposioRoutes } from "./routes/composio-routes.js";
import {
  registerDesktopAuthorizeRoute,
  registerDesktopDeviceRoutes,
} from "./routes/desktop-auth-routes.js";
import { registerDesktopLocalRoutes } from "./routes/desktop-local-routes.js";
import { registerFeedbackRoutes } from "./routes/feedback-routes.js";
import { registerFeishuEvents } from "./routes/feishu-events.js";
import {
  registerFeishuOAuthCallback,
  registerFeishuOAuthRoutes,
} from "./routes/feishu-oauth-routes.js";
import { registerIntegrationRoutes } from "./routes/integration-routes.js";
import { registerInviteRoutes } from "./routes/invite-routes.js";
import { registerModelRoutes } from "./routes/model-routes.js";
import { registerPoolRoutes } from "./routes/pool-routes.js";
import { registerSecretRoutes } from "./routes/secret-routes.js";
import {
  registerSessionInternalRoutes,
  registerSessionRoutes,
} from "./routes/session-routes.js";
import {
  registerSharedSlackClaimPublicRoutes,
  registerSharedSlackClaimRoutes,
} from "./routes/shared-slack-claim-routes.js";
import { registerFilesystemSkillRoutes } from "./routes/skill-filesystem-routes.js";
import {
  registerSkillCatalogRoutes,
  registerSkillRoutes,
} from "./routes/skill-routes.js";
import { registerSlackEvents } from "./routes/slack-events.js";
import { registerUserRoutes } from "./routes/user-routes.js";
import { registerWorkspaceTemplateRoutes } from "./routes/workspace-template-routes.js";

import type { AppBindings } from "./types.js";

/** Whether this API instance is running in Nexu Desktop (local) mode. */
export function isDesktopMode(): boolean {
  return process.env.NEXU_DESKTOP_MODE === "true";
}

class HealthHandler {
  constructor(private readonly commitHash?: string) {}

  @Span("api.health")
  async handle(c: Context<AppBindings>): Promise<Response> {
    const payload = await this.buildPayload();
    return c.json(payload);
  }

  @Span("api.health.payload")
  async buildPayload(): Promise<{
    status: "ok";
    metadata: { commitHash: string | null };
  }> {
    return {
      status: "ok",
      metadata: {
        commitHash: this.commitHash ?? null,
      },
    };
  }
}

export function createApp() {
  const app = new OpenAPIHono<AppBindings>();
  const commitHash = process.env.COMMIT_HASH;
  const healthHandler = new HealthHandler(commitHash);

  app.use("*", requestTraceMiddleware);
  app.use("*", requestLoggerMiddleware);
  app.use("*", errorMiddleware);
  app.use(
    "*",
    cors({
      origin: process.env.WEB_URL ?? "http://localhost:5173",
      credentials: true,
    }),
  );

  // Desktop mode: permissive CORS for internal endpoints (localhost-only, safe)
  if (isDesktopMode()) {
    app.use("/api/internal/desktop/*", cors({ origin: "*" }));
    registerDesktopLocalRoutes(app);
  }

  registerDesktopDeviceRoutes(app);
  registerAuthRoutes(app);
  registerSlackOAuthCallback(app);
  registerFeishuOAuthCallback(app);
  registerSlackEvents(app);
  registerFeishuEvents(app);
  registerArtifactInternalRoutes(app);
  registerSessionInternalRoutes(app);
  registerSecretRoutes(app);
  registerComposioRoutes(app);
  registerSkillRoutes(app);
  registerWorkspaceTemplateRoutes(app);
  registerFeedbackRoutes(app);
  registerClaimPublicRoutes(app);
  registerSharedSlackClaimPublicRoutes(app);

  // Auth middleware — validates session cookie and sets userId/session.
  // Desktop mode: try cookie-based auth first, fall back to desktop-auth
  // (which resolves the user from DB without cookies) if cookie isn't
  // synced to the webview yet.
  if (isDesktopMode()) {
    app.use("/api/v1/*", async (c, next) => {
      try {
        await authMiddleware(c, async () => {});
        if (c.get("userId")) {
          return next();
        }
      } catch {
        // Cookie not available yet — fall back to desktop auth
      }
      return desktopAuthMiddleware(c, next);
    });
  } else {
    app.use("/api/v1/*", authMiddleware);
  }

  registerDesktopAuthorizeRoute(app);
  registerUserRoutes(app);
  registerBotRoutes(app);
  registerChannelRoutes(app);
  registerInviteRoutes(app);
  registerModelRoutes(app);
  registerPoolRoutes(app);
  registerSharedSlackClaimRoutes(app);
  registerArtifactRoutes(app);
  registerSessionRoutes(app);
  registerClaimRoutes(app);
  registerFeishuOAuthRoutes(app);
  registerIntegrationRoutes(app);
  registerSkillCatalogRoutes(app);
  registerFilesystemSkillRoutes(app);

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Nexu API", version: "1.0.0" },
  });

  // Infrastructure health endpoint (k8s/lb/docker probes).
  app.get("/health", (c) => healthHandler.handle(c));

  app.onError((error, c) => {
    const handled = resolveErrorHandling(c, error);
    logHandledError(c, handled.level, handled.logBody);
    return c.json(handled.responseBody, handled.status);
  });

  return app;
}
