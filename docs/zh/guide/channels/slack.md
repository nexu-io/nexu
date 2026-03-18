# Slack

OpenClaw 已经完整支持 Slack 的私聊和频道模式，Nexu 继承同样的接入思路。

## 你需要准备

- 一个 Slack App
- 一个 `xoxb-...` 格式的 Bot Token
- 以及以下两者之一：
  - Socket Mode 使用的 `xapp-...` App Token
  - HTTP Events API 使用的 Signing Secret

## 推荐模式

除非你必须走 HTTP 事件回调，否则优先使用 Socket Mode。

## Socket Mode 检查清单

1. 创建 Slack App。
2. 开启 Socket Mode。
3. 创建带 `connections:write` 权限的 App Token。
4. 安装应用并复制 Bot Token。
5. 订阅消息与 mention 事件。
6. 为私聊开启 App Home messages。
7. 启动 gateway。

## 配置示例

```json5
{
  channels: {
    slack: {
      enabled: true,
      mode: "socket",
      appToken: "xapp-...",
      botToken: "xoxb-...",
    },
  },
}
```

## 常用策略项

- `dmPolicy`：`pairing`、`allowlist`、`open`、`disabled`
- `groupPolicy`：`open`、`allowlist`、`disabled`
- `channels.slack.channels`：使用稳定的 channel ID 做 allowlist
- `requireMention`：共享频道建议保持开启，只在可信频道关闭

## 验证命令

```bash
openclaw channels status --probe
openclaw logs --follow
openclaw pairing list slack
```

上游参考：<https://docs.openclaw.ai/channels/slack>
