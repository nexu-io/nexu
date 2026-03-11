/**
 * Build a Feishu interactive card for claim/registration flow.
 * Sent as a DM to unregistered users who message the bot.
 */
export function buildFeishuClaimCard(claimUrl: string) {
  return {
    header: {
      title: { tag: "plain_text", content: "👋 绑定你的 Nexu 账号" },
      template: "turquoise",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content:
            "Hey！在回复你之前，需要先绑定一下你的 Nexu 账号。\n\n只需 30 秒，绑定后我就能记住你的偏好，提供个性化服务。",
        },
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "绑定账号" },
            type: "primary",
            multi_url: {
              url: claimUrl,
              pc_url: claimUrl,
              ios_url: claimUrl,
              android_url: claimUrl,
            },
          },
        ],
      },
    ],
  };
}
