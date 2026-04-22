# 产品路线图

这里是 nexu 面向用户的公开路线图。

路线图会随版本发布持续更新。如果你有功能建议或优先级上的意见，欢迎在 [GitHub Discussions](https://github.com/nexu-io/nexu/discussions) 告诉我们。

---

## ✅ 已发布

**Windows 正式版**
在 macOS 之外，Windows 10+ 用户现在可以完整使用 nexu，体验与 macOS 版本保持一致。

**微信接入**
通过微信 8.0.7 OpenClaw 插件扫码即连，无需额外配置，手机上就能随时与你的 AI Agent 对话。

**Telegram 和 WhatsApp**
把你的 Agent 接入 Telegram Bot 或 WhatsApp，出海用户和海外团队也能顺畅使用。

**企业微信 / 钉钉 / QQ**
支持国内主流企业 IM 渠道全覆盖，不管团队用什么工具，都可以直接接入。

**MiniMax、Codex、GLM 一键登录**
MiniMax、OpenAI Codex、GLM（Z.AI）支持 OAuth 授权，无需手动填写 API Key，点击即登录。

**Ollama 本地模型**
支持连接本地部署的 Ollama 模型，数据不出本机，满足隐私和安全要求。

**积分与激励体系上线**
支持每日签到、分享获积分、邀请奖励，完成 GitHub Star 或 X 分享等任务也可获得积分奖励。

**系统代理自动识别**
自动读取系统代理配置，无需手动填写，代理环境下开箱即用。

---

## 🚧 进行中

**升级后自动恢复对话历史**（Windows）
Windows 用户升级版本后，之前的对话记录会自动恢复，不再需要手动处理。

**升级后自动恢复已安装的 Skills**（Windows）
升级后，已安装的 Skills 会自动保留，不用每次升级后重新安装。

**渠道连接失败时给出可读提示**
当某个渠道连接失败时，直接显示具体原因，而不是空白页或无法理解的错误码。

**对话名称更直观**
私聊显示联系人姓名，群聊显示群组名称，找到对应对话更快。

**全局快捷键唤起**
支持通过全局快捷键快速唤起 nexu，不用每次切换应用。

**Web 端与桌面端积分保持一致**
修复两端积分显示不一致的问题，余额实时同步。

---

## 📋 规划中

**在 IM 中完成 OAuth 授权**
OAuth 授权流程直接在聊天窗口内完成，无需跳转到浏览器。

**客户端内展示更新内容**
每次升级后，客户端直接展示本次更新了什么，不用手动去查 Release Notes。

**长对话不再卡顿**
对话内容越来越多时，响应速度依然保持流畅。

**邮箱找回密码**
登录页支持通过邮箱找回密码，不用再联系客服。

**消息已读状态跨端同步**
Web 端已读的消息，桌面端也标为已读，多端切换不再看到重复的未读提示。

**自定义附件下载路径**
支持设置文件下载的默认保存位置，不必每次手动选择文件夹。

**断网时全局提示**
网络异常时，界面上直接显示离线状态，不用猜测是不是自己出了什么问题。

**浏览和安装社区 Skills**
可以直接在客户端里发现其他 Agent 的 Skills，安装后马上可用。

**跨 Agent 协作（ACP 协议）**
接入 Agent Communication Protocol，让你的 Agent 和其他 Agent 协同工作。

**Linux 支持**
正在评估可行性，欢迎在 [GitHub Issues](https://github.com/nexu-io/nexu/issues) 告诉我们你的使用场景，帮助我们确定优先级。

---

## 💬 参与反馈

路线图的优先级很大程度上取决于用户的真实需求：

- **提交功能需求** → [GitHub Issues](https://github.com/nexu-io/nexu/issues)
- **参与功能讨论** → [GitHub Discussions](https://github.com/nexu-io/nexu/discussions)
- **关注设计讨论** → [Roadmap & RFCs](https://github.com/nexu-io/nexu/discussions/categories/rfc-roadmap)
- **查看完整更新历史** → [GitHub Releases](https://github.com/nexu-io/nexu/releases)
