# Twitter 联动：Orange × Nexu

**用途**：CEO 个人账号发布，与 @oran_ge（橘子/ListenHub 创始人）互动联动，展示 ListenHub 语音输入 + Nexu Agent 执行的组合能力。
**说明**：中英双版本，可分别复制发布。

---

## 背景

- **橘子 (@oran_ge)**：ListenHub 创始人，一年从 0 到 $3M ARR，已获千万融资
- **ListenHub 最新能力（2026.3）**：ASR 语音识别 API — 本地离线、免费、专为 Agent（OpenClaw）设计
- **联动核心概念**：ListenHub 负责「听」，Nexu 负责「做」。语音进，结果出。

---

## 具体操作步骤

### Step 1：安装 ListenHub Skills

```bash
/skill install @listenhub/asr        # 语音识别
/skill install @listenhub/podcast    # 播客生成（可选）
/skill install @listenhub/tts        # 文本转语音（可选）
```

或去 [listenhub.ai/docs/zh](https://listenhub.ai/docs/zh) 下载 ASR 组件本地安装。

### Step 2：配置语音输入链路

1. 安装 ListenHub ASR 本地服务（无需 API Key，离线运行）
2. 在 Nexu 里触发语音输入 → ASR 转文字 → Agent 执行
3. 测试链路：对着 Nexu 说一句话 → 文字转写 → Agent 自动响应

### Step 3：准备演示场景

| 演示编号 | 你说什么（语音） | Nexu 做什么 | 亮点 |
|---------|----------------|------------|------|
| Demo 1 | "帮我搜一下今天 AI 圈有什么新闻" | 调 web-search → 返回摘要 | 语音→搜索→结果，3 步自动 |
| Demo 2 | "把这段内容发到 Twitter" | 调 post-to-x → 自动发推 | 说一句话就发推，最震撼 |
| Demo 3 | "帮我把这篇文章做成播客" | 调 ListenHub podcast → 输出音频 | 语音输入 → 语音输出，闭环 |
| Demo 4 | "总结一下我微信群里今天聊了什么" | 读取微信群聊 → 输出摘要 | 语音控制 IM，最贴 Nexu 定位 |

---

## Twitter Thread — 中文版（可直接发）

### (1/4) Hook

橘子 @oran_ge 的 ListenHub 刚上了免费 ASR 语音识别。

我第一反应：接到 Nexu 里试试。

结果？**对着电脑说句话，Agent 直接干活了。**

### (2/4) 演示

实测几个场景：

🎙️ "帮我搜今天 AI 新闻" → 10 秒出摘要
🎙️ "把这段发 Twitter" → 自动打开浏览器发了
🎙️ "做成播客" → 3 分钟输出一期音频

全程没碰键盘。

ListenHub 负责「听」，Nexu 负责「做」。
语音进，结果出。

### (3/4) 为什么这很重要

以前操作 Agent 的方式：打字 → 等 → 复制 → 粘贴
现在：说一句话 → 完事了

这不是「语音助手」，是 **语音控制的数字员工**。

更关键的是：
→ ListenHub ASR 完全本地离线，不传数据
→ Nexu 数据也在本地
→ 从输入到执行，全链路隐私可控

### (4/4) CTA

感谢 @oran_ge 做了这么好用的语音能力 🙌

如果你也想试试语音控制 Agent：
→ Nexu 下载：nexu.io
→ ListenHub ASR：listenhub.ai/docs/zh

两个产品都开源、都免费。
欢迎来玩 👇

#Nexu #ListenHub #OpenClaw #VoiceAgent #语音控制

---

## Twitter Thread — English Version

### (1/4) Hook

.@oran_ge just dropped a free local ASR API with ListenHub.

Naturally, I plugged it into Nexu.

Result? **Talk to your computer. Agent does the work.**

### (2/4) Demo

Quick tests:

🎙️ "Search today's AI news" → summary in 10s
🎙️ "Post this to Twitter" → auto-published
🎙️ "Turn this into a podcast" → audio ready in 3 min

Zero typing. Zero copy-paste.

ListenHub handles the ears. Nexu handles the execution.
Voice in, results out.

### (3/4) Why this matters

Old way: type → wait → copy → paste → switch tabs → repeat
New way: say it → done

This isn't a "voice assistant." It's a **voice-controlled digital coworker.**

And both products run 100% locally:
→ ListenHub ASR: offline, no data leaves your machine
→ Nexu: local-first, your data stays yours
→ End-to-end privacy from input to execution

### (4/4) CTA

Huge thanks to @oran_ge for building such a clean voice layer 🙌

Want to try voice-controlled Agents?
→ Nexu: nexu.io
→ ListenHub ASR: listenhub.ai/docs/zh

Both open-source. Both free.
Let us know what you build 👇

#Nexu #ListenHub #OpenClaw #VoiceAgent #AIagent

---

## 视频脚本（45-60 秒）

### 0:00 - 0:05 | 开场钩子

**画面**：黑屏 → 麦克风图标亮起
**字幕**：「如果你的 Agent，能听懂你说话呢？」

### 0:05 - 0:10 | 产品亮相

**画面**：Nexu 桌面客户端打开，右下角出现 ListenHub ASR 图标
**字幕**：「Nexu × ListenHub — 语音控制你的数字员工」

### 0:10 - 0:20 | Demo 1：语音搜索

**画面**：用户按住语音按钮，说 "帮我搜一下今天 AI 有什么大新闻"
→ 文字实时出现在聊天框 → Agent 搜索 → 返回摘要
**字幕**：「说一句话 → 实时转写 → Agent 自动搜索」

### 0:20 - 0:30 | Demo 2：语音发推

**画面**：用户说 "把刚才的摘要发到 Twitter"
→ Agent 调用 post-to-x Skill → 浏览器弹出 → 推文已发
**字幕**：「说一句话 → 自动发布 Twitter」

### 0:30 - 0:40 | Demo 3：语音生成播客

**画面**：用户说 "把这篇文章做成播客"
→ Agent 调用 ListenHub Podcast Skill → 进度条 → 播放按钮出现
**字幕**：「语音输入 → AI 播客输出 🎧」

### 0:40 - 0:50 | 核心卖点

**画面**：三个关键词卡片依次弹出
- 🔒 100% 本地运行
- 🎙️ 语音输入 → Agent 执行
- 🆓 开源 + 免费
**字幕**：「从输入到执行，全链路本地 + 免费」

### 0:50 - 0:60 | CTA

**画面**：Nexu Logo + ListenHub Logo 并排 → 下载链接
**字幕**：「nexu.io × listenhub.ai — 让你的 Agent 耳聪目明」

---

## 发布策略

| 步骤 | 时间 | 内容 |
|------|------|------|
| 1 | Day 0 | 私信/微信联系橘子，发送合作意向 |
| 2 | Day 1-3 | 安装调试 ListenHub ASR + Nexu 联动，录制素材 |
| 3 | Day 4 | 约橘子确认发布时间，交换素材/文案 |
| 4 | 发布日 AM | 双方同时发 Twitter Thread + 视频 |
| 5 | 发布日 +2h | 互相引用转发 + 评论区互动 |
| 6 | 发布日 +1d | 发精选用户反馈/数据追加帖 |

### 给橘子的私信模板

> 橘子老师你好！我是 Nexu 的 Celina。
>
> 看到你的 ListenHub ASR 刚上线，专为 Agent 设计正好和 Nexu 特别契合。
>
> 我们想试试「语音控制 Nexu」的玩法——用 ListenHub ASR 做语音输入，Nexu 做 Agent 执行，拍个联动短视频一起发 Twitter。
>
> 双方都是 OpenClaw 生态、都开源、都本地优先，叙事上很自然。
>
> 你看有兴趣一起玩吗？🙌

---

## Related

- [nexu&baoyuskills.md](./nexu&baoyuskills.md) — 宝玉 Skills 联动 Thread（参考结构）
- [v0.1.6-launch-thread.md](./v0.1.6-launch-thread.md) — v0.1.6 发版文案
- [ListenHub ASR 文档](https://listenhub.ai/docs/zh) — ListenHub 安装指南
- [OpenClaw × ListenHub 实战拆解](https://juejin.cn/post/7615251948597739520) — 技术集成参考
