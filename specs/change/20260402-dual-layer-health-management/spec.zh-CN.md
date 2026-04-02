# Nexu Desktop 与 OpenClaw 端到端自愈闭环

- **ID**: 20260402-dual-layer-health-management
- **Status**: Proposed
- **Created**: 2026-04-02
- **Related**:
  - [nexu-io/nexu#725](https://github.com/nexu-io/nexu/pull/725) — HTTP 健康探针与 gateway wedge 检测
  - `specs/change/20260326-desktop-handled-failure-sentry/spec.md` — 受控失败 Sentry 上报

---

## 1. 愿景

当 Nexu 出现问题时，系统应当自行检测、尝试修复，只有在修不好时才告诉我们到底发生了什么。用户不需要自己发现问题、手动导出日志、或者提 ticket。目标体验是：

```
自动探测 → 自愈 → 升级 → 远程上报 → IM 通知 → 用户触发修复
```

这是一个**端到端的自愈闭环**：系统静默解决大多数问题，将剩余问题通过 Sentry 报告给团队、通过 IM 通知用户，并提供一键修复路径（`/diagnose`、`/fix`），用户无需离开聊天界面。

## 2. 当前差距

目前没有任何单一组件能独立实现这个闭环：

- **OpenClaw** 拥有完善的内部监控体系（channel 健康检测、session 卡死检测、tool 死循环熔断、auth 过期检查），能自愈大多数应用级故障。但它检测不了自身进程级别的楔死，内部恢复失败时没有升级通道，也不会上报到任何远程系统。

- **Controller** 对 OpenClaw 发起 HTTP 探针，管理 OpenClaw 的生命周期（启动、重启、健康循环）。但它把健康状态视为二值的 alive/dead——无法区分真正的死锁和配置重载或 channel 重连，导致良性操作时产生误报告警。

- **Desktop** 提供宿主上下文（sleep/wake、renderer、macOS 权限）并拥有用户侧界面（诊断导出、Sentry 上传、UX）。但它没有结构化的方式从 Controller 或 OpenClaw 接收升级信号。

- **差距在于协调**：三者都有能力，但没有共同语言。Controller 不知道 OpenClaw 正在自愈；OpenClaw 无法向 Controller 求助；Desktop 无法将宿主上下文反馈回来。没有统一的升级路径，没有远程上报触发器，没有面向用户的修复入口。

这是一个可解决的集成问题，不是能力缺失问题。

## 3. 目标

1. **端到端自愈闭环** — 从异常检测、自动修复到远程上报和用户可触达的 IM 命令，作为一个统一的系统。
2. **三层职责** — OpenClaw 负责应用内部故障；Controller 是唯一的运行时协调者（探针、生命周期、升级决策）；Desktop 提供宿主上下文并负责 UX/上报。
3. **语义化健康协调** — OpenClaw 和 Controller 之间的正式协议替代仅依赖探针的隐式监控，让 Controller 理解 OpenClaw 在做什么。
4. **噪音最小化** — 只上报系统真正无法修复的问题。自愈成功的问题不产生告警、不发 Sentry 事件、不打扰用户。
5. **用户可触达的修复入口** — IM 命令（`/diagnose`、`/fix`）让用户直接在聊天中检查和修复，无需接触 CLI 或桌面 UI。

## 4. 非目标

- 不构建完整监控平台（Datadog 继续承担该角色）。
- 不让 OpenClaw 直接上传 Sentry — Desktop 拥有远程上报的职责。
- 不使用日志文本匹配作为生产级协议（用语义化事件替代 POC 中的 `launchd_log_line` 匹配）。
- 本 spec 不覆盖用户侧同意 UX 或发布策略。

---

## 5. 架构

### 5.1 角色定义

**OpenClaw（应用层）** — gateway 进程本身。
- 负责：channel、session、tool、auth、config 异常
- 动作：重试、重启 channel、熔断、doctor 修复
- 输出：结构化诊断事件 + 通过 `/health` 提供语义化健康状态
- 自愈失败时：健康状态转为 `unhealthy`，发出 `escalation_requested`

**Controller（运行时协调者）** — OpenClaw 生命周期的唯一管理者。
- 负责：HTTP 健康探针、OpenClaw 进程生命周期（启动/停止/重启）、健康循环、升级决策、wedge 检测
- 消费：OpenClaw 健康响应 + 通过 Controller 拥有的事件管道接收运行时事件
- 决策：是否重启、是否升级给 Desktop、还是等待
- 提供：向 OpenClaw 传递宿主上下文信号（sleep/wake 恢复、准备重启）
- 边界：Controller 与 OpenClaw 通信；Desktop 与 Controller 通信。不存在 Desktop ↔ OpenClaw 的直接控制路径。

**Desktop（宿主上下文 + UX + 上报）** — Electron 外壳。
- 负责：sleep/wake 检测、renderer 生命周期、macOS 权限、诊断导出、Sentry 上传、用户侧 IM 通知
- 向 Controller 提供：宿主信号（sleep/wake 状态、renderer 健康状态）
- 从 Controller 接收：升级触发、诊断快照
- 不直接探测或重启 OpenClaw

### 5.2 交互模型

```
                    Controller 拥有的事件管道
OpenClaw ──── /health 响应 ──────────→ Controller
OpenClaw ──── 运行时事件 ────────────→ Controller
Controller ── RPC 命令 ──────────────→ OpenClaw（diagnose、fix、prepare_for_restart）

                    Desktop ↔ Controller 接口
Desktop ──── 宿主信号 ──────────────→ Controller（sleep_resumed、renderer_state）
Controller ── 升级触发 ─────────────→ Desktop（report_to_sentry、notify_user）
Desktop ──── 诊断/Sentry ──────────→ 外部（Sentry、本地导出）
```

**关键约束**：所有 OpenClaw 协调流程都经过 Controller。Desktop 永远不直接向 OpenClaw 发送命令。这避免了双控制路径，保持 Controller 作为运行时状态的唯一真实来源。

---

## 6. 健康模型

### 6.1 健康状态枚举

OpenClaw 的 `/health` 响应从二值 alive/dead 升级为语义化状态机：

```typescript
type HealthStatus = "healthy" | "degraded" | "recovering" | "maintenance" | "unhealthy";
```

### 6.2 状态迁移规则

```
                    ┌──────────────┐
         ┌─────────│   healthy    │←────────────────┐
         │         └──────┬───────┘                  │
         │                │ 检测到异常                 │ 全部恢复
         │                ▼                           │ (+ RECOVERY_HYSTERESIS)
         │         ┌──────────────┐                  │
         │    ┌───→│   degraded   │───┐              │
         │    │    └──────┬───────┘   │              │
         │    │           │ 自愈开始   │ 自愈成功      │
         │    │           ▼            │              │
         │    │    ┌──────────────┐   │              │
         │    │    │  recovering  │───┘              │
         │    │    └──────┬───────┘                  │
         │    │           │ MAX_RECOVERING_DURATION  │
         │    │           │ 超时或自愈失败             │
         │    │           ▼                          │
         │    │    ┌──────────────┐    重启/修复      │
         │    └────│  unhealthy   │──────────────────┘
         │         └──────────────┘
         │
         │  (显式操作)
         │         ┌──────────────┐
         └────────→│ maintenance  │─── MAINTENANCE_TTL 超时
                   └──────┬───────┘    → unhealthy
                          │ 操作完成
                          └──────────→ healthy
```

### 6.3 状态时间约束

| 状态 | 最大停留时间 | 超时后 |
|------|------------|--------|
| `healthy` | 无限制 | — |
| `degraded` | 5 分钟（`MAX_DEGRADED_DURATION`） | → `unhealthy` |
| `recovering` | 10 分钟（`MAX_RECOVERING_DURATION`） | → `unhealthy` + 发出 `escalation_requested` |
| `maintenance` | 15 分钟（`MAINTENANCE_TTL`） | → `unhealthy`（维护卡住） |
| `unhealthy` | 无限制（等待外部干预） | — |

### 6.4 防抖规则

- **恢复滞后**：从 `unhealthy` → `healthy` 转换后，维持 60s `RECOVERY_HYSTERESIS` 窗口。窗口期内健康状态报告为 `healthy`，但 Controller 保持 wedge 计数器在非零"观察"水平，而非重置为 0。
- **降级去抖**：持续不足 5s（`DEGRADED_DEBOUNCE`）的瞬态问题不进入 `degraded`，仅在异常持续超过去抖时间后才转换。
- **计数器重置**：`consecutiveFailures` 仅在 `RECOVERY_HYSTERESIS` 结束且持续为 `healthy` 状态后才重置为 0。

### 6.5 增强版健康响应 Schema

```typescript
interface HealthResponse {
  status: HealthStatus;
  uptime: number;                // gateway 启动后的秒数
  statusSince: number;           // 当前状态开始的 epoch ms（用于 TTL 检查）

  // 为什么不健康？
  degradedReasons?: string[];    // 例如 ["channel:telegram:reconnecting", "auth:claude:expiring"]

  // 正在做什么？
  selfHealingInProgress: boolean;
  activeRecoveries?: Array<{
    type: string;                // "channel_restart" | "auth_refresh" | "session_cleanup"
    target: string;              // "telegram:bot1" | "claude:default"
    startedAt: number;           // epoch ms
    estimatedDurationMs?: number;
  }>;

  // 是否需要 Controller 介入？
  escalationRequested: boolean;
  escalationReason?: string;     // "channel_restart_exhausted" | "self_heal_timeout"
}
```

### 6.6 Controller 探针行为（基于 PR #725 更新）

```
收到探针响应时：
  if status == "healthy":
    if 在 RECOVERY_HYSTERESIS 窗口内:
      保持 consecutiveFailures 在"观察"水平（不完全重置）
    else:
      重置 consecutiveFailures = 0
      清除 wedgeReported

  if status == "degraded":
    // OpenClaw 已感知 — 不计为失败
    保持 consecutiveFailures 不变（不递增）
    // 但是：检查 statusSince。如果 degraded 超过 MAX_DEGRADED_DURATION，
    // Controller 视为 unhealthy。
    if now - statusSince >= MAX_DEGRADED_DURATION:
      触发 Controller 级干预

  if status == "recovering":
    // 主动自愈中 — 暂停 wedge 计数器，等待
    保持 consecutiveFailures 不变（不递增）
    // 但是：上限为 MAX_RECOVERING_DURATION
    if now - statusSince >= MAX_RECOVERING_DURATION:
      触发 Controller 级干预

  if status == "maintenance":
    // 有意操作 — 抑制，但尊重 TTL
    重置 consecutiveFailures = 0
    if now - statusSince >= MAINTENANCE_TTL:
      触发 Controller 级干预（维护卡住）

  if status == "unhealthy" || escalationRequested:
    // OpenClaw 放弃了 — 干预，但感知 scope（见 §8）
    触发 Controller 级干预

  if 探针失败（超时 / 连接拒绝）:
    // 完全无法连接 OpenClaw — 真实失败
    递增 consecutiveFailures
    if consecutiveFailures >= WEDGE_THRESHOLD:
      触发 wedge 检测（沿用 PR #725 逻辑）
```

---

## 7. 协调协议

### 7.1 协议通道

所有 OpenClaw → Controller 事件通过 **Controller 拥有的运行时事件管道**（即 Controller 订阅 OpenClaw 运行时事件的现有机制）。这不是新通道——而是在现有 `runtime/events` 订阅上扩展新的事件类型。

Controller → OpenClaw 命令使用**现有 RPC 接口**（OpenClaw gateway 服务器上的 HTTP/WS 方法）。

Desktop ↔ Controller 通信使用**现有 Controller API**（Desktop 已经在用的与 Controller 交互的内部接口）。

**不引入新的传输层。** 所有变更都是在现有通道上增加事件类型和 RPC 方法。

### 7.2 OpenClaw → Controller 事件

在现有运行时事件管道上发出的新事件类型：

```typescript
// OpenClaw 正在尝试内部恢复
interface SelfHealingStarted {
  type: "self_healing_started";
  scope: IncidentScope;    // 哪个类别出了问题
  target: string;          // 正在修复什么
  strategy: string;        // "channel_restart" | "auth_refresh" | "circuit_break"
  timestamp: number;
}

interface SelfHealingSucceeded {
  type: "self_healing_succeeded";
  scope: IncidentScope;
  target: string;
  strategy: string;
  durationMs: number;
  timestamp: number;
}

interface SelfHealingFailed {
  type: "self_healing_failed";
  scope: IncidentScope;
  target: string;
  strategy: string;
  attempts: number;
  lastError: string;       // 已脱敏的错误信息（无 token/secret）
  timestamp: number;
}

// OpenClaw 无法恢复 — 请求 Controller 介入
interface EscalationRequested {
  type: "escalation_requested";
  scope: IncidentScope;
  severity: "warning" | "critical";
  reason: string;            // "channel_restart_loop_exhausted" | "auth_refresh_failed"
  context: EscalationContext;
  recommendedAction: EscalationAction;
  reportable: boolean;       // 是否应发送到 Sentry？
  dedupeKey: string;         // 用于按 episode 去重（如 "channel:telegram:bot1"）
  timestamp: number;
}

// 有意操作 — 抑制告警
interface MaintenanceStarted {
  type: "maintenance_started";
  operation: string;         // "config_reload" | "plugin_update"
  estimatedDurationMs?: number;
  timestamp: number;
}

interface MaintenanceFinished {
  type: "maintenance_finished";
  operation: string;
  success: boolean;
  timestamp: number;
}
```

### 7.3 事件 Scope 与升级模型

并非每次升级都意味着"重启 gateway"。升级携带 scope，让 Controller 选择正确的响应：

```typescript
type IncidentScope = "channel" | "auth" | "config" | "session" | "process";

type EscalationAction =
  | "restart_channel"     // scope: channel — 重启特定 channel
  | "refresh_auth"        // scope: auth — 重新触发 auth 流程
  | "reload_config"       // scope: config — 重载配置
  | "clear_session"       // scope: session — 清理卡死 session
  | "restart_gateway"     // scope: process — 完整进程重启（最后手段）
  | "notify_user"         // 任意 scope — 仅通知用户
  | "report_sentry";      // 任意 scope — 上报 Sentry

// Controller 决策矩阵：
//   scope: channel   → 先尝试 restart_channel，失败则升级给 Desktop
//   scope: auth      → 尝试 refresh_auth，需手动重新授权则通知用户
//   scope: config    → 尝试 reload_config，reload 失败才 restart_gateway
//   scope: session   → clear_session，无需重启
//   scope: process   → restart_gateway（唯一默认需要重启的 scope）
```

### 7.4 升级上下文 Schema

`context` 字段使用**类型化白名单 schema**，而非开放的 `Record<string, unknown>`：

```typescript
interface EscalationContext {
  // 必填字段
  errorMessage: string;        // 已脱敏 — 无 token、secret 或凭据
  errorCode?: string;          // 如 "ECONNREFUSED"、"AUTH_EXPIRED"
  component: string;           // 如 "channel-health-monitor"、"auth-health"

  // Scope 相关字段（均为可选，白名单内）
  channelType?: string;        // "telegram" | "discord" | "slack" | ...
  channelAccount?: string;     // 账户标识（已脱敏）
  authProvider?: string;       // "claude" | "openai" | ...
  selfHealAttempts?: number;
  selfHealDurationMs?: number;
  lastHealthStatus?: HealthStatus;

  // 大小约束：序列化后的 context 必须 < 4KB。
  // 超出的字段被截断，而非省略。
}
```

**脱敏规则**：所有 `EscalationContext` 字段在发出前必须通过 OpenClaw 现有的脱敏层（`redaction.ts`）。不在此白名单中的字段一律剥离。这在事件发出侧强制执行，而非在消费侧。

### 7.5 Controller → OpenClaw 命令

添加到 OpenClaw `server-methods/` 的 RPC 方法：

```typescript
// 通知 OpenClaw 宿主侧上下文（从 Desktop 经由 Controller 传递）
interface HostSleepResumed {
  method: "host_sleep_resumed";
  sleepDurationMs: number;    // 机器休眠了多久
}

// 请求 OpenClaw 准备外部重启
interface PrepareForRestart {
  method: "prepare_for_restart";
  reason: string;             // "wedge_detected" | "user_requested" | "update"
  gracePeriodMs: number;      // kill 前的状态刷写时间
}

// 触发综合自检（用于 /diagnose 命令）
interface RunDiagnose {
  method: "run_diagnose";
  depth: "quick" | "full";    // quick = 健康摘要；full = doctor 级别
}

// 触发自动修复（用于 /fix 命令）
interface RunFix {
  method: "run_fix";
  scope: "safe" | "moderate"; // safe = 无停机；moderate = 可能重启 channel
  targets?: string[];         // 可选：指定修复的子系统
}

// 告诉 OpenClaw 在 Controller 干预后重置瞬态计数器
interface ResetTransientHealthCounters {
  method: "reset_transient_health_counters";
  reason: string;             // "post_restart" | "post_sleep_resume"
}
```

### 7.6 Desktop → Controller 信号

Desktop 通过现有 Controller API 提供宿主上下文：

```typescript
// Desktop 通知 Controller 宿主事件
interface HostSleepWakeEvent {
  type: "host_sleep_resumed";
  sleepDurationMs: number;
}

interface RendererStateEvent {
  type: "renderer_state_changed";
  state: "healthy" | "crashed" | "unresponsive";
}
```

Controller 将相关信号转发给 OpenClaw（如 `host_sleep_resumed`），其余信号用于自身决策（如 renderer 崩溃 → 通过 Desktop 上报 Sentry）。

---

## 8. 恢复流程

分层升级，感知 scope 的响应：

```
┌─ 第一层：OpenClaw 内部 ──────────────────────────────────────┐
│                                                               │
│  检测到异常（channel monitor / diagnostic event）              │
│    → 尝试自愈（重试 / 重启 / 熔断）                             │
│    → 发出 self_healing_started { scope, target, strategy }    │
│                                                               │
│  结果 A：恢复成功                                              │
│    → 发出 self_healing_succeeded                              │
│    → 健康状态恢复为 "healthy"（经过 RECOVERY_HYSTERESIS）       │
│    → 结束（无噪音，无上报）                                     │
│                                                               │
│  结果 B：恢复失败 / 状态 TTL 超时                               │
│    → 发出 self_healing_failed                                 │
│    → 发出 escalation_requested { scope, recommendedAction }   │
│    → 健康状态转为 "unhealthy"                                  │
│                                                               │
└───────────────────────────────────┬───────────────────────────┘
                                    │ 升级（经由 Controller 事件管道）
                                    ▼
┌─ 第二层：Controller 干预 ────────────────────────────────────┐
│                                                               │
│  Controller 收到 escalation_requested 或检测到 wedge          │
│                                                               │
│  感知 scope 的响应：                                           │
│    scope: channel → restart_channel（定向，无停机）             │
│    scope: auth    → refresh_auth 或通知用户                    │
│    scope: config  → reload_config，失败才 restart              │
│    scope: session → clear_session                             │
│    scope: process → prepare_for_restart → 重启 gateway        │
│    （探针不可达 / wedge → 始终重启 gateway）                    │
│                                                               │
│  结果 A：干预成功，健康 → "healthy"                             │
│    → 记录恢复日志，结束                                         │
│                                                               │
│  结果 B：干预失败 或 重启循环耗尽                                │
│    → Controller 通知 Desktop 升级至第三层                      │
│                                                               │
└───────────────────────────────────┬───────────────────────────┘
                                    │ 仍然异常
                                    ▼
┌─ 第三层：Desktop — 上报 + 用户触达 ─────────────────────────┐
│                                                               │
│  Desktop 从 Controller 收到升级触发。                          │
│  触发三路并行输出：                                             │
│                                                               │
│  1. Sentry：captureMessage + diagnostics ZIP 附件              │
│    （包含来自 Controller 的升级上下文）                          │
│                                                               │
│  2. IM 通知用户：                                              │
│     "检测到持续性异常。回复 /diagnose 查看详情，                  │
│      或回复 /fix 尝试修复。"                                    │
│                                                               │
│  3. 本地诊断快照（复用现有导出机制）                              │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

## 9. 上报策略

### 9.1 Sentry 触发条件

仅在升级真正失败时上报 — 不是每个诊断事件都上报：

| 触发条件 | 描述 |
|---------|------|
| `wedge_confirmed` | HTTP 探针连续失败超过阈值，进程无响应 |
| `cold_start_failed` | Gateway 在启动超时内未达到健康状态 |
| `self_healing_failed_and_escalated` | OpenClaw 耗尽内部恢复手段，Controller 干预也失败 |
| `renderer_crash_before_ready` | Electron renderer 进程在初始化完成前崩溃 |
| `restart_loop_exhausted` | Controller 在窗口期内重启 gateway N 次，仍不健康 |

### 9.2 去重与限流

- **按 episode 去重**：每个故障 episode 只产生一个 Sentry 事件。OpenClaw 发起的升级以 `EscalationRequested` 中的 `dedupeKey` 为键；Controller 原生触发（`wedge_confirmed`、`cold_start_failed`、`restart_loop_exhausted`、`renderer_crash_before_ready`）由 Controller 自行生成 dedupeKey，格式为 `{trigger_type}:{episode_start_timestamp}`
- **限流**：所有触发类型合计每小时最多 3 个 Sentry 事件
- **恢复重置**：`RECOVERY_HYSTERESIS` 结束且持续 healthy 后重置所有计数器和标志
- **冷却期**：Sentry 上报后，同一 `dedupeKey` 抑制 30 分钟
- **IM 通知冷却**：IM 通知与 Sentry 共用相同的 `dedupeKey` 和 30 分钟冷却期。同一个 bot 反复断连不会刷屏——每个 episode 只通知一次，冷却期结束或问题变化后才再次通知。

### 9.3 诊断载荷

分两级：**远程安全子集**用于 Sentry，**完整包**仅本地导出。

**远程安全载荷（Sentry 附件）**：
- 触发事件的 `EscalationContext`（发出时已脱敏，< 4KB）
- 自愈尝试历史（事件类型 + 时间戳，不含消息内容）
- 最近 20 次带语义状态和 `statusSince` 的健康响应
- 大小上限：**256KB**。超出时优先截断最旧的健康响应。
- 上传前经过现有脱敏层处理。
- 不含用户消息内容、auth token、session 载荷。

**完整诊断包（仅本地）**：
- 远程安全载荷的全部内容，加上：完整运行时状态、renderer 故障、最近事件、启动状态
- 通过现有 `diagnostics-export.ts` 导出到本地磁盘
- 仅通过用户手动操作"帮助 → 导出诊断"上传

---

## 10. IM 命令

**仅限私聊**：`/diagnose` 和 `/fix` 仅在与 bot 的私聊（DM）中响应。在群聊中，bot 忽略这些命令或回复："请私聊我执行此命令。"这避免了共享 channel 中的误操作。

### 10.1 `/diagnose` — 自检报告

**触发**：用户在与 bot 的私聊中发送 `/diagnose`。

**流程**：
1. Controller 调用 OpenClaw `run_diagnose(depth: "full")`
2. Controller 附加自身视角（探针历史、进程统计、升级状态）
3. Desktop 附加宿主上下文（sleep/wake 日志、renderer 状态）
4. 合并报告返回至 IM

**报告内容**：
```
Gateway 健康状态：degraded（45s 前开始）
  - telegram:bot1：重连中（第 3 次尝试，45s 前开始）
  - auth:claude：2 小时后过期
  - session：3 个活跃，0 个卡死

进程：运行中（PID 12345，运行时间 6h）
Controller 探针：0 次连续失败
上次 sleep/wake：2 小时前，正常恢复

自愈：1 个活跃恢复（telegram channel 重启）
升级请求：无
```

### 10.2 `/fix` — 触发修复

**触发**：用户在与 bot 的私聊中发送 `/fix`。

**流程**：
1. Controller 调用 OpenClaw `run_fix`，内部运行 **doctor** 诊断修复流程
2. Doctor 识别根因并尝试定向修复（如检测到 webhook 过期 → 重新注册，检测到端口冲突 → 杀残留进程，检测到 LaunchAgent 异常 → 重新加载）
3. 将发现的问题和修复结果返回至 IM
4. 如果 doctor 修复解决了问题 → 完成，无需进一步操作
5. 如果 doctor 无法解决 → IM 询问："Doctor 无法修复此问题。是否重启 gateway？（短暂断连）回复 `/fix restart`"
6. 确认后：Controller 执行 `prepare_for_restart` → 进程重启 → `reset_transient_health_counters`

**修复升级**（先 doctor，重启是最后手段）：

| 步骤 | 操作 | 需要确认 |
|------|-----|---------|
| 1. Doctor | 根因诊断、auth 刷新、webhook 重新注册、端口冲突解决、LaunchAgent 修复、channel 重启、session 清理 | 否 |
| 2. 重启 | 重启 gateway 进程 | 是 — "Doctor 无法修复，是否重启 gateway？" |
| 3. 重建 | 清空 session 存储、重建沙箱镜像 | 是 — "警告：这可能丢失进行中的对话。" |

**降级模式**：当 OpenClaw 不可达（wedge/崩溃）时，`/fix` 回退为仅 Controller 操作：进程重启、诊断导出。IM 响应会说明能力受限。

### 10.3 具体场景

端到端自愈闭环的完整示例：

```
1. OpenClaw 检测到：telegram:bot1 断连
   → 自动重连尝试 1/3... 失败（webhook URL 已变更）
   → 自动重连尝试 2/3... 失败
   → 自动重连尝试 3/3... 失败
   → 发出 escalation_requested { scope: "channel", target: "telegram:bot1" }

2. Controller 收到升级请求
   → 尝试 restart_channel... 仍然失败
   → 通知 Desktop 升级至第三层

3. 用户收到 IM 通知：
   "telegram:bot1 持续断连，自动重连未恢复。
    输入 /diagnose 查看详情，或 /fix 尝试修复。"

4. 用户回复：/fix

5. OpenClaw doctor 运行：
   → 检测到：Telegram webhook URL 在 bot token 刷新后已变更
   → 修复：使用新 URL 重新注册 webhook
   → 重启 telegram:bot1 channel
   → Channel 重连成功

6. 用户收到 IM 回复：
   "已修复：Telegram webhook URL 已更新并重新注册。
    telegram:bot1 已恢复连接。"
```

---

## 11. 上游依赖

本 spec 需要 Nexu 和 OpenClaw 两侧的变更。并非所有变更都可以从 Nexu 侧完成。

### 11.1 Nexu 侧（可立即实现）

这些变更完全在 Nexu 仓库内，无需 OpenClaw 上游变更即可推进：

| 变更 | 组件 | 备注 |
|------|------|------|
| Controller 探针逻辑感知语义健康状态 | Controller | 演进 PR #725 以处理新状态值 |
| Controller 升级决策引擎 | Controller | 感知 scope 的响应逻辑 |
| Desktop ↔ Controller 宿主信号接口 | Desktop + Controller | sleep/wake、renderer 状态 |
| Desktop 第三层触发时的 Sentry 上报 | Desktop | 扩展 handled-failure-reporter |
| Desktop 诊断载荷增强 | Desktop | 在 ZIP 中添加升级上下文 |
| IM `/diagnose` 和 `/fix` 命令路由 | Controller | 命令分发、授权 |
| 状态时间约束执行（TTL） | Controller | 在探针响应中监控 `statusSince` |

### 11.2 OpenClaw 上游（需要协调）

这些变更需要修改 OpenClaw 源代码：

| 变更 | 优先级 | 无此变更时的 fallback |
|------|--------|---------------------|
| `/health` 返回 `HealthStatus` 枚举 + `statusSince` | **阶段 1 — 关键** | Controller 将所有非 200 视为失败（当前行为） |
| `/health` 返回 `selfHealingInProgress` + `activeRecoveries` | 阶段 1 | Controller 无法在自愈期间抑制告警；更高的误报率 |
| 运行时事件管道上的 `self_healing_*` 事件 | 阶段 2 | Controller 仅依赖 `/health` 轮询；响应性较差 |
| 带 scope + context 的 `escalation_requested` 事件 | 阶段 2 | Controller 仅通过健康状态 TTL 超时检测需升级的情况 |
| `maintenance_started` / `maintenance_finished` 事件 | 阶段 2 | Controller 仅使用 `maintenance` 健康状态（无预先通知） |
| `run_diagnose` RPC 方法 | 阶段 4 | `/diagnose` 仅返回 Controller 视角 |
| `run_fix` RPC 方法 | 阶段 4 | `/fix` 仅限 Controller 侧操作（进程重启） |
| `host_sleep_resumed` RPC 方法 | 阶段 2 | OpenClaw 不知道 sleep/wake；无计数器重置 |
| `prepare_for_restart` RPC 方法 | 阶段 2 | Controller 杀死 OpenClaw 时无优雅关闭 |
| `EscalationContext` 白名单 schema + 脱敏 | 阶段 2 | Sentry 报告中无结构化上下文 |

### 11.3 分阶段方法

发布阶段按顺序排列，使得 Nexu 侧工作可以立即开始，OpenClaw 上游变更逐步请求：

- **阶段 1**：Nexu 侧探针逻辑 + OpenClaw `/health` 增强（最小上游请求）
- **阶段 2**：完整协调协议（较大上游请求，基于阶段 1 构建）
- **阶段 3**：Sentry 集成（仅 Nexu 侧，消费阶段 2 事件）
- **阶段 4**：IM 命令（需要 OpenClaw `run_diagnose` / `run_fix`）

如果 OpenClaw 上游变更延迟，每个阶段都有文档化的 fallback，可通过仅 Nexu 侧的变更提供部分价值。

---

## 12. 发布计划

### 阶段 1：健康语义化

- **OpenClaw 上游**：增强 `/health` 返回 `HealthStatus` 枚举、`statusSince`、`degradedReasons`、`selfHealingInProgress`、`escalationRequested`
- **Nexu (Controller)**：更新探针逻辑以感知语义状态，通过 `statusSince` 执行 TTL，实现防抖规则
- **Fallback**：如上游延迟，Controller 添加自己的基于超时的降级检测（精度较低但可用）
- **验证**：配置重载或 channel 重连期间不再产生误报 wedge 告警

### 阶段 2：协调协议

- **OpenClaw 上游**：发出 `self_healing_*`、`escalation_requested`、`maintenance_*` 事件；接受 `host_sleep_resumed`、`prepare_for_restart`、`reset_transient_health_counters` 命令
- **Nexu (Controller)**：消费事件，实现感知 scope 的升级决策，从 Desktop 转发宿主信号
- **Nexu (Desktop)**：向 Controller 发送 sleep/wake 和 renderer 信号
- **Fallback**：如上游事件延迟，Controller 从健康状态 TTL 超时推断升级需求
- **验证**：Controller 在自愈期间正确暂停 wedge 计数；感知 scope 的响应避免不必要的重启

### 阶段 3：升级与上报

- **仅 Nexu**（超出阶段 2 事件外无上游依赖）
- 实现分层恢复流程（第一层 → 第二层 → 第三层）
- 仅将 Sentry 上报接入第三层触发条件（按上报策略）
- 将 `EscalationContext` 纳入 diagnostics ZIP
- **验证**：Sentry 事件仅在真正不可恢复的故障时触发

### 阶段 4：IM 命令

- **OpenClaw 上游**：实现 `run_diagnose` 和 `run_fix` server method
- **Nexu (Controller)**：注册 `/diagnose` 和 `/fix` 命令路由，授权执行
- **Nexu (Desktop)**：向 `/diagnose` 输出贡献宿主上下文
- **Fallback**：无上游 `run_diagnose`/`run_fix` 时，命令返回仅 Controller 视角，仅可执行进程级操作
- **验证**：授权操作员可以从 IM 直接诊断和修复，无需接触 CLI 或桌面 UI

---

## 13. 待解决问题

1. `maintenance_started` / `maintenance_finished` 是否应在 OpenClaw 配置重载时自动发出，还是由操作显式触发？
2. `MAX_RECOVERING_DURATION` 设为多少合适 — 当前提议 10 分钟，但网络不稳定时的 channel 重连可能合理需要更长时间。
3. 在多设备场景下（多个 Desktop 连接同一个 Controller）如何协调？
4. 第三层故障时的 IM 通知是否应包含故障摘要，还是仅提示运行 `/diagnose`？
5. 提议 OpenClaw 上游变更的流程是什么 — RFC、issue 还是直接 PR？

---

## 14. 参考资料

- OpenClaw 健康基础设施：`src/commands/health.ts`、`src/gateway/server-methods/health.ts`、`src/gateway/channel-health-monitor.ts`
- OpenClaw 诊断事件：`src/infra/diagnostic-events.ts`、`src/logging/diagnostic.ts`
- OpenClaw doctor/修复：`src/commands/doctor.ts`、`src/commands/doctor-gateway-daemon-flow.ts`
- OpenClaw tool 死循环检测：`src/agents/tool-loop-detection.ts`
- Controller 健康探针：`apps/controller/src/runtime/runtime-health.ts`（PR #725）
- Controller wedge 检测：`apps/controller/src/runtime/loops.ts`（PR #725）
- Sentry 受控失败 spec：`specs/change/20260326-desktop-handled-failure-sentry/spec.md`
