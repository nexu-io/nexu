import { isIP } from "node:net";
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
  imageUrls?: string[];
  feishuAppId?: string;
  feishuAppSecret?: string;
  preUploadedImageKeys?: string[];
}

interface ProcessedImages {
  embedded: string[]; // image_keys for successfully uploaded images
  linked: string[]; // original URLs for failed/oversized images
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB — Feishu upload limit
const IMAGE_FETCH_TIMEOUT_MS = 15_000;

export async function getFeishuTenantToken(
  appId: string,
  appSecret: string,
): Promise<string | null> {
  try {
    const resp = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      },
    );

    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      code: number;
      tenant_access_token?: string;
    };

    if (data.code !== 0 || !data.tenant_access_token) return null;
    return data.tenant_access_token;
  } catch {
    return null;
  }
}

/** Block SSRF: reject private/loopback/link-local IPs and non-https schemes. */
function isSafeUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

  const hostname = parsed.hostname;

  // Reject IP-literal hostnames that resolve to private/reserved ranges
  if (isIP(hostname)) {
    const parts = hostname.split(".");
    if (hostname === "127.0.0.1" || hostname === "0.0.0.0") return false;
    if (hostname === "::1" || hostname === "::") return false;
    // 10.x.x.x
    if (parts[0] === "10") return false;
    // 172.16-31.x.x
    if (parts[0] === "172") {
      const second = Number.parseInt(parts[1] ?? "", 10);
      if (second >= 16 && second <= 31) return false;
    }
    // 192.168.x.x
    if (parts[0] === "192" && parts[1] === "168") return false;
    // 169.254.x.x (link-local)
    if (parts[0] === "169" && parts[1] === "254") return false;
    return true;
  }

  // Block common dangerous hostnames
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal" ||
    hostname === "169.254.169.254"
  ) {
    return false;
  }

  return true;
}

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    if (!isSafeUrl(url)) {
      logger.warn({
        message: "image_download_blocked_ssrf",
        scope: "feishu-webhook",
        url,
      });
      return null;
    }

    const resp = await fetch(url, {
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    });

    if (!resp.ok || !resp.body) return null;

    const contentLength = resp.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_IMAGE_BYTES) {
      return null;
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const reader = resp.body.getReader();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_IMAGE_BYTES) {
        reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

export async function uploadImageToFeishu(
  buffer: Buffer,
  tenantToken: string,
): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("image_type", "message");
    form.append("image", new Blob([buffer]), "image.png");

    const resp = await fetch("https://open.feishu.cn/open-apis/im/v1/images", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: form,
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      code: number;
      data?: { image_key?: string };
    };

    if (data.code !== 0 || !data.data?.image_key) return null;
    return data.data.image_key;
  } catch {
    return null;
  }
}

export async function uploadFileToFeishu(
  buffer: Buffer,
  fileName: string,
  tenantToken: string,
): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("file_type", "stream");
    form.append("file_name", fileName);
    form.append("file", new Blob([buffer]), fileName);

    const resp = await fetch("https://open.feishu.cn/open-apis/im/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: form,
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      code: number;
      data?: { file_key?: string };
    };

    if (data.code !== 0 || !data.data?.file_key) return null;
    return data.data.file_key;
  } catch {
    return null;
  }
}

export async function sendFeishuCardMessage(
  card: Record<string, unknown>,
  chatId: string,
  tenantToken: string,
): Promise<string | null> {
  try {
    const resp = await fetch(
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: "interactive",
          content: JSON.stringify(card),
        }),
      },
    );

    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      code: number;
      data?: { message_id?: string };
    };

    if (data.code !== 0) return null;
    return data.data?.message_id ?? null;
  } catch {
    return null;
  }
}

export async function sendFeishuImageMessage(
  imageKey: string,
  chatId: string,
  tenantToken: string,
  replyMessageId?: string,
): Promise<boolean> {
  try {
    const content = JSON.stringify({ image_key: imageKey });
    const url = replyMessageId
      ? `https://open.feishu.cn/open-apis/im/v1/messages/${replyMessageId}/reply`
      : "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id";

    const reqBody = replyMessageId
      ? { msg_type: "image", content }
      : { receive_id: chatId, msg_type: "image", content };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
    });

    if (!resp.ok) return false;
    const data = (await resp.json()) as { code: number };
    return data.code === 0;
  } catch {
    return false;
  }
}

export async function sendFeishuFileMessage(
  fileKey: string,
  chatId: string,
  tenantToken: string,
  replyMessageId?: string,
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {
      receive_id: chatId,
      msg_type: "file",
      content: JSON.stringify({ file_key: fileKey }),
    };
    if (replyMessageId) {
      body.reply_in_thread = true;
      // Use reply endpoint for thread replies
    }

    const url = replyMessageId
      ? `https://open.feishu.cn/open-apis/im/v1/messages/${replyMessageId}/reply`
      : "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id";

    // Reply endpoint uses different body shape
    const reqBody = replyMessageId
      ? { msg_type: "file", content: JSON.stringify({ file_key: fileKey }) }
      : body;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
    });

    if (!resp.ok) return false;

    const data = (await resp.json()) as { code: number };
    return data.code === 0;
  } catch {
    return false;
  }
}

async function processImages(
  imageUrls: string[],
  appId: string,
  appSecret: string,
): Promise<ProcessedImages> {
  const result: ProcessedImages = { embedded: [], linked: [] };

  const tenantToken = await getFeishuTenantToken(appId, appSecret);
  if (!tenantToken) {
    result.linked = imageUrls;
    return result;
  }

  const settled = await Promise.allSettled(
    imageUrls.map(async (url) => {
      const buffer = await downloadImage(url);
      if (!buffer) return { url, imageKey: null };

      const imageKey = await uploadImageToFeishu(buffer, tenantToken);
      return { url, imageKey };
    }),
  );

  settled.forEach((entry, i) => {
    if (entry.status === "fulfilled" && entry.value.imageKey) {
      result.embedded.push(entry.value.imageKey);
    } else {
      const url =
        entry.status === "fulfilled"
          ? entry.value.url
          : (imageUrls[i] ?? "unknown");
      result.linked.push(url);
    }
  });

  return result;
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

function buildCardElements(
  payload: FeedbackPayload,
  images?: ProcessedImages,
): unknown[] {
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

  // Linked images (fallback for oversized / failed uploads)
  if (images && images.linked.length > 0) {
    const links = images.linked
      .map((url) => `[📎 查看图片](${url})`)
      .join("\n");
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: links },
    });
  }

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

/** Send feedback card. Returns message_id if sent via Bot API, or "webhook" if sent via webhook. */
export async function sendFeishuWebhook(
  payload: FeedbackPayload,
): Promise<string | null> {
  let images: ProcessedImages | undefined;
  if (
    payload.imageUrls &&
    payload.imageUrls.length > 0 &&
    payload.feishuAppId &&
    payload.feishuAppSecret
  ) {
    images = await processImages(
      payload.imageUrls,
      payload.feishuAppId,
      payload.feishuAppSecret,
    );

    logger.info({
      message: "feedback_images_processed",
      scope: "feishu-webhook",
      embedded: images.embedded.length,
      linked: images.linked.length,
    });
  } else if (payload.imageUrls && payload.imageUrls.length > 0) {
    images = { embedded: [], linked: payload.imageUrls };
  }

  // Merge pre-uploaded image keys (from imageData / script-based flow)
  if (payload.preUploadedImageKeys && payload.preUploadedImageKeys.length > 0) {
    if (!images) images = { embedded: [], linked: [] };
    images.embedded.push(...payload.preUploadedImageKeys);
  }

  const card = {
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
    elements: buildCardElements(payload, images),
  };

  // Prefer Bot API (returns message_id for file replies)
  const chatId = process.env.FEISHU_FEEDBACK_CHAT_ID;
  if (chatId && payload.feishuAppId && payload.feishuAppSecret) {
    const tenantToken = await getFeishuTenantToken(
      payload.feishuAppId,
      payload.feishuAppSecret,
    );
    if (tenantToken) {
      const messageId = await sendFeishuCardMessage(card, chatId, tenantToken);
      if (messageId) return messageId;
      logger.warn({
        message: "feishu_bot_api_card_failed_fallback_webhook",
        scope: "feishu-webhook",
      });
    }
  }

  // Fallback to webhook
  const webhookUrl = process.env.FEISHU_FEEDBACK_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.warn({
      message: "feishu_feedback_not_configured",
      scope: "feishu-webhook",
    });
    return null;
  }

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msg_type: "interactive", card }),
    });

    if (!resp.ok) {
      logger.warn({
        message: "feishu_feedback_webhook_failed",
        scope: "feishu-webhook",
        status: resp.status,
        statusText: resp.statusText,
      });
      return null;
    }

    return "webhook";
  } catch (error) {
    logger.warn({
      message: "feishu_feedback_webhook_error",
      scope: "feishu-webhook",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
