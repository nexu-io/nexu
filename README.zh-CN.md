<p align="center">
  <img src="site/media/nexu-logo.svg" width="120" alt="nexu Logo" />
</p>

<h1 align="center">nexu</h1>

<p align="center">
  <strong>The Simplest OpenClaw Desktop for OPC</strong>
</p>

<p align="center">
  <a href="https://github.com/nexu-io/nexu/releases"><img src="https://img.shields.io/badge/release-v0.1.0-blue" alt="Release" /></a>
  <a href="https://github.com/nexu-io/nexu/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
</p>

<p align="center">
  <a href="#概述">概述</a> · <a href="#为什么选择-nexu">为什么选择 nexu</a> · <a href="#核心特性">核心特性</a> · <a href="#快速开始">快速开始</a> · <a href="#使用场景">使用场景</a> · <a href="#开发">开发</a> · <a href="#贡献">贡献</a> · <a href="#致谢">致谢</a> · <a href="#社区">社区</a> · <a href="#star-history">Star History</a> · <a href="#许可证">许可证</a>
</p>

<p align="center">
  <a href="https://nexu.io" target="_blank" rel="noopener"><strong>官网</strong></a> &nbsp;·&nbsp; <a href="README.md">English</a> &nbsp;·&nbsp; 简体中文
</p>

---

## 概述

**nexu** 将 OpenClaw 变成一个桌面体验 ⚡——下载 Mac 客户端，双击安装，几秒钟内你的第一个 AI Agent 就已就绪。

基于开源 OpenClaw 核心打造，nexu 预装 **OpenClaw Skills** 与 **完整飞书 Skills**，让 Agent 直接接入你团队已在用的工作流 🔌。通过 nexu 账号即可使用 Claude 4.6、ChatGPT 5.4、Minimax 2.5、GLM 5.0、Kimi 2.5 等顶级模型，也可使用自带 API Key，无需登录 🔓。

<!-- TODO: 添加产品 Demo GIF / 截图 -->

---

## 为什么选择 nexu

很多开源 Agent 工具在让用户看到价值之前，先要面对冗长安装和零散配置。我们认为第一体验应该反过来。

| 常见问题 | nexu |
|----------|------|
| 😩 复杂的 CLI / 环境配置 | ✅ 双击安装，无需终端 |
| 🧩 技能与集成东拼西凑 | ✅ 内置 OpenClaw + 完整飞书 Skills，开箱即用 |
| 🔧 模型与 API Key 配置 | ✅ nexu 账号直连顶级模型，或自带 API Key |
| 🎭 Agent 只能"演示" | ✅ 面向真实团队工作流的桌面客户端 |
| 🚪 必须注册才能用 | ✅ 自带 API Key 即可使用，零注册零登录 |

> 开源不应该意味着更难用，而应该意味着更多自由、更多信任、更高的团队杠杆。

---

## 核心特性

### 🖱 双击安装

下载、双击、开始使用。无需环境变量、无需折腾依赖、无需长文档。nexu 的首次体验与能力一致——开箱即用。

### 🔗 内置 OpenClaw Skills + 完整飞书 Skills

原生 OpenClaw Skills 与完整飞书 Skills 一并提供。Agent 不再停留在演示，而是直接进入团队真实工作流，无需额外集成。

### 🧠 顶级模型，开箱即用

通过 nexu 账号直接使用 Claude 4.6、ChatGPT 5.4、Minimax 2.5、GLM 5.0、Kimi 2.5 等模型，无需额外配置。也可随时切换为自带 API Key。

### 🔑 支持自带 API Key，无需登录

更倾向自己的模型服务？填入 API Key 即可使用，无需注册、无需登录。

### 👥 为团队而生

核心开源，同时提供真正可用的桌面体验，兼容团队已有的工具与模型栈。

---

## 🚀 快速开始

### 系统要求

- 🍎 **系统**: macOS 12+（Apple Silicon）
- 💾 **磁盘**: 约 500 MB

### 安装

**推荐：直接下载 Mac 客户端**

1. 打开 [官网](https://nexu.io) 或 [Releases](https://github.com/nexu-io/nexu/releases) 📥
2. 下载 Mac 安装包
3. 启动 nexu 🎉

> ⏳ **Windows 与 macOS Intel**：开发中。如需进展可邮件 [support@nexu.ai](mailto:support@nexu.ai)。

### 首次启动

使用 nexu 账号登录，立即使用已支持的模型；也可添加自带 API Key，无需账号即可使用 🔑。

---

## 使用场景

nexu 面向 **OPC（One Person Company）** 与小团队，让一个人就能拥有一支 AI 团队。

### 🛒 一人电商 / 跨境电商

选品调研、竞品比价、商品标题优化、多语言营销素材生成——从一周压缩到一个下午。

### ✍️ 知识博主 / 自媒体

热点追踪、选题生成、多平台内容批量产出、评论区互动——一个人运营矩阵账号。

### 💻 独立开发者

代码审查、文档生成、Bug 分析、重复任务自动化——Agent 就是你的结对编程搭档。

### ⚖️ 法律 / 财税 / 咨询

合同审阅、法规检索、报表生成、客户问答——把专业知识变成 Agent 的技能。

### 🏪 门店 / 本地商家

库存管理、订单跟进、客户消息自动回复、营销文案生成——让 AI 帮你看店。

### 🎨 设计 / 创意

需求拆解、素材检索、文案撰写、设计稿标注——释放创意时间，减少重复劳动。

---

## 🛠 开发

### 前置条件

- **Node.js** 22+（推荐 LTS）
- **包管理器**: pnpm 10+

### 项目结构

```
nexu/
├── apps/
│   ├── api/              # 后端 API 服务
│   ├── web/              # Web 前端
│   ├── landing/          # 落地页
│   ├── desktop/          # Mac 桌面客户端（Electron）
│   ├── gateway/          # 网关服务
│   └── router/           # 路由服务
├── packages/
│   └── shared/           # 共享库
├── openclaw-runtime/     # OpenClaw 核心运行时
├── skills/               # 内置 Skills（本地开发 & Bot）
├── nexu-skills/          # nexu Skill 定义
├── deploy/               # 部署配置（Helm、K8s、Nginx）
├── docs/                 # 文档 & 设计文档
├── tests/                # 集成测试 & 契约测试
├── experiments/          # 实验脚本
└── specs/                # 规格说明
```

### 从源码运行

```bash
git clone https://github.com/nexu-io/nexu.git
cd nexu
pnpm install
pnpm run dev
```

### 常用命令

```bash
pnpm run dev             # 启动 API + Web + Landing（热重载）
pnpm run dev:desktop     # 启动桌面客户端
pnpm run dev:sidecar     # 启动网关 Sidecar
pnpm run build           # 生产构建（所有包）
pnpm run lint            # 运行 Linter（Biome + 类型检查）
pnpm test                # 运行测试（Vitest）
```

---

## 🤝 贡献

欢迎贡献！参与方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

1. 🍴 Fork 本仓库
2. 🌿 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 💾 提交改动（`git commit -m 'Add amazing feature'`）
4. 📤 推送到分支（`git push origin feature/amazing-feature`）
5. 🔀 提交 Pull Request

### 规范

- 遵循现有代码风格（ESLint + Prettier）
- 为新功能编写测试
- 按需更新文档
- 保持提交原子化且描述清晰

---

## 🙏 致谢

nexu 基于以下优秀开源项目构建：

- [OpenClaw](https://github.com/nexu-io/nexu) — AI Agent 运行时
- [Electron](https://www.electronjs.org/) — 跨平台桌面框架
- [React](https://react.dev/) — UI 组件库
- [Tailwind CSS](https://tailwindcss.com/) — 实用优先的 CSS 框架

---

---

## 💬 社区

| 飞书群 | Discord |
|:---:|:---:|
| <img src="site/media/feishu-qr.png" width="200" /> | <img src="site/media/discord-qr.png" width="200" /> |
| [加入飞书群](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=8b7k7b5b-ac27-4748-9165-78606dc16913) | [加入 Discord](https://discord.gg/nexu) |

- 💡 [GitHub Discussions](https://github.com/nexu-io/nexu/discussions) — 提问与讨论
- 🐛 [GitHub Issues](https://github.com/nexu-io/nexu/issues) — Bug 反馈与功能建议
- 📧 邮件：[support@nexu.ai](mailto:support@nexu.ai)

---

## ⭐ Star History

<a href="https://star-history.com/#nexu-io/nexu&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=nexu-io/nexu&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=nexu-io/nexu&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=nexu-io/nexu&type=Date" />
 </picture>
</a>

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源。

---

<p align="center">Built with ❤️ by the nexu Team</p>
