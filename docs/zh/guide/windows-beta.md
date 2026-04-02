# Windows 内测使用指南

如果你正在参与 `nexu` 客户端内测，可以按这篇文档完成安装、登录和体验。

## 适用范围

本次文档主要面向 Windows 内测用户，适用于非 ARM64 的 Windows 设备。

如果你使用的是 Mac ARM64 / Apple Silicon（M 系列）设备，请直接访问 [nexu GitHub 仓库](https://github.com/nexu-io/nexu) 获取正式可用版本。

## Tips

1. 本文档适用于 Windows 内测版本，仅支持非 ARM64 设备。
2. 内测版本功能尚未完成全面验收，可能存在一些缺陷，感谢理解，我们会统一收集反馈并快速跟进。
3. 如果你觉得 `nexu` 做得还不错，欢迎前往 [GitHub 仓库](https://github.com/nexu-io/nexu) 给我们点一个 Star，这是对我们最大的鼓励。
4. 为了支持我们更快迭代，也欢迎把 `nexu` 推荐给身边的朋友，一起点点 Star。

## Windows

### 1. 获取内测安装包

Windows 内测安装包目前仅在内测渠道内发放。

请先扫描下方二维码加入内测问题反馈群，再查看群内置顶消息或对应说明文档获取最新的 Windows 内测安装包。

![内测问题反馈群二维码](/assets/windows-beta/windows-feedback-group-qr.webp)

![Windows 内测安装包示例](/assets/windows-beta/windows-download-installer.webp)

### 2. 运行安装包

下载完成后，双击安装包并按提示完成安装。

**已知问题：首次打开安装包耗时较久**

首次打开安装包时，可能需要等待约 30 秒到 1 分钟，安装界面才会弹出。

这是因为 Windows 内置的应用检测机制会先进行一次较完整的安全扫描。这个等待属于当前已知问题，请耐心等待；我们会在正式版中继续优化这部分体验。

![选择安装范围](/assets/windows-beta/windows-install-options.webp)

![安装进行中](/assets/windows-beta/windows-installing.webp)

![安装完成](/assets/windows-beta/windows-install-finish.webp)

### 3. 体验 `nexu`

安装完成后，打开 `nexu`，推荐按下面的顺序开始体验：

#### 登录 nexu 账号

进入客户端后，使用 `Nexu Official` 登录即可体验免费的高质量官方模型。

如果你还不熟悉登录入口，可以参考 [一分钟快速上手](/zh/guide/quickstart)。

![选择使用 Nexu 账号登录](/assets/windows-beta/windows-login-start.webp)

![登录窗口示例](/assets/windows-beta/windows-login-email.webp)

![账号连接成功](/assets/windows-beta/windows-login-success.webp)

#### 连接飞书机器人

如果你希望在飞书中和 `nexu` 对话，可以继续完成飞书机器人配置。

详细步骤可参考 [飞书渠道配置](/zh/guide/channels/feishu)。

![进入客户端首页并选择渠道](/assets/windows-beta/windows-home-channel.webp)

![连接飞书并填写凭证](/assets/windows-beta/windows-feishu-connect.webp)

![在飞书中体验 nexu](/assets/windows-beta/windows-feishu-chat.webp)

**已知问题：首次启动客户端可能偏慢**

在部分 Windows 设备上，首次打开客户端时也可能出现 30 秒到 1 分钟左右的等待时间。这通常同样与系统安全扫描和首次初始化有关，属于当前内测阶段的已知问题。

## Mac ARM64 / M 芯片

如果你使用的是 Mac ARM64 / M 系列芯片，请前往以下地址获取可用版本：

- [nexu GitHub 仓库](https://github.com/nexu-io/nexu)
- [nexu 下载页面](https://nexu.io/download)

## 内测问题反馈群

如果你在内测过程中遇到安装、登录、渠道配置或功能使用问题，也欢迎继续在内测问题反馈群中反馈，我们会集中收集并尽快跟进。
