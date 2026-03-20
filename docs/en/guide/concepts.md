# Key Concepts

## Agent

The Agent is the core runtime unit in nexu — a persistent AI assistant that connects to multiple chat platforms, understands context, and executes tasks.

You can configure different models, install different skills, and let the Agent serve you and your team across multiple channels. Each workspace runs a single Agent instance.

![nexu Agent home screen](/assets/nexu-home.webp)

## Channels

Channels are where the Agent interacts with users. nexu currently supports three platforms:

- [Feishu](/guide/channels/feishu) — popular with teams in China, only needs App ID and App Secret
- [Slack](/guide/channels/slack) — widely used by international teams, supports one-click app creation via manifest
- [Discord](/guide/channels/discord) — common in developer communities, connects via Bot Token

See [Channel Configuration](/guide/channels) for details.

## Models

Models determine the Agent's reasoning capability and response quality. nexu offers two integration paths:

- **nexu Official** — ready to use with zero configuration, ideal for getting started quickly
- **BYOK (Bring Your Own Key)** — connect your own Anthropic, OpenAI, Google AI, or other OpenAI-compatible provider, ideal for specific model preferences or cost control

Switch models at any time in the client without disrupting existing conversations or channel connections.

![Model configuration page](/assets/nexu-model-select.webp)

See [Model Configuration](/guide/models) for details.

## Skills

Skills are the Agent's extensibility layer. Each Skill is a self-contained module that grants the Agent specific capabilities — data queries, document generation, Feishu spreadsheet operations, third-party service calls, and more.

nexu provides a skill catalog for one-click installation, and also supports local development of custom skills to meet specialized needs.

![Skill catalog](/assets/nexu-skills.webp)

See [Skill Installation](/guide/skills) for details.