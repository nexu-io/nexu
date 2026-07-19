# 技能安装

技能扩展了 Agent 的能力边界，从网络搜索、文档生成，到飞书多维表格操作、第三方 API 调用，应有尽有。安装一个技能只需几秒钟。

## 第一步：打开技能页面

在 nexu 客户端左侧导航栏点击 **Skills**，进入技能中心。

**Explore** 标签展示所有可安装的公共技能，支持按分类筛选（Office & Collaboration、Files & Knowledge、Creative & Design、Business Analysis、Audio & Video 等）或直接搜索关键词。

![Nexu 技能目录](/assets/nexu-skills.webp)

## 第二步：找到并安装技能

浏览或搜索目标技能，点击卡片上的 **Install** 按钮。技能支持热加载，安装后无需重启 Agent 即可立即生效。

![搜索并安装技能](/assets/nexu-skills-search.webp)

## 第三步：确认安装

切换到 **Yours** 标签，查看已安装的技能列表，并可通过开关随时启用或禁用单个技能。

![已安装的技能](/assets/nexu-skills-installed.webp)

## 第四步：在对话中使用

技能安装后，直接在渠道对话中描述需求即可，Agent 会自动选择合适的技能完成任务。

![技能在对话中的使用效果](/assets/nexu-skills-chat.webp)

## 示例：使用 TweetClaw 处理 X/Twitter 工作流

如果同一个 OpenClaw 工作区还需要 X/Twitter 能力，可在 **Skills** 页面搜索 "TweetClaw"。对于使用 CLI 管理的 OpenClaw 工作区，也可以直接安装插件：

```bash
openclaw plugins install @xquik/tweetclaw
openclaw config set plugins.entries.tweetclaw.config.apiKey "$XQUIK_API_KEY"
openclaw config set tools.alsoAllow '["explore", "tweetclaw"]'
```

[TweetClaw](https://github.com/Xquik-dev/tweetclaw) 也发布在 [npm](https://www.npmjs.com/package/@xquik/tweetclaw)，并收录于 [ClawHub](https://clawhub.ai/plugins/@xquik/tweetclaw)。执行账号相关操作前，请先从 Xquik 控制台获取并设置 `XQUIK_API_KEY`。可用于推文搜索、回复搜索、粉丝导出、用户查询、媒体上传和下载、私信、推文监控、webhooks、抽奖，以及需要审批的发推或回复。

请将 nexu 渠道凭据与 TweetClaw 和 Xquik 凭据分开管理。涉及公开或改动账号状态的 X/Twitter 操作前，要求明确审批，包括发推、回复、私信、关注或取关。

Xquik 是独立的第三方服务，与 X Corp. 无关联，也未获得其认可。"Twitter" 和 "X" 是 X Corp. 的商标。

## 常见问题

**Q: 安装技能后需要重启 Agent 吗？**

不需要。技能支持热加载，Agent 会立即识别并启用新安装的技能。

**Q: 可以安装目录以外的技能吗？**

可以。nexu 支持本地自定义技能开发，满足个性化需求。详见开发者文档。

**Q: 如何卸载技能？**

进入 **Yours** 标签，点击对应技能旁的 **Uninstall** 即可。
