/**
 * Builds platform-specific authorization text for Composio toolkit OAuth.
 *
 * Each platform gets a plain text string in its native markdown format.
 * The AI model replies with it directly as its text response.
 */

interface ToolkitInfo {
  slug: string;
  displayName: string;
  description: string;
  domain: string;
}

export interface AuthCardPayloads {
  slack: string;
  discord: string;
  feishu: string;
}

function buildSlackText(toolkit: ToolkitInfo, connectUrl: string): string {
  // Slack mrkdwn: *bold*, <url|text> for clickable links
  return `:link: *${toolkit.displayName}* \u00b7 OAuth 2.0\n${toolkit.description}\n\n:point_right: <${connectUrl}|Connect Link>\n\n_nexu uses OAuth 2.0 \u00b7 Your credentials are never stored_`;
}

function buildDiscordText(toolkit: ToolkitInfo, connectUrl: string): string {
  return `:link: **${toolkit.displayName}** \u00b7 OAuth 2.0\n${toolkit.description}\n\n:point_right: **[Connect Link](${connectUrl})**\n\n_nexu uses OAuth 2.0 \u00b7 Your credentials are never stored_`;
}

function buildFeishuText(toolkit: ToolkitInfo, connectUrl: string): string {
  // The markdown table triggers OpenClaw's shouldUseCard() regex:
  //   /\|.+\|[\r\n]+\|[-:| ]+\|/
  // which causes sendMarkdownCardFeishu() to render an interactive card.
  return `**${toolkit.displayName}** \u00b7 OAuth 2.0

${toolkit.description}

| Action | |
|--------|---|
| [Connect Link](${connectUrl}) | Authorize access |

_nexu uses OAuth 2.0 \u00b7 Your credentials are never stored_`;
}

export function buildAuthCards(
  toolkit: ToolkitInfo,
  connectUrl: string,
): AuthCardPayloads {
  return {
    slack: buildSlackText(toolkit, connectUrl),
    discord: buildDiscordText(toolkit, connectUrl),
    feishu: buildFeishuText(toolkit, connectUrl),
  };
}
