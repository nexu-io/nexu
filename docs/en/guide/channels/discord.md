# Discord

Discord works well for direct messages and server channels through the official bot API.

## What you need

- A Discord application with a bot
- A bot token
- Developer Mode enabled so you can copy user, server, and channel IDs
- Privileged intents enabled, especially Message Content Intent

## Setup flow

1. Create a Discord application and bot in the Developer Portal.
2. Enable Message Content Intent.
3. Invite the bot with `bot` and `applications.commands` scopes.
4. Store the token securely and connect it to Nexu.
5. Start the gateway.
6. DM the bot, receive a pairing code, and approve it.

## Example config

```json5
{
  channels: {
    discord: {
      enabled: true,
      token: {
        source: "env",
        provider: "default",
        id: "DISCORD_BOT_TOKEN",
      },
    },
  },
}
```

## Recommended server policy

- Start with `groupPolicy: "allowlist"`
- Add your private server under `guilds`
- Keep `requireMention: true` at first
- Turn `requireMention` off only after you confirm the server is private and trusted

## Verify

```bash
openclaw doctor
openclaw channels status --probe
openclaw pairing list discord
```

Reference source: <https://docs.openclaw.ai/channels/discord>
