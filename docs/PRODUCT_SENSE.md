# Product Sense

## Core model

One user = one bot = one OpenClaw agent = one Slack account (botToken).

Users create a bot, configure its persona (system prompt, model), connect it to a Slack workspace via OAuth, and the bot responds to messages autonomously. Multiple users' bots run in a single Gateway process with complete isolation through OpenClaw's native bindings routing.

## Target user

Developers and teams who want a custom AI assistant in their Slack workspace without managing infrastructure. Nexu handles Gateway pools, config generation, credential storage, and hot-reload.

## Product flows

- **Onboarding:** Register (invite code or email) → create bot → configure persona → connect Slack → bot responds
- **Day-to-day:** Bot receives Slack messages → processes via OpenClaw agent → responds in Slack
- **Management:** Update bot config (prompt, model) → config regenerated → Gateway hot-reloads without downtime

## Multi-tenant isolation

Isolation is achieved through OpenClaw's native architecture:
- Each bot maps to exactly one agent in the OpenClaw config
- Each Slack connection maps to one account in the config
- Bindings route messages from a specific account to its assigned agent
- No shared state between bots — different system prompts, models, and credentials

## Cross-cutting product principles

- Connecting a Slack workspace should be a single OAuth click
- Bot changes should take effect without restarts (hot-reload)
- Credentials are never visible to users after initial connection
- The system should scale by adding Gateway pool capacity, not by changing the product model

Detailed specs in `docs/product-specs/`.
