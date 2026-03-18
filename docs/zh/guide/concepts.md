# 核心概念

了解这些核心概念，帮助你更好地使用 nexu。

## Agent

nexu 中的 Agent 是一个 AI 驱动的助手，它连接到你的聊天平台，使用语言模型理解和回复消息，并利用技能执行任务。每个 nexu 工作区运行一个 Agent，可以同时连接多个渠道。

## 渠道（Channels）

渠道是 Agent 所在的聊天平台。nexu 目前支持：

- **飞书** — 使用 WebSocket 长连接，无需公网服务器
- **Slack** — 通过 Events API 连接，支持预配置 manifest 一键创建
- **Discord** — 通过 Discord Gateway（WebSocket）连接

每个渠道需要平台特定的凭证（Token、Secret 等），在 nexu 客户端中填入即可。

## 模型（Models）

模型是 Agent 背后的 AI 大脑。nexu 支持两种模式：

- **nexu 官方** — 托管访问，无需 API Key，最快的上手方式
- **BYOK（自带密钥）** — 连接你自己的服务商（Anthropic、OpenAI、Google AI，或任何 OpenAI 兼容端点）

你可以随时在 nexu 客户端中切换模型。

## 技能（Skills）

技能扩展了 Agent 在基础对话之外的能力。它们是基于文件的模块，从 `.openclaw/skills/` 加载，赋予 Agent 专业能力——从查询数据库到生成报告。

技能可以从 nexu 目录安装，也可以在本地创建。

## 部署（Deployments）

部署是 Agent 的运行实例。当你启动 nexu 并连接渠道后，Agent 就已部署就绪，可以接收消息。nexu 桌面客户端自动处理部署——无需管理服务器或基础设施。

## 工作区（Workspace）

工作区是你的 nexu 环境，它把 Agent、连接的渠道、配置的模型和安装的技能关联在一起。你在 nexu 客户端中配置的一切都属于你的工作区。
