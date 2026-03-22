# nexu 适配微信，可以在微信上指挥你的龙虾啦

你的 AI 龙虾申请加入你的微信联系人。

刚刚，微信上线「ClawBot」插件，支持接入 OpenClaw。nexu 已完成适配，欢迎大家前往体验。

> 内测期间，Claude、GPT、Gemini 等顶级模型**全部免费、无限量使用**。

---

## 接入路径

### 第一步：更新微信至 8.0.7

在微信中将版本更新到 **8.0.7**，这是支持 ClawBot 插件的最低版本。

### 第二步：下载 nexu 并接入飞书

打开 nexu（下载地址：[https://nexu.io](https://nexu.io)），按照文档完成飞书渠道配置，让你的 Agent 先跑起来：

👉 [**飞书渠道配置（图文教程）**](https://docs.nexu.io/zh/guide/channels/feishu)

完成后在飞书中给 Agent 发一条消息，确认连通。

### 第三步：输入官方配置代码

在飞书中给 Agent 发送以下消息：

```
npx -y @tencent-weixin/openclaw-weixin-cli@latest install
```

![WeixinClawBot 插件](/assets/wechat/weixinclawbot.webp)

### 第四步：生成二维码并扫码

Agent 执行完成后会生成微信授权二维码，用微信扫码连接。

<!-- ![扫码连接](/assets/wechat/qrcode.png) -->

### 第五步：微信里完成配置

在微信中点击连接，开始和你的微信 ClawBot 对话。

<!-- ![对话截图](/assets/wechat/chat.png) -->

🦞 **部署完成，即在你的好友列表中直接出现！**

---

此外 nexu 已接入飞书、Slack、Discord，欢迎多多体验。

- [nexu 官网 — 下载客户端](https://nexu.io)
- [nexu GitHub — 开源仓库](https://github.com/nexu-io/nexu)
- [加入飞书交流群](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=8b7k7b5b-ac27-4748-9165-78606dc16913)
- [加入 Discord](https://discord.gg/Q6AxCUuMNU)
