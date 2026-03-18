# 渠道配置

Nexu 可以同时接入多个聊天渠道。当前这套文档重点覆盖：

- [飞书](/zh/guide/channels/feishu)
- [Slack](/zh/guide/channels/slack)
- [Discord](/zh/guide/channels/discord)

## 推荐接入顺序

1. 先在上游平台创建应用或机器人。
2. 收集凭证，并避免出现在日志、截图和代码仓库中。
3. 在 Nexu 中添加渠道，或写入等价配置。
4. 启动 gateway，确认收发消息正常。
5. 完成 pairing 或配置 allowlist。

## 说明

- OpenClaw 的渠道文档是这里的基础参考：<https://docs.openclaw.ai/channels>
- Nexu 底层依赖 OpenClaw，因此渠道概念和 gateway 配置基本一一对应。
- 在 Nexu 中，飞书通常分为用户自管的 WebSocket 机器人和官方 webhook 流程两类。
- Slack 和 Discord 一般以机器人凭证接入，再通过策略配置细化权限范围。
