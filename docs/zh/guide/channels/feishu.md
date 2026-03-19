# 飞书

只需获取 App ID 和 App Secret，即可将飞书机器人接入 nexu。

## 第一步：创建飞书应用

1. 打开 [飞书开放平台](https://open.feishu.cn/app)，登录你的飞书账号，点击「创建企业自建应用」。

![飞书开放平台应用列表](/assets/feishu/step1-app-list.webp)

2. 填写应用名称、描述，选择图标，点击「创建」。

![创建企业自建应用](/assets/feishu/step1-create-app.webp)

3. 进入「凭证与基础信息」页面，复制以下两个参数：
   - **App ID**
   - **App Secret**

![获取 App ID 和 App Secret](/assets/feishu/step1-credentials.webp)

## 第二步：在 nexu 中填入凭证

打开 nexu 客户端，在飞书渠道配置中填入 App ID 和 App Secret，点击「Connect」。

![在 nexu 中填入凭证](/assets/feishu/step3-nexu-connect.webp)

## 第三步：发布应用并测试

1. 回到飞书开放平台，进入「版本管理与发布」。

![版本管理与发布](/assets/feishu/step4-version-manage.webp)

2. 点击「创建版本」，填写版本号和更新说明，点击「保存」。

![创建版本](/assets/feishu/step4-create-version.webp)

3. 点击「确认发布」，等待审核通过。

![确认发布](/assets/feishu/step4-publish.webp)

4. 等待审核通过后，在 nexu 客户端点击「Chat」即可跳转到飞书与机器人对话 🎉

![飞书已连接](/assets/feishu/step3-connected.webp)

## 常见问题

**Q: 需要公网服务器吗？**

不需要。nexu 使用飞书长连接（WebSocket）模式，无需公网 IP 或回调地址。

**Q: 需要手动配置权限吗？**

不需要。nexu 会自动处理所需权限，你只需提供 App ID 和 App Secret。

