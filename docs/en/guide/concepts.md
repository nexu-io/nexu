# Key Concepts

## Agent

The Agent is the core runtime unit in nexu: a persistent AI assistant that connects to multiple chat platforms, understands context, and executes tasks.

You can configure different models, install different skills, and let the Agent serve you and your team across multiple channels. Each workspace runs one Agent instance.

![nexu Agent home screen](/assets/nexu-home.webp)

## Channels

Channels are where the Agent interacts with users. nexu currently supports several mainstream platforms:

- [Feishu](/guide/channels/feishu) — a common choice for teams in China, requiring only App ID and App Secret
- [Slack](/guide/channels/slack) — popular with global teams, with manifest-based setup
- [Discord](/guide/channels/discord) — commonly used in developer communities, connected through a Bot Token

See [Channel Configuration](/guide/channels) for details.

## Models

Models determine the Agent's reasoning quality and response capability. nexu supports two integration paths:

- **Nexu Official** — ready to use with no API key required, ideal for getting started quickly
- **BYOK (Bring Your Own Key)** — connect your own Anthropic, OpenAI, Google AI, or other OpenAI-compatible provider

You can switch models in the client at any time without affecting existing conversations or channel connections.

![Model configuration screen](/assets/nexu-model-select.webp)

See [Model Configuration](/guide/models) for details.

## Skills

Skills are the Agent's extensibility system. Each skill is a standalone module that gives the Agent specific capabilities, such as data querying, document generation, spreadsheet operations, or third-party API calls.

nexu provides a skill catalog for one-click installation and also supports local custom skill development for advanced workflows.

![Skill catalog](/assets/nexu-skills.webp)

See [Skill Installation](/guide/skills) for details.
