# 飞书

本页结合 OpenClaw 的渠道能力和 Nexu 当前的飞书接入方式进行说明。

## 你需要准备

- 一个飞书或 Lark 租户
- 一个已开启 Bot 能力的飞书应用
- `App ID` 与 `App Secret`
- 在配置事件订阅前先确保 gateway 已启动

## 接入流程

1. 在飞书开放平台创建企业自建应用。
2. 开启 Bot 能力并授予消息相关权限。
3. 选择接入模式：
   - `websocket`：用户自管机器人，不需要公网回调地址
   - `webhook`：适合 Nexu 官方机器人这类入站 HTTP 流程
4. 将应用凭证录入 Nexu。
5. 启动 gateway。
6. 先发私聊拿到 pairing code，再完成审批。

## 配置示例

```json5
{
  channels: {
    feishu: {
      enabled: true,
      dmPolicy: "pairing",
      accounts: {
        main: {
          appId: "cli_xxx",
          appSecret: "xxx",
          botName: "Nexu Assistant",
        },
      },
    },
  },
}
```

## 群组行为

- 默认群组策略通常为开放，但要求 `@mention`
- 如果只允许指定群组，使用 `groupPolicy: "allowlist"`
- 如果只允许群里部分成员触发消息，使用 `groups.<chat_id>.allowFrom`

## Nexu 特有说明

- 用户自管飞书机器人通常通过 WebSocket 连接，不需要公网 webhook。
- Nexu 官方飞书机器人链路采用 webhook，并在转发前做 claim check。
- 如果使用国际版 Lark，请设置 `domain: "lark"`。

## 验证命令

```bash
openclaw gateway status
openclaw logs --follow
openclaw pairing list feishu
```

上游参考：<https://docs.openclaw.ai/channels/feishu>
