import { execFile } from "node:child_process";
import path from "node:path";
import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const desktopReadyResponseSchema = z.object({
  ready: z.boolean(),
  coreReady: z.boolean(),
  degraded: z.boolean(),
  bootPhase: z.enum([
    "preparing",
    "starting-managed-runtime",
    "attaching-external-runtime",
    "reconciling-runtime",
    "stabilizing-runtime",
    "ready",
  ]),
  workspacePath: z.string(),
  controlPlane: z.object({
    ok: z.boolean(),
    phase: z.enum(["disconnected", "connecting", "ready", "degraded"]),
    wsConnected: z.boolean(),
  }),
  status: z.enum(["active", "starting", "degraded", "unhealthy"]),
});

const fallbackEventSchema = z.object({
  id: z.string(),
  receivedAt: z.string(),
  channel: z.string(),
  status: z.string(),
  reasonCode: z.string().nullable(),
  accountId: z.string().nullable(),
  to: z.string().nullable(),
  threadId: z.string().nullable(),
  sessionKey: z.string().nullable(),
  actionId: z.string().nullable(),
  fallbackOutcome: z.enum(["sent", "skipped", "failed"]),
  fallbackReason: z.string(),
  error: z.string().nullable(),
  sendResult: z
    .object({
      runId: z.string().optional(),
      messageId: z.string().optional(),
      channel: z.string().optional(),
      chatId: z.string().optional(),
      conversationId: z.string().optional(),
    })
    .nullable(),
});

const fallbackEventsResponseSchema = z.object({
  events: z.array(fallbackEventSchema),
});

const fallbackEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const desktopPreferencesResponseSchema = z.object({
  locale: z.enum(["en", "zh-CN"]).nullable(),
  analyticsEnabled: z.boolean(),
});

const desktopPreferencesUpdateSchema = z
  .object({
    locale: z.enum(["en", "zh-CN"]).optional(),
    analyticsEnabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.locale !== undefined || value.analyticsEnabled !== undefined,
    {
      message: "At least one desktop preference must be provided",
    },
  );

export function registerDesktopRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  const shellOpenRequestSchema = z.object({
    path: z.string().min(1),
  });

  const shellOpenResponseSchema = z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/shell-open",
      tags: ["Desktop"],
      request: {
        body: {
          content: {
            "application/json": { schema: shellOpenRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: shellOpenResponseSchema },
          },
          description: "Shell open result",
        },
        403: {
          content: {
            "application/json": { schema: shellOpenResponseSchema },
          },
          description: "Path not allowed",
        },
      },
    }),
    async (c) => {
      const { path: targetPath } = c.req.valid("json");
      const resolved = path.resolve(targetPath);
      const allowedRoot = path.resolve(container.env.openclawStateDir);
      const allowedWorkspaceRoot = path.resolve(
        path.join(container.env.openclawStateDir, "agents"),
      );

      if (
        !(
          resolved.startsWith(allowedRoot + path.sep) ||
          resolved === allowedRoot ||
          resolved.startsWith(allowedWorkspaceRoot + path.sep) ||
          resolved === allowedWorkspaceRoot
        )
      ) {
        return c.json(
          { ok: false, error: "Path outside allowed directory" },
          403,
        );
      }

      try {
        await new Promise<void>((resolve, reject) => {
          const cmd =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "explorer"
                : "xdg-open";
          execFile(cmd, [resolved], (err) => (err ? reject(err) : resolve()));
        });
        return c.json({ ok: true }, 200);
      } catch {
        return c.json({ ok: false, error: "Failed to open folder" }, 200);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/internal/desktop/ready",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: desktopReadyResponseSchema },
          },
          description: "Desktop runtime ready status",
        },
      },
    }),
    async (c) => {
      const controlPlane = await container.controlPlaneHealth.probe({
        timeoutMs: 1500,
      });
      const coreReady =
        container.runtimeState.bootPhase === "ready" && controlPlane.ok;
      const degraded = coreReady && container.runtimeState.status !== "active";
      const bots = await container.configStore.listBots();
      const preferredBot =
        bots.find((bot) => bot.status === "active") ??
        bots.find((bot) => bot.status !== "deleted") ??
        null;

      return c.json(
        {
          ready: coreReady && !degraded,
          coreReady,
          degraded,
          bootPhase: container.runtimeState.bootPhase,
          workspacePath: preferredBot
            ? path.join(
                container.env.openclawStateDir,
                "agents",
                preferredBot.id,
              )
            : path.join(container.env.openclawStateDir, "agents"),
          controlPlane: {
            ok: controlPlane.ok,
            phase: controlPlane.phase,
            wsConnected: controlPlane.wsConnected,
          },
          status: container.runtimeState.status,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/internal/desktop/fallback-events",
      tags: ["Desktop"],
      request: {
        query: fallbackEventsQuerySchema,
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: fallbackEventsResponseSchema },
          },
          description: "Recent channel fallback diagnostics",
        },
      },
    }),
    async (c) => {
      const query = c.req.valid("query");
      return c.json(
        {
          events: container.channelFallbackService.listRecentEvents(
            query.limit,
          ),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/internal/desktop/preferences",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: desktopPreferencesResponseSchema },
          },
          description: "Desktop preferences",
        },
      },
    }),
    async (c) => {
      return c.json(
        {
          locale: await container.configStore.getStoredDesktopLocale(),
          analyticsEnabled:
            await container.configStore.getDesktopAnalyticsEnabled(),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/internal/desktop/preferences",
      tags: ["Desktop"],
      request: {
        body: {
          content: {
            "application/json": { schema: desktopPreferencesUpdateSchema },
          },
          required: true,
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: desktopPreferencesResponseSchema },
          },
          description: "Updated desktop preferences",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const locale =
        body.locale !== undefined
          ? await container.configStore.setDesktopLocale(body.locale)
          : await container.configStore.getStoredDesktopLocale();
      const analyticsEnabled =
        body.analyticsEnabled !== undefined
          ? await container.configStore.setDesktopAnalyticsEnabled(
              body.analyticsEnabled,
            )
          : await container.configStore.getDesktopAnalyticsEnabled();
      await container.openclawSyncService.syncAll();
      return c.json({ locale, analyticsEnabled }, 200);
    },
  );

  // Compaction notification endpoint — called by OpenClaw patch
  // (handleAutoCompactionStart in compact-*.js / dispatch-*.js) via
  // HTTP POST when Pi auto-compaction starts.
  //
  // Why HTTP instead of stderr NEXU_EVENT:
  //   In launchd mode, controller doesn't spawn OpenClaw (launchd does),
  //   so controller can't read OpenClaw's stderr. HTTP works regardless
  //   of process management mode.
  //
  // Why not onAgentEvent:
  //   handleAutoCompactionStart's subscriber-emitted compaction events
  //   don't reach agent-runner-execution's onAgentEvent (different
  //   execution contexts). Verified via debug logging 2026-04-04.
  //
  // Session key format: agent:<agentId>:direct:<userId>
  // Channel is resolved from payload or first connected channel in config.
  // Target (to) is the user ID parsed from session key — works for feishu
  // DMs (ou_xxx), verified via openclaw message send 2026-04-04.
  app.post("/api/internal/compaction-notify", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const sessionKey = body.sessionKey as string | undefined;
    if (!sessionKey) return c.json({ ok: false }, 400);

    const parts = sessionKey.split(":");
    const to = parts.length >= 4 ? parts.slice(3).join(":") : undefined;
    if (!to) return c.json({ ok: false, reason: "no target" }, 400);

    // Resolve channel: prefer explicit value from OpenClaw context,
    // fall back to first connected channel in Nexu config.
    // ctx.params.messageChannel is often null in compaction context,
    // so the fallback is the common path.
    let channel = typeof body.channel === "string" ? body.channel : undefined;
    if (!channel) {
      const cfg = await container.configStore.getConfig();
      channel = cfg.channels.find(
        (ch) => ch.status === "connected",
      )?.channelType;
    }
    if (!channel) return c.json({ ok: false, reason: "no channel" }, 400);

    const locale = await container.configStore.getDesktopLocale();
    const message =
      locale === "en"
        ? "⏳ Compacting conversation history, estimated ~30s..."
        : "⏳ 正在整理对话记录，预计30秒内完成...";

    try {
      await container.gatewayService.sendChannelMessage({
        to,
        message,
        channel,
        sessionKey,
      });
      return c.json({ ok: true });
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  });
}
