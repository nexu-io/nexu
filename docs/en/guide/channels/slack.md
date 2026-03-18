# Slack

Slack is production-ready in OpenClaw for DMs and channels, and Nexu inherits the same setup model.

## What you need

- A Slack app
- A bot token `xoxb-...`
- Either:
  - an app token `xapp-...` for Socket Mode, or
  - a signing secret for HTTP Events API mode

## Recommended mode

Use Socket Mode unless you have a strong reason to receive events over HTTP.

## Socket Mode checklist

1. Create the Slack app.
2. Enable Socket Mode.
3. Create an app token with `connections:write`.
4. Install the app and copy the bot token.
5. Subscribe to message and mention events.
6. Enable App Home messages for DMs.
7. Start the gateway.

## Example config

```json5
{
  channels: {
    slack: {
      enabled: true,
      mode: "socket",
      appToken: "xapp-...",
      botToken: "xoxb-...",
    },
  },
}
```

## Common policy settings

- `dmPolicy`: `pairing`, `allowlist`, `open`, or `disabled`
- `groupPolicy`: `open`, `allowlist`, or `disabled`
- `channels.slack.channels`: stable Slack channel IDs for allowlists
- `requireMention`: keep it on for shared channels, turn it off only in trusted spaces

## Verify

```bash
openclaw channels status --probe
openclaw logs --follow
openclaw pairing list slack
```

Reference source: <https://docs.openclaw.ai/channels/slack>
