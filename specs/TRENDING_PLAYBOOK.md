# nexu GitHub Trending 作战手册

---

## 一、今日 Trending 数据快照（2026-03-23）

以下是今天 GitHub Trending 页面上的真实项目数据：

| 排名 | 项目 | 总 Stars | **今日新增** | 类型 |
|:---:|---|---:|---:|---|
| 1 | everything-claude-code | 100,428 | **4,453** | Claude Code 资源合集 |
| 2 | project-nomad | 11,977 | **4,148** | 离线生存 AI 工具（TypeScript） |
| 3 | deer-flow (字节跳动) | 37,454 | **3,569** | SuperAgent 框架 |
| 4 | MoneyPrinterV2 | 21,513 | **2,902** | 自动赚钱工具 |
| 5 | TradingAgents | 38,503 | **2,521** | 多 Agent 金融交易 |
| 6 | pentagi | 12,626 | **1,307** | AI 渗透测试 Agent |
| 7 | browser-use | 83,210 | **1,160** | 浏览器自动化 AI |
| 8 | hermes-agent | 10,879 | **874** | NousResearch Agent |
| 9 | TradingAgents-CN | 20,176 | **672** | 中文金融 Agent |
| 10 | minimind | 42,383 | **478** | 2 小时训练迷你 GPT |
| 11 | awesome-claude-code | 30,490 | **413** | Claude Code 精选列表 |
| 12 | obsidian-skills | 16,010 | **367** | Obsidian Agent Skills |
| 13 | iptv-org/iptv | 113,372 | **165** | IPTV 频道合集 |
| 14 | n8n-mcp | 15,840 | **136** | n8n MCP 工具 |
| 15 | tinygrad | 31,789 | **58** | 轻量深度学习框架 |

### 观察

- **头部项目**日增 2,000-4,500 stars（多为已有大量基数或话题极热的项目）
- **中部项目**日增 400-1,300 stars（典型的 "刚爆发" 项目）
- **尾部项目**日增 58-165 stars（老牌项目凭惯性/长尾流量维持在榜）
- 当前 Trending **几乎全是 AI / Agent 相关**——nexu 正好在这个赛道上

---

## 二、收益预估：如果 nexu 上了 Trending

### (a) Launch Day 当天收益

| 场景 | 日增 Stars | 对应 Trending 位置 | 概率 |
|---|---:|---|---|
| 保守 | 200-400 | Trending 尾部（#20-25） | 高 — 多渠道协调发布即可触及 |
| 正常 | 500-1,000 | Trending 中部（#10-15） | 中 — 需 HN 首页 + Reddit 爆发 |
| 爆发 | 1,000-3,000 | Trending 头部（#5-10） | 低 — 需多个渠道同时爆 + 话题引爆 |

> **参考基准**：AFFiNE 首周 6,000 stars（日均 ~857）；codexu 的 note-gen 上 HN 后单日数百；今天 Trending 门槛约 **58-165 stars/天**。

### (b) 后续持续收益

| 时间段 | 预期 Stars | 驱动力 |
|---|---:|---|
| **T+0（Launch Day）** | 200-1,000 | 多渠道集中引爆 |
| **T+1 ~ T+7（Trending 期）** | 1,000-3,000 | Trending 飞轮效应：上榜→曝光→更多 star→停留更久 |
| **T+8 ~ T+30** | 500-1,500 | 长尾流量（HN 存档、Google 索引、Awesome List） |
| **T+30 ~ T+90** | 300-1,000 | 版本更新推广 + 社区口碑 |
| **累计第一年** | 3,000-8,000 | 持续运营 + 多轮推广 |

> **关键飞轮**：上 Trending → 更多曝光 → 更多 star → 保持 Trending 更久 → 更更多曝光。一次成功的 Launch 可以在第一周产生总 Stars 的 30-50%。

---

## 三、上 Trending 的核心要素（来源：7 篇实战文章综合）

### (a) 必要条件 — 缺一不可

| 条件 | 说明 | 来源 |
|---|---|---|
| **多渠道流量** | 单一来源（如只有 HN）即使拿 3000 star 也可能不上。必须 HN + Reddit + Twitter + DEV.to 同时导流 | Gitroom |
| **时间窗口集中** | 在 24-48 小时内集中引爆。Trending 按**近期 star 速度**排名，分散在一个月内无效 | Gitroom / IndieRadar |
| **产品可用且有亮点** | 项目必须已经可用，有明显差异化。README 要在 8 秒内说清价值 | 宋马 / codexu |
| **README = Landing Page** | 一句话价值定位 + GIF/截图 + 快速上手步骤 + 对比竞品优势 | 所有文章共识 |

### (b) 非常重要 — 显著影响结果

| 条件 | 说明 | 来源 |
|---|---|---|
| **发布日选周二-周四** | 避开周末（开发者活跃度低），美东早 8-9 点发 HN（北京时间晚 21-22 点） | SmolLaunch / IndieRadar |
| **在 Trending 刷新前 4-6 小时引爆** | GitHub Trending 于 UTC 00:00（北京早 8 点）刷新。在此前 4-6 小时制造流量高峰 | Gitroom |
| **HN 第一条评论质量** | 讲故事（为什么做）、暴露限制（真诚）、邀请反馈（具体问题），定调整个讨论 | SmolLaunch |
| **发完帖守 3+ 小时回复** | 前 30-60 分钟决定 HN 帖子生死。每条评论认真回复 | SmolLaunch / IndieRadar |
| **提前 1-2 天发布 SEO 文章** | DEV.to / Medium 文章提前发，让 Google 索引。Launch Day 流量来时已有内容支撑 | IndieRadar |
| **英文 README 是必须的** | GitHub 海外用户是大头。nexu 已有英文 README ✅ | 鱼皮 |
| **每次发帖换角度/找噱头** | 不重复介绍项目。用故事、技术分享、里程碑、有趣事件作为标题 | codexu |

### (c) 可选加分项 — 锦上添花

| 方法/渠道 | 说明 | 预期效果 |
|---|---|---|
| **Product Hunt 发布** | 协调 PH + GitHub 同时 Launch，形成交叉流量 | +200-500 stars |
| **KOL 合作（100-150 人）** | Twitter/X KOL 转推，5 天内累积报价转发 | 长期品牌曝光 |
| **周刊投稿** | 阮一峰、HelloGitHub、GithubDaily | 长尾流量 |
| **Awesome List PR** | awesome-selfhosted、awesome-chatgpt 等 | 持续 SEO 引流 |
| **Lemmy 搬运** | 开源友好社区，10 分钟搬运 | +50-100 upvotes |
| **Discord 社区** | 承接 Launch 流量，沉淀长期用户 | 社区留存 |
| **Algora Bounty** | 在简单 bug 上挂小额奖金，增加 Launch Day GitHub Activity | 活跃度信号 |
| **合并屯好的 PR** | Launch Day 集中合并，增加 commits/contributions 指标 | 算法加分 |
| **里程碑推文** | "We're trying to reach 1000 stars" 发到 Twitter | 社区自发传播 |

---

## 四、关键原则提醒

> **烂熟于心，贴在墙上。**

1. **多渠道是硬性条件** — 单一来源即使 3000 star 也可能不上 Trending（Gitroom 创始人亲历）
2. **Trending 刷新时间 = UTC 00:00 = 北京早 8 点** — 在此前 4-6 小时引爆最佳
3. **前 30-60 分钟决定帖子生死** — 发完 HN/Reddit 后必须守着回复
4. **绝不买 Star、绝不 HN 互刷 upvote** — 会被检测，声誉毁掉（所有文章共识）
5. **100-1000 star 是最难的阶段** — 频繁硬发帖适得其反，需要内容和噱头（codexu）
6. **每次发帖换角度** — 讲故事、晒成就、分享技术、用噱头标题（codexu）
7. **品牌是唯一的护城河** — 代码不值钱，信任和社区才值钱（IndieRadar）
8. **Star 增长是马拉松不是短跑** — Launch Day 拿 30-50%，剩下靠长期运营（AFFiNE/Iris）

---

## 五、nexu 的独特卖点（发帖时重点打）

| 卖点 | 为什么有效 | 目标受众 |
|---|---|---|
| **微信集成** | 英文社区极其稀缺，海外开发者好奇度极高。中文社区则是刚需 | HN / Reddit / V2EX |
| **BYOK + 本地数据** | 隐私友好，self-hosted 叙事。r/selfhosted 最爱的关键词 | r/selfhosted |
| **纯 GUI 双击即用** | 比 CLI 工具更有视觉冲击力。GIF 演示效果远好于文字描述 | 所有渠道 |
| **AI Agent + IM 集成** | 蹭当前最热的 AI Agent 话题（今天 Trending 几乎全是 Agent 项目） | 所有渠道 |
| **免费内测** | "Claude/GPT/Gemini 全部免费无限用" 是极强的 CTA | 所有渠道 |
| **MIT 开源** | 最宽松许可证，fork/审计 无障碍，符合开源社区价值观 | HN / r/opensource |
| **One Person Company** | "一个人 = 一支 AI 团队"的定位，击中独立开发者和小团队痛点 | Reddit / V2EX / Twitter |

---

## 六、完整 Checklist & To-Do List（2 周冲刺计划）

### 阶段一：基础设施 + 素材准备（第 1 周，D1-D7）

> 基础设施和内容素材并行推进，一周内全部就绪。

**D1-D2（周一-周二）：项目基础**

- [ ] **1. 录制产品 GIF / 短视频** 🔴 P0
  - 展示核心流程：微信扫码 → AI Agent 回复消息（10-15 秒）
  - 现状：目前只有静态截图，**这是最高优先级的缺失项**

- [ ] **2. README 加 "Open-source alternative to X" 定位锚点** 🔴 P0
  - 例如："Open-source alternative to Coze/Dify for IM"

- [ ] **3. 优化 GitHub Topics 标签** 🔴 P0
  - 加上：`ai-agent`, `wechat`, `feishu`, `slack`, `discord`, `desktop-app`, `self-hosted`, `electron`, `openclaw`, `byok`

- [ ] **4. 确认 HN 账号** 🔴 P0
  - 确认团队有老号可用（注册满 2 周以上）。如没有，立即注册

**D2-D4（周二-周四）：社区 & 基础设施**

- [ ] **5. 创建 Discord 社区** 🟡 P1
  - 频道结构：general / showcase / bugs / feature-requests

- [ ] **6. 创建 good first issue（5-10 个）** 🟡 P1
  - 降低贡献门槛，积累 Launch 前的活跃度信号

- [ ] **7. 提供 Docker 一键部署** 🟡 P1
  - r/selfhosted 社区最看重这个

- [ ] **8. 准备 FAQ / 已知限制文档** 🟢 P2
  - HN 第一条评论需要用到

**D3-D5（周三-周五）：内容撰写（和上面并行）**

- [ ] **9. 写 DEV.to 英文文章** 🔴 P0
  - 标题参考："How I Built an Open-Source Desktop Client That Connects AI Agents to WeChat"
  - Launch 前 1-2 天发布，让 Google 索引

- [ ] **10. 写中文技术文章** 🔴 P0
  - 掘金 / V2EX / Linux.do 各一个版本，语气不同
  - 不要直译英文版，要讲故事、有噱头
  - 标题参考：《让 AI 替你回微信是什么体验》

**D5-D7（周五-周日）：发帖草稿 & KOL 外联启动**

- [ ] **11. 准备 Reddit 帖子草稿（多版本）** 🟡 P1
  - r/selfhosted 版：强调 BYOK / 本地数据 / Docker
  - r/LocalLLaMA 版：强调多模型支持 / 开源
  - r/opensource 版：强调 MIT / 社区
  - r/sideproject 版：讲创业故事
  - 全部用第一人称 "I built..."

- [ ] **12. 准备 Twitter/X Thread 草稿** 🟡 P1
  - 第一条是 hook（"What if your AI agent lived inside WeChat?"）
  - 后续展开功能、使用场景、GIF 演示

- [ ] **13. 联系 KOL（目标 15-30 人）** 🟡 P1
  - Twitter/X 上的 AI 工具测评博主
  - 准备好内容包（产品简介、截图、推荐话术模板）
  - 第 1 周发出邀请，第 2 周 Launch Day 配合转发

- [ ] **14. 提 PR 进 Awesome List** 🟡 P1
  - awesome-selfhosted、awesome-chatgpt / awesome-ai-agents、awesome-electron
  - 立即提交，审核周期不确定，先排上队

- [ ] **15. 向周刊 / 自媒体投稿** 🟡 P1
  - 阮一峰周刊、HelloGitHub、GithubDaily（GitHub Issue）

---

### 阶段二：Launch Day 执行（第 2 周，周二或周三 = D9 或 D10）

> **选周二或周三。所有渠道在 24 小时内同步引爆。**

- [ ] **16. T-1 天晚上：发布 DEV.to / Medium 文章**
  - 提前让 Google 索引

- [ ] **17. T-0 北京时间 21:00-22:00：提交 HN Show HN**
  - 标题：`Show HN: Nexu – Open-source desktop client connecting AI agents to WeChat, Slack, Discord`
  - 提交 GitHub 链接（不是官网）
  - 2-5 分钟内发第一条评论（讲故事 + 暴露限制 + 邀请反馈）

- [ ] **18. T-0 北京时间 22:00：Reddit 多子版块发帖**
  - r/selfhosted（首选）→ r/LocalLLaMA → r/opensource → r/sideproject

- [ ] **19. T-0 北京时间 22:30：Twitter/X Thread + @KOL**
  - KOL 开始 quote retweet

- [ ] **20. T-0 北京时间 23:00-01:00：中文渠道同步**
  - Linux.do（首选，氛围最好）
  - V2EX（分享创造节点，第一次发）
  - NodeSeek

- [ ] **21. T-0 全天：合并屯好的 PR**
  - Launch Day 前攒 3-5 个 PR，集中合并增加 GitHub Activity 指标

- [ ] **22. T-0 发帖后持续 3+ 小时：回复所有评论**
  - HN / Reddit 每条评论认真回复
  - 前 30-60 分钟是关键期，决定帖子走势

---

### 阶段三：Launch 后持续运营（第 2 周后半 + 长期）

- [ ] **23. T+1 ~ T+7：每日检查 & 互动**
  - 回复所有新 Issue / Discussion
  - 发 KOL 跟进推文
  - Reddit 发更新回复

- [ ] **24. 每次版本更新 = 一次推广机会**
  - r/selfhosted 发更新帖
  - Twitter 发 changelog
  - Linux.do / V2EX 用新噱头标题发帖

- [ ] **25. 持续内容输出**
  - "Top 10 open-source AI agent tools" 类型 listicle（把 nexu 放进去）
  - 技术博客：分享开发过程中的有趣技术细节
  - 用户故事征集

---

## 七、参考来源

| 来源 | 核心价值 | 链接 |
|---|---|---|
| Gitroom | Trending 算法原理 + 时间策略 | [gitroom.com/blog](https://gitroom.com/blog/everything-know-github-trending-feed) |
| AFFiNE Playbook (Iris) | 0→33k stars 真实数据 + 系统方法论 | [dev.to/iris1031](https://dev.to/iris1031/github-star-growth-a-battle-tested-open-source-launch-playbook-35a0) |
| AFFiNE 10k 数据 (Iris) | 各阶段增长数据 + 渠道效果 | [dev.to/iris1031](https://dev.to/iris1031/github-star-growth-10k-stars-in-18-months-real-data-4d04) |
| IndieRadar 2026 | 6 步 Launch Playbook + 商业化路径 | [indieradar.app/blog](https://indieradar.app/blog/open-source-marketing-playbook-indie-hackers) |
| SmolLaunch HN 指南 | HN 发帖逐小时计划 + 评论模板 | [smollaunch.com](https://smollaunch.com/guides/hacker-news-launch-guide) |
| 鱼皮 10 技巧 | 中国区 Top 7 的实战经验 | [codefather.cn](https://www.codefather.cn/post/2027583962439778306) |
| codexu 5000 star | 最接地气的中文推广实录 + 噱头技巧 | [sspai.com](https://sspai.com/post/100639) |
| 宋马 | 选题→打磨→推广→运营四步法 | [bbs.songma.com](https://bbs.songma.com/149082.html) |
