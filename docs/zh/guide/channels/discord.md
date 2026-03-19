# Discord

只需获取 Application ID 和 Bot Token，即可将 Discord 机器人接入 nexu。

## 第一步：创建 Discord 应用

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications)，点击「New Application」。

![Discord Applications 页面](/assets/discord/step1-applications.webp)

2. 填写应用名称，点击「Create」。

![创建应用](/assets/discord/step1-create-app.webp)

3. 进入「General Information」页面，复制保存：
   - **Application ID**

![获取 Application ID](/assets/discord/step1-general-info.webp)

4. 在左侧菜单进入「Bot」，点击「Reset Token」生成 Bot Token，复制保存：
   - **Bot Token**

![生成 Bot Token](/assets/discord/step3-bot-token.webp)

## 第二步：在 nexu 中填入凭证

打开 nexu 客户端，在 Discord 渠道配置中填入 App ID 和 Bot Token，点击「Connect」。

![在 nexu 中填入凭证](/assets/discord/step2-nexu-connect.webp)

## 第三步：配置权限并邀请机器人

1. 回到 Discord Developer Portal，在「Bot」页面下方开启以下 Privileged Gateway Intents：
   - **Message Content Intent**

![开启 Message Content Intent](/assets/discord/step4-intents.webp)

2. 在左侧菜单进入「OAuth2」→「URL Generator」，勾选 Scopes：
   - `bot`
   - `applications.commands`

![选择 Scopes](/assets/discord/step5-scopes.webp)

3. 在下方 Bot Permissions 中勾选：
   - `View Channels`
   - `Send Messages`
   - `Read Message History`
   - `Embed Links`
   - `Attach Files`
   - `Add Reactions`
   - `Use External Emojis`
   - `Use External Stickers`

![选择 Bot Permissions](/assets/discord/step5-permissions.webp)

4. 复制页面底部生成的 URL，在浏览器中打开。

![复制生成的 URL](/assets/discord/step5-generated-url.webp)

5. 选择你的服务器，点击「Continue」。

![选择服务器](/assets/discord/step3-select-server.webp)

6. 确认权限列表，点击「Authorize」，授权机器人加入。

![授权机器人](/assets/discord/step3-authorize.webp)

## 第四步：测试

连接成功后，在 nexu 客户端点击「Chat」即可跳转到 Discord 与机器人对话 🎉

![Discord 已连接](/assets/discord/step4-connected.webp)

## 常见问题

**Q: 需要公网服务器吗？**

不需要。nexu 使用 Discord Gateway（WebSocket），无需公网 IP 或回调地址。

**Q: 机器人没有回复消息？**

请确认已开启 Message Content Intent，否则机器人无法读取消息内容。
