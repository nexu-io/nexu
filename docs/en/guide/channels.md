# Channel Configuration

Nexu supports multiple chat channels at the same time. For this documentation set, the core channel guides are:

- [Feishu](/guide/channels/feishu)
- [Slack](/guide/channels/slack)
- [Discord](/guide/channels/discord)

## Recommended setup order

1. Create the channel app or bot in the upstream platform.
2. Collect credentials and keep them out of logs, screenshots, and commits.
3. Add the channel in Nexu or write the equivalent config.
4. Start the gateway and validate message delivery.
5. Approve pairing or allowlist the target users/groups.

## Notes

- The OpenClaw channel reference is the baseline for channel behavior: <https://docs.openclaw.ai/channels>
- Nexu uses OpenClaw under the hood, so the channel concepts map directly to gateway configuration.
- Feishu in Nexu commonly uses either a user-managed WebSocket bot or the Nexu official webhook flow.
- Slack and Discord are usually configured through bot credentials and then fine-tuned with channel policies.
