# Key Concepts

Understanding these core concepts will help you get the most out of nexu.

## Agent

An Agent in nexu is an AI-powered assistant that connects to your chat platforms, uses language models to understand and respond, and leverages skills to perform tasks. Each nexu workspace runs one Agent that can be connected to multiple channels simultaneously.

## Channels

Channels are the chat platforms where your Agent lives. nexu currently supports:

- **Feishu** — uses WebSocket long-connection, no public server needed
- **Slack** — connects via Events API with pre-configured manifest
- **Discord** — connects via Discord Gateway (WebSocket)

Each channel requires platform-specific credentials (tokens, secrets, etc.) that you enter in the nexu client.

## Models

Models are the AI brains behind your Agent. nexu supports two modes:

- **nexu Official** — managed access with no API key needed, fastest way to get started
- **BYOK (Bring Your Own Key)** — connect your own provider (Anthropic, OpenAI, Google AI, or any OpenAI-compatible endpoint)

You can switch models anytime from the nexu client.

## Skills

Skills extend what your Agent can do beyond basic conversation. They are file-based modules loaded from `.openclaw/skills/` that give your Agent specialized capabilities — from querying databases to generating reports.

Skills can be installed from the nexu catalog or created locally.

## Deployments

A Deployment is a running instance of your Agent. When you launch nexu and connect your channels, your Agent is deployed and ready to receive messages. The nexu desktop app handles deployment automatically — no servers or infrastructure to manage.

## Workspace

A Workspace is your nexu environment that ties together your Agent, connected channels, configured models, and installed skills. Everything you configure in the nexu client belongs to your workspace.
