# Telegram

只需获取 Bot Token，即可将 Telegram 机器人接入 nexu。

## 第一步：创建 Telegram Bot

1. 打开 Telegram，在搜索栏搜索 **BotFather**，点击「Open」进入对话。

![搜索并打开 BotFather](/assets/telegram/step1-search-botfather.webp)

2. 发送 `/newbot` 命令。

![发送 /newbot](/assets/telegram/step1-newbot.webp)

3. 按提示依次输入：
   - **Bot 名称**（显示名，例如 `nexu_eli`）
   - **Bot 用户名**（必须以 `bot` 结尾，例如 `nexu_elibot`）

4. 创建成功后，BotFather 会返回一条消息，其中包含 **Bot Token**（格式类似 `8549010317:AAEZw-DEou...`）。复制并保存该 Token。

![获取 Bot Token](/assets/telegram/step1-bot-token.webp)

## 第二步：在 nexu 中连接 Telegram

1. 打开 nexu 客户端，在「Choose a channel to get started」区域点击 **Telegram**。

![选择 Telegram 渠道](/assets/telegram/step2-choose-telegram.webp)

2. 在弹出的「连接 Telegram」对话框中，将 Bot Token 粘贴到输入框，点击「连接 Telegram」。

![填入 Bot Token 并连接](/assets/telegram/step2-nexu-connect.webp)

## 第三步：开始对话

连接成功后，在 Telegram 中搜索你的 Bot 用户名，发送 `/start` 开始聊天，即可与你的 OpenClaw Agent 实时交互 🎉

![Telegram 中与 Bot 对话](/assets/telegram/step3-chat.webp)

---

## 常见问题

**Q: 需要公网服务器吗？**

不需要。nexu 使用 Telegram Bot API 的长轮询模式，无需公网 IP 或 Webhook 地址。

**Q: 机器人没有回复消息？**

请确认 Bot Token 填写正确，且 nexu 客户端保持运行状态。

**Q: 可以在群组中使用吗？**

可以。将 Bot 添加到 Telegram 群组后，在消息中 @Bot 用户名即可触发回复。

**Q: 手机和电脑都关了，Agent 还能回复吗？**

需要保持 nexu 客户端运行。只要 nexu 在后台运行（电脑不休眠），Agent 就能 7×24 小时在线回复 Telegram 消息。
