# Nexu 技能管理架构与未来规划

## 一、技能来源层级

Nexu 桌面端运行 OpenClaw 运行时，技能从以下四个层级加载（优先级从高到低）：

```
┌─────────────────────────────────────────────────────────────────┐
│                      技能加载优先级                               │
├──────────┬──────────────────────────────────┬───────────────────┤
│ 优先级    │ 来源                             │ 可见范围           │
├──────────┼──────────────────────────────────┼───────────────────┤
│ 最高 ★★★ │ 代理工作区 (Workspace)            │ 仅该代理           │
│ 高   ★★  │ 用户个人级 (Managed/Local)        │ 所有代理           │
│ 中   ★   │ 运行时级 (Runtime/extraDirs)      │ 所有代理           │
│ 低       │ 系统内置 (Bundled)               │ 所有代理           │
└──────────┴──────────────────────────────────┴───────────────────┘
```

同名技能冲突时，高优先级覆盖低优先级。

---

## 二、各层级详细说明

### 2.1 系统内置技能 (Bundled Skills)

**来源路径：** `openclaw-runtime/node_modules/openclaw/skills/`
（打包后位于 `~/.nexu/runtime/openclaw-sidecar/node_modules/openclaw/skills/`）

**数量：** 52 个

**完整列表：**
1password, apple-notes, apple-reminders, bear-notes, blogwatcher, blucli, bluebubbles, camsnap, canvas, clawhub, coding-agent, discord, eightctl, gemini, gh-issues, gifgrep, github, gog, goplaces, healthcheck, himalaya, imsg, mcporter, model-usage, nano-banana-pro, nano-pdf, notion, obsidian, openai-image-gen, openai-whisper, openai-whisper-api, openhue, oracle, ordercli, peekaboo, sag, session-logs, sherpa-onnx-tts, skill-creator, slack, songsee, sonoscli, spotify-player, summarize, things-mac, tmux, trello, video-frames, voice-call, wacli, weather, xurl

**特征：**
- 随 OpenClaw 版本发布，用户不可修改
- 受 SKILL.md 中 `metadata.openclaw.requires` 门控（需要特定二进制、环境变量、OS 等）
- 优先级最低，可被其他任何层级同名技能覆盖
- 不需要 Nexu 管理，OpenClaw 自动加载

**Nexu 当前处理：**
- ❌ 未在 UI 中展示系统内置技能
- ❌ 未在技能账本 (skill-ledger.json) 中追踪
- ❌ config 的 `skills` allowlist 未包含系统内置技能

**Allowlist 交互行为（已确认）：**

经代码追踪确认，OpenClaw 的 `skills` allowlist 会**过滤所有来源**的技能，包括系统内置：

```
filterSkillEntries(entries, config, skillFilter, eligibility)
  → entries 包含所有来源（bundled + managed + workspace + personal + extra）
  → skillFilter 即 agent config 中的 skills 数组
  → 统一过滤，不区分来源
```

| allowlist 状态 | 行为 |
|---------------|------|
| 省略（undefined） | 代理看到所有来源的所有技能 |
| 空数组 `[]` | 代理看不到任何技能 |
| `["calendar", "weather", ...]` | 代理**仅**看到列出的技能，未列出的系统内置技能被屏蔽 |

**这是符合预期的设计意图。** Nexu 只希望代理使用 Nexu 管理的技能（SkillHub 安装、用户导入、代理工作区安装），而不是 OpenClaw 自带的全部 52 个系统技能。系统内置技能中很多是面向 OpenClaw 原生用户的（如 slack、discord、notion、tmux 等），不适合 Nexu 的桌面产品场景。

如果未来需要开放某些系统内置技能给 Nexu 用户，可以通过以下方式：
- 在 SkillHub 市场中上架对应的技能（会写入 extraDirs，自动进入 allowlist）
- 或在 config compiler 中显式将指定的系统内置技能 slug 加入 allowlist

---

### 2.2 运行时技能 (Runtime Skills / extraDirs)

**来源路径：** `~/Library/Application Support/@nexu/desktop/runtime/openclaw/state/skills/`
（开发模式下：`.tmp/desktop/openclaw-state/skills/`）

**配置方式：** OpenClaw config 中 `skills.load.extraDirs`

```json
{
  "skills": {
    "load": {
      "watch": true,
      "watchDebounceMs": 250,
      "extraDirs": ["<上述路径>"]
    }
  }
}
```

**当前包含的技能（35 个）：**
SkillHub 市场安装的技能（source: managed）+ 用户导入的自定义技能（source: custom）

**特征：**
- 所有代理共享
- 由 Nexu SkillHub 管理（安装/卸载/导入）
- 在 skill-ledger.json 中追踪
- 在 config `skills` allowlist 中列出
- `syncAll()` 在技能变更后触发 config 重写

**Nexu 当前管理状态：** ✅ 完整管理
- ✅ UI 展示：「推荐」标签页（source: managed）、「已安装」标签页（source: custom）
- ✅ 账本追踪：安装/卸载状态、时间戳
- ✅ Config 同步：安装后 ~2 秒内 config 更新
- ✅ 升级兼容：启动时磁盘↔账本对账（SkillDirWatcher.syncNow）

**未来增强：**
- 技能版本管理（当前只记录安装时间，不追踪版本更新）
- 技能自动更新检测（对比 ClawHub 最新版本）
- 技能依赖管理（某些技能依赖特定二进制或环境变量）
- 技能健康检查（验证 SKILL.md 格式、依赖可用性）

---

### 2.3 代理工作区技能 (Agent Workspace Skills)

**来源路径：** `~/Library/Application Support/@nexu/desktop/runtime/openclaw/state/agents/<botId>/skills/<slug>/`

**实际存储结构：**
```
agents/<botId>/
  ├── skills/
  │   └── obsidian -> ../.agents/skills/obsidian  (符号链接)
  └── .agents/
      └── skills/
          └── obsidian/
              └── SKILL.md  (实际文件)
```

**注意：** `clawhub install` 创建的是**符号链接**（symlink），实际文件在 `.agents/skills/` 下。

**特征：**
- 仅对该代理可见（最高优先级）
- 由代理在对话中通过 `clawhub install` 安装
- 用户不能直接通过 SkillHub UI 安装到工作区

**Nexu 当前管理状态：** ✅ 基本管理
- ✅ 启动对账：WorkspaceSkillScanner + SkillDirWatcher.syncWorkspaceDirs 扫描并记录到账本
- ✅ 账本追踪：source: "workspace"，agentId 字段标识所属代理
- ✅ Config 同步：合并到对应代理的 skills allowlist
- ✅ UI 展示：「已安装」标签页中按代理分组展示
- ✅ 符号链接检测：isSymbolicLink() 兼容 clawhub 的安装方式

**未来增强：**
- UI 中支持卸载工作区技能（目前只能从磁盘手动删除）
- 「提升为共享」功能：将工作区技能复制到运行时共享目录
- 「迁移到其他代理」功能
- 实时监听工作区变更（目前仅启动时对账，运行中依赖 syncAll 周期扫描）
- 代理对话中安装技能后立即触发 syncAll（需要 OpenClaw 事件钩子）

---

### 2.4 用户个人级技能 (User-Level Managed Skills)

**来源路径：** `~/.openclaw/skills/` 或 `~/.agents/skills/`
（取决于 OPENCLAW_HOME 环境变量设置）

**发现过程：**
在手动测试中发现，代理通过 `clawhub install` 安装技能时，实际文件写入 `~/.agents/skills/<slug>/`，然后在工作区创建符号链接指向该路径。

**特征：**
- 所有代理共享（中等优先级）
- OpenClaw 自动加载，不需要 extraDirs 配置
- 用户可以手动放置 SKILL.md 目录到此路径

**Nexu 当前管理状态：** ❌ 未管理
- ❌ 未扫描此目录
- ❌ 未在账本中追踪
- ❌ 未在 UI 中展示
- ⚠️ 但通过工作区符号链接间接可见（如果代理安装后创建了 symlink）

**当前此路径下的技能（6 个）：**
obsidian, playwright-skill, ui-ux-pro-max, vercel-composition-patterns, vercel-react-best-practices, web-design-guidelines

**未来方案：**
- 扫描 `~/.agents/skills/` (或 `~/.openclaw/skills/`) 作为第四个技能来源
- 在账本中以 source: "user" 追踪
- 在 UI 中增加「个人技能」分类
- 考虑是否纳入 config allowlist（或让 OpenClaw 自己处理这层）

---

## 三、技能加载完整流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Nexu 启动时技能加载流程                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. SkillhubService.start()                                        │
│     ├── SkillDirWatcher.syncNow()                                  │
│     │   ├── syncSharedDir()    ← 扫描 extraDirs/ 对账              │
│     │   └── syncWorkspaceDirs() ← 扫描 agents/*/skills/ 对账       │
│     ├── copyStaticSkills()     ← 复制静态打包技能                   │
│     └── initialize()           ← 下载缺失的推荐技能                │
│                                                                     │
│  2. OpenClawSyncService.syncAll()                                  │
│     ├── SkillDb.getAllInstalled() → 读取共享技能 slugs              │
│     ├── WorkspaceScanner.scanAll() → 扫描工作区技能                │
│     ├── compileOpenClawConfig()                                     │
│     │   └── compileAgentList()                                     │
│     │       └── 每个代理: skills = [...共享, ...该代理工作区]       │
│     └── ConfigWriter.write() → 写入 openclaw.json                  │
│                                                                     │
│  3. OpenClaw 运行时                                                │
│     ├── 读取 openclaw.json → 获取 agents.list[].skills allowlist   │
│     ├── 加载 bundled skills (52 个内置)                            │
│     ├── 加载 ~/.agents/skills/ (用户个人级)                        │
│     ├── 加载 extraDirs/ (运行时级)                                 │
│     ├── 加载 workspace/skills/ (代理工作区)                        │
│     └── 按 allowlist 过滤 → 最终技能集                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 四、UI 页面设计建议

### 当前设计

```
技能页面
├── 你的技能 (Yours)
│   ├── 全部 (34)        → 所有已安装技能
│   ├── 推荐 (32)        → source: managed（SkillHub 市场）
│   └── 已安装 (2)       → source: custom + workspace
│       ├── [自定义共享技能]
│       │   └── taobao-native
│       └── [由 Nexu Assistant 安装]
│           └── obsidian
└── 探索 (Explore)       → ClawHub 市场浏览
```

### 建议的增强设计

```
技能页面
├── 你的技能 (Yours)
│   ├── 全部 (N)          → 所有层级技能汇总
│   ├── 市场技能 (32)     → source: managed（SkillHub 安装）
│   ├── 自定义技能 (1)    → source: custom（zip 导入）
│   ├── 代理技能 (1)      → source: workspace（代理安装）
│   │   └── [按代理分组]
│   │       ├── Nexu Assistant (ID: 27c2e...)
│   │       │   └── obsidian
│   │       └── Support Bot (ID: 3fa8b...)
│   │           └── ticket-helper
│   ├── 个人技能 (6)      → source: user（~/.agents/skills/）
│   │   └── playwright-skill, ui-ux-pro-max, ...
│   └── 系统技能 (52)     → bundled（只读展示）
│       └── [按分类折叠]
│           ├── 生产力: apple-notes, apple-reminders, ...
│           ├── 开发: github, gh-issues, coding-agent, ...
│           ├── 通讯: slack, discord, imsg, ...
│           └── 媒体: nano-banana-pro, video-frames, ...
└── 探索 (Explore)        → ClawHub 市场浏览
```

### 各分类展示要素

| 分类 | 来源标识 | 操作 | 额外信息 |
|------|---------|------|---------|
| 市场技能 | `SkillHub` 标签 | 卸载、更新检查 | 安装时间、版本 |
| 自定义技能 | `自定义` 标签 | 卸载 | 导入时间 |
| 代理技能 | `代理名称` 标签 | 卸载、提升为共享 | 代理名称、代理ID、安装时间 |
| 个人技能 | `个人` 标签 | 打开文件夹、删除 | 文件路径 |
| 系统技能 | `系统` 标签 | 无（只读） | 需要的环境变量/依赖、平台兼容性 |

### 技能详情页增强

每个技能详情页应展示：

```
┌─────────────────────────────────────────┐
│  obsidian                               │
│  ────────────────────────────           │
│  来源: 代理工作区                        │
│  代理: Nexu Assistant                    │
│  代理 ID: 27c2e2ff-e42b-...             │
│  安装时间: 2026-03-28 16:16              │
│  优先级: ★★★ (工作区 > 共享 > 内置)      │
│                                         │
│  状态指示:                               │
│  ✅ SKILL.md 存在                        │
│  ✅ 在 config allowlist 中               │
│  ⚠️ 覆盖了系统内置同名技能               │
│                                         │
│  路径: ~/Library/.../agents/.../skills/  │
│                                         │
│  [卸载] [提升为共享] [查看 SKILL.md]     │
└─────────────────────────────────────────┘
```

---

## 五、当前状态总结与待办事项

### 已完成 ✅

| 功能 | 状态 |
|------|------|
| SkillHub 市场安装/卸载/导入 → config 即时同步 | ✅ |
| 代理工作区技能启动对账 | ✅ |
| 符号链接技能检测 | ✅ |
| 升级兼容（空账本 → 对账重建） | ✅ |
| 每代理 skills allowlist | ✅ |
| UI 展示代理技能（按代理分组） | ✅ |

### 短期待办 🔜

| 功能 | 优先级 | 说明 |
|------|--------|------|
| ~~系统内置技能与 allowlist 交互确认~~ | ~~高~~ | ✅ 已确认：allowlist 屏蔽内置技能，符合预期 |
| 扫描 `~/.agents/skills/` 用户个人级 | 高 | 新增 source: "user"，避免技能丢失 |
| UI 中卸载工作区技能 | 中 | 目前只能手动删除文件 |
| 运行时实时监听工作区变更 | 中 | 不仅在启动时对账 |

### 中期规划 📋

| 功能 | 说明 |
|------|------|
| 系统技能只读展示 | UI 中展示 52 个内置技能，标注依赖和平台 |
| 个人技能 UI 展示 | 展示 `~/.agents/skills/` 中的技能 |
| 技能版本追踪 | 对比 ClawHub 最新版本，提示更新 |
| 技能健康检查 | 验证 SKILL.md 格式、依赖可用性 |
| 工作区技能「提升为共享」 | 从代理工作区复制到共享目录 |

### 长期愿景 🔮

| 功能 | 说明 |
|------|------|
| 技能市场评分与评论 | 用户反馈驱动的技能质量信号 |
| 技能沙箱执行 | 不受信任的技能在隔离环境运行 |
| 多机器技能同步 | 通过云端同步已安装技能列表 |
| 技能组合/工作流 | 多个技能串联为工作流模板 |

---

## 六、技能来源对照表

| 磁盘路径 | 来源类型 | source 值 | Nexu 管理 | UI 可见 | allowlist |
|----------|---------|-----------|----------|---------|-----------|
| `openclaw/skills/` (npm 包) | 系统内置 | — | ❌ | ❌ | ❌ 符合预期，被 allowlist 屏蔽 |
| `~/.agents/skills/` | 用户个人级 | — | ❌ | ❌ | ❌ 待实现 |
| `state/skills/` (extraDirs) | 运行时共享 | managed/custom | ✅ | ✅ | ✅ |
| `state/agents/<id>/skills/` | 代理工作区 | workspace | ✅ | ✅ | ✅ |
