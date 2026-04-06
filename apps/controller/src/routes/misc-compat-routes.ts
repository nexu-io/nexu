import { readFile } from "node:fs/promises";
import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  openclawConfigSchema,
  resolveClaimKeyQuerySchema,
  resolveClaimKeyResponseSchema,
  sharedSlackClaimResponseSchema,
  sharedSlackClaimSchema,
  validateInviteResponseSchema,
  validateInviteSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import { logger } from "../lib/logger.js";
import { proxyFetch } from "../lib/proxy-fetch.js";
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
const openAiChatCompletionBodySchema = z.object({
  model: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant", "tool"]),
      content: z.union([z.string(), z.array(z.unknown())]),
      name: z.string().optional(),
      tool_call_id: z.string().optional(),
    }),
  ),
  stream: z.boolean().optional(),
  user: z.string().optional(),
});

type OpenAiCompatMessage = z.infer<
  typeof openAiChatCompletionBodySchema
>["messages"][number];
type DingTalkSessionContext = {
  channel: "dingtalk-connector";
  accountId: string;
  chatType: "direct" | "group";
  peerId: string;
  conversationId?: string;
  senderName?: string;
  groupSubject?: string;
};

function buildOpenAiCompatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}/chat/completions`;
}

function buildOpenAiCompatHeaders(params: {
  apiKey: string;
  extraHeaders?: Record<string, string> | null | undefined;
}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${params.apiKey}`,
    ...(params.extraHeaders ?? {}),
  };
}

function resolveAgentIdFromHeader(
  headerValue: string | undefined,
): string | null {
  const value = headerValue?.trim();
  return value && value.length > 0 ? value : null;
}

function toStringHeaderRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function parseDingTalkSessionContext(
  rawValue: string | undefined,
): DingTalkSessionContext | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    if (
      parsed.channel !== "dingtalk-connector" ||
      typeof parsed.accountId !== "string" ||
      (parsed.chatType !== "direct" && parsed.chatType !== "group") ||
      typeof parsed.peerId !== "string"
    ) {
      return null;
    }

    return {
      channel: "dingtalk-connector",
      accountId: parsed.accountId,
      chatType: parsed.chatType,
      peerId: parsed.peerId,
      ...(typeof parsed.conversationId === "string"
        ? { conversationId: parsed.conversationId }
        : {}),
      ...(typeof parsed.senderName === "string"
        ? { senderName: parsed.senderName }
        : {}),
      ...(typeof parsed.groupSubject === "string"
        ? { groupSubject: parsed.groupSubject }
        : {}),
    };
  } catch {
    return null;
  }
}

function buildCompatSessionKey(context: DingTalkSessionContext): string {
  const rawKey = [
    context.channel,
    context.accountId,
    context.chatType,
    context.peerId,
    context.conversationId ?? "",
  ].join(":");
  return `compat-${Buffer.from(rawKey, "utf8").toString("base64url")}`;
}

function buildCompatSessionTitle(context: DingTalkSessionContext): string {
  if (context.chatType === "group") {
    return (
      context.groupSubject?.trim() ||
      context.senderName?.trim() ||
      "DingTalk Group"
    );
  }
  return context.senderName?.trim() || context.peerId;
}

function extractLatestUserText(messages: OpenAiCompatMessage[]): string {
  const reversed = [...messages].reverse();
  const latestUserMessage = reversed.find((message) => message.role === "user");
  if (!latestUserMessage) {
    return "";
  }

  if (typeof latestUserMessage.content === "string") {
    return latestUserMessage.content;
  }

  const textParts = latestUserMessage.content.flatMap((part) => {
    if (
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      "text" in part &&
      (part as Record<string, unknown>).type === "text" &&
      typeof (part as Record<string, unknown>).text === "string"
    ) {
      return [(part as Record<string, string>).text];
    }
    return [];
  });
  return textParts.join("\n").trim();
}

function extractCompatMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const textParts = content.flatMap((part) => {
    if (typeof part !== "object" || part === null) {
      return [];
    }
    const block = part as Record<string, unknown>;
    if (
      (block.type === "text" || block.type === "replyContext") &&
      typeof block.text === "string"
    ) {
      return [block.text];
    }
    return [];
  });

  return textParts.join("\n").trim();
}

export function registerMiscCompatRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/chat/completions",
      tags: ["Compat"],
      request: {
        body: {
          content: {
            "application/json": { schema: openAiChatCompletionBodySchema },
          },
          required: true,
        },
      },
      responses: {
        200: {
          content: {
            "text/event-stream": { schema: z.string() },
          },
          description: "OpenAI-compatible streaming chat completions",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const rawConfig = await readFile(
        container.env.openclawConfigPath,
        "utf8",
      );
      const openclawConfig = openclawConfigSchema.parse(JSON.parse(rawConfig));
      const requestedAgentId = resolveAgentIdFromHeader(
        c.req.header("x-openclaw-agent-id"),
      );
      const agentId =
        requestedAgentId ??
        openclawConfig.agents.list.find((agent) => agent.default)?.id ??
        openclawConfig.agents.list[0]?.id ??
        "main";
      const agent =
        openclawConfig.agents.list.find((item) => item.id === agentId) ??
        openclawConfig.agents.list.find((item) => item.default) ??
        openclawConfig.agents.list[0];
      const rawModel =
        typeof agent?.model === "string"
          ? agent.model
          : (agent?.model?.primary ??
            (typeof openclawConfig.agents.defaults?.model === "string"
              ? openclawConfig.agents.defaults.model
              : openclawConfig.agents.defaults?.model?.primary));

      if (!rawModel || !rawModel.includes("/")) {
        return c.text("No compatible model configured", 500);
      }

      const slashIndex = rawModel.indexOf("/");
      const providerKey = rawModel.slice(0, slashIndex);
      const modelId = rawModel.slice(slashIndex + 1);
      const provider = openclawConfig.models?.providers?.[providerKey];
      const sessionContext = parseDingTalkSessionContext(body.user);
      const compatSessionKey = sessionContext
        ? buildCompatSessionKey(sessionContext)
        : null;
      const resolvedBotId = agent?.id ?? agentId;
      logger.info(
        {
          route: "compat.chatCompletions",
          agentId,
          resolvedBotId,
          hasSessionContext: sessionContext !== null,
          sessionContext,
          rawUserType: typeof body.user,
        },
        "compat chat request received",
      );

      if (
        !provider?.baseUrl ||
        !provider.apiKey ||
        provider.api !== "openai-completions"
      ) {
        return c.text(
          "Configured model provider is not OpenAI-compatible",
          400,
        );
      }

      const bot = await container.configStore.getBot(resolvedBotId);
      const rawMessages: OpenAiCompatMessage[] =
        sessionContext != null
          ? body.messages.filter((message) => message.role !== "system")
          : [...body.messages];
      const messageCountWithoutSystem = rawMessages.filter(
        (message) => message.role !== "system",
      ).length;
      const historyMessages: OpenAiCompatMessage[] = [];
      if (compatSessionKey && bot && messageCountWithoutSystem <= 1) {
        const history =
          await container.sessionService.getChatHistoryBySessionKey(
            bot.id,
            compatSessionKey,
            12,
          );
        for (const message of history.messages) {
          const content = extractCompatMessageText(message.content);
          if (!content) {
            continue;
          }
          historyMessages.push({
            role: message.role,
            content,
          });
        }
      }
      const messages: OpenAiCompatMessage[] = [
        ...historyMessages,
        ...rawMessages,
      ];
      if (
        bot?.systemPrompt &&
        !messages.some(
          (message) =>
            message.role === "system" &&
            typeof message.content === "string" &&
            message.content.trim() === bot.systemPrompt?.trim(),
        )
      ) {
        messages.unshift({
          role: "system",
          content: bot.systemPrompt,
        });
      }

      if (typeof provider.apiKey !== "string") {
        return c.json(
          {
            error:
              "OpenAI-compatible proxy requires a string API key for this provider",
          },
          400,
        );
      }

      const response = await proxyFetch(
        buildOpenAiCompatUrl(provider.baseUrl),
        {
          method: "POST",
          headers: buildOpenAiCompatHeaders({
            apiKey: provider.apiKey,
            extraHeaders: toStringHeaderRecord(provider.headers),
          }),
          body: JSON.stringify({
            model: modelId,
            messages,
            stream: body.stream ?? true,
            user: body.user,
          }),
        },
      );

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        return new Response(errorText || "Upstream completion failed", {
          status: response.status,
        });
      }

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let assistantText = "";
      const userText = extractLatestUserText(messages);
      const stream = new ReadableStream<Uint8Array>({
        start: async (controller) => {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.close();
            return;
          }

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              if (!value) {
                continue;
              }

              controller.enqueue(value);
              sseBuffer += decoder.decode(value, { stream: true });
              const lines = sseBuffer.split("\n");
              sseBuffer = lines.pop() ?? "";

              for (const line of lines) {
                if (!line.startsWith("data: ")) {
                  continue;
                }
                const data = line.slice(6).trim();
                if (!data || data === "[DONE]") {
                  continue;
                }
                try {
                  const parsed = JSON.parse(data) as {
                    choices?: Array<{
                      delta?: { content?: string };
                    }>;
                  };
                  assistantText += parsed.choices?.[0]?.delta?.content ?? "";
                } catch {
                  // Ignore malformed SSE chunks from upstream providers.
                }
              }
            }

            const trailing = sseBuffer.trim();
            if (trailing.startsWith("data: ")) {
              const data = trailing.slice(6).trim();
              if (data && data !== "[DONE]") {
                try {
                  const parsed = JSON.parse(data) as {
                    choices?: Array<{
                      delta?: { content?: string };
                    }>;
                  };
                  assistantText += parsed.choices?.[0]?.delta?.content ?? "";
                } catch {
                  // Ignore malformed trailing chunk.
                }
              }
            }

            if (
              sessionContext &&
              compatSessionKey &&
              bot &&
              userText.length > 0 &&
              assistantText.trim().length > 0
            ) {
              logger.info(
                {
                  route: "compat.chatCompletions",
                  agentId,
                  resolvedBotId,
                  botId: bot.id,
                  sessionKey: compatSessionKey,
                  channelType: "dingtalk",
                  userTextLength: userText.length,
                  assistantTextLength: assistantText.trim().length,
                },
                "compat transcript append start",
              );
              await container.sessionService.appendCompatTranscript({
                botId: bot.id,
                sessionKey: compatSessionKey,
                title: buildCompatSessionTitle(sessionContext),
                channelType: "dingtalk",
                channelId:
                  sessionContext.conversationId ?? sessionContext.peerId,
                metadata: {
                  senderName: sessionContext.senderName ?? null,
                  groupSubject: sessionContext.groupSubject ?? null,
                  peerId: sessionContext.peerId,
                  accountId: sessionContext.accountId,
                  conversationId: sessionContext.conversationId ?? null,
                  source: "dingtalk-compat",
                },
                userText,
                assistantText: assistantText.trim(),
                provider: providerKey,
                model: modelId,
                api: provider.api,
              });
              logger.info(
                {
                  route: "compat.chatCompletions",
                  agentId,
                  resolvedBotId,
                  botId: bot.id,
                },
                "compat transcript append success",
              );
            } else {
              logger.warn(
                {
                  route: "compat.chatCompletions",
                  agentId,
                  resolvedBotId,
                  hasSessionContext: sessionContext !== null,
                  hasBot: Boolean(bot),
                  userTextLength: userText.length,
                  assistantTextLength: assistantText.trim().length,
                },
                "compat transcript append skipped",
              );
            }
          } catch (error) {
            logger.error(
              {
                route: "compat.chatCompletions",
                agentId,
                error: error instanceof Error ? error.message : String(error),
              },
              "compat stream failed",
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  choices: [
                    {
                      delta: {
                        content: `\n\n[compat stream error: ${error instanceof Error ? error.message : String(error)}]`,
                      },
                    },
                  ],
                })}\n\n`,
              ),
            );
          } finally {
            controller.close();
            reader.releaseLock();
          }
        },
      });

      return new Response(stream, {
        status: response.status,
        headers: {
          "Content-Type":
            response.headers.get("content-type") ?? "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    },
  );

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
