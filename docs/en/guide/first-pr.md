# Good First Issue Contributor Guide

If you've used **nexu**, or you're curious about products combining IM, desktop clients, and digital clones, we'd love for you to start with a **Good First Issue** and submit your first PR.

We're actively looking for **Good First Issue contributors**.

Think of it as: a small task the maintainers have already scoped out — clear boundaries, focused on one area, and perfect for first-time open-source contributors.

## Why It's Great for First-Timers

- **Easy to get started**: Usually involves just one area — no need to understand the entire architecture first.
- **Easy to verify**: Small scope, clear acceptance criteria, you can self-test when done.
- **Faster feedback**: These issues typically get reviewed more quickly.

## Who Should Start Here

If any of the following applies to you, `good-first-issue` is a great place to begin:

- First time contributing to open source
- More interested in UX, docs, i18n, or frontend interactions
- Prefer starting small and learning the project as you go
- Willing to collaborate with reviewers to refine your changes

Jump right in:

- [Good First Issue List](https://github.com/nexu-io/nexu/labels/good-first-issue)
- [GitHub Issues](https://github.com/nexu-io/nexu/issues)
- [Contributing Guide](/guide/contributing)

## What You Get After Contributing

When your contribution is merged, it doesn't just end at "PR merged":

- Your contribution enters public display and the leaderboard
- Your effort is recorded as contribution points
- First-time contributors receive follow-up suggestions

See full details:

- [Contributor Rewards & Support](/guide/contributor-rewards)

## Three Steps: From Observer to Contributor

### 1. Pick an Issue

Open the [Good First Issue List](https://github.com/nexu-io/nexu/labels/good-first-issue), find one that interests you, and leave a comment to claim it — this avoids duplicate work.

Recommended starting points:

- Copy / i18n fixes
- Small UI / interaction issues
- Documentation improvements
- Small bugs with clear reproduction steps

### 2. Read the Guide & Set Up

Before you start coding, read through the [Contributing Guide](/guide/contributing).

Minimum setup:

```bash
git clone https://github.com/nexu-io/nexu.git
cd nexu
pnpm install
```

If you're changing code, at least run:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

If you're changing docs, preview locally:

```bash
cd docs
pnpm install
pnpm dev
```

### 3. Submit a PR

Fork the repo, create a descriptive branch name, and include in your PR description:

- Related Issue number
- What you changed
- How to verify
- Screenshots or recordings for UI changes

After merge, you'll enter the appreciation and points tracking flow.

## Join the Community 💬

It's better to chat with a group than figure things out alone. The group includes maintainers and experienced contributors — join us and talk about your first contribution 👇

👉 [Join nexu Discord](https://discord.gg/vMrySTJW8u)
👉 [Join nexu Feishu Group](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=bd9j6550-d1ee-41e6-8bbb-7e735ae88ba2)

<img src="/feishu-contributor-qr.png" width="200" alt="nexu Feishu Contributor Group" />

## FAQ

### I'm not a senior engineer — is that okay?

Absolutely. Good First Issue is designed as an entry point for first-time contributors.

### What if my English isn't great?

The team reads both English and Chinese in Issues / PRs. Read through the contributing guide first — language is not a barrier, getting started is.

### Can I use AI to help write code?

Yes. We recommend briefly noting in your PR whether you used AI assistance and what you verified yourself.

### Will my PR be ignored?

We try to review on a public schedule. Good First Issue PRs typically get faster feedback, but it depends on maintainer availability at the time.

## Final Words

The best part of open source is that your changes live in the version history — and are actually used by real people.

If you're ready, start with a [Good First Issue](https://github.com/nexu-io/nexu/labels/good-first-issue).
