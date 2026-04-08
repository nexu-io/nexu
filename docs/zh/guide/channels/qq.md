# QQ

只需获取 App ID 和 App Secret，即可将 QQ 机器人接入 nexu。

## 第一步：在 nexu 中打开 QQ 渠道

1. 打开 nexu 客户端，在 Channels 区域点击 **QQ**。

![在 nexu 中选择 QQ 渠道](/assets/qq/step3-choose-qq-channel.webp)

2. 打开 QQ 开放平台：https://q.qq.com/qqbot/openclaw/login.html

![从 nexu 弹窗跳转 QQ 开放平台](/assets/qq/step3-open-platform-link.webp)

## 第二步：登录 QQ 开放平台

1. 使用手机 QQ 扫描登录二维码。

![QQ 开放平台登录二维码](/assets/qq/step1-login-qr.webp)

2. 在手机 QQ 上点击「同意」，完成开发者账号登录。

![手机 QQ 确认登录](/assets/qq/step1-login-confirm.webp)

## 第三步：创建 QQ 机器人

1. 登录成功后，在机器人列表区域点击「创建机器人」。

![创建 QQ 机器人](/assets/qq/step1-create-bot.webp)

## 第四步：复制 App ID 和 App Secret

![创建机器人入口](/assets/qq/step2-create-bot.webp)

在机器人详情页复制并保存以下两个参数：

- **App ID**
- **App Secret**

这两个参数只会在创建后完整显示一次，建议立即保存。

## 第五步：在 nexu 中连接 QQ

在 QQ 渠道配置中填入 App ID 和 App Secret，点击「连接 QQ」。

![在 nexu 中连接 QQ](/assets/qq/step3-nexu-connect.webp)

## 第六步：在 QQ 中开始聊天

连接成功后，打开桌面 QQ 或手机 QQ，找到你创建的机器人会话，直接发消息即可开始和 Agent 对话。

![QQ 中与 Agent 对话](/assets/qq/step4-chat.webp)

---

## 常见问题

**Q: 需要自己准备服务器或者公网地址吗？**

不需要。按 nexu 当前接入方式，只需在客户端填入 App ID 和 App Secret 即可完成连接。

**Q: 连接成功后，去哪里找到这个 QQ 机器人？**

打开桌面 QQ 或手机 QQ，搜索你创建机器人时设置的名称，或者在最近会话里查找对应机器人会话。

**Q: 为什么已经连接成功了，机器人还是没有回复？**

优先检查这三项：

- App ID 和 App Secret 是否填写正确
- nexu 客户端是否仍在运行
- 你当前发消息的对象是否就是刚创建的那个机器人

**Q: 电脑关机后，QQ 里的机器人还能继续回复吗？**

nexu 客户端需要保持运行。只要 nexu 在后台运行、电脑没有休眠，机器人就可以持续回复 QQ 消息。

**Q: 可以把机器人拉进 QQ 群里用吗？**

可以。把机器人拉进 QQ 群后，就能在群里和 Agent 互动；建议先在私聊里确认连接正常，再拉群使用。
