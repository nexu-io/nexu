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

目前 OpenClaw 和 Desktop 都无法单独实现这个闭环：

- **OpenClaw** 拥有完善的内部监控体系（channel 健康检测、session 卡死检测、tool 死循环熔断、auth 过期检查），能自愈大多数应用级故障。但它检测不了自身进程级别的楔死，内部恢复失败时没有升级通道，也不会上报到任何远程系统。

- **Desktop** 对 OpenClaw 发起 HTTP 探针，可以重启进程。但它把健康状态视为二值的 alive/dead——无法区分真正的死锁和配置重载或 channel 重连，导致良性操作时产生误报告警。

- **差距在于协调**：两边都有能力，但没有共同语言。Desktop 不知道 OpenClaw 正在自愈；OpenClaw 无法向 Desktop 求助。没有统一的升级路径，没有远程上报触发器，没有面向用户的修复入口。

这是一个可解决的集成问题，不是能力缺失问题。

## 3. 目标

1. **端到端自愈闭环** — 从异常检测、自动修复到远程上报和用户可触达的 IM 命令，作为一个统一的系统。
2. **分层职责** — OpenClaw 负责应用内部故障；Desktop 负责进程外部故障。每一层先尝试自行解决，解决不了再升级。
3. **语义化健康协调** — OpenClaw 和 Desktop 之间的正式协议替代仅依赖探针的隐式监控，让 Desktop 理解 OpenClaw 在做什么，反之亦然。
4. **噪音最小化** — 只上报系统真正无法修复的问题。自愈成功的问题不产生告警、不发 Sentry 事件、不打扰用户。
5. **用户可触达的修复入口** — IM 命令（`/diagnose`、`/fix`）让用户直接在聊天中检查和修复，无需接触 CLI 或桌面 UI。

## 4. 非目标

- 不构建完整监控平台（Datadog 继续承担该角色）。
- 不让 OpenClaw 直接上传 Sentry — Desktop 拥有远程上报的职责。
- 不使用日志文本匹配作为生产级协议（用语义化事件替代 POC 中的 `launchd_log_line` 匹配）。
- 本 spec 不覆盖用户侧同意 UX 或发布策略。

---

## 5. 架构

### 职责边界

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw（应用层）                            │
│                                                                 │
│  负责：channel、session、tool、auth、config 异常                  │
│  动作：重试、重启 channel、熔断、doctor 修复                       │
│  输出：结构化诊断事件 + 语义化健康状态                              │
│                                                                 │
│  自愈失败 → 发出 escalation_requested 事件                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ abnormal / recovery / escalation 事件
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│               Desktop / Controller（监督层）                      │
│                                                                 │
│  负责：进程楔死、冷启动失败、renderer 崩溃、                        │
│        sleep/wake 恢复、macOS 权限、端口冲突                      │
│  协调：sleep 状态、维护窗口、自愈感知                               │
│       （避免与 OpenClaw 冲突）                                    │
│  升级至：Sentry 上传、IM 通知、用户交互                             │
└─────────────────────────────────────────────────────────────────┘
```

### 交互模型

```
Desktop ──── HTTP 探针 (5s) ────→ OpenClaw /health（语义化响应）
Desktop ──── RPC 命令 ──────────→ OpenClaw（diagnose、fix、prepare_for_restart 等）
OpenClaw ─── WS/事件通道 ──────→ Desktop（异常信号、升级请求、恢复通知）
```

---

## 6. 健康模型

### 6.1 健康状态枚举

OpenClaw 的 `/health` 响应从二值 alive/dead 升级为语义化状态机：

```typescript
type HealthStatus = "healthy" | "degraded" | "recovering" | "maintenance" | "unhealthy";
```

| 状态 | 含义 | Desktop 应该... |
|------|------|----------------|
| `healthy` | 所有系统正常 | 正常探针节奏 |
| `degraded` | 部分功能受损，已感知并处理中 | 记录日志，延长 wedge 阈值 |
| `recovering` | 主动自愈进行中 | 暂停 wedge 计数器，等待结果 |
| `maintenance` | 有意操作（配置重载、升级） | 完全抑制告警 |
| `unhealthy` | 自愈已耗尽，需要外部帮助 | 开始 Desktop 级干预 |

### 6.2 增强版健康响应 Schema

```typescript
interface HealthResponse {
  status: HealthStatus;
  uptime: number;                // gateway 启动后的秒数

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

  // 是否需要 Desktop 介入？
  escalationRequested: boolean;
  escalationReason?: string;     // "channel_restart_exhausted" | "self_heal_timeout"
}
```

### 6.3 Desktop 探针行为（基于 PR #725 更新）

```
收到探针响应时：
  if status == "healthy":
    重置 consecutiveFailures = 0
    清除 wedgeReported

  if status == "degraded" && selfHealingInProgress:
    // OpenClaw 已感知并在处理 — 不计为失败
    保持 consecutiveFailures 不变（不递增）
    将 wedge 阈值延长至 24（双倍宽限期）
    // 但是：抑制时间上限为 SELF_HEAL_TIMEOUT（默认 10 分钟）。
    // 如果 degraded+selfHealing 持续超过此时间，视为 unhealthy。
    if degradedDuration >= SELF_HEAL_TIMEOUT:
      触发 Desktop 级干预

  if status == "maintenance":
    // 有意操作 — 完全抑制
    重置 consecutiveFailures = 0

  if status == "unhealthy" || escalationRequested:
    // OpenClaw 放弃了 — 跳过 wedge 阈值，立即干预
    触发 Desktop 级干预

  if 探针失败（超时 / 连接拒绝）:
    // 完全无法连接 OpenClaw — 真实失败
    递增 consecutiveFailures
    if consecutiveFailures >= WEDGE_THRESHOLD:
      触发 wedge 检测（沿用 PR #725 逻辑）
```

---

## 7. 协调协议

### 7.1 OpenClaw → Desktop 事件

通过现有 WS/事件通道发出的结构化事件：

```typescript
// OpenClaw 正在尝试内部恢复
interface SelfHealingStarted {
  type: "self_healing_started";
  target: string;          // 正在修复什么
  strategy: string;        // "channel_restart" | "auth_refresh" | "circuit_break"
  timestamp: number;
}

interface SelfHealingSucceeded {
  type: "self_healing_succeeded";
  target: string;
  strategy: string;
  durationMs: number;
  timestamp: number;
}

interface SelfHealingFailed {
  type: "self_healing_failed";
  target: string;
  strategy: string;
  attempts: number;
  lastError: string;
  timestamp: number;
}

// OpenClaw 无法恢复 — 请求 Desktop 介入
interface EscalationRequested {
  type: "escalation_requested";
  reason: string;            // "channel_restart_loop_exhausted" | "auth_refresh_failed"
  context: Record<string, unknown>;  // Sentry/诊断的上下文
  // 重要：context 在发出前必须经过脱敏 — 不得包含 token、secret 或凭据。
  // 必须使用现有的脱敏层（redaction.ts）作为强制过滤器，
  // 仅允许白名单字段通过。
  suggestedAction?: "restart_gateway" | "notify_user" | "report_sentry";
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

### 7.2 Desktop → OpenClaw 命令

添加到 OpenClaw `server-methods/` 的 RPC 方法：

```typescript
// 通知 OpenClaw Desktop 侧的上下文
interface DesktopSleepResumed {
  method: "desktop_sleep_resumed";
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

// 告诉 OpenClaw 在 Desktop 干预后重置瞬态计数器
interface ResetTransientHealthCounters {
  method: "reset_transient_health_counters";
  reason: string;             // "post_restart" | "post_sleep_resume"
}
```

---

## 8. 恢复流程

分层升级，噪音最小化：

```
┌─ 第一层：OpenClaw 内部 ──────────────────────────────────────┐
│                                                               │
│  检测到异常（channel monitor / diagnostic event）              │
│    → 尝试自愈（重试 / 重启 / 熔断）                             │
│    → 发出 self_healing_started                                │
│                                                               │
│  结果 A：恢复成功                                              │
│    → 发出 self_healing_succeeded                              │
│    → 健康状态恢复为 "healthy"                                  │
│    → 结束（无噪音，无上报）                                     │
│                                                               │
│  结果 B：达到最大重试次数后恢复失败                               │
│    → 发出 self_healing_failed                                 │
│    → 发出 escalation_requested                                │
│    → 健康状态转为 "unhealthy"                                  │
│                                                               │
└───────────────────────────────────┬───────────────────────────┘
                                    │ 升级
                                    ▼
┌─ 第二层：Desktop 干预 ──────────────────────────────────────┐
│                                                               │
│  Desktop 收到 escalation_requested 或检测到 wedge             │
│    → 向 OpenClaw 发送 prepare_for_restart                     │
│    → 等待宽限期完成状态刷写                                     │
│    → 执行进程重启                                              │
│    → 发送 reset_transient_health_counters                     │
│                                                               │
│  结果 A：重启成功，健康状态恢复为 "healthy"                      │
│    → 记录 gateway_recovery，结束                               │
│                                                               │
│  结果 B：重启失败 或 重启循环耗尽                                │
│    → 进入第三层                                                │
│                                                               │
└───────────────────────────────────┬───────────────────────────┘
                                    │ 仍然异常
                                    ▼
┌─ 第三层：远程上报 + 用户触达 ────────────────────────────────┐
│                                                               │
│  触发三路并行输出：                                             │
│                                                               │
│  1. Sentry：captureMessage + diagnostics ZIP 附件              │
│    （包含 OpenClaw 升级请求中的诊断上下文）                      │
│                                                               │
│  2. IM 通知用户：                                              │
│     "检测到持续性 gateway 异常。回复 /diagnose 查看详情，        │
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
| `self_healing_failed_and_escalated` | OpenClaw 耗尽内部恢复手段，请求 Desktop 帮助，Desktop 干预也失败 |
| `renderer_crash_before_ready` | Electron renderer 进程在初始化完成前崩溃 |
| `restart_loop_exhausted` | Desktop 在窗口期内重启 gateway N 次，仍不健康 |

### 9.2 去重与限流

- **按 episode 去重**：每个故障 episode 只产生一个 Sentry 事件（复用 PR #725 的 `wedgeReported` flag 模式）
- **限流**：所有触发类型合计每小时最多 3 个 Sentry 事件
- **恢复重置**：健康状态恢复为 "healthy" 时重置所有计数器和标志
- **冷却期**：Sentry 上报后，同一触发类型抑制 30 分钟

### 9.3 诊断载荷

复用现有 `diagnostics-export.ts`，增加：

- 已有：运行时状态、最近事件、启动状态、renderer 故障、健康指标
- 新增：OpenClaw 的 `escalation_requested` 事件上下文、自愈尝试历史、最近 N 次带语义状态的健康响应

---

## 10. IM 命令

### 10.1 `/diagnose` — 自检报告

**触发**：用户在任意已连接 IM channel 中发送 `/diagnose`。

**流程**：
1. Channel 将命令路由到 gateway（绕过 AI agent 路径）
2. Gateway 调用 OpenClaw `run_diagnose(depth: "full")`
3. Desktop 附加自身视角（探针历史、进程统计、sleep/wake 日志）
4. 合并报告返回至 IM

**报告内容**：
```
Gateway 健康状态：degraded
  - telegram:bot1：重连中（第 3 次尝试，45s 前开始）
  - auth:claude：2 小时后过期
  - session：3 个活跃，0 个卡死

进程：运行中（PID 12345，运行时间 6h）
Desktop 探针：0 次连续失败
上次 sleep/wake：2 小时前，正常恢复

自愈：1 个活跃恢复（telegram channel 重启）
升级请求：无
```

### 10.2 `/fix` — 触发修复

**触发**：用户在任意已连接 IM channel 中发送 `/fix`。

**授权**：`/fix`（和 `/diagnose`）需要操作员级别授权。只有指定的管理员用户或白名单 channel 可以执行这些命令。在共享 channel 中，gateway 必须在执行任何修复操作前验证发送者身份是否在操作员白名单中。未授权的发送者收到"权限不足"响应。

**流程**：
1. 验证发送者是否为授权操作员（未授权则拒绝）
2. Gateway 调用 OpenClaw `run_fix(scope: "safe")`
2. OpenClaw 执行安全修复（auth 刷新、channel 重启、session 清理）
3. 结果返回至 IM
4. 如果安全修复不够，IM 询问："部分问题需要重启 gateway（短暂断连）。是否继续？回复 `/fix confirm`"
5. 确认后：Desktop 执行 `prepare_for_restart` → 进程重启 → `reset_transient_health_counters`

**操作分级**：

| 级别 | 操作 | 需要确认 |
|------|-----|---------|
| 安全 | 刷新 auth token、重启不健康 channel、清理卡死 session | 否 |
| 中等 | 重启 gateway 进程、重载配置 | 是 |
| 受限 | 清空 session 存储、重建沙箱镜像 | 是 + 警告 |

---

## 11. 发布计划

### 阶段 1：健康语义化

- 增强 OpenClaw `/health` 端点，实现 `HealthResponse` schema（状态枚举、degradedReasons、selfHealingInProgress、escalationRequested）
- 更新 Desktop 探针逻辑以尊重语义化状态（PR #725 演进）
- **验证**：配置重载或 channel 重连期间不再产生误报 wedge 告警

### 阶段 2：协调协议

- 实现 OpenClaw → Desktop 事件（self_healing_*、escalation_requested、maintenance_*）
- 实现 Desktop → OpenClaw 命令（desktop_sleep_resumed、prepare_for_restart、reset_transient_health_counters）
- 将 Desktop 的 sleep/wake 监听器接入发送 `desktop_sleep_resumed`
- **验证**：Desktop 在 OpenClaw 自愈期间正确暂停 wedge 计数

### 阶段 3：升级与上报

- 实现分层恢复流程（第一层 → 第二层 → 第三层）
- 仅将 Sentry 上报接入第三层触发条件（按上报策略）
- 将 OpenClaw 升级上下文纳入 diagnostics ZIP
- **验证**：Sentry 事件仅在真正不可恢复的故障时触发

### 阶段 4：IM 命令

- 将 `/diagnose` 和 `/fix` 注册为 gateway 命令（绕过 agent 路由）
- 在 OpenClaw 中实现 `run_diagnose` 和 `run_fix` server method
- Desktop 向 `/diagnose` 输出贡献自身视角
- 实现中等/受限级别 `/fix` 操作的确认流程
- **验证**：用户可以从 IM 直接诊断和修复，无需接触 CLI 或桌面 UI

---

## 12. 待解决问题

1. `maintenance_started` / `maintenance_finished` 是否应在 OpenClaw 配置重载时自动发出，还是需要显式触发？
2. `escalation_requested` 的超时时间是多少 — OpenClaw 应该尝试多久后放弃？
3. `/diagnose` 和 `/fix` 应在所有 channel 可用，还是限制在管理员指定的 channel？
4. 在多设备场景下（多个 Desktop 连接同一个 OpenClaw）如何协调？
5. 第三层故障时的 IM 通知是否应包含故障摘要，还是仅提示运行 `/diagnose`？

---

## 13. 参考资料

- OpenClaw 健康基础设施：`src/commands/health.ts`、`src/gateway/server-methods/health.ts`、`src/gateway/channel-health-monitor.ts`
- OpenClaw 诊断事件：`src/infra/diagnostic-events.ts`、`src/logging/diagnostic.ts`
- OpenClaw doctor/修复：`src/commands/doctor.ts`、`src/commands/doctor-gateway-daemon-flow.ts`
- OpenClaw tool 死循环检测：`src/agents/tool-loop-detection.ts`
- Desktop 健康探针：`apps/controller/src/runtime/runtime-health.ts`（PR #725）
- Desktop wedge 检测：`apps/controller/src/runtime/loops.ts`（PR #725）
- Sentry 受控失败 spec：`specs/change/20260326-desktop-handled-failure-sentry/spec.md`
