import { logger } from "./logger.js";

interface FeedbackPayload {
  content: string;
  channel?: string;
  sender?: string;
  agentId?: string;
  botName?: string;
  ownerEmail?: string;
  ownerName?: string;
  conversationContext?: string;
}

function buildMetadataColumn(
  label: string,
  value: string,
): Record<string, unknown> {
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    vertical_align: "top",
    elements: [
      {
        tag: "div",
        text: { tag: "lark_md", content: `**${label}**\n${value}` },
      },
    ],
  };
}

function buildCardElements(payload: FeedbackPayload): unknown[] {
  const elements: unknown[] = [];

  // Metadata grid — balanced 2x2 layout
  const row1: Record<string, unknown>[] = [];
  const row2: Record<string, unknown>[] = [];

  if (payload.ownerEmail) {
    row1.push(buildMetadataColumn("👤 账号", payload.ownerEmail));
  }
  if (payload.channel) {
    row1.push(buildMetadataColumn("💬 渠道", payload.channel));
  }
  if (payload.botName) {
    row2.push(buildMetadataColumn("🤖 Bot", payload.botName));
  }
  if (payload.agentId) {
    row2.push(buildMetadataColumn("🏷️ Bot ID", `\`${payload.agentId}\``));
  }

  for (const row of [row1, row2]) {
    if (row.length > 0) {
      elements.push({
        tag: "column_set",
        flex_mode: "none",
        background_style: "grey",
        horizontal_spacing: "default",
        columns: row,
      });
    }
  }

  // Divider
  elements.push({ tag: "hr" });

  // Feedback content
  elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: payload.content,
    },
  });

  // Conversation context — render \n as actual newlines
  if (payload.conversationContext) {
    elements.push({ tag: "hr" });

    const contextText = payload.conversationContext
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "  ");

    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**📝 会话上下文**\n${contextText}`,
      },
    });
  }

  // Timestamp footer
  const now = new Date();
  const ts = now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  elements.push({
    tag: "note",
    elements: [
      {
        tag: "plain_text",
        content: ts,
      },
    ],
  });

  return elements;
}

export async function sendFeishuWebhook(
  payload: FeedbackPayload,
): Promise<boolean> {
  const webhookUrl = process.env.FEISHU_FEEDBACK_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.warn({
      message: "feishu_feedback_webhook_not_configured",
      scope: "feishu-webhook",
    });
    return false;
  }

  const body = {
    msg_type: "interactive",
    card: {
      header: {
        title: {
          tag: "plain_text",
          content:
            payload.content.length > 60
              ? `${payload.content.slice(0, 60)}...`
              : payload.content,
        },
        template: "orange",
      },
      elements: buildCardElements(payload),
    },
  };

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      logger.warn({
        message: "feishu_feedback_webhook_failed",
        scope: "feishu-webhook",
        status: resp.status,
        statusText: resp.statusText,
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.warn({
      message: "feishu_feedback_webhook_error",
      scope: "feishu-webhook",
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
