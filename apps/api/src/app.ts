import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth.js";
import {
  errorMiddleware,
  logHandledError,
  resolveErrorHandling,
} from "./middleware/error-middleware.js";
import { requestLoggerMiddleware } from "./middleware/request-logger.js";
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
import { registerInviteRoutes } from "./routes/invite-routes.js";
import { registerModelRoutes } from "./routes/model-routes.js";
import { registerOnboardingRoutes } from "./routes/onboarding-routes.js";
import { registerPoolRoutes } from "./routes/pool-routes.js";
import {
  registerSessionInternalRoutes,
  registerSessionRoutes,
} from "./routes/session-routes.js";
import { registerSkillRoutes } from "./routes/skill-routes.js";
import { registerSlackEvents } from "./routes/slack-events.js";
import { registerUserRoutes } from "./routes/user-routes.js";

import type { AppBindings } from "./types.js";

export function createApp() {
  const app = new OpenAPIHono<AppBindings>();
  const commitHash = process.env.COMMIT_HASH;

  app.use("*", requestLoggerMiddleware);
  app.use("*", errorMiddleware);
  app.use(
    "*",
    cors({
      origin: process.env.WEB_URL ?? "http://localhost:5173",
      credentials: true,
    }),
  );

  registerAuthRoutes(app);
  registerSlackOAuthCallback(app);
  registerSlackEvents(app);
  registerArtifactInternalRoutes(app);
  registerSessionInternalRoutes(app);
  registerSkillRoutes(app);

  app.use("/api/v1/*", authMiddleware);

  registerUserRoutes(app);
  registerOnboardingRoutes(app);
  registerBotRoutes(app);
  registerChannelRoutes(app);
  registerInviteRoutes(app);
  registerModelRoutes(app);
  registerPoolRoutes(app);
  registerArtifactRoutes(app);
  registerSessionRoutes(app);

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Nexu API", version: "1.0.0" },
  });

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      metadata: {
        commitHash: commitHash ?? null,
      },
    }),
  );

  app.onError((error, c) => {
    const handled = resolveErrorHandling(c, error);
    logHandledError(c, handled.level, handled.logBody);
    return c.json(handled.responseBody, handled.status);
  });

  return app;
}
