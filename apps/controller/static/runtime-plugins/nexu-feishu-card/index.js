/**
 * Nexu Feishu Card Plugin
 *
 * Registers tools for building and sending Feishu interactive cards.
 * The send tool calls back to the Nexu controller API, which handles the actual Feishu API call.
 */

const CONTROLLER_PORT = process.env.NEXU_CONTROLLER_PORT || "50800";
const CONTROLLER_HOST = process.env.NEXU_CONTROLLER_HOST || "127.0.0.1";

function json(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

const plainTextSchema = {
  type: "object",
  properties: {
    tag: {
      type: "string",
      const: "plain_text",
    },
    content: {
      type: "string",
    },
  },
  required: ["tag", "content"],
};

const buttonSchema = {
  type: "object",
  properties: {
    tag: {
      type: "string",
      const: "button",
    },
    text: plainTextSchema,
    type: {
      type: "string",
      enum: ["primary", "default"],
    },
    value: {
      type: "string",
    },
  },
  required: ["tag", "text", "type", "value"],
};

const textElementSchema = {
  type: "object",
  properties: {
    tag: {
      type: "string",
      enum: ["markdown", "plain_text"],
    },
    content: {
      type: "string",
    },
  },
  required: ["tag", "content"],
};

const dividerSchema = {
  type: "object",
  properties: {
    tag: {
      type: "string",
      const: "divider",
    },
  },
  required: ["tag"],
};

const actionElementSchema = {
  type: "object",
  properties: {
    tag: {
      type: "string",
      const: "action",
    },
    actions: {
      type: "array",
      items: buttonSchema,
    },
  },
  required: ["tag", "actions"],
};

const cardElementSchema = {
  anyOf: [textElementSchema, actionElementSchema, dividerSchema],
};

const cardSchema = {
  type: "object",
  properties: {
    header: {
      type: "object",
      description: "卡片头部（可选）",
      properties: {
        title: {
          ...plainTextSchema,
          description: "标题",
        },
        template: {
          type: "string",
          enum: ["grey", "red", "orange", "yellow", "green", "blue", "purple", "default"],
          description: "卡片头部颜色模板",
        },
      },
    },
    elements: {
      type: "array",
      description: "卡片元素数组",
      items: cardElementSchema,
    },
  },
  required: ["elements"],
};

const sendFeishuCardParameters = {
  type: "object",
  properties: {
    card: {
      description: "卡片内容对象",
      ...cardSchema,
    },
    to: {
      type: "string",
      description: "接收者 ID。飞书当前会话中可省略，系统会自动推断。",
    },
    receive_id_type: {
      type: "string",
      enum: ["open_id", "chat_id", "user_id", "union_id", "email"],
      description: "接收者 ID 类型。飞书当前会话中可自动推断。",
    },
  },
  required: ["card"],
};

const buildFeishuCardParameters = {
  type: "object",
  properties: {
    header_title: {
      type: "string",
      description: "卡片头部标题",
    },
    header_template: {
      type: "string",
      enum: ["grey", "red", "orange", "yellow", "green", "blue", "purple", "default"],
      description: "卡片头部颜色模板",
    },
    elements: {
      type: "array",
      description: "卡片元素数组",
      items: cardElementSchema,
    },
  },
};

const updateFeishuCardParameters = {
  type: "object",
  properties: {
    message_id: {
      type: "string",
      description: "要更新的原始飞书卡片消息 ID，通常来自 send_feishu_card 的返回结果。",
    },
    card: {
      description: "更新后的卡片内容对象。常用于把按钮替换为已完成状态。",
      ...cardSchema,
    },
  },
  required: ["message_id", "card"],
};

const buildFeishuButtonParameters = {
  type: "object",
  properties: {
    text: {
      type: "string",
      description: "按钮显示文字",
    },
    value: {
      type: "string",
      description: "点击按钮后发送的消息内容",
    },
    type: {
      type: "string",
      enum: ["primary", "default"],
      description: "按钮类型",
      default: "default",
    },
  },
  required: ["text", "value"],
};

const buildFeishuTextParameters = {
  type: "object",
  properties: {
    content: {
      type: "string",
      description: "文本内容",
    },
    is_markdown: {
      type: "boolean",
      description: "是否使用 markdown 格式",
      default: true,
    },
  },
  required: ["content"],
};

const buildFeishuDividerParameters = {
  type: "object",
  properties: {},
};

/**
 * Build a Feishu card payload with the given options.
 */
function buildCard(card) {
  return {
    config: {
      wide_screen_mode: true,
    },
    header: card.header || {},
    elements: card.elements || [],
  };
}

function extractAgentId(sessionKey) {
  if (typeof sessionKey !== "string") {
    return null;
  }
  const match = sessionKey.match(/^agent:([^:]+):/);
  return match ? match[1] : null;
}

function inferFeishuTarget(sessionKey) {
  if (typeof sessionKey !== "string") {
    return {};
  }

  const dmMatch = sessionKey.match(/:feishu:dm:([^:]+)/);
  if (dmMatch) {
    return {
      to: dmMatch[1],
      receiveIdType: "open_id",
    };
  }

  const groupMatch = sessionKey.match(/:feishu:group:([^:]+)/);
  if (groupMatch) {
    return {
      to: groupMatch[1],
      receiveIdType: "chat_id",
    };
  }

  return {};
}

function isFeishuToolContext(ctx) {
  if (!ctx || typeof ctx !== "object") {
    return false;
  }

  if (ctx.messageChannel === "feishu") {
    return true;
  }

  return typeof ctx.sessionKey === "string" && ctx.sessionKey.includes(":feishu:");
}

function onlyInFeishuSession(factory) {
  return (ctx) => {
    if (!isFeishuToolContext(ctx)) {
      return null;
    }
    return factory(ctx);
  };
}

/**
 * Send Feishu card via controller API.
 */
async function sendCardViaController(botId, card, to, receiveIdType) {
  const url = `http://${CONTROLLER_HOST}:${CONTROLLER_PORT}/api/internal/channels/feishu/send-card`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      botId,
      card,
      to,
      receiveIdType,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Controller API error ${response.status}: ${errorText}`);
  }

  return await response.json();
}

async function updateCardViaController(botId, messageId, card) {
  const url = `http://${CONTROLLER_HOST}:${CONTROLLER_PORT}/api/internal/channels/feishu/update-card`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      botId,
      messageId,
      card,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Controller API error ${response.status}: ${errorText}`);
  }

  return await response.json();
}

const plugin = {
  id: "nexu-feishu-card",
  name: "Nexu Feishu Card",
  description: "发送飞书交互卡片给用户，支持按钮选择等交互元素。",
  register(api) {
    api.registerTool(
      onlyInFeishuSession((ctx) => {
        const agentId = extractAgentId(ctx?.sessionKey);
        const inferredTarget = inferFeishuTarget(ctx?.sessionKey);

        return {
          name: "send_feishu_card",
          description: `发送飞书交互卡片给用户。适用于：当需要向用户提出明确的选择（如方案A/B/C、操作选项、确认按钮等）时使用。

卡片支持按钮交互，用户点击按钮后会将按钮的值作为消息发送给机器人，机器人的对话上下文会包含按钮的值。

如果这是一次性选择流程，请记住返回的 messageId，并在用户点击后调用 update_feishu_card，把原卡片替换为“已选择”或禁用态，避免重复点击。
当前工具只负责发送/更新卡片，不直接提供飞书原生回调 toast。

参数说明：
- card: 卡片内容对象，包含 header（可选）和 elements（元素数组）
- to: 接收者的 ID。飞书当前会话中可省略，系统会自动推断。
- receive_id_type: 接收者 ID 类型。飞书当前会话中可自动推断。`,
          parameters: sendFeishuCardParameters,
          async execute(_toolCallId, params) {
            try {
              if (!agentId) {
                return json({
                  success: false,
                  error: "无法从当前 sessionKey 解析 bot ID",
                });
              }

              const to = params.to || inferredTarget.to;
              if (!to) {
                return json({
                  success: false,
                  error: "无法获取接收者 ID，请提供 to 参数或在飞书会话中调用该工具",
                });
              }

              const receiveIdType =
                params.receive_id_type || inferredTarget.receiveIdType || "open_id";
              const card = buildCard(params.card);
              const result = await sendCardViaController(agentId, card, to, receiveIdType);

              if (result?.messageId) {
                return json({
                  success: true,
                  messageId: result.messageId,
                  message: "卡片发送成功",
                });
              }

              return json({
                success: false,
                error: "卡片发送失败，未获取到消息 ID",
                details: result,
              });
            } catch (error) {
              return json({
                success: false,
                error: `发送失败: ${error instanceof Error ? error.message : String(error)}`,
              });
            }
          },
        };
      }),
      { name: "send_feishu_card" },
    );

    api.registerTool(
      onlyInFeishuSession((ctx) => {
        const agentId = extractAgentId(ctx?.sessionKey);

        return {
          name: "update_feishu_card",
          description: `更新一条已发送的飞书卡片。

适用于一次性选择场景：先调用 send_feishu_card 发送按钮卡片，拿到 messageId；用户点击后，再调用本工具把原卡片替换为“已选择”确认态或无按钮版本。`,
          parameters: updateFeishuCardParameters,
          async execute(_toolCallId, params) {
            try {
              if (!agentId) {
                return json({
                  success: false,
                  error: "无法从当前 sessionKey 解析 bot ID",
                });
              }

              const result = await updateCardViaController(
                agentId,
                params.message_id,
                buildCard(params.card),
              );

              if (result?.ok) {
                return json({
                  success: true,
                  message: "卡片更新成功",
                });
              }

              return json({
                success: false,
                error: "卡片更新失败",
                details: result,
              });
            } catch (error) {
              return json({
                success: false,
                error: `更新失败: ${error instanceof Error ? error.message : String(error)}`,
              });
            }
          },
        };
      }),
      { name: "update_feishu_card" },
    );

    api.registerTool(
      onlyInFeishuSession(() => ({
        name: "build_feishu_card",
        description: `构建飞书卡片内容。此工具用于构造卡片对象，不会发送卡片。

用于准备卡片内容，然后再用 send_feishu_card 发送。
如果用户完成了一次性选择，也可以把返回结果交给 update_feishu_card 去替换原卡片。

卡片元素类型：
- text: 文本段落（tag: "plain_text" 或 "markdown"）
- button: 按钮（点击后会将 value 作为消息发送给机器人）
- divider: 分隔线`,
        parameters: buildFeishuCardParameters,
        async execute(_toolCallId, params) {
          const card = {
            config: {
              wide_screen_mode: true,
            },
            elements: params.elements || [],
          };

          if (params.header_title) {
            card.header = {
              title: {
                tag: "plain_text",
                content: params.header_title,
              },
              template: params.header_template || "default",
            };
          }

          return json({
            card,
            usage_tip: "将返回的 card 对象传递给 send_feishu_card 工具来发送卡片",
          });
        },
      })),
      { name: "build_feishu_card" },
    );

    api.registerTool(
      onlyInFeishuSession(() => ({
        name: "build_feishu_button",
        description: "构建飞书卡片按钮元素",
        parameters: buildFeishuButtonParameters,
        async execute(_toolCallId, params) {
          return json({
            tag: "action",
            actions: [
              {
                tag: "button",
                text: {
                  tag: "plain_text",
                  content: params.text,
                },
                type: params.type || "default",
                value: params.value,
              },
            ],
          });
        },
      })),
      { name: "build_feishu_button" },
    );

    api.registerTool(
      onlyInFeishuSession(() => ({
        name: "build_feishu_text",
        description: "构建飞书卡片文本元素",
        parameters: buildFeishuTextParameters,
        async execute(_toolCallId, params) {
          const isMarkdown = params.is_markdown !== false;
          return json({
            tag: isMarkdown ? "markdown" : "plain_text",
            content: params.content,
          });
        },
      })),
      { name: "build_feishu_text" },
    );

    api.registerTool(
      onlyInFeishuSession(() => ({
        name: "build_feishu_divider",
        description: "构建飞书卡片分隔线元素",
        parameters: buildFeishuDividerParameters,
        async execute() {
          return json({
            tag: "divider",
          });
        },
      })),
      { name: "build_feishu_divider" },
    );
  },
};

export default plugin;
