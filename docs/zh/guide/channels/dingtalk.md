# 钉钉

只需获取 Client ID 和 Client Secret，即可将钉钉机器人接入 nexu。

## 第一步：在 nexu 中打开钉钉渠道

1. 打开 nexu 客户端，在 Channels 区域点击 **钉钉**。

![在 nexu 中选择钉钉渠道](/assets/dingtalk/step7-choose-dingtalk-channel.webp)

2. 打开钉钉开发者平台：https://open.dingtalk.com/

![从 nexu 弹窗跳转钉钉开放平台](/assets/dingtalk/step7-open-platform-link.webp)

## 第二步：登录钉钉开发者平台

1. 使用钉钉 App 扫码登录。

![钉钉开发者平台扫码登录](/assets/dingtalk/step1-login-qr.webp)

## 第三步：创建钉钉应用

1. 登录成功后，先进入开发平台首页的应用开发流程页，点击「创建应用」。

![开发首页中的创建应用入口](/assets/dingtalk/step2-home-create-entry.webp)

2. 进入「应用开发」页面，在钉钉应用列表右上角点击「创建应用」。

![创建钉钉应用入口](/assets/dingtalk/step2-create-app.webp)

3. 填写应用名称、应用描述并上传图标，然后点击「保存」。

![填写应用名称和描述](/assets/dingtalk/step2-fill-app-info.webp)

## 第四步：为应用添加机器人能力

1. 进入应用详情页，打开左侧「添加应用能力」，在「机器人」卡片中点击「添加」。

![添加机器人能力](/assets/dingtalk/step3-add-bot-capability.webp)

2. 进入左侧「机器人」页面，打开「机器人配置」开关。

![开启机器人配置](/assets/dingtalk/step3-enable-bot.webp)

3. 按页面提示完善机器人名称、简介、头像、多语言信息和消息接收模式，然后点击底部「发布」。

![填写机器人配置并发布](/assets/dingtalk/step3-bot-config-form.webp)

## 第五步：开通所需权限

进入左侧「权限管理」，按页面提示申请 nexu 需要的接口权限。

如果你希望获得更流畅的 AI 对话体验，推荐额外开通以下 AI Card 相关权限：

- **Card.Instance.Write** - AI Card 写入权限
- **Card.Streaming.Write** - AI Card 流式输出权限

💡 说明：

- 开启 AI Card 后，AI 回复会像 ChatGPT 一样逐字显示
- 如果未开启，系统会使用普通文本消息，仍可正常对话

下面示例展示了开通 `Card.Instance.Write` 权限的页面：

![开通卡片相关权限](/assets/dingtalk/step4-permission-card-write.webp)

## 第六步：复制 Client ID 和 Client Secret

回到「凭证与基础信息」页面，复制并保存以下两个参数：

- **Client ID**
- **Client Secret**

![复制 Client ID 和 Client Secret](/assets/dingtalk/step5-copy-credentials.webp)

## 第七步：创建并发布版本

1. 进入左侧「版本管理与发布」，在空白的版本列表页点击右上角「创建新版本」。

![打开版本管理与发布页面](/assets/dingtalk/step6-version-list.webp)

2. 点击后进入版本详情页，填写版本号和版本描述，设置应用可见范围并保存。

![创建新版本](/assets/dingtalk/step6-create-version.webp)

3. 保存后按钉钉平台流程完成发布，使机器人能力正式生效。

## 第八步：在 nexu 中连接钉钉

1. 在钉钉渠道配置中填入 Client ID 和 Client Secret，点击「连接钉钉」。

![在 nexu 中连接钉钉](/assets/dingtalk/step7-nexu-connect.webp)

2. 连接成功后，打开钉钉即可与机器人开始对话。

![钉钉中与机器人正常对话](/assets/dingtalk/step8-chat-success.webp)

---

## 常见问题

**Q: 只创建应用还不够，为什么还不能用？**

钉钉应用通常还需要补充机器人能力、权限以及版本发布。少任何一步，都可能导致机器人无法正常工作。

**Q: 需要公网服务器吗？**

按 nexu 当前接入方式，通常不需要你自己额外准备公网回调服务，完成应用配置并填入凭证即可。

**Q: 发布后成员看不到应用怎么办？**

检查版本发布时设置的可见范围，确认已经把自己或目标部门加入可见范围。

**Q: 机器人没有回复怎么办？**

优先检查 Client ID / Client Secret 是否正确，其次确认机器人能力已启用、权限已开通、版本已发布，同时确保 nexu 客户端正在运行。
