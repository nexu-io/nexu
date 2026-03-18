# Feishu

This guide combines the OpenClaw channel model with Nexu's Feishu integration patterns.

## What you need

- A Feishu or Lark tenant
- A Feishu app with Bot capability enabled
- `App ID` and `App Secret`
- The gateway running before you finalize event subscription

## Setup flow

1. Create an enterprise app in the Feishu Open Platform.
2. Enable the bot capability and grant message permissions.
3. Choose a transport mode:
   - `websocket` for a user-managed bot with no public webhook URL
   - `webhook` for the official Nexu-style inbound HTTP flow
4. Add the app credentials to Nexu.
5. Start the gateway.
6. Send a DM to receive a pairing code, then approve it.

## Example config

```json5
{
  channels: {
    feishu: {
      enabled: true,
      dmPolicy: "pairing",
      accounts: {
        main: {
          appId: "cli_xxx",
          appSecret: "xxx",
          botName: "Nexu Assistant",
        },
      },
    },
  },
}
```

## Group behavior

- Default group behavior is open with `requireMention: true`
- Use `groupPolicy: "allowlist"` when you want to restrict specific group chats
- Use `groups.<chat_id>.allowFrom` when only selected senders should be processed in a group

## Nexu-specific notes

- User-managed bots normally connect through WebSocket, so no public callback URL is required.
- The official Nexu bot path uses webhook mode and performs a claim check before forwarding messages.
- For Lark tenants, set `domain: "lark"`.

## Verify

```bash
openclaw gateway status
openclaw logs --follow
openclaw pairing list feishu
```

For deeper upstream reference, see the OpenClaw Feishu docs: <https://docs.openclaw.ai/channels/feishu>
