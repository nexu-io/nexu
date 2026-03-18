# Discord

Discord 通过官方 Bot API 接入，适合私聊和服务器频道两种场景。

## 你需要准备

- 一个带 Bot 的 Discord Application
- 一个 Bot Token
- 打开 Developer Mode，方便复制用户、服务器、频道 ID
- 开启 Message Content Intent 等必要 intents

## 接入流程

1. 在 Discord Developer Portal 创建应用和 Bot。
2. 开启 Message Content Intent。
3. 使用 `bot` 与 `applications.commands` scope 邀请机器人进服务器。
4. 安全保存 token，并在 Nexu 中配置。
5. 启动 gateway。
6. 私聊机器人获取 pairing code 并批准。

## 配置示例

```json5
{
  channels: {
    discord: {
      enabled: true,
      token: {
        source: "env",
        provider: "default",
        id: "DISCORD_BOT_TOKEN",
      },
    },
  },
}
```

## 推荐服务器策略

- 先使用 `groupPolicy: "allowlist"`
- 在 `guilds` 中加入你的私有服务器
- 初期保持 `requireMention: true`
- 确认服务器是私有且可信后，再考虑关闭 `requireMention`

## 验证命令

```bash
openclaw doctor
openclaw channels status --probe
openclaw pairing list discord
```

上游参考：<https://docs.openclaw.ai/channels/discord>
