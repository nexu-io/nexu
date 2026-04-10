const DEFAULT_BASE_URL = "https://cloud.langfuse.com";
const pendingPrompts = new Map();

function readLangfuseConfig() {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) {
    return null;
  }

  return {
    authHeader: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
    baseUrl: (process.env.LANGFUSE_BASE_URL?.trim() ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
  };
}

function randomId() {
  return crypto.randomUUID();
}

function extractText(content, maxLength) {
  if (typeof content === "string") {
    return content.slice(0, maxLength);
  }

  if (Array.isArray(content)) {
    return content
      .filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
      .slice(0, maxLength);
  }

  return "";
}

function buildBatch(event, context, pending) {
  const now = new Date().toISOString();
  const startedAt = pending?.startedAt ??
    (event.durationMs ? Date.now() - event.durationMs : Date.now());
  const startTime = new Date(startedAt).toISOString();

  let input = pending?.prompt ?? "";
  if (!input) {
    for (let index = event.messages.length - 1; index >= 0; index -= 1) {
      const message = event.messages[index];
      if (message?.role === "user") {
        input = extractText(message.content, 2000);
        break;
      }
    }
  }

  let output = "";
  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message = event.messages[index];
    if (message?.role === "assistant") {
      output = extractText(message.content, 4000);
      break;
    }
  }

  let usage;
  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message = event.messages[index];
    if (message?.role === "assistant" && message.usage) {
      usage = {
        input:
          typeof message.usage.input_tokens === "number"
            ? message.usage.input_tokens
            : undefined,
        output:
          typeof message.usage.output_tokens === "number"
            ? message.usage.output_tokens
            : undefined,
        unit: "TOKENS",
      };
      break;
    }
  }

  const traceId = randomId();
  const generationId = randomId();

  return [
    {
      id: randomId(),
      type: "trace-create",
      timestamp: now,
      body: {
        id: traceId,
        name: "openclaw-turn",
        sessionId: context.sessionKey ?? undefined,
        userId: context.agentId ?? "unknown",
        tags: ["openclaw", context.agentId ?? "unknown"],
        input: input || undefined,
        output: output || undefined,
        metadata: {
          success: event.success,
          error: event.error ?? undefined,
          messageCount: event.messages.length,
        },
        timestamp: startTime,
      },
    },
    {
      id: randomId(),
      type: "generation-create",
      timestamp: now,
      body: {
        id: generationId,
        traceId,
        name: "llm",
        startTime,
        endTime: now,
        input: input || undefined,
        output: output || undefined,
        level: event.success ? "DEFAULT" : "ERROR",
        statusMessage: event.error ?? undefined,
        usage,
        metadata: {
          durationMs: event.durationMs,
          messageCount: event.messages.length,
        },
      },
    },
  ];
}

async function postLangfuseBatch(api, config, batch) {
  try {
    const response = await fetch(`${config.baseUrl}/api/public/ingestion`, {
      method: "POST",
      headers: {
        Authorization: config.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ batch }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      api.logger.warn(
        `[langfuse-tracer] Ingestion failed ${response.status}: ${body.slice(0, 200)}`,
      );
    }
  } catch (error) {
    api.logger.warn(`[langfuse-tracer] Fetch error: ${String(error)}`);
  }
}

const plugin = {
  id: "langfuse-tracer",
  name: "Langfuse Tracer",
  description:
    "Temporarily forwards OpenClaw agent lifecycle events to Langfuse when LANGFUSE_* env vars are present.",
  register(api) {
    const config = readLangfuseConfig();
    if (!config) {
      api.logger.info(
        "[langfuse-tracer] LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set — tracing disabled",
      );
      return;
    }

    api.logger.info(
      `[langfuse-tracer] Langfuse tracing enabled → ${config.baseUrl}`,
    );

    api.on("before_agent_start", (event = {}, context = {}) => {
      const key = context.sessionKey ?? context.agentId ?? "default";
      pendingPrompts.set(key, {
        prompt: typeof event.prompt === "string" ? event.prompt : "",
        startedAt: Date.now(),
      });
    });

    api.on("agent_end", async (event = {}, context = {}) => {
      const key = context.sessionKey ?? context.agentId ?? "default";
      const pending = pendingPrompts.get(key);
      pendingPrompts.delete(key);

      const messages = Array.isArray(event.messages) ? event.messages : [];
      const batch = buildBatch({ ...event, messages }, context, pending);
      await postLangfuseBatch(api, config, batch);
    });
  },
};

export default plugin;
