# OpenClaw 升级风险评估：为替换 PI Agent 而升级

> 调研时间：2026-04-14
> 当前 Nexu 内置版本：`2026.3.7`（`openclaw-runtime/package.json`）
> **升级目标**：让 Nexu 能把底层 PI agent runtime 替换为 Codex 等可插拔 harness

---

## 1. 目标与前提

Nexu 升级 OpenClaw 的**唯一驱动力**是：能够在 embedded agent turn 中用 Codex（或未来其他 harness）替换内置 PI runtime，从而获得：

- 原生 Codex app-server thread 管理（resume / compaction / model discovery）
- Codex-managed 的 OAuth 认证，不需要 OpenAI API key
- 为将来接入其他原生 agent runtime（Claude native agent、Gemini agent 等）铺路

**结论先行**：

| 问题 | 答案 |
|------|------|
| 能不能升？ | 能 |
| 升到哪个版本？ | **`v2026.4.12`** |
| 能不能立刻用 Codex harness？ | ⚠️ 能跑起来，但官方明确标记 harness 还不稳定（见 §3） |
| 工程量多大？ | 中等（两个 channel 插件可以直接换官方版本，4 个 platform plugin 免疫 SDK 重构） |

### 核心兼容性发现（调研摘要）

跨 3.7 → 4.12 的 13,667 个 commit，逐一核对 Nexu 与 OpenClaw 的所有耦合接口，主要发现：

| 维度 | 结论 |
|------|------|
| **Config schema 差异** | 极小 —— Nexu compiler 输出的字段 4.12 全部兼容；只有 2 处 Zod enum 不匹配（`tools.exec.host` 新增 `"auto"`、`timeFormat` 枚举值从 `"12h/24h"` 改为 `"12/24/auto"`），加上需新增 1 个 optional `embeddedHarness` 字段 |
| **WS 协议** | 字节级兼容 —— 协议版本仍 v3，握手 payload 格式 `v3\|deviceId\|...\|deviceFamily` 未变；Nexu 用到的 6 个 RPC + 3 个事件全部 additive-only，零改动 |
| **Plugin SDK** | Nexu 真正受影响的只有 2 个 channel 副本，且都有官方替代；4 个自研 platform plugin 用 duck-type API 免疫 SDK 重构 |
| **Harness 生态** | 100 个内置 extension 中只有 `codex` 实现 `AgentHarness`；社区零可用第三方 harness；官方 #66251 仍 open |
| **状态目录 / lock 文件** | 路径和格式全部保留（`agents/*/sessions/*.jsonl.lock`、`$TMPDIR/openclaw-<uid>/gateway.*.lock`、`identity/device.json` 等） |
| **CLI 入口 / 环境变量** | `gateway run --port` 未变；`OPENCLAW_CONFIG_PATH` / `OPENCLAW_STATE_DIR` / `OPENCLAW_GATEWAY_TOKEN` 全部保留；legacy `CLAWDBOT_*` / `MOLTBOT_*` Nexu 未使用 |
| **BYOK / auth 路径** | `models.providers.<runtimeKey>` schema、`agents/<id>/agent/auth-profiles.json` 路径、`api_key` / `oauth` profile shape 全部保留；4 个 platform plugin 用的 6 种 hook（`before_model_resolve` / `before_prompt_build` / `llm_output` / `message_sending` / `before_agent_start` / `agent_end`）全部保留 |
| **Skill 集成** | `agents.list[].skills` allowlist、`skills.load.extraDirs + watch + watchDebounceMs` 全部保留；Nexu `7a03c2b0` 的 batch fix 仍然 load-bearing |
| **Nexu 避免无端重启的保护机制** | 12 项保护（stale lock 清理、孤儿进程扫描、circuit breaker、config identical skip、prewarm 等）在 4.12 下 10 项仍有效，2 项需小幅适配（launchd supervisor restart 语义 + prewarm plugin manifest 验证） |
| **运行时利好** | OpenClaw 4.x 多处新增和 Nexu 叠加的双保险：tick broadcast non-droppable、config.patch noop guard、self-write hash dedup、Windows/macOS gateway lock PID 回收检测 |

**Nexu 实际需要改动的代码面**（详见 §6）：
- 2 处 Zod enum 修正
- 1 个 `embeddedHarness` schema + compiler 输出
- `openclaw-process.ts` 的 successor PID 检测扩展 + launchd 模式断言
- 删除 2 个 channel 插件副本并启用官方版
- 4 个 platform plugin、WS 客户端、BYOK、skill install 均无需改动

---

## 2. 从哪个版本开始支持替换底层 harness？

### Agent Harness Plugin API 的引入时间线

| 能力 | 引入版本 | commit |
|------|---------|--------|
| `AgentHarness` plugin SDK 接口 | 随 plugin SDK 重构于 v2026.3.22 成型 | — |
| **Codex harness 作为独立 extension 发布** | **`v2026.4.10`**（2026-04-10） | `dd26e8c` |
| `embeddedHarness` config 字段（`runtime` + `fallback`） | v2026.4.10 前后 | — |
| `OPENCLAW_AGENT_RUNTIME` 环境变量 | v2026.4.10 | — |
| `OPENCLAW_AGENT_HARNESS_FALLBACK=none` 禁用 PI fallback | v2026.4.10 | — |

**关键结论**：**v2026.4.10 是下限**。低于 4.10 的版本没有任何可用的 harness 替换能力。

### Codex 是目前唯一的 harness 实现

在 origin/main 上 `git grep AgentHarness` 确认：**100 个内置 extension 中只有 `extensions/codex/` 实现了 `AgentHarness` 接口**。其他 Anthropic、Gemini、DeepSeek 等都只是 provider plugin，不是 harness。

社区侧（npm、ClawHub、GitHub 搜索）也**没有任何可用的第三方 harness 插件**——几个声称的仓库（`wang546673478/openclaw-plugins`、`evalops/openclaw-safety-harness`）都是 0 star 实验性质。

所以如果未来要接 Codex 之外的 harness，需要自己写。API 在那里，但生态是空的。

---

## 3. 升级目标版本：为什么选 v2026.4.12

### 各候选版本口碑

| 版本 | 主要问题 / 亮点 | 稳定度 |
|------|----------------|-------|
| 4.5 | ❌ Worker 进程独立加载所有插件导致 CPU 跑满；SSRF 新检查破坏 loopback+LAN IP 组合；Slack 每 35 分钟重连 | 差 |
| 4.9 | ❌ Windows 下 CLI 命令 hang 被 SIGKILL | 差 |
| **4.10** | ⭐ **Codex harness 首发**；❌ 但在 macOS 上 init 时无限 hang（codex-cli 0.118.0/0.120.0 都复现） | 差（harness 不可用） |
| 4.11 / 4.11-beta.1 | ❌ Codex app-server JSON parser 被 NODE_OPTIONS preload 的 stderr 搞崩；QQ Bot 图片下载被 SSRF guard 挡掉；WhatsApp 语音 idle 时跳过转写 | 差 |
| **4.12** | ✅ 质量修复版本：memory/dreaming 可靠性提升、gateway 检测占位 token、native 依赖跨平台恢复、4.10/4.11 多个 regression 修复 | **相对最好** |
| 4.13 | 没有公开信息 | 未知 |
| 4.14 / 4.14-beta.1 | 太新，社区无实战反馈 | 未知 |

### 为什么是 4.12 而不是更高

1. **4.12 是 4.10/4.11 后的第一个 stabilization 版本**——专门修 regression，不加新功能
2. 4.13/4.14 太新，社区还没跑过生产，踩坑风险高
3. harness 能力在 4.12 上已经全部存在（4.10 之后没有再移除/重构）
4. Codex harness 官方本身不稳定（见 §4），再追新版本也解决不了这个问题

### 为什么不是 4.10

- 4.10 的 Codex harness 有 init hang bug（issue #64744），在 macOS 上直接不可用
- Nexu 桌面端主打 macOS，这个 bug 是 showstopper

### Codex Harness 专项风险（issue #66251，**仍 open**）

OpenClaw 官方自己挂了一个 "Track Codex harness stability work" 跟踪 issue，明确承认 harness 目前**不稳定**，涉及 4 类问题：

1. Gateway 启动时 model catalog 注册失败
2. App-server 初始化 hang / 协议鲁棒性
3. Reset 操作后状态保留错误
4. Compaction 后 context 使用量误报

官方自己的话："Codex-backed sessions can fail to start through the expected harness, preserve stale native context after reset, or report misleading context usage after compaction."

**含义**：即便升到 4.12，Codex harness 也还是 beta 级别的质量，不应作为生产默认。推荐策略：

- **默认保持 `embeddedHarness.runtime: "auto"` + `fallback: "pi"`**
- **个别测试 bot 显式用 `codex/gpt-5.4` 试水**
- **不要整站切到 `fallback: "none"`**
- 等官方 #66251 关闭后再考虑把 Codex 作为主 runtime

---

## 4. 接口层兼容性

接口层指 OpenClaw 公开给外部消费者的"约定"：config schema、plugin SDK import 路径、CLI 入口、状态目录布局、环境变量名、安全策略等。

### 🔴 红色风险（直接会炸）

#### R1. Plugin SDK 路径全部重构（v2026.3.22）

v2026.3.22 删除了 `openclaw/extension-api`，**没有 compat shim**。新路径是 `openclaw/plugin-sdk/*` 的子路径化 import。

Nexu 受影响的代码全部在两个 channel 插件副本里（处理方案见 §6）：

| 插件 | 位置 | 处理 |
|------|------|------|
| WhatsApp | `apps/controller/static/runtime-plugins/whatsapp/` | 删除副本，启用 OpenClaw 内置版 |
| WeChat | `apps/controller/static/runtime-plugins/openclaw-weixin/` | 升级到 `@tencent-weixin/openclaw-weixin@2.1.8` |

Nexu 自研的 4 个 platform plugin（`nexu-runtime-model`、`nexu-credit-guard`、`nexu-platform-bootstrap`、`langfuse-tracer`）**没有 import plugin SDK**，使用 duck-type 的 `register(api)` API，不受此重构影响。

#### R2. Zod Schema 与 OpenClaw 实际类型不一致

文件：`packages/shared/src/schemas/openclaw-config.ts`

| 字段 | Nexu schema | OpenClaw 实际 |
|------|------------|-------------|
| `tools.exec.host` (line 480) | `"sandbox" \| "gateway" \| "node"` | 新增 `"auto"` |
| `agents.defaults.timeFormat` (line 216) | `"12h" \| "24h"` | `"auto" \| "12" \| "24"` |

**影响**：config 读回验证失败，controller 启动 crash。**可独立于升级先修**。

#### R3. 缺少 harness 配置字段（启用 Codex 的前提）

为了真正用上 Codex harness，Nexu 的 Zod schema 必须新增：

```ts
// packages/shared/src/schemas/openclaw-config.ts
embeddedHarness: z.object({
  runtime: z.string().optional(), // "auto" | "pi" | "codex" | <plugin-id>
  fallback: z.enum(["pi", "none"]).optional(),
}).optional()
```

同时 config compiler 要在 `agents.defaults` 或 per-agent 配置里输出该字段。

### 🟠 橙色风险（可能会炸）

#### R4. `gateway.auth` 认证模式收紧（v2026.3.31）

`trusted-proxy` 拒绝混合 shared-token 配置，implicit same-host 认证被移除。Nexu 同时设 `OPENCLAW_GATEWAY_TOKEN` + `--auth none`（dev 模式），需确认不被新严格性误杀。

#### R5. CLI 入口路径

`openclaw-process.ts:40` 解析 `../node_modules/openclaw/openclaw.mjs` 作为 OpenClaw 入口。如果上游改名则 spawn silent fail。

#### R6. Workspace plugin 自动加载被禁用（v2026.3.12 安全加固）

Nexu 在 `plugins.load.paths: [env.openclawExtensionsDir]` 加载自研 plugin，需验证新版本是否仍自动信任此路径。

### 🟡 黄色风险（无影响或仅需配置调整）

| 项 | 说明 |
|----|------|
| Session reset 默认行为 | Nexu 覆盖为 `idleMinutes: 525600`，需验证仍被尊重 |
| xAI / Firecrawl 配置路径迁移（v2026.4.2） | Nexu 未使用，无影响 |
| Legacy config 别名清理（v2026.4.5） | `talk.*`、`sandbox.perSession` 等，Nexu 未使用，无影响 |
| 新内置 provider/channel | LM Studio、Arcee、QQ Bot 等需要 `plugins.allow` 白名单放行才能用 |

---

## 5. 运行时行为兼容性

运行时行为指系统跑起来之后的实际语义：WS 协议握手、进程生命周期、文件 watcher 触发、hook 调用顺序等。这一层和接口层不同：即使 schema 没变，行为也可能变。

### 5.1 WS RPC 调用与事件 — 🟢 绿色

Nexu 的所有 6 个 RPC 调用 + 3 个事件订阅在 v2026.3.7 → v2026.4.12 全部向后兼容。协议版本仍是 v3，握手字节完全一致（`v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily`）。**Nexu 侧零改动**。

| # | 方法/事件 | Nexu 使用位置 | 3.7 → 4.12 变化 |
|---|---------|-------------|--------------|
| 1 | `connect` (handshake) | `openclaw-ws-client.ts:681` | 新增可选 `auth.bootstrapToken` / `deviceTokens[]`，纯 additive |
| 2 | `send` | `openclaw-gateway-service.ts:222` | 内部 dispatch 重写，`SendParams` schema 和返回字段全部保留 |
| 3 | `channels.status` | `openclaw-gateway-service.ts:281` | 新增 `applyPluginAutoEnable`（服务端行为），返回 shape 加一个可选 `healthState?: string` |
| 4 | `channels.logout` | `openclaw-gateway-service.ts:267` | 未变 |
| 5 | `web.login.start` | `openclaw-gateway-service.ts:593` | 文件字节级完全相同 |
| 6 | `web.login.wait` | `openclaw-gateway-service.ts:601` | 文件字节级完全相同 |
| 7 | Event `connect.challenge` | `openclaw-ws-client.ts:547` | `{nonce}` shape 未变 |
| 8 | Event `tick` | `openclaw-ws-client.ts:563` | **利好**：`dropIfSlow` 被移除，tick 现在 non-droppable，Nexu 60s watchdog 误触发概率降低 |
| 9 | Event `shutdown` | `openclaw-ws-client.ts:568` | `{reason, restartExpectedMs}` 未变 |

**错误码**：Nexu 依赖的两个 close reason 字符串（`"device token mismatch"`, `"device signature invalid"`）在 `handshake-auth-helpers.ts` 中仍然 verbatim 使用。

**新机会（非必需）**：`message.action` RPC（新增）、`HelloOk.auth.deviceTokens[]`（多 role token）—— 未来 Codex harness 若需要结构化 channel action 可以用上。

### 5.2 进程生命周期 / 避免无端重启 — 🟠 橙色

Nexu 花了大量精力避免 OpenClaw 无端重启，这些保护机制在升级后大部分仍然有效，但 **packaged launchd 模式下 supervisor restart 语义变了**，需要小幅适配。

#### Nexu 侧完整保护矩阵

| 机制 | 位置 | 升级后状态 |
|------|------|----------|
| Stale session lock 清理 (`agents/*/sessions/*.lock`) | `openclaw-process.ts:568` | ✅ 格式未变（仍是 `.jsonl.lock`） |
| Stale gateway lock 清理 (`$TMPDIR/openclaw-<uid>/gateway.*.lock`) | `openclaw-process.ts:598` | ✅ 格式未变；OpenClaw 4.x 新增 PID 回收检测作为双保险 |
| 孤儿进程扫描 (Linux `/proc` + macOS `pgrep`) | `openclaw-process.ts:617` | ✅ 进程命令行仍含 `openclaw` + `gateway` |
| Supervisor restart 抑制 (`controlledRestartExpected`) | `openclaw-process.ts:351` | ⚠️ launchd 模式下 successor PID 正则失效（见下） |
| `MAX_CONSECUTIVE_RESTARTS=10` / 120s 窗口 circuit breaker | `openclaw-process.ts` | ✅ 独立逻辑 |
| Config 写入 identical skip | `openclaw-config-writer.ts:90` | ✅ OpenClaw 也加了 self-write hash dedup，双保险 |
| `plugins.allow` 排序 + prewarm `feishu`/`openclaw-weixin` | `openclaw-config-compiler.ts:278-309` | ⚠️ 需验证 plugin 仍被 bundle（见下） |
| `appendFile("")` watch trigger | `openclaw-watch-trigger.ts` | ✅ chokidar 行为未变 |
| SkillHub `onIdle` batching (commit `7a03c2b0`) | `install-queue.ts:205` | ✅ 仍然 load-bearing（见 §5.3） |
| WS tick watchdog 60s | `openclaw-ws-client.ts:774` | ✅ OpenClaw tick non-droppable 修复让此机制更稳 |
| Launchd `KeepAlive.OtherJobEnabled`（OpenClaw 绑 controller） | `plist-generator.ts:371` | ⚠️ 需适配（见下） |
| Runtime identity 多字段 attach 决策 | `launchd-bootstrap.ts:742` | ✅ 独立逻辑 |

#### 关键风险：Launchd 模式下 supervisor restart 语义变了

**v3.7 行为**：OpenClaw 自己 fork 一个 detached 后继进程，stdout 打 `spawned pid 12345`，Nexu 正则提取 PID，观察 successor 是否存活。

**v4.12 行为**（commit `a65ab607c7` "fix(gateway): use launchd KeepAlive restarts"）：
- OpenClaw 在 launchd 下改为 **clean exit(0)** + 1.5s 等待避免 launchd throttle
- stdout 打 `restart mode: full process restart (supervisor restart)`（**没有 PID**）
- 依赖 launchd `KeepAlive` 把它拉起来

**对 Nexu 的影响**：
- `openclaw-process.ts:215` 的正则 `/spawned pid\s+(\d+)/i` 匹不到
- `controlledRestartSuccessorPid` 永远是 null
- `awaitControlledRestart` 只能靠端口 probe 推进，45s 后若 launchd relaunch 还没完成 → fallback 到 `scheduleRestart()` 由 controller 自己 spawn child
- 但 controller 此时不应管理 OpenClaw 进程（launchd 才是 owner），双方会撞车

**关键验证点**：packaged 模式下 `RUNTIME_MANAGE_OPENCLAW_PROCESS=false` 必须生效。从 `plist-generator.ts` 看是设置了的，但需要实测：
- `apps/controller/src/app/env.ts` 里 `manageOpenclawProcess` 应读到 false
- Controller 完全不该调 `OpenClawProcessManager.start()`

**建议代码改动**：

1. 扩展 successor PID 匹配，让 launchd 路径也能显式识别：
   ```ts
   // openclaw-process.ts:215
   const isControlledRestart = line.includes("restart mode: full process restart (");
   const pidMatch = line.match(/spawned pid\s+(\d+)/i);
   // 已有 isControlledRestart 标记，pid 缺失时依赖 port probe
   ```

2. 在 `OpenClawProcessManager.start()` 入口加断言：检测到 `OPENCLAW_SERVICE_MARKER==="launchd"` 时拒绝启动 + warn。

3. 或延长 `CONTROLLED_RESTART_GRACE_MS` 到 60-90s，容忍 launchd relaunch + sidecar preload 延迟。

#### 次要风险：Prewarm plugin 可能失效

v4.x 的 plugin loading narrowing（#65120, #65259, #65298, #65429, #65459）要求 plugin manifest 声明激活需求。Nexu 在 `plugins.allow` 硬编码了 `["feishu", "openclaw-weixin"]` prewarm + `langfuse-tracer`。需验证这些在 4.12 下：
- 仍在 bundled plugin 列表里
- Manifest 声明了正确的 scope
- 不然 hot-reload 会退化成完整 gateway restart（Nexu 规避的 ~11s drain 重现）

#### OpenClaw 4.x 带来的多个利好

| Commit | 内容 | 影响 |
|--------|------|-----|
| `915e15c13d` | config.patch 空 diff 时 `noop:true`，不 SIGUSR1 | 和 Nexu `lastWrittenContent` skip 叠加双保险 |
| `7cf8ccf9b3` | 启动时内部写（auth token）用 hash 去重 | 冷启动更稳 |
| `f914cd598a` / `a9984e2bf9` | 自写 config reload 去重 | Nexu 外部写不受影响 |
| `f00f0a9596` / `61fef8c689` | session-lock cleanup 更健壮 | ✅ |
| `5f6e3499f3` | Windows/macOS gateway lock PID 回收检测 | Nexu nuke-all 基础上加双保险 |
| `786de3eca2` | tick 广播 non-droppable | Nexu 60s watchdog 更稳 |
| `92776b8d77` | 启动期间 defer cron + heartbeat 到 sidecar ready | Feishu 启动 probe 超时问题缓解 |
| `e94ebfa084` | SIGTERM 路径更稳 | ✅ |

### 5.3 Skill 安装 / 热加载 — 🟡 黄色

Nexu skill 集成**代码层面无改动**，但有两处数据侧需要审计。

#### Nexu skill 集成数据流

```
User → web → POST /skillhub/... → SkillhubService.enqueueInstall(slug)
  → InstallQueue (concurrency=2) → catalogManager.executeInstall(slug)
  → process.execPath <clawhubBin> install <slug>  (完全自包含，ELECTRON_RUN_AS_NODE=1)
  → npm install --production (系统 PATH npm)
  → onComplete → skillDb.recordInstall(slug, source)
  → 队列 drain → onIdle() → openclawSyncService.syncAll()
  → compileOpenClawConfig() → shouldPushConfig() hash dedup → 写 openclaw.json
  → touchAnySkillMarker() 触发 OpenClaw chokidar → bumpSkillsSnapshotVersion
```

Ledger 三种 source：`"managed"`（curated/ClawHub）、`"custom"`（zip 导入）、`"workspace"`（OpenClaw 自装到 per-agent 目录）、`"user"`（用户级 `~/.agents/skills/`）。

#### 升级后风险矩阵

| 集成点 | 变化 | 风险 |
|-------|------|-----|
| `agents.list[].skills` 显式 allowlist | 语义未变；新增 `agents.defaults.skills` 是 opt-in（Nexu 不用） | 🟢 |
| `skills.load.extraDirs` + `watch: true, watchDebounceMs: 250` | 配置 shape 相同；内部拆分为 `refresh-state.ts` 但外部契约一致 | 🟢 |
| SKILL.md frontmatter 解析 | #64469 修复收紧了 frontmatter fence 要求 | 🟡 必须审计所有 bundled skill 的 `---` 围栏格式 |
| Symlink-safe skill loader (#57519) | 拒绝 skill 根目录外的 symlink | 🟡 确认没有 dev-time symlink 到 skills dir |
| ClawHub catalog | Nexu 用自己的 CDN + 独立 `clawhub` npm (v0.8.0)，不走 OpenClaw 内置 ClawHub | 🟢 |
| Dangerous scan fail-closed (v2026.3.31) | Nexu 自己的 install 路径不经过 OpenClaw 的 `skills install` 扫描 | 🟢（自己的路径） |
| Runtime-triggered install（agent 自己调 install 工具） | 4.12 后 fail-closed；SKILL.md `install:` frontmatter 含 brew/uv/go 的会被挡 | 🟠 审计 curated skill |
| Nexu 的 `7a03c2b0` batch fix | 上游 `915e15c13d` 只解决"空 diff"的 SIGUSR1；Nexu 每装一个 skill 都是真实 diff（`skills[]` 增长），batch 仍必要 | 🟢 keep it |
| `touchAnySkillMarker` chokidar 触发 | 内部重构但外部行为一致 | 🟢 |

#### 需要审计的 curated skill 列表

`CURATED_SKILL_SLUGS`（`catalog-manager.ts:10-41`）+ `STATIC_SKILL_SLUGS`（`curated-skills.ts:47-57`）。重点审计（因为复杂度高）：
- `skill-creator`
- `skill-vetter`
- `coding-agent`
- `deep-research`
- `libtv-video`

审计内容：看这些 skill 的 `SKILL.md` frontmatter 是否有 `install: [{kind: brew|uv|go|download, ...}]`。如果有，4.12 下 agent 运行时触发这类 install 会被 fail-closed，Nexu 目前没有 UI 让用户传 `--dangerously-force-unsafe-install`。

#### Nexu `7a03c2b0` batch fix 升级后仍然必要

原根因：10+ skill 顺序 install → 每次都 config sync → 每次都 SIGUSR1 → restart loop。

上游 4.12 加的 `915e15c13d` 只针对"patch 内容为空"时 skip，Nexu 的每次 patch 都是真的 diff（`skills[]` 数组每次都长），所以 **Nexu 的 batching 依然是关键防线**。防御纵深从 1 层变成 3 层：
1. Nexu `onIdle` 合并（防线 1）
2. Nexu hash-based `shouldPushConfig` dedup（防线 2）
3. OpenClaw config.patch noop guard（防线 3，新）

### 5.4 BYOK（Bring Your Own Key）— 🟢 绿色 + ⚠️ 一个既存隐患

升级对 BYOK surface **无 breaking change**。有一个 v2026.3.7 就存在的隐患，建议升级 PR 一起处理。

#### Nexu BYOK 数据流

```
用户 UI 输入 → ModelProviderService → ~/.nexu/config.json
  (config.models.providers[<providerId>].apiKey, 明文)
    ↓
openclaw-config-compiler.compileModelsConfig()
  → models.providers[<runtimeKey>] = { baseUrl, apiKey, api, authHeader, headers, models[] }
  → 写 ~/Library/Application Support/@nexu/desktop/runtime/openclaw/state/openclaw.json
    ↓
openclaw-auth-profiles-writer
  → 写 agents/<id>/agent/auth-profiles.json
  → 每个 provider 一个 <providerId>:default 条目 (type: api_key | oauth)
```

**存储**：apiKey 明文存 `~/.nexu/config.json`（目前没有加密）。

**runtimeKey 规则**：默认用 canonical provider id（`openai`、`anthropic`），用户改了 `baseUrl` 时变成 `byok_<provider>`（走 proxied-variant 路径）。

#### Nexu 的 4 个 platform plugin 升级兼容性

4 个 platform plugin（`nexu-runtime-model`、`nexu-credit-guard`、`nexu-platform-bootstrap`、`langfuse-tracer`）**没有 import `openclaw/plugin-sdk`**，而是直接 duck-type `register(api)` 里的 api 对象，使用 `api.on(hook, cb)` / `api.logger` / `api.pluginConfig`。

这意味着 **v2026.3.22 的 plugin SDK 大重构完全不影响这 4 个 plugin**。

| 插件 | 使用的 hook | 4.12 状态 |
|------|----------|---------|
| nexu-runtime-model | `before_model_resolve`, `before_prompt_build` | ✅ 保留 |
| nexu-platform-bootstrap | `before_prompt_build` | ✅ 保留 |
| nexu-credit-guard | `llm_output`, `message_sending` | ✅ 保留 |
| langfuse-tracer | `before_agent_start`, `agent_end` | ✅ 保留 |

Hook event payload 的字段（`event.prompt`、`event.messages[].usage.input_tokens/output_tokens`、`ctx.channelId` 等）在 4.12 的 `src/plugins/types.ts` 全部保留。

#### 耦合点核验

| 耦合点 | 4.12 状态 |
|-------|---------|
| `plugins.allow` 硬编码 `nexu-runtime-model` 等 4 个 | ✅ 仍由 `openclawRuntimePluginWriter` 写入 `env.openclawExtensionsDir` |
| `models.providers.<runtimeKey>` schema | ✅ 仍匹配 4.12 zod schema |
| `agents/<id>/agent/auth-profiles.json` 路径 | ✅ `src/secrets/auth-store-paths.ts:12` 未变 |
| `api_key` / `oauth` profile shape | ✅ 未变 |
| `nexu-runtime-model.json` sibling state 文件 | ✅ plugin 自己读写，无外部依赖 |
| `gateway.auth.mode: "none"\|"token"` | ✅ 不受 trusted-proxy 收紧影响 |
| Codex OAuth (`openai-codex:default` profile) | ✅ 保留 |
| `dangerouslyAllowHostHeaderOriginFallback: true` | ✅ v2026.4.5 的 dangerous flag audit 只记录不拒绝 |

#### 既存隐患：Codex OAuth 静默 bypass 用户 BYOK key

**场景**：
1. 用户在 Nexu 里配了 OpenAI BYOK（自己的 key）
2. 用户又连接了 Codex OAuth（为了用 ChatGPT 订阅 + Codex 能力）
3. Bot 模型 ref 是 `openai/gpt-4.1`

**结果**：`resolveModelId` 里的 `OAUTH_PROVIDER_MAP = { openai: "openai-codex" }` 会自动把 `openai/*` 重写成 `openai-codex/*`，走 Codex OAuth token 路径，**用户的 BYOK key 被默默绕过**。UI 上没有任何提示告诉用户这次请求用的是哪个身份。

**建议**（小改，不阻塞升级）：
- 在 model picker 加 badge：显示当前 bot 实际使用的是 BYOK apiKey 还是 Codex OAuth token
- 或把 `openai → openai-codex` 的自动重写改成用户显式开关

**4.12 harness 层加剧这个问题**：新增的 `embeddedHarness.runtime` 给 provider 选择加了第二个维度。Nexu 目前不设置这个字段（默认 `auto + pi fallback`），但如果将来要暴露 harness 选择，UI 必须同时展示三件事：模型、身份、harness。

### 5.5 运行时层风险总评

| 子系统 | 风险 | 需要代码改动？ |
|-------|-----|-------------|
| WS RPC / 事件 | 🟢 绿 | 无 |
| 进程生命周期 | 🟠 橙 | 小改（successor PID 检测扩展、launchd 模式断言） |
| Skill 集成 | 🟡 黄 | 无代码改动，需数据审计 |
| BYOK / 认证 | 🟢 绿 | 无（建议处理既存 Codex bypass 隐患） |

---

## 6. 升级成本与改造工作

### 6.1 两个 channel 插件的处理

#### WhatsApp（工作量：几乎为零）

OpenClaw 内置：`extensions/whatsapp/` 从 2026-01-18（v2026.1.22）就存在，v2026.3.7 就有。

**做法**：删掉 Nexu 自带的 `apps/controller/static/runtime-plugins/whatsapp/`，改用 `plugins.allow: ["whatsapp"]` 启用 OpenClaw 内置版本。

**好处**：零迁移工作 / 少维护一份重复代码 / 自动跟随 OpenClaw 升级获得 bug 修复。

**需验证**：内置版本的 channel 配置 API 是否与 Nexu 当前使用方式兼容（channel id、config schema 字段等）。

#### WeChat（工作量：小，升级 npm 依赖）

腾讯官方 npm 包：`@tencent-weixin/openclaw-weixin`（MIT 协议，腾讯维护）

- Nexu 当前：**1.0.2**
- npm 最新：**2.1.8**

**1.0.2 → 2.1.8 主要变更**（来自官方 CHANGELOG）：

| 版本 | 变更 | 影响 Nexu？ |
|------|------|------------|
| 2.x | Plugin SDK import 从 `openclaw/plugin-sdk` 改为 `openclaw/plugin-sdk/plugin-entry` + `openclaw/plugin-sdk/channel-config-schema` | 腾讯已做好，Nexu 只要升包 |
| 2.x | 新增 `assertHostCompatibility()` 在 register 时做 fail-fast 版本检查 | 低 |
| 2.1.2 | 移除 `openclaw-weixin` CLI 子命令，改用宿主 `openclaw plugins uninstall` | 如果 Nexu 调过 weixin-cli 需改 |
| 2.1.2 | 修复在 OpenClaw 2026.3.31+ 的 dangerous code pattern 警告 | 必要，不升会被 install 检查挡掉 |
| 2.1.3 | 新增 `StreamingMarkdownFilter`，WeChat 消息从「不支持 Markdown」变为「部分支持」 | 用户可见行为变化，产品侧要知会 |
| 2.1.4 | 移除 `get_bot_qrcode` 客户端超时 | 低 |
| 2.1.7 | 修复 plugin 注册重入 bug | 必要 |

**做法**：
1. 删除 `apps/controller/static/runtime-plugins/openclaw-weixin/`（Nexu 拷贝的旧版源码）
2. 在 `openclaw-runtime/package.json` 加依赖 `"@tencent-weixin/openclaw-weixin": "2.1.8"`
3. 验证 `openclaw.plugin.json` 里的 channel id `openclaw-weixin` 与 Nexu config compiler 输出一致
4. 跑本地登录 / 收发消息 smoke test

### 6.2 4 个 platform plugin

无需迁移。`nexu-runtime-model`、`nexu-credit-guard`、`nexu-platform-bootstrap`、`langfuse-tracer` 用 duck-type API，免疫 SDK 重构，Hook event 字段在 4.12 全部保留。

### 6.3 必要的 Nexu 侧代码改动

| 改动 | 文件 | 紧急度 |
|-----|-----|------|
| Zod schema 修两处 enum（R2） | `packages/shared/src/schemas/openclaw-config.ts:216,480` | 立即（与升级独立） |
| 新增 `embeddedHarness` schema 字段（R3） | 同上 | 升级 PR 必带 |
| Compiler 输出 `embeddedHarness.runtime: "auto", fallback: "pi"` | `apps/controller/src/lib/openclaw-config-compiler.ts` | 升级 PR 必带 |
| 扩展 successor PID 匹配（5.2） | `apps/controller/src/runtime/openclaw-process.ts:215` | 升级到 4.x 前必带 |
| `OpenClawProcessManager.start()` 加 launchd 模式断言（5.2） | 同上 | 推荐 |
| `CONTROLLED_RESTART_GRACE_MS` 调到 60-90s（5.2） | 同上 | 推荐 |
| 删除 `runtime-plugins/whatsapp/` + 启用内置（6.1） | `apps/controller/static/runtime-plugins/whatsapp/`、compiler `plugins.allow` | 升级 PR 必带 |
| 删除 `runtime-plugins/openclaw-weixin/` + 加 npm 依赖（6.1） | `apps/controller/static/runtime-plugins/openclaw-weixin/`、`openclaw-runtime/package.json` | 升级 PR 必带 |
| Codex OAuth bypass BYOK 的 UI badge（5.4） | model picker | 不阻塞升级，建议同期 |

### 6.4 需要审计但非编码工作

- Curated skill `SKILL.md` frontmatter 是否含 `install:` brew/uv/go 条目（5.3）
- Bundled skill `SKILL.md` 围栏格式 `---` 是否完整（5.3）
- `feishu` / `openclaw-weixin` / `langfuse-tracer` 在 4.12 仍被 bundle 且 manifest 声明 scope（5.2）
- `RUNTIME_MANAGE_OPENCLAW_PROCESS=false` 在 packaged 模式下确实生效（5.2）

### 6.5 总工程量估算

🟢 中等偏小

| 工作项 | 估算 |
|-------|-----|
| Schema 修复（R2） | 半天 |
| Harness 配置接线（R3） | 1-2 天 |
| WhatsApp 切换 | 几小时 |
| WeChat 升级 | 1-2 天 |
| 进程生命周期适配（5.2） | 1-2 天 |
| 数据审计（6.4） | 1 天 |
| 全链路验证 + 联调 | 1-2 周 |

---

## 7. 升级策略

### 7.1 分阶段路径

| 阶段 | 目标版本 | 主要工作 |
|------|---------|---------|
| 0 | （不升级）先修 | 修 Zod schema 两处 enum（R2），与升级无关但必做 |
| 1 | v2026.3.11 | 安全补丁验证基础兼容性（protocol v3、WS 握手、config 读写） |
| 2 | **v2026.3.22** | **最大坎** —— 过 plugin SDK 重构、删除 WhatsApp 自研副本、升级 WeChat 到 `@tencent-weixin/openclaw-weixin@2.x`、legacy env var 清理 |
| 3 | **v2026.4.12** | 升到目标版本，接入 `embeddedHarness` config 字段，保持默认 `auto + pi fallback` |
| 4 | （可选）harness 试点 | 个别测试 bot 切 `codex/gpt-5.4`，观察官方 issue #66251 进展 |

### 7.2 每个阶段的验证清单

1. ✅ `pnpm typecheck` 通过
2. ✅ Controller ↔ OpenClaw WebSocket 握手成功
3. ✅ `channels.status` RPC 返回格式符合 Nexu 期望
4. ✅ Config 编译 → 写入 → OpenClaw 读取 → 无 validation error
5. ✅ `openclaw gateway run --port` CLI 入口正常
6. ✅ 进程 start/stop/restart 生命周期完整（launchd + 非 launchd 两种模式都测）
7. ✅ 状态目录结构兼容（agents/sessions/locks、identity、extensions）
8. ✅ WhatsApp channel 内置版本能收发消息
9. ✅ WeChat 2.1.8 能登录 + 收发消息 + Markdown 部分支持验证
10. ✅ `feishu` / `openclaw-weixin` / `langfuse-tracer` prewarm 仍然生效（无 ~11s gateway drain）
11. ✅ 10+ skill 批量安装不触发 restart loop
12. ✅ BYOK + Codex OAuth 同时存在时的身份选择行为符合预期

### 7.3 Codex Harness 启用时机

**不要在升级 PR 里同时启用 Codex**。分两步走：

1. **升级 PR**：只升 OpenClaw 到 4.12，harness 配置用 `auto + pi fallback`，确保现有 PI 行为不变
2. **Harness 试点 PR**（升级稳定后 1-2 周）：
   - 先在内部测试 bot 上切 `codex/gpt-5.4`
   - 观察 #66251 的修复节奏
   - 有把握后再给用户开放「选择 agent runtime」的产品选项

---

## 8. 关键文件索引

### Nexu 侧集成点（路径相对 repo 根目录）

| 类别 | 文件 |
|------|------|
| 版本锁 | `openclaw-runtime/package.json:15` |
| 运行时安装 | `openclaw-runtime/install-runtime.mjs` |
| 桌面端 sidecar 打包 | `apps/desktop/main/runtime/manifests.ts:256-445` |
| Config 编译 | `apps/controller/src/lib/openclaw-config-compiler.ts` |
| Config 写入 | `apps/controller/src/runtime/openclaw-config-writer.ts` |
| 进程管理 | `apps/controller/src/runtime/openclaw-process.ts` |
| WebSocket 客户端 | `apps/controller/src/runtime/openclaw-ws-client.ts` |
| Gateway 服务 | `apps/controller/src/services/openclaw-gateway-service.ts` |
| 健康检查 | `apps/controller/src/runtime/runtime-health.ts` |
| 环境变量解析 | `apps/controller/src/app/env.ts` |
| Launchd 生命周期 | `apps/desktop/main/platforms/mac/launchd-lifecycle.ts` |
| Plist 生成 | `apps/desktop/main/services/plist-generator.ts` |
| Zod schema | `packages/shared/src/schemas/openclaw-config.ts` |
| WeChat plugin（删除） | `apps/controller/static/runtime-plugins/openclaw-weixin/` |
| WhatsApp plugin（删除） | `apps/controller/static/runtime-plugins/whatsapp/` |
| SkillHub | `apps/controller/src/services/skillhub/` |
| BYOK / Provider | `apps/controller/src/services/model-provider-service.ts` |
| Auth profiles | `apps/controller/src/runtime/openclaw-auth-profiles-writer.ts` |
| Platform plugin | `apps/controller/static/runtime-plugins/{nexu-runtime-model,nexu-credit-guard,nexu-platform-bootstrap,langfuse-tracer}/` |

### 外部参考

| 资源 | 地址 |
|------|-----|
| Codex Harness 官方文档 | https://docs.openclaw.ai/plugins/codex-harness |
| Agent Harness Plugin SDK | https://docs.openclaw.ai/plugins/sdk-agent-harness |
| Plugin SDK migration 指南 | https://docs.openclaw.ai/plugins/sdk-migration |
| Codex harness 稳定性跟踪 | [openclaw/openclaw#66251](https://github.com/openclaw/openclaw/issues/66251) |
| Codex harness init hang (4.10) | [openclaw/openclaw#64744](https://github.com/openclaw/openclaw/issues/64744) |
| 4.5 worker plugin CPU 饱和 | [openclaw/openclaw#62051](https://github.com/openclaw/openclaw/issues/62051) |
| 4.9 Windows CLI SIGKILL | [openclaw/openclaw#63609](https://github.com/openclaw/openclaw/issues/63609) |
| WeChat 插件 npm | `@tencent-weixin/openclaw-weixin` |
| OpenClaw CHANGELOG | [`openclaw/openclaw` CHANGELOG.md](https://github.com/openclaw/openclaw/blob/main/CHANGELOG.md) |

---

## 9. 一句话结论

**为了能用 Codex 替换 PI，升级是值得的；目标定在 `v2026.4.12`，分 3.7 → 3.22 → 4.12 三阶段；两个 channel 插件改用官方版本（WhatsApp 用 OpenClaw 内置，WeChat 用腾讯 npm 2.1.8）、4 个 platform plugin 因为 duck-type API 免疫 SDK 重构，工程量中等偏小；WS 协议零改动，BYOK / skill / 认证路径都兼容；唯一需要关注的运行时风险是 packaged launchd 模式下 supervisor restart 语义变了（需要扩展 successor PID 检测 + 确保 `RUNTIME_MANAGE_OPENCLAW_PROCESS=false`）；Codex harness 本身还是 beta 级质量（#66251 未关闭），升级完后先保持 `auto + pi fallback`，harness 真正投产等官方 stabilize。**
