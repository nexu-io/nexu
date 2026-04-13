# Good First Issue 贡献者指南

如果你用过 **nexu**，或者对「IM + 桌面客户端 + 数字分身」这类产品好奇，欢迎从 **Good First Issue** 开始你的第一个 PR。

我们正在持续寻找 **Good First Issue 贡献者**。

你可以把它理解成：维护者已经拆好的小题，范围清楚、方向聚焦，适合第一次参与开源的人上手。

## 为什么适合第一次参与

- **更容易上手**：通常只涉及一个方向，不需要先吃透整套架构。
- **更容易验证**：范围小、验收清楚，做完就能自测。
- **反馈更快**：这类题一般更容易推进 review。

## 哪些人适合从这里开始

如果你符合下面任意一种情况，都很适合从 `good-first-issue` 开始：

- 第一次做开源贡献
- 更关注体验、文档、i18n、前端交互
- 愿意先从小题切入，边做边熟悉项目
- 愿意和 Reviewer 一起协作完成修改

直接看题：

- [Good First Issue 列表](https://github.com/nexu-io/nexu/labels/good-first-issue)
- [GitHub Issues](https://github.com/nexu-io/nexu/issues)
- [贡献指南](/zh/guide/contributing)

## 贡献之后你能获得什么

如果你的贡献被合入，我们希望这件事不只停留在 “PR merge 完了”：

- 贡献会进入公开展示与排行榜
- 投入会按规则记录积分
- 第一次贡献者会拿到后续参与建议

详细规则见：

- [贡献奖励与支持](/zh/guide/contributor-rewards)

## 三步，从围观到提交

### 1. 挑题

打开 [Good First Issue 列表](https://github.com/nexu-io/nexu/labels/good-first-issue)，选一条你感兴趣的题目，并先在 Issue 下留言认领，避免多人撞车。

建议优先挑：

- 文案 / i18n 修正
- 小范围 UI / 交互问题
- 文档补充
- 复现明确、验收清晰的小 Bug

### 2. 读指南、搭环境

正式开发前，先看一遍 [贡献指南](/zh/guide/contributing)。

最少需要：

```bash
git clone https://github.com/nexu-io/nexu.git
cd nexu
pnpm install
```

如果你改的是代码，建议至少跑：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

如果你改的是文档，建议本地预览：

```bash
cd docs
pnpm install
pnpm dev
```

### 3. 提 PR

Fork 仓库，开一个清晰的分支名，在 PR 描述里写清：

- 关联的 Issue 编号
- 改了什么
- 怎么验证
- 如果是 UI 改动，附截图或录屏

合并后，就会进入致谢、积分和排行榜流程。

## 加入 nexu 开发者飞书交流群 💬

一个人研究不如一群人一起聊。群里有维护者、有老贡献者，扫码进群，聊聊你想做的第一个贡献 👇

<img src="/feishu-contributor-qr.png" width="200" alt="nexu 开发者飞书交流群" />

## 常见问题

### 我不是资深工程师，可以吗？

可以。Good First Issue 本来就是为第一次贡献准备的入口。

### 英语不好怎么办？

Issue / PR 中英文团队都会尽量看；先把中文贡献指南读一遍就够。

### 可以用 AI 辅助写代码吗？

可以。建议在 PR 里简单说明用了什么 AI 辅助，以及你自己做了哪些验证。

### 提了 PR 会没人理吗？

我们会尽量按公开节奏 review；通常 Good First Issue 的反馈会更快，但仍以当时维护者人力为准。

## 写在最后

开源最有意思的一点，是你的改动会留在版本历史里，也会真正被用户用到。

如果你准备好了，就从一条 [Good First Issue](https://github.com/nexu-io/nexu/labels/good-first-issue) 开始。
