# 核心概念

## Agent

Agent 是 nexu 的核心运行单元——一个持续在线的 AI 助手，能够同时接入多个聊天平台，理解上下文并执行任务。

你可以为 Agent 配置不同的模型、安装不同的技能，让它在多个渠道中为你和你的团队服务。每个工作区对应一个 Agent 实例。

![nexu Agent 主界面](/assets/nexu-home.webp)

## 渠道（Channels）

渠道是 Agent 与用户交互的入口。nexu 目前支持三个主流平台：

- [飞书](/zh/guide/channels/feishu) — 国内团队首选，只需 App ID 和 App Secret
- [Slack](/zh/guide/channels/slack) — 海外团队常用，支持 manifest 一键创建应用
- [Discord](/zh/guide/channels/discord) — 开发者社区常用，通过 Bot Token 接入

详见 [渠道配置](/zh/guide/channels)。

## 模型（Models）

模型决定了 Agent 的推理能力和回复质量。nexu 提供两种接入方式：

- **nexu Official** — 开箱即用，无需配置任何 API Key，适合快速体验
- **BYOK（自带密钥）** — 接入你自己的 Anthropic、OpenAI、Google AI 或其他 OpenAI 兼容服务商，适合有特定模型偏好或成本控制需求的用户

支持随时在客户端中切换模型，不影响已有对话和渠道连接。

![模型配置页面](/assets/nexu-model-select.webp)

详见 [模型配置](/zh/guide/models)。

## 技能（Skills）

技能是 Agent 的能力扩展机制。每个技能是一个独立模块，赋予 Agent 特定的执行能力——数据查询、文档生成、飞书多维表格操作、第三方服务调用等。

nexu 提供技能目录，支持一键安装；同时也支持本地开发自定义技能，满足个性化需求。

![技能目录](/assets/nexu-skills.webp)

详见 [技能安装](/zh/guide/skills)。