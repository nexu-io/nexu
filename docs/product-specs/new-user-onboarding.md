# New User Onboarding

## Flow

1. **Registration** — User registers with invite code or email/password at `/auth`
2. **Bot creation** — User creates first bot at `/workspace/bot` (name, slug, system prompt, model)
3. **Slack connection** — User clicks "Add to Slack" at `/workspace/channels` → OAuth flow → workspace connected
4. **Confirmation** — Bot channel status shows `connected`, bot is assigned to gateway pool, config version bumped

## Key interactions

| Step | API endpoint | Frontend page |
|------|-------------|---------------|
| Register with invite | `POST /v1/invites/{code}/register` | `/invite` |
| Register with email | `POST /api/auth/sign-up` | `/auth` |
| Create bot | `POST /v1/bots` | `/workspace/bot` |
| Get OAuth URL | `POST /v1/bots/{botId}/channels/slack/oauth-url` | `/workspace/channels` |
| OAuth callback | `POST /api/oauth/slack/callback` | `/workspace/channels/slack/callback` |

## Behind the scenes

- Bot creation auto-assigns to the default gateway pool
- OAuth callback encrypts and stores bot token + signing secret
- Webhook route created for the Slack team_id → pool → bot mapping
- Pool `config_version` incremented → Gateway hot-reloads with new bot

## Acceptance criteria

- [ ] User can register and create a bot in under 2 minutes
- [ ] Slack OAuth completes in a single click after authorization
- [ ] Bot responds to first Slack message within seconds of connection
- [ ] Error states (expired invite, OAuth failure) show clear messages

## Status

Draft — core flow implemented, edge cases need testing.
