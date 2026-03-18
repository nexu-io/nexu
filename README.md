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
  <a href="#overview">Overview</a> · <a href="#why-nexu">Why nexu</a> · <a href="#features">Features</a> · <a href="#getting-started">Getting Started</a> · <a href="#use-cases">Use Cases</a> · <a href="#development">Development</a> · <a href="#contributing">Contributing</a> · <a href="#acknowledgements">Acknowledgements</a> · <a href="#community">Community</a> · <a href="#star-history">Star History</a> · <a href="#license">License</a>
</p>

<p align="center">
  <a href="https://nexu.io" target="_blank" rel="noopener"><strong>Website</strong></a> &nbsp;·&nbsp; English &nbsp;·&nbsp; <a href="README.zh-CN.md">简体中文</a>
</p>

---

## Overview

**nexu** turns OpenClaw into a desktop experience you can start using in seconds ⚡. Download the Mac client, double-click to install, and your first AI agent is ready before you finish reading this paragraph.

Built on the open-source OpenClaw core, nexu bundles **OpenClaw Skills** and **full Feishu Skills** so agents plug directly into the workflows your team already uses 🔌. Access Claude 4.6, ChatGPT 5.4, Minimax 2.5, GLM 5.0, Kimi 2.5, and more via your nexu account—or bring your own API Key with no login required 🔓.

<!-- TODO: Add product demo GIF / screenshot here -->

---

## Why nexu

Open-source agent tools often force users through long install guides and scattered config before they see any value. We believe the first experience should be the opposite.

| Challenge | nexu |
|-----------|------|
| 😩 Complex CLI / env setup | ✅ One double-click install; no terminal required |
| 🧩 Scattered skill integration | ✅ Built-in OpenClaw + full Feishu Skills, ready to use |
| 🔧 Model and API key juggling | ✅ nexu account for top models, or bring your own API Key |
| 🎭 "Demo only" agents | ✅ A desktop client built for real team workflows |
| 🚪 Login walls | ✅ Use your own API Key with zero sign-up |

> Open source should not mean harder to use. It should mean more freedom, more trust, and more leverage for every team.

---

## Features

### 🖱 Double-click install

Download, double-click, start using. No environment variables, no dependency wrestling, no long install docs. nexu's first run is as capable as it gets—ready out of the box.

### 🔗 Built-in OpenClaw Skills + full Feishu Skills

Native OpenClaw Skills and full Feishu Skills ship together. Agents move beyond demos and into the real workflows your team already uses—without extra integration work.

### 🧠 Top-tier models, out of the box

Use Claude 4.6, ChatGPT 5.4, Minimax 2.5, GLM 5.0, Kimi 2.5, and more directly via your nexu account. No extra config. Switch to your own API Key anytime.

### 🔑 Bring your own API Key, no login

Prefer your own model providers? Add your API Key and use the client without creating an account or logging in.

### 👥 Built for teams

Open-source at the core, with a desktop experience that actually runs. Compatible with the tools and model stack your team already trusts.

---

## 🚀 Getting Started

### System requirements

- 🍎 **OS**: macOS 12+ (Apple Silicon)
- 💾 **Storage**: ~500 MB

### Installation

**Pre-built Mac client (recommended)**

1. Go to the [Releases](https://github.com/nexu-io/nexu/releases) page or the [official site](https://nexu.io) 📥
2. Download the Mac installer
3. Launch nexu 🎉

> ⏳ **Windows & macOS Intel**: In development. Email [support@nexu.ai](mailto:support@nexu.ai) for updates.

### First launch

Sign in with your nexu account for instant access to supported models, or add your own API Key and use the client without an account 🔑.

---

## Use Cases

nexu is built for **OPC (One Person Company)** and small teams—one person, one AI team.

### 🛒 Solo e-commerce / cross-border trade

Product research, competitor pricing, listing optimization, multilingual marketing assets—compress a week's work into one afternoon.

### ✍️ Content creators / knowledge bloggers

Trend tracking, topic generation, multi-platform content production, comment engagement—run a content matrix solo.

### 💻 Indie developers

Code review, doc generation, bug analysis, repetitive task automation—your Agent is your pair-programming partner.

### ⚖️ Legal / finance / consulting

Contract review, regulation lookup, report generation, client Q&A—turn domain expertise into Agent skills.

### 🏪 Local business / retail

Inventory management, order follow-up, auto-reply to customer messages, marketing copy—let AI help run the shop.

### 🎨 Design / creative

Requirement breakdown, asset search, copywriting, design annotation—free up creative time, cut repetitive work.

---

## 🛠 Development

### Prerequisites

- **Node.js** 22+ (LTS recommended)
- **Package manager**: pnpm 10+

### Project structure

```
nexu/
├── apps/
│   ├── api/              # Backend API server
│   ├── web/              # Web frontend
│   ├── landing/          # Landing page
│   ├── desktop/          # Mac desktop client (Electron)
│   ├── gateway/          # Gateway service
│   └── router/           # Router service
├── packages/
│   └── shared/           # Shared libraries
├── openclaw-runtime/     # OpenClaw core runtime
├── skills/               # Built-in Skills (local dev & bot)
├── nexu-skills/          # nexu skill definitions
├── deploy/               # Deployment configs (Helm, K8s, Nginx)
├── docs/                 # Documentation & design docs
├── tests/                # Integration & contract tests
├── experiments/          # Experimental scripts
└── specs/                # Specifications
```

### Quick start (from source)

```bash
git clone https://github.com/nexu-io/nexu.git
cd nexu
pnpm install
pnpm run dev
```

### Available commands

```bash
pnpm run dev             # Start API + Web + Landing with hot reload
pnpm run dev:desktop     # Start desktop client
pnpm run dev:sidecar     # Start gateway sidecar
pnpm run build           # Production build (all packages)
pnpm run lint            # Run linter (Biome + typecheck)
pnpm test                # Run tests (Vitest)
```

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. 🍴 Fork this repo
2. 🌿 Create a feature branch (`git checkout -b feature/amazing-feature`)
3. 💾 Commit your changes (`git commit -m 'Add amazing feature'`)
4. 📤 Push to the branch (`git push origin feature/amazing-feature`)
5. 🔀 Open a Pull Request

### Guidelines

- Follow the existing code style (ESLint + Prettier)
- Write tests for new functionality
- Update documentation as needed
- Keep commits atomic and descriptive

---

## 🙏 Acknowledgements

nexu is built on the shoulders of excellent open-source projects:

- [OpenClaw](https://github.com/nexu-io/nexu) — The AI agent runtime
- [Electron](https://www.electronjs.org/) — Cross-platform desktop framework
- [React](https://react.dev/) — UI component library
- [Tailwind CSS](https://tailwindcss.com/) — Utility-first CSS framework

---

---

## 💬 Community

| Feishu Group | Discord |
|:---:|:---:|
| <img src="site/media/feishu-qr.png" width="200" /> | <img src="site/media/discord-qr.png" width="200" /> |
| [Join Feishu Group](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=8b7k7b5b-ac27-4748-9165-78606dc16913) | [Join Discord](https://discord.gg/nexu) |

- 💡 [GitHub Discussions](https://github.com/nexu-io/nexu/discussions) — Q&A and discussion
- 🐛 [GitHub Issues](https://github.com/nexu-io/nexu/issues) — Bug reports and feature ideas
- 📧 Email: [support@nexu.ai](mailto:support@nexu.ai)

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

## 📄 License

This project is open source under the [MIT License](LICENSE).

---

<p align="center">Built with ❤️ by the nexu Team</p>
