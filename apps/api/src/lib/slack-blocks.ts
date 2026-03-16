/**
 * Build Block Kit blocks for the claim card.
 */
export function buildClaimCardBlocks(claimUrl: string): unknown[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":wave: *Welcome to Nexu!*\n\nI'm your AI-powered workspace assistant. To get started, set up your personal Nexu account.",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Setting up takes less than 30 seconds — just click below to create your account and start using Nexu right away.",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Set Up My Nexu Account" },
          url: claimUrl,
          style: "primary",
          action_id: "claim_nexu_account",
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: ":lock: This link is unique to you. Only you can see this message.",
        },
      ],
    },
  ];
}
