# Key Concepts

## Agent

The Agent is the core runtime unit in nexu — a persistent AI assistant that connects to multiple chat platforms, understands context, and executes tasks.

Each workspace runs a single Agent instance.

## Channels

Channels are where the Agent interacts with users. nexu supports Feishu, Slack, and Discord. Enter the required credentials and the connection is live.

A single Agent can serve multiple channels simultaneously, with messages handled independently per platform.

## Models

Models determine the Agent's reasoning capability. nexu offers two integration paths:

- **nexu Official** — ready to use, zero configuration
- **BYOK** — connect your own Anthropic, OpenAI, Google AI, or compatible provider

Switch models at any time without disrupting existing conversations.

## Skills

Skills are the Agent's extensibility layer. Each Skill is a self-contained module that grants the Agent specific capabilities — data queries, document generation, third-party service calls, and more.

Install from the catalog in one click, or develop locally.

## Deployments

nexu uses a local desktop deployment model. Launch the client, connect your channels, and the Agent is immediately operational.

No additional servers or container orchestration required.

## Workspace

The Workspace is the top-level organizational unit in nexu, binding together the Agent, channels, models, and skills. One Workspace equals one complete runtime environment.
