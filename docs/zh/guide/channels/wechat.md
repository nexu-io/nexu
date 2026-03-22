# 微信

点击「Connect」，微信扫码，即可将微信接入 nexu。无需额外配置。

## 前置条件

将微信更新至 **8.0.7** 或更高版本。这是支持 ClawBot 插件的最低版本。

## 第一步：在 nexu 中点击连接

打开 nexu 客户端，在微信渠道配置中点击「Connect」。

nexu 会自动安装微信官方 ClawBot 插件（`@tencent-weixin/openclaw-weixin-cli`），无需手动操作。

<!-- ![点击 Connect](/assets/wechat/step1-nexu-connect.webp) -->

## 第二步：微信扫码授权

插件安装完成后，nexu 会弹出一个微信授权二维码。

1. 打开手机上的**微信**。
2. 扫描屏幕上的二维码。
3. 在手机上点击**确认连接**。

<!-- ![扫码授权](/assets/wechat/step2-scan-qrcode.webp) -->

## 第三步：开始对话

连接成功后，在 nexu 客户端点击「Chat」即可跳转到微信与 ClawBot 对话 🎉

<!-- ![微信已连接](/assets/wechat/step3-connected.webp) -->

## 常见问题

**Q: 需要公网服务器吗？**

不需要。nexu 通过微信 ClawBot 插件直连，无需公网 IP 或回调地址。

**Q: 需要企业微信或公众号吗？**

不需要。微信 8.0.7 原生支持 ClawBot 插件，个人微信即可使用。

**Q: 会不会被封号？**

不会。ClawBot 是微信官方推出的插件，完全合规。
