<p align="center">
  <img src="site/media/nexu-logo.svg" width="120" alt="nexu Logo" />
</p>

<h1 align="center">nexu</h1>

<p align="center">
  <strong>The Best Open-Source Feishu OpenClaw 🦞 Client</strong>
</p>

<p align="center">
  <a href="https://github.com/nexu-io/nexu/releases"><img src="https://img.shields.io/badge/release-v0.1.0-blue" alt="Release" /></a>
  <a href="https://github.com/nexu-io/nexu/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
</p>

<p align="center">
  <a href="https://nexu.io" target="_blank" rel="noopener"><strong>🌐 Website</strong></a> &nbsp;·&nbsp;
  <a href="https://github.com/nexu-io/nexu/releases/latest" target="_blank" rel="noopener"><strong>⬇️ Download</strong></a> &nbsp;·&nbsp;
  <a href="https://docs.nexu.io" target="_blank" rel="noopener"><strong>📖 Docs</strong></a> &nbsp;·&nbsp;
  <a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=8b7k7b5b-ac27-4748-9165-78606dc16913" target="_blank" rel="noopener"><strong>💬 Feishu</strong></a> &nbsp;·&nbsp;
  <a href="https://discord.gg/nexu" target="_blank" rel="noopener"><strong>🎮 Discord</strong></a> &nbsp;·&nbsp;
  <a href="https://x.com/Nexu06" target="_blank" rel="noopener"><strong>𝕏 Twitter</strong></a>
</p>

<p align="center">
  English &nbsp;·&nbsp; <a href="README.zh-CN.md">简体中文</a>
</p>

---

## Your Data Should Belong to You

Feishu + OpenClaw 🦞 is the hottest AI Agent combo right now. But most existing products follow the same playbook: locked-in models, data routed through their servers, per-seat pricing.

Your conversations, your business data, your workflows — all hosted on someone else's infrastructure.

We made a different choice: **nexu — an open-source Feishu OpenClaw client. Choose any model, keep 100% of your data local, completely free.**

Not another clone of a closed-source product, but a truly trustworthy AI assistant built for individual users.

---

## What is nexu

In one line: **the best open-source Feishu OpenClaw 🦞 client.**

Built on the OpenClaw core, packaged as a desktop app. Download, double-click, and have your first Agent running in 1 minute — chat with it directly in Feishu.

No terminal. No config files. No docs to read first.

<!-- TODO: Add product demo GIF / screenshot here -->

---

## How nexu Compares

| | Closed-source products | nexu |
|---|---|---|
| **Model choice** | Platform-locked, no switching | Choose Claude, GPT, Gemini, etc. — switch anytime |
| **Data storage** | Routed through third-party servers | 100% local, never touches a third party |
| **Pricing** | Per-seat / monthly subscription | Completely free, BYOK (Bring Your Own Key) |
| **Source code** | Closed | MIT License, fully open |
| **Extensibility** | Platform-limited | Feishu, Slack, Discord — more channels coming |

In short: same Feishu + OpenClaw combo, but more freedom, more security, lower cost.

---

## Six Reasons to Choose nexu

### 🖱 1-Minute Install

Download the Mac client, double-click, and your Agent is ready in seconds.

> 📌 Supports macOS 12+ (Apple Silicon), ~500 MB
> 📌 Windows & Intel Mac coming soon

### 🧠 Top-Tier Models, No Lock-In

Supports Claude, GPT, Gemini, and more. Switch anytime. Not tied to any single provider — use what works best for you.

### 🔒 Your Data Stays on Your Machine

All data is stored on your own computer. Nothing passes through third-party servers. Your conversations, your business data, your workflows — they belong to you alone.

### 🆓 Completely Free, BYOK

nexu itself is completely free. Bring your own API Key — no subscription fees, no per-seat charges.

### 🔗 Deep Feishu Integration, Multi-Channel Ready

Built-in Feishu Skills let your Agent chat directly in Feishu. Also supports Slack and Discord, with more channels in development.

### 🧩 Fully Open Source, Community-Driven

MIT License, code fully open. Community-driven — the features you need ship faster.

---

## What You Can Do with nexu

### 🛒 E-commerce Sellers

Tell your Agent in Feishu: "This product needs to break into Southeast Asia — draft a promotion strategy and write listings for three platforms."

By the time you finish your coffee, strategy, copy, and multilingual versions are all done.

### ✍️ Content Creators

Monday morning on Feishu: "What's worth writing about this week? Pick three angles, draft one post each, different tone for Xiaohongshu vs. WeChat."

Content lands before lunch.

### 💻 Indie Developers

Paste an error screenshot into Feishu: "Spent two hours on this bug, help me out."

Agent locates the issue, suggests a fix, and drafts the PR description for good measure.

### ⚖️ Consulting / Legal / Finance

Contract review, regulation lookup, report generation — turn your domain expertise into Agent skills, callable anytime in Feishu.

---

## Why Open Source

The big-company playbook for AI tools is clear: lock in the model, lock in the data, charge monthly. The deeper you go, the safer they are — because you can't leave.

We don't want to play that game.

What we want to build is: **a truly trustworthy, truly usable AI assistant for individual users.**

Open source means: you can see the code, your data stays local, no surprise price hikes, no service shutdowns, no waking up one day to find your data was used to train someone else's model.

> Closed-source products let you *use* AI. Open-source products let you *own* AI. nexu stands on the user's side — your data sovereignty should not be a paid feature.

---

## 🚀 Getting Started

### Download (Recommended)

Go to [nexu.io](https://nexu.io), download the Mac client, and double-click to launch.

### Run from Source

```bash
git clone https://github.com/nexu-io/nexu.git
cd nexu
pnpm install
pnpm run dev
```

---

## 🛠 Development

### Prerequisites

- **Node.js** 22+ (LTS recommended)
- **Package manager**: pnpm 10+

### Project Structure

```
nexu/
├── apps/
│   ├── api/              # Backend API server
│   ├── web/              # Web frontend
│   ├── desktop/          # Mac desktop client (Electron)
│   └── controller/       # Controller service
├── packages/
│   └── shared/           # Shared libraries
├── docs/                 # Documentation
├── tests/                # Tests
└── specs/                # Specifications
```

### Available Commands

```bash
pnpm run dev             # Start dev environment with hot reload
pnpm run dev:desktop     # Start desktop client
pnpm run build           # Production build
pnpm run lint            # Run linter
pnpm test                # Run tests
```

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork this repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 💬 Community

| Feishu Group | Discord |
|:---:|:---:|
| <img src="site/media/feishu-qr.png" width="200" /> | <img src="site/media/discord-qr.png" width="200" /> |
| [Join Feishu Group](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=8b7k7b5b-ac27-4748-9165-78606dc16913) | [Join Discord](https://discord.gg/nexu) |

- 💡 [GitHub Discussions](https://github.com/nexu-io/nexu/discussions) — Q&A and discussion
- 🐛 [GitHub Issues](https://github.com/nexu-io/nexu/issues) — Bug reports and feature ideas
- 📧 Email: [support@nexu.ai](mailto:support@nexu.ai)

### Contributors

<a href="https://github.com/nexu-io/nexu/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=nexu-io/nexu" />
</a>

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
