# Security policy

## Reporting a vulnerability

**Please do not** open a public GitHub Issue, Discussion, or pull request to disclose security vulnerabilities. Public disclosure can put users at risk before a fix is available.

**Preferred channels**

1. **GitHub (private vulnerability reporting)** — In **[github.com/nexu-io/nexu](https://github.com/nexu-io/nexu)**, open the **Security** tab and use **Report a vulnerability**. This opens a private thread visible only to you and maintainers.  
2. **Email** — Send to **[support@nexu.ai](mailto:support@nexu.ai)** with the same information you would put in a private report.

For either channel, include:

- A clear description of the issue and its potential impact  
- Affected component (e.g. desktop app, controller API, docs site) and version or commit SHA if known  
- Steps to reproduce, or a minimal proof of concept if you can share one safely  
- Whether the issue has been observed in the wild or only in a test environment  

You may encrypt your message with PGP if we publish a key later; until then, avoid pasting long-lived secrets into email—describe handling and redact samples.

We aim to acknowledge receipt within a few business days and work with you on a coordinated disclosure timeline after we understand and can patch the issue.

## Supported versions

Security fixes are applied to the **latest stable release** and typically to the **`main` branch** ahead of the next release. Very old releases may not receive backports—ask when you report if you need a specific line.

## Scope (in brief)

**Generally in scope**

- This repository’s code: desktop client, controller, web UI, and related tooling shipped as part of nexu  
- Security of how nexu handles credentials, sessions, IPC, and channel integrations **as implemented in this codebase**  

**Generally out of scope**

- Vulnerabilities in third-party services or apps (e.g. IM clients, model providers) unless nexu clearly increases exposure (e.g. leaking secrets that should stay local)  
- Physical access to an unlocked device, or social engineering of users  
- Denial-of-service that only exhausts a single user’s local resources without privilege escalation  

When in doubt, report anyway—we can triage quickly.

## Safe harbor

We support **good-faith** security research that follows this policy and does not degrade user safety or service availability (e.g. no mass scraping of user data, no destructive testing on others’ systems without permission).

## Implementation & architecture notes

For engineers and auditors: cryptographic design, token models, and related implementation notes are documented in **[`specs/SECURITY.md`](specs/SECURITY.md)**. That file is **not** the channel for submitting new vulnerability reports.

---

## 安全漏洞反馈（简体中文）

**请勿**通过公开的 GitHub Issue、Discussion 或 PR 披露安全漏洞，以免在修复发布前扩大风险。

**推荐渠道：**（1）在 **[github.com/nexu-io/nexu](https://github.com/nexu-io/nexu)** 打开 **Security** 标签页，使用 **Report a vulnerability** 提交私密报告；（2）或发送邮件至 **[support@nexu.ai](mailto:support@nexu.ai)**。

请尽量包含：

- 问题描述与可能影响  
- 涉及组件（如桌面端、controller API 等）及版本或 commit  
- 复现步骤或（在可分享前提下的）最小验证方式  
- 是否已在真实环境观察到  

实现层面的安全设计说明见 **[`specs/SECURITY.md`](specs/SECURITY.md)**；**提交新漏洞请仍使用邮件**，不要仅依赖该文档作为反馈渠道。
