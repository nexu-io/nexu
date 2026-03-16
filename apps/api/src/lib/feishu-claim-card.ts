/**
 * Feishu card for prompting unregistered users to bind their account via OAuth.
 *
 * Flow:
 * 1. Unregistered user messages bot → send prompt card with link to bind page
 * 2. User clicks button → opens browser → logs into Nexu → initiates Feishu OAuth
 * 3. OAuth callback creates workspace_membership
 */

/** Prompt card sent to unregistered users: multi_url button to the bind page. */
export function buildFeishuBindPromptCard(bindUrl: string) {
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
            "在使用我之前，请先绑定你的飞书和 Nexu 账号。\n\n点击下方按钮，30 秒即可完成绑定。",
        },
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "去绑定" },
            type: "primary",
            multi_url: {
              url: bindUrl,
              pc_url: bindUrl,
              ios_url: bindUrl,
              android_url: bindUrl,
            },
          },
        ],
      },
    ],
  };
}
