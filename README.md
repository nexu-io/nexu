<p align="center">
  <img src="site/media/readme-hero.png" width="100%" alt="nexu" />
</p>

<h1 align="center">nexu</h1>

<p align="center">
  <strong>The simplest open-source OpenClaw 🦞 desktop client for WeChat & Feishu</strong>
</p>

<p align="center">
  <a href="https://github.com/nexu-io/nexu/releases"><img src="https://img.shields.io/github/v/release/nexu-io/nexu?color=blue" alt="Release" /></a>
  <a href="https://github.com/nexu-io/nexu/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
  <a href="https://github.com/nexu-io/nexu/stargazers"><img src="https://img.shields.io/github/stars/nexu-io/nexu?style=social" alt="Stars" /></a>
</p>

<p align="center">
  <a href="https://nexu.io" target="_blank" rel="noopener"><strong>🌐 Website</strong></a> &nbsp;·&nbsp;
  <a href="https://docs.nexu.io" target="_blank" rel="noopener"><strong>📖 Docs</strong></a> &nbsp;·&nbsp;
  <a href="https://github.com/nexu-io/nexu/discussions"><strong>💬 Discussions</strong></a> &nbsp;·&nbsp;
  <a href="https://github.com/nexu-io/nexu/issues"><strong>🐛 Issues</strong></a> &nbsp;·&nbsp;
  <a href="https://x.com/nexudotio" target="_blank" rel="noopener"><strong>𝕏 Twitter</strong></a>
</p>

<p align="center">
  English &nbsp;·&nbsp; <a href="README.zh-CN.md">简体中文</a> &nbsp;·&nbsp; <a href="README.ja.md">日本語</a>
</p>

---

> 🦞 **The smoothest way to connect OpenClaw to WeChat**: Scan, connect, and go.
>
> 🖥 **Supported platforms**: macOS (Apple Silicon) · macOS (Intel) · Windows — [Downloads](https://powerformer.feishu.cn/wiki/IWQZwt1qSiExq7kfioWcI1qVnFf)
>
> 🎉 **Beta Perk**: During the beta period, top-tier models like Gemini and more are **free to use**. [Download and try now →](https://nexu.io)

---

## 📋 What is nexu?

**nexu** (next to you) is an open-source desktop client that runs your **OpenClaw 🦞** Agent directly inside WeChat, Feishu, Slack, Discord, and other IM channels.

WeChat + OpenClaw supported — works with WeChat 8.0.7 OpenClaw plugin. Click connect, scan with WeChat, and start chatting with your AI Agent.

Download and go — graphical setup, built-in Feishu Skills, multi-model support (Gemini and more), and bring your own API Key.

Once connected to IM, your Agent is online 24/7 — chat from your phone anytime, anywhere.

All data stays on your machine. Your privacy, fully in your control.

<h3 align="center">🎬 Product Demo</h3>

<p align="center">
  <video src="https://github.com/user-attachments/assets/d7a801e4-6d0c-40f2-aa0c-d28fd78fdcaa" width="100%" autoplay loop muted playsinline>
    Your browser does not support video playback. <a href="https://github.com/user-attachments/assets/d7a801e4-6d0c-40f2-aa0c-d28fd78fdcaa">Download the video</a> to watch.
  </video>
</p>

---

## 📊 Difference from other solutions

| | OpenClaw (official) | Typical hosted Feishu + agent stacks | **nexu** ✅ |
|---|---|---|---|
| **🧠 Models** | BYO, but manual config required ⚠️ | Platform-locked, no switching ❌ | **Pick Gemini, etc. — one-click switch in GUI; MiniMax / Codex / GLM support OAuth** ✅ |
| **📡 Data path** | Local | Routed through vendor servers, data out of your control ❌ | **Local-first; we don't host your business data** ✅ |
| **💰 Cost** | Free, but self-deploy required ⚠️ | Subscription / per-seat pricing ❌ | **Client is free; pay providers via your own API keys** ✅ |
| **📜 Source** | Open source | Closed source, no audit possible ❌ | **MIT — fork and audit** ✅ |
| **🔗 Channels** | DIY integration required ⚠️ | Varies by vendor, often limited ❌ | **Built-in WeChat, Feishu, Slack, Discord — works out of the box** ✅ |
| **🖥 Interface** | CLI, requires technical skills ❌ | Varies by vendor | **Pure GUI, no CLI needed, double-click to start** ✅ |

---

## Features

### 🖱 Double-click install

Download, double-click, start using. No environment variables, no dependency wrestling, no long install docs. nexu's first run is as capable as it gets—ready out of the box.

### 🔗 Built-in OpenClaw 🦞 Skills + full Feishu Skills

Native OpenClaw 🦞 Skills and full Feishu Skills ship together. Agents move beyond demos and into the real workflows your team already uses—without extra integration work.

### 🧠 Top-tier models, out of the box

Use Gemini and more directly via your nexu account. No extra config. Switch to your own API Key anytime.

### 🔐 OAuth login, no key needed

MiniMax, OpenAI Codex, and GLM (Z.AI Coding Plan) support OAuth login—authorize with one click, no need to copy-paste API keys.

### 🔑 Bring your own API Key, no login

Prefer your own model providers? Add your API Key and use the client without creating an account or logging in.

### 📱 IM-connected, mobile-ready

Connect to WeChat, Feishu, Slack, or Discord and your AI agent is instantly available on your phone. No extra app—just open WeChat or your team chat and start talking to your agent on the go.

### 👥 Built for teams

Open-source at the core, with a desktop experience that actually runs. Compatible with the tools and model stack your team already trusts.

---

## Use cases

nexu is built for **One Person Company** and small teams—one person, one AI team.

### 🛒 Solo e-commerce / cross-border trade

> *"I used to spend the whole weekend writing listings in 3 languages. Now I tell my Agent the product specs in Feishu, and by the time I finish my coffee, the listings are ready for Amazon, Shopee, and TikTok Shop."*

Product research, competitor pricing, listing optimization, multilingual marketing assets—compress a week's work into one afternoon.

### ✍️ Content creators / knowledge bloggers

> *"Monday morning: I ask my Agent in Slack for this week's trending topics. By lunch, I have 5 draft posts across Xiaohongshu, WeChat, and Twitter—each in the right tone for the platform."*

Trend tracking, topic generation, multi-platform content production, comment engagement—run a content matrix solo.

### 💻 Indie developers

> *"3 AM bug hunt? I paste the stack trace into Discord, my Agent traces it to a race condition, suggests a fix, and even drafts the PR description. Pair programming that never sleeps."*

Code review, doc generation, bug analysis, repetitive task automation—your Agent is your pair-programming partner.

### ⚖️ Legal / finance / consulting

> *"A client sends a 40-page contract on Feishu. I forward it to my Agent—10 minutes later I get a risk summary, flagged clauses, and suggested revisions. What used to take half a day now takes a coffee break."*

Contract review, regulation lookup, report generation, client Q&A—turn domain expertise into Agent skills.

### 🏪 Local business / retail

> *"Customers message me at midnight asking 'is this in stock?' My Agent in Feishu auto-replies with real-time inventory, handles returns, and even sends a promo coupon. I actually sleep now."*

Inventory management, order follow-up, auto-reply to customer messages, marketing copy—let AI help run the shop.

### 🎨 Design / creative

> *"I drop a rough brief in Slack: 'landing page for a pet food brand, playful vibe.' My Agent comes back with copy options, color palette suggestions, and reference images—all before the kickoff meeting."*

Requirement breakdown, asset search, copywriting, design annotation—free up creative time, cut repetitive work.

---

## 🚀 Getting started

### System requirements

- 🍎 **macOS**: macOS 12+ (Apple Silicon & Intel)
- 🪟 **Windows**: Windows 10+
- 💾 **Storage**: ~500 MB

### Installation

**Pre-built client (recommended)**

| Platform | Download |
|----------|----------|
| 🍎 macOS (Apple Silicon) | [Official site](https://nexu.io) · [Releases](https://github.com/nexu-io/nexu/releases) |
| 🍎 macOS (Intel) | [Download](https://powerformer.feishu.cn/wiki/IWQZwt1qSiExq7kfioWcI1qVnFf) |
| 🪟 Windows | [Download](https://powerformer.feishu.cn/wiki/IWQZwt1qSiExq7kfioWcI1qVnFf) |

### First launch

Sign in with your nexu account for instant access to supported models, or add your own API Key and use the client without an account 🔑.

---

## 🛠 Development

### Prerequisites

- **Node.js** 22+ (LTS recommended)
- **pnpm** 10+

### Repository layout (excerpt)

```
nexu/
├── apps/
│   ├── api/              # Backend API
│   ├── web/              # Web frontend
│   ├── desktop/          # Desktop client (Electron)
│   └── controller/       # Controller service
├── packages/shared/      # Shared libraries
├── docs/
├── tests/
└── specs/
```

### Commands

```bash
pnpm run dev             # Dev stack with hot reload
pnpm run dev:desktop     # Desktop client
pnpm run build           # Production build
pnpm run lint
pnpm test
```

---

## 🤝 Contributing

Contributions are welcome! The full English guide is [CONTRIBUTING.md](CONTRIBUTING.md) at the repo root (what GitHub shows when you open a PR). The same content is published at [docs.nexu.io — Contributing](https://docs.nexu.io/guide/contributing). **Chinese:** [docs.nexu.io (zh)](https://docs.nexu.io/zh/guide/contributing) · [docs/zh/guide/contributing.md](docs/zh/guide/contributing.md).

1. 🍴 Fork this repo
2. 🌿 Create a feature branch (`git checkout -b feature/amazing-feature`)
3. 💾 Commit your changes (`git commit -m 'Add amazing feature'`)
4. 📤 Push to the branch (`git push origin feature/amazing-feature`)
5. 🔀 Open a Pull Request

### Guidelines

- Follow the existing code style (Biome; run `pnpm lint`)
- Write tests for new functionality
- Update documentation as needed
- Keep commits atomic and descriptive

---

## ❓ FAQ

**Q: Is nexu free?**
A: The client is completely free and open-source (MIT). Multiple top-tier models are built in for you to use, and you can also bring your own API Key.

**Q: Which operating systems are supported?**
A: macOS 12+ (Apple Silicon & Intel) and Windows 10+ are supported.

**Q: Which IM platforms are supported?**
A: WeChat, Feishu, Slack, and Discord are built in and work out of the box.

**Q: Is my data safe?**
A: All data stays on your machine. nexu does not host your business data. The source code is open for audit.

**Q: Can I use my own API Key?**
A: Yes. Add your API Key and use the client without creating an account or logging in.

**Q: What do I need to connect WeChat?**
A: nexu works with the WeChat 8.0.7 OpenClaw plugin. Click connect, scan with WeChat, and you're good to go — no extra setup required.

---

## 💬 Community

We use GitHub as the primary hub for community interaction. Before opening a new thread, please search existing ones to avoid duplicates.

| Channel | When to use |
|---------|-------------|
| 💡 [**Discussions**](https://github.com/nexu-io/nexu/discussions) | Ask questions, propose ideas, share use cases, or just say hi. Browse the **Q&A** category for troubleshooting and **Ideas** for feature brainstorming. |
| 🐛 [**Issues**](https://github.com/nexu-io/nexu/issues) | Report a bug or request a specific feature. Please use the provided issue templates — they help us triage faster. |
| 📋 [**Roadmap & RFCs**](https://github.com/nexu-io/nexu/discussions/categories/rfc-roadmap) | Follow upcoming plans and join design discussions on proposed changes. |
| 📧 [**support@nexu.ai**](mailto:support@nexu.ai) | For private inquiries, partnership, or anything not suited for a public thread. |

### Join our community groups

<table>
  <tr>
    <td align="center" width="220">
      <strong>💬 WeChat Group</strong><br/><br/>
      <img src="site/media/wechat-qr.png" width="200" height="200" alt="WeChat Community QR Code" /><br/>
      <sub>Scan to join the WeChat community</sub>
    </td>
    <td align="center" width="220">
      <strong><a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=8b7k7b5b-ac27-4748-9165-78606dc16913">🪁 Feishu Group</a></strong><br/><br/>
      <img src="site/media/feishu-qr.png" width="200" height="200" alt="Feishu Community QR Code" /><br/>
      <sub>Scan or click to join the Feishu community</sub>
    </td>
    <td align="center" width="220">
      <strong><a href="https://discord.gg/Q6AxCUuMNU">🎮 Discord</a></strong><br/><br/>
      <img src="site/media/discord-qr.png" width="200" height="200" alt="Discord Community QR Code" /><br/>
      <sub>Scan or click to join the Discord server</sub>
    </td>
  </tr>
</table>

### Contributors

<a href="https://github.com/nexu-io/nexu/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=nexu-io/nexu" />
</a>

---

## 📊 GitHub Stats

<picture>
  <img alt="GitHub Stats" src="docs/github-metrics.svg" />
</picture>

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

nexu is open-sourced under the [MIT License](LICENSE) — free to use, modify, distribute, and build upon for any purpose, including commercial use.

We believe open source is the future of AI infrastructure. Fork it, contribute, or build your own product on top of nexu.

---

<p align="center">
  <a href="https://github.com/nexu-io/nexu/stargazers">
    <img src="https://github.com/user-attachments/assets/a44df6d4-7056-4cd0-b778-32248a7fd26b" width="600" alt="Star nexu on GitHub" />
  </a>
</p>

---

<p align="center">Built with ❤️ by the nexu Team</p>
