import {
  type SessionChatMessage,
  addSessionChatTrace,
  appendSessionChatMessage,
  createSessionChatMessage,
  updateSessionChatMessageTraceState,
  updateSessionChatThreadStatus,
} from "./db";

const openclawBaseUrl = (
  process.env.OPENCLAW_BASE_URL ?? "http://127.0.0.1:18789"
).replace(/\/$/, "");
const openclawGatewayToken =
  process.env.OPENCLAW_GATEWAY_TOKEN ?? "gw-secret-token";
const openclawModel = process.env.OPENCLAW_MODEL ?? "openclaw";
const openclawAgentId = process.env.OPENCLAW_AGENT_ID?.trim() || null;

type OpenClawResponseShape = {
  output?: Array<{
    type?: string;
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

export type SessionChatDispatchResult = {
  userMessage: SessionChatMessage;
  assistantMessage: SessionChatMessage | null;
  dispatchOk: boolean;
  dispatchError: string | null;
};

function extractAssistantText(response: OpenClawResponseShape): string | null {
  for (const item of response.output ?? []) {
    if (item.type !== "message" || item.role !== "assistant") {
      continue;
    }

    const textParts = (item.content ?? [])
      .filter(
        (content) =>
          content.type === "output_text" && typeof content.text === "string",
      )
      .map((content) => content.text?.trim() ?? "")
      .filter(Boolean);

    if (textParts.length > 0) {
      return textParts.join("\n\n");
    }
  }

  return null;
}

export async function dispatchSessionChatTurn(input: {
  threadId: string;
  body: string;
}): Promise<SessionChatDispatchResult> {
  const userMessage = await createSessionChatMessage({
    threadId: input.threadId,
    role: "user",
    body: input.body,
  });

  await updateSessionChatThreadStatus(input.threadId, "dispatching");
  await addSessionChatTrace({
    messageId: userMessage.id,
    correlationId: userMessage.correlationId,
    stage: "dispatch-started",
    source: "session-chat-dispatcher",
    detail: `Posting prompt to ${openclawBaseUrl}/v1/responses`,
  });

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${openclawGatewayToken}`,
      "x-openclaw-message-channel": "session-chat-desktop",
    };

    if (openclawAgentId) {
      headers["x-openclaw-agent-id"] = openclawAgentId;
    }

    const response = await fetch(`${openclawBaseUrl}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        stream: false,
        model: openclawModel,
        input: input.body,
      }),
    });

    const json = (await response.json()) as OpenClawResponseShape;

    if (!response.ok) {
      const dispatchError =
        json.error?.message ??
        `OpenClaw dispatch failed with status ${response.status}.`;
      await updateSessionChatMessageTraceState(
        userMessage.id,
        "dispatch-failed",
      );
      await updateSessionChatThreadStatus(input.threadId, "dispatch-failed");
      await addSessionChatTrace({
        messageId: userMessage.id,
        correlationId: userMessage.correlationId,
        stage: "dispatch-failed",
        source: "openclaw-responses",
        detail: dispatchError,
      });

      return {
        userMessage,
        assistantMessage: null,
        dispatchOk: false,
        dispatchError,
      };
    }

    const assistantText =
      extractAssistantText(json) ??
      "OpenClaw completed without assistant text.";
    const assistantMessage = await appendSessionChatMessage({
      threadId: input.threadId,
      role: "assistant",
      body: assistantText,
      correlationId: userMessage.correlationId,
      traceState: "dispatch-succeeded",
    });

    await updateSessionChatMessageTraceState(
      userMessage.id,
      "dispatch-succeeded",
    );
    await updateSessionChatThreadStatus(input.threadId, "dispatch-succeeded");
    await addSessionChatTrace({
      messageId: userMessage.id,
      correlationId: userMessage.correlationId,
      stage: "dispatch-succeeded",
      source: "openclaw-responses",
      detail: "OpenClaw returned a completed response payload.",
    });
    await addSessionChatTrace({
      messageId: assistantMessage.id,
      correlationId: userMessage.correlationId,
      stage: "reply-persisted",
      source: "session-chat-db",
      detail: "Assistant reply stored in dedicated session-chat database.",
    });

    return {
      userMessage,
      assistantMessage,
      dispatchOk: true,
      dispatchError: null,
    };
  } catch (error) {
    const dispatchError =
      error instanceof Error ? error.message : "Unknown dispatch failure.";
    await updateSessionChatMessageTraceState(userMessage.id, "dispatch-failed");
    await updateSessionChatThreadStatus(input.threadId, "dispatch-failed");
    await addSessionChatTrace({
      messageId: userMessage.id,
      correlationId: userMessage.correlationId,
      stage: "dispatch-failed",
      source: "session-chat-dispatcher",
      detail: dispatchError,
    });

    return {
      userMessage,
      assistantMessage: null,
      dispatchOk: false,
      dispatchError,
    };
  }
}
