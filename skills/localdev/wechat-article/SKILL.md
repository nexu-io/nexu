# Skill: Nexu 公众号文章排版与发布

> 基于 2026 年 4 月最新已发布文章（蒸馏 CEO + Claude 封号指南）提取的标准化排版流程。

## 触发词

公众号、微信文章、排版、排公众号、发布公众号、md 转公众号、公众号 HTML

---

## 一、排版流水线（三步走）

所有公众号文章统一使用以下流水线，不再手写 HTML。

### 第一步：Markdown → HTML

使用 `baoyu-markdown-to-html` 的 **grace 主题 + black 配色**：

```bash
bun ~/.claude/skills/baoyu-markdown-to-html/scripts/main.ts <input.md> --theme grace --color black
```

首次使用先装依赖：

```bash
cd ~/.claude/skills/baoyu-markdown-to-html/scripts && bun install
```

**注意：不要** 加 `--keep-title`，正文不含 H1 标题。标题通过发布参数传入。

### 第二步：颜色后处理

转换完成后，用 StrReplace（`replace_all: true`）做两轮全局替换：

| 原始值 | 替换为 | 用途 |
|--------|--------|------|
| `color: #3f3f3f` | `color: #888888` | 正文灰色（阅读舒适） |
| `color: #333333` | `color: #1a1a1a` | 加粗近黑（强调清晰） |

### 第三步：删除正文封面图

如果 Markdown 中第一张图是封面图，转换后会出现在 HTML 开头。**发布前必须删除 `<p><img ...></p>` 封面图标签**，封面图通过 `--thumb` 参数单独上传。

---

## 二、排版设计令牌（从已发布 HTML 逐属性提取）

以下所有 CSS 值均从已发布文章（`distill-skill-guide-publish.html` + `claude-ban-survival-guide-publish.html`）的内联 `style=""` 中逐属性抄录，作为排版效果的 ground truth。

### 2.1 容器

```css
/* <body> */
body {
  padding: 24px;
  background: #ffffff;
  max-width: 860px;
  margin: 0 auto;
  font-family: -apple-system-font, BlinkMacSystemFont, Helvetica Neue,
               PingFang SC, Hiragino Sans GB, Microsoft YaHei UI,
               Microsoft YaHei, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.75;
  text-align: left;
}

/* <section class="container"> — 继承 body */
section.container {
  font-family: /* 同 body */;
  font-size: 16px;
  line-height: 1.75;
  text-align: left;
}
```

### 2.2 段落 `<p>`

```css
p {
  margin: 1.5em 8px;
  letter-spacing: 0.1em;
  color: #888888;
}
```

### 2.3 加粗 `<strong>`

```css
strong {
  color: #1a1a1a;
  font-weight: bold;
  font-size: inherit;
}
```

视觉效果：在 `#888888` 灰色正文中，`#1a1a1a` 近黑加粗跳出来形成对比。

### 2.4 引用块 `<blockquote>`

```css
blockquote {
  margin-top: 0;
  margin-right: 0;
  margin-left: 0;
  background: #f7f7f7;
  font-style: italic;
  padding: 1em 1em 1em 2em;
  border-left: 4px solid #333333;
  border-radius: 6px;
  color: rgba(0, 0, 0, 0.6);
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
  margin-bottom: 1em;
}

/* 引用块内的段落 */
blockquote p {
  display: block;
  font-size: 1em;
  letter-spacing: 0.1em;
  color: #888888;
  margin: 0;
}
```

### 2.5 分隔线 `<hr>`

```css
hr {
  border-style: solid;
  border-width: 2px 0 0;
  border-color: rgba(0, 0, 0, 0.1);
  -webkit-transform-origin: 0 0;
  -webkit-transform: scale(1, 0.5);
  transform-origin: 0 0;
  transform: scale(1, 0.5);
  height: 1px;
  border: none;
  margin: 2em 0;
  background: linear-gradient(to right,
    rgba(0, 0, 0, 0),
    rgba(0, 0, 0, 0.1),
    rgba(0, 0, 0, 0));
}
```

### 2.6 无序列表 `<ul>` / `<li>`

```css
ul {
  margin-left: 0;
  color: #888888;
  list-style: none;
  padding-left: 1.5em;
}

li {
  display: block;
  color: #888888;
  margin: 0.5em 8px;
}
```

列表项以手动 `•` 字符作为文本前缀，不使用 CSS `list-style`。加粗的列表项内 `<strong>` 仍为 `color: #1a1a1a`。

### 2.7 图片 `<img>`

```css
img {
  display: block;
  width: 100%;
  margin: 1.5em auto;
}
```

图片总是包裹在 `<p>` 中：`<p class="p" style="..."><img ...></p>`。

### 2.8 行内代码 `<code>`

```css
code {
  font-size: 90%;
  color: #d14;
  background: rgba(27, 31, 35, 0.05);
  padding: 3px 5px;
  border-radius: 4px;
}
```

### 2.9 颜色速查表

| 用途 | 色值 | 来源 |
|------|------|------|
| 正文文字 | `#888888` | 后处理（原 `#3f3f3f`） |
| 加粗文字 | `#1a1a1a` | 后处理（原 `#333333`） |
| 列表文字 | `#888888` | 后处理 |
| 引用块边框 | `#333333` | grace 主题原生 |
| 引用块背景 | `#f7f7f7` | grace 主题原生 |
| 引用块文字 | `rgba(0, 0, 0, 0.6)` | grace 主题原生 |
| 引用块内段落 | `#888888` | 后处理 |
| 行内代码文字 | `#d14` | grace 主题原生 |
| 行内代码背景 | `rgba(27, 31, 35, 0.05)` | grace 主题原生 |
| 页面背景 | `#ffffff` | grace 主题原生 |

---

## 三、标准内容结构

从已发布文章提取的统一结构模式：

### 3.1 开头：Star 引导引用块

每篇文章正文第一个元素是一个 `<blockquote>`，引导读者 Star：

```
> nexu 是一个可以一键安装的 OpenClaw 桌面客户端，让你在本地用 AI 操控一切。
> GitHub：https://github.com/nexu-io/nexu ，觉得有用的话帮忙点个 Star 支持一下 🌟
```

### 3.2 正文：分节图 + 分隔线节奏

文章按章节组织，章节之间用 **`<hr>` 分隔线 + 分节横幅图** 的组合来过渡：

```
段落正文...

---                          ← hr 分隔线
![](imgs-xxx/02-section.png) ← 分节横幅图
段落正文...

---
![](imgs-xxx/03-section.png)
段落正文...
```

分节横幅图编号从 `02-section.png` 开始（`01` 留给封面图），通常 4-6 张。

### 3.3 结尾：CTA + 二维码

```
---

**nexu** 是一个可以一键安装的 OpenClaw 桌面客户端...

**GitHub：https://github.com/nexu-io/nexu**

进群还能领 **Seedance 2.0 视频生成免费额度**，名额有限，先到先得。

扫码加入龙虾社区，一起交流 AI Agent 和本地开发工作流：

![](imgs-xxx/qr-both-groups.png)
```

---

## 四、发布到公众号草稿箱

**重要：先用 `open` 命令在浏览器打开本地 HTML 预览，等用户确认后再推送。不要自动推送。**

```bash
node skills/nexubot/wechat-mp-draft/scripts/publish-html-draft.mjs \
  <publish.html> \
  --thumb <cover.png> \
  --title "文章标题" \
  --digest "一句话摘要（手动撰写，不超过 64 字）"
```

### 发布参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `<HTML文件路径>` | 是 | 本地公众号 HTML 文件 |
| `--thumb <路径>` | 推荐 | 封面图路径（省略时取正文第一张图） |
| `--title <标题>` | 推荐 | 文章标题（正文中不含 H1） |
| `--digest <摘要>` | 推荐 | 一句话摘要，口语化有行动感 |

### 环境变量

`.env` 文件位于 `skills/nexubot/wechat-mp-draft/scripts/.env`：

```
WECHAT_APP_ID=<your_app_id>
WECHAT_APP_SECRET=<your_app_secret>
WECHAT_ARTICLE_AUTHOR=Next to you 的 nexu
```

---

## 五、发布规范（强制）

### A. 标题不进正文

正文 HTML 不含 `<h1>`。标题通过 `--title` 参数传入。

### B. 摘要手动指定

每篇文章用 `--digest` 传入一句话摘要（≤64 汉字），不依赖自动截取。

### C. 封面图单独指定

封面图通过 `--thumb` 参数指定，不放入正文 HTML。建议尺寸 900×383 或 900×500。

### D. 微信链接处理

微信公众号正文不支持超链接跳转。所有外部链接写成完整文本 URL，不使用 `<a>` 标签。

### E. 社群二维码

文章末尾统一使用最新二维码文件：
- 源文件：`/Users/joey/.cursor/projects/Users-joey-Desktop-nexu/assets/_____-38e21ace-929c-4f23-9637-a4a34f0115c9.png`
- 复制到文章 `imgs-*` 目录下，命名为 `qr-both-groups.png`

---

## 六、文章目录结构

每篇文章在 `skills/localdev/wechat-article/` 下组织：

```
skills/localdev/wechat-article/
├── SKILL.md                              ← 本文件（排版规范）
├── <slug>.md                             ← Markdown 源文件
├── <slug>-publish.html                   ← 公众号发布用 HTML（grace+black+后处理）
├── <slug>.html                           ← 本地预览 HTML（可选）
└── imgs-<slug>/                          ← 配图子目录
    ├── 01-cover.png                      ← 封面图
    ├── 02-section.png ~ 06-section.png   ← 分节图
    ├── <content-images>.png              ← 内容截图
    └── qr-both-groups.png                ← 社群二维码
```

### 命名约定

- Markdown / HTML 用 kebab-case 命名
- 封面图以 `01-cover` 开头
- 分节横幅图以 `0X-section` 编号
- 二维码固定命名 `qr-both-groups.png`

---

## 七、合规风控检查（发布前必过）

| 检查项 | ❌ 禁止 | ✅ 替代方案 |
|--------|---------|------------|
| 绝对化 | 免费无限量、最好用、全网第一 | 以官网公示为准 |
| 替官方背书 | 微信官方推荐、不会封号 | 以微信官方说明为准 |
| 敏感词 | 翻墙、VPN、破解 | 在常用网络环境下即可使用 |
| 标题红线 | ChatGPT / OpenAI 作标题主体 | 可正文提及，不做标题重点 |
| 外链密度 | 重复出现同一链接 5+ 次 | 精简到 2-3 次自然出现 |

---

## 八、已发布文章索引

| 文章 | 主题 | Markdown | 发布 HTML | 配图目录 |
|------|------|----------|-----------|----------|
| 蒸馏 CEO | grace+black ✅ | `distill-skill-guide.md` | `distill-skill-guide-publish.html` | `imgs-distill/` |
| Claude 封号指南 | grace+black ✅ | — | `claude-ban-survival-guide-publish.html` | `imgs-claude-ban/` |
| Seedance 2.0 | 旧蓝色 ⚠️ | `nexu-seedance2-article.md` | `nexu-seedance2-article.html` | `imgs/` |
| v0.2.0 更新 | 手写 ⚠️ | `nexu-v0.2.0-release-wechat.md` | `nexu-v0.2.0-release-wechat.html` | — |

**⚠️ 标记**：Seedance 那篇使用旧蓝色主题（`#0F4C81` 强调色，白底蓝标题），v0.2.0 那篇是手写 HTML 预览。新文章一律使用 grace+black+颜色后处理流程。
