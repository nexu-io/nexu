import crypto from "node:crypto";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { registerArtifactRoutes } from "../routes/artifact-routes.js";
import { registerBotRoutes } from "../routes/bot-routes.js";
import { registerChannelRoutes } from "../routes/channel-routes.js";
import { registerDesktopCompatRoutes } from "../routes/desktop-compat-routes.js";
import { registerDesktopRoutes } from "../routes/desktop-routes.js";
import { registerIntegrationRoutes } from "../routes/integration-routes.js";
import { registerMiscCompatRoutes } from "../routes/misc-compat-routes.js";
import { registerModelRoutes } from "../routes/model-routes.js";
import { registerRuntimeConfigRoutes } from "../routes/runtime-config-routes.js";
import { registerSessionRoutes } from "../routes/session-routes.js";
import { registerSkillhubRoutes } from "../routes/skillhub-routes.js";
import { registerUserRoutes } from "../routes/user-routes.js";
import { registerWorkspaceTemplateRoutes } from "../routes/workspace-template-routes.js";
import type { ControllerBindings } from "../types.js";
import type { ControllerContainer } from "./container.js";

export function createApp(container: ControllerContainer) {
  const app = new OpenAPIHono<ControllerBindings>();

  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    await next();
  });
  app.use(
    "*",
    cors({
      origin: container.env.webUrl,
      credentials: true,
    }),
  );

  registerBotRoutes(app, container);
  registerMiscCompatRoutes(app, container);
  registerDesktopRoutes(app, container);
  registerDesktopCompatRoutes(app, container);
  registerChannelRoutes(app, container);
  registerSessionRoutes(app, container);
  registerModelRoutes(app, container);
  registerIntegrationRoutes(app, container);
  registerArtifactRoutes(app, container);
  registerSkillhubRoutes(app, container);
  registerUserRoutes(app, container);
  registerRuntimeConfigRoutes(app, container);
  registerWorkspaceTemplateRoutes(app, container);

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Nexu Controller API",
      version: "0.1.0",
    },
  });

  app.get("/health", async (c) => {
    const runtime = await container.runtimeHealth.probe();
    return c.json(
      {
        status: container.runtimeState.status,
        runtime,
        sync: {
          config: container.runtimeState.configSyncStatus,
          skills: container.runtimeState.skillsSyncStatus,
          templates: container.runtimeState.templatesSyncStatus,
        },
        gateway: {
          status: container.runtimeState.gatewayStatus,
          lastProbeAt: container.runtimeState.lastGatewayProbeAt,
          lastError: container.runtimeState.lastGatewayError,
        },
      },
      200,
    );
  });

  return app;
}
