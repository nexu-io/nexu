# RFC 0001 — Simplify Feishu channel onboarding to scan-to-connect

| Field       | Value                          |
| ----------- | ------------------------------ |
| Status      | Draft                          |
| Author(s)   | @qiongyu1999                   |
| Created     | 2026-03-23                     |
| Discussion  | [#359](https://github.com/nexu-io/nexu/discussions/359) |

## Motivation

The current Feishu onboarding flow requires five manual steps on the Feishu Open Platform:

1. Create an enterprise custom app and copy App ID / App Secret.
2. Paste credentials into the nexu client.
3. Bulk-import ~102 permission scopes via a JSON blob.
4. Subscribe to four events and one callback, switching to WebSocket mode for each.
5. Create a version, submit for review, and wait for approval.

This is significantly more complex than the WeChat flow. WeChat already supports OpenClaw plugin integration — users click connect, scan a QR code with WeChat, and they're done. Feishu users frequently make mistakes at the permission and event steps, leading to support requests and drop-off.

**Goal:** Bring the Feishu experience to parity with WeChat — scan to connect, no manual Open Platform configuration.

## Non-goals

- Removing the existing "advanced / self-hosted app" path — power users and enterprises with strict policies should still be able to bring their own Feishu app.
- Changing how other channels (WeChat, Slack, Discord) connect.

## Proposal

### Integrate with Feishu OpenClaw plugin (same model as WeChat)

nexu already supports WeChat via the OpenClaw plugin: the user clicks "Connect" in the nexu client, scans a QR code with WeChat, and the channel is live. The proposal is to **replicate this exact pattern for Feishu** by integrating with the Feishu OpenClaw plugin.

The user experience would be:

1. Open nexu → click "Connect Feishu"
2. Scan the QR code with Feishu (or click a link on desktop Feishu)
3. Authorize → done

No App ID, no App Secret, no permission JSON, no event subscription, no version publishing.

**Pros:**
- Consistent UX across WeChat and Feishu — both are scan-to-connect.
- No Feishu Open Platform configuration required from the user.
- No nexu-hosted Feishu app to maintain or get reviewed.
- Proven pattern — already working for WeChat.

**Cons / open questions:**
- Depends on Feishu OpenClaw plugin availability and feature completeness.
- Skill capabilities (docs, calendar, sheets, etc.) may differ from the current self-hosted app approach if the plugin exposes a different permission surface.

### Keep current flow as "Advanced" path

The existing five-step manual flow remains available for users who need full control over their Feishu app (custom permissions, enterprise policies, etc.). In the UI and docs, this is collapsed under an "Advanced" section.

## Alternatives considered

- **nexu-hosted Feishu marketplace app (OAuth):** nexu publishes a pre-configured app; users authorize it into their tenant. Rejected in favor of the OpenClaw plugin approach because it adds maintenance burden (Feishu review cycles, scope updates) and raises data-path perception questions.
- **Auto-configure via Feishu management API:** nexu programmatically creates the app in the user's tenant. Rejected because API coverage is uncertain and engineering cost is higher than the plugin approach.
- **Do nothing:** Keep the five-step manual flow. Rejected because it is the #1 source of onboarding friction for Feishu users.

## Migration & compatibility

- Existing users who already configured a self-hosted Feishu app are unaffected; their credentials remain in the local database.
- The "Advanced" (self-hosted app) path stays available and documented.
- New users default to the OpenClaw plugin path; switching to a self-hosted app later is a supported operation.

## Risks & open questions

1. **Feishu OpenClaw plugin status** — Is the plugin publicly available? What is its current feature set compared to a full self-hosted Feishu app?
2. **Skill coverage** — The current self-hosted app grants ~102 scopes (IM, docs, calendar, sheets, etc.). Does the OpenClaw plugin support the same breadth, or will some Skills be unavailable via this path?
3. **Enterprise restrictions** — Some Feishu tenants may restrict plugin installation. How do we handle that gracefully (fall back to Advanced path)?
4. **Desktop Feishu** — WeChat scan works because mobile WeChat is ubiquitous. For Feishu, many users are on desktop — do we also support a click-to-authorize flow alongside QR scan?

## Next steps

- [ ] Investigate Feishu OpenClaw plugin availability, API surface, and permission model.
- [ ] Prototype the scan-to-connect flow with a minimal integration.
- [ ] Compare Skill coverage between plugin path and current self-hosted app path.
- [ ] Update this RFC with findings and a final recommendation.
