---
title: OpenClaw Gateway 健康检查方案（Runtime Sidecar）
doc_type: design
author: opencode
created_at: 2026-02-26
updated_at: 2026-02-26
status: draft
version: v0.1
---

# OpenClaw Gateway 健康检查方案（Runtime Sidecar）

## Context

当前 `apps/gateway` 已有以下能力：

- 启动前可选检查：基于 gateway 可达性的启动门禁
- 配置轮询与原子落盘：`/api/internal/pools/{poolId}/config/latest`
- 心跳上报：`/api/internal/pools/heartbeat`（上报 sidecar 状态）

但目前缺少对 OpenClaw Gateway 的持续健康探测，运行时无法可靠区分以下场景：

- gateway 进程挂掉
- gateway 可连通但内部降级（channels/session 异常）
- 短暂抖动与持续故障

这导致控制面只看到 sidecar 进程状态，不足以反映真实“消息处理能力”。

参考文档：`https://docs.openclaw.ai/gateway/health`（官方推荐通过 CLI `status/health` 进行健康诊断）。

---

## Goals

1. 为 sidecar 引入分层健康检查：`liveness` + `deep health`。
2. 统一健康状态机：`active` / `degraded` / `unhealthy`。
3. 将 gateway 健康状态通过现有 heartbeat 上报到控制面（不新增 sidecar 对外服务）。
4. 降低误判率：支持重试、阈值、时间窗与退避。
5. 保持敏感信息安全：探测日志中不泄露 token/secret。

## Non-Goals

- 不修改 OpenClaw 核心源码。
- 不新增 sidecar 的 Hono/HTTP 服务端。
- 不引入新基础设施（消息队列、服务网格、外部监控代理）。
- 不在该阶段做自动流量迁移或自动跨池重平衡。

---

## 设计原则

- **分层探测**：高频轻量 + 低频深度。
- **状态稳定优先**：避免单次失败触发状态抖动。
- **可解释性**：状态变化必须有明确 reason/code。
- **渐进升级**：先启用监控与上报，再逐步接入告警/自愈。

---

## 总体方案

```text
gateway
  ├─ startup readiness gate (已有)
  ├─ liveness probe loop (新增, 高频)
  ├─ deep health probe loop (新增, 低频)
  ├─ state evaluator (新增, 统一状态机)
  └─ heartbeat reporter (已有, 继续复用)
        -> apps/api /api/internal/pools/heartbeat
```

### 1) 启动前 Readiness（保留）

- 使用 CLI `openclaw health --json` 做启动门禁轮询，返回成功后再进入注册与配置拉取。
- 语义：只做“启动门禁”，不承担运行时健康判定。
- 若未启用 gateway 健康探测，sidecar 不阻塞启动（兼容本地开发）。

### 2) 运行时 Liveness（新增）

- 探测目标：CLI 健康快照命令 `openclaw health --json`（WS health snapshot）。
- 频率：默认 `5s`。
- 超时：默认 `2s`。
- 判定：
  - 连续失败 `< N1`：保持现状
  - 连续失败 `>= N1`：标记 `degraded`
  - 恢复成功 `>= R1` 次：允许从 `degraded` 回到 `active`

建议默认值：

- `N1 = 3`
- `R1 = 2`

### 3) 运行时 Deep Health（新增）

- 探测目标：CLI 深度状态命令 `openclaw status --deep --json`。
- 频率：默认 `30s`。
- 超时：默认 `5s`。
- 判定：
  - 连续失败 `>= N2` 或连续异常时间超过 `T2`：标记 `unhealthy`
  - deep health 恢复成功 `>= R2` 次：允许从 `unhealthy` 降级到 `degraded`，再由 liveness 驱动回 `active`

建议默认值：

- `N2 = 3`
- `T2 = 60s`
- `R2 = 2`

---

## 状态机设计

状态集：`active | degraded | unhealthy`

### 迁移规则

1. `active -> degraded`
   - liveness 连续失败达到 `N1`。
2. `degraded -> unhealthy`
   - deep health 连续失败达到 `N2`，或持续异常超过 `T2`。
3. `unhealthy -> degraded`
   - deep health 连续成功达到 `R2`。
4. `degraded -> active`
   - liveness 连续成功达到 `R1` 且 deep health 最近窗口无失败。

### 抖动控制

- 引入最小驻留时间 `minStateHoldMs`（默认 `15s`），防止频繁来回切换。
- 仅在状态变化时打印 `info` 日志；探测成功日志降为 `debug`（或采样）。

---

## 与现有 sidecar 的集成点

### 新增模块（建议）

- `src/gateway-health.ts`
  - 负责 liveness/deep health 探测
  - 输出探测结果与状态建议
- `src/health-state.ts`
  - 维护失败计数、恢复计数、状态迁移与最小驻留时间
- `src/loops.ts`
  - 新增 `runGatewayHealthLoop(state)`

### 复用模块

- `src/state.ts`
  - 扩展 runtime state：
    - `gatewayStatus`
    - `gatewayLastOkAt`
    - `gatewayLastErrorCode`
    - `gatewayLastErrorAt`
- `src/api.ts`
  - 继续通过 heartbeat 上报状态
- `src/index.ts`
  - 在主流程启动健康循环（与 poll/heartbeat 并行）

---

## 配置项设计（环境变量）

新增可选 env：

- `OPENCLAW_BIN`：OpenClaw CLI 可执行文件（默认 `openclaw`）
- `OPENCLAW_PROFILE`：可选 profile（等价 CLI `--profile <name>`）
- `RUNTIME_GATEWAY_PROBE_ENABLED`（默认 `true`）
- `RUNTIME_GATEWAY_CLI_TIMEOUT_MS`（默认 `10000`，与 `openclaw health` 默认超时一致）
- `RUNTIME_GATEWAY_LIVENESS_INTERVAL_MS`（默认 `5000`）
- `RUNTIME_GATEWAY_DEEP_INTERVAL_MS`（默认 `30000`）
- `RUNTIME_GATEWAY_FAIL_DEGRADED_THRESHOLD`（默认 `3`）
- `RUNTIME_GATEWAY_FAIL_UNHEALTHY_THRESHOLD`（默认 `3`）
- `RUNTIME_GATEWAY_RECOVER_THRESHOLD`（默认 `2`）
- `RUNTIME_GATEWAY_UNHEALTHY_WINDOW_MS`（默认 `60000`）
- `RUNTIME_GATEWAY_MIN_STATE_HOLD_MS`（默认 `15000`）

兼容策略：

- 若 `RUNTIME_GATEWAY_PROBE_ENABLED=false`，则关闭运行时 gateway 探测（仅保留配置轮询与心跳上报）。
- 兼容旧配置：若存在 `OPENCLAW_GATEWAY_URL` / `OPENCLAW_GATEWAY_HEALTH_URL` / `OPENCLAW_GATEWAY_STATUS_URL`，记录 deprecation warning，并在一个版本窗口后移除。
- `OPENCLAW_GATEWAY_READY_URL` 在新方案中完全移除，sidecar 不再读取该变量，所有启动门禁与运行时探测统一走 CLI。

### CLI 探测命令约定

sidecar 统一通过 CLI 命令判断 gateway 状态，不依赖 HTTP health endpoint：

1. liveness 命令
   - `openclaw health --json --timeout <ms>`
2. deep health 命令
   - `openclaw status --deep --json --timeout <ms>`
3. profile 透传
   - 若设置 `OPENCLAW_PROFILE`，两条命令都增加 `--profile <name>`

返回值处理约定：

- CLI exit code 非 0 视为探测失败。
- 命令超时视为探测失败（错误码归类 `cli_timeout`）。
- CLI 输出不是合法 JSON 视为探测失败（错误码归类 `parse_error`）。

安全要求：

- token/password 仅通过环境变量注入，不作为 CLI 明文参数。
- 日志仅打印命令名与退出码，不打印完整命令行参数与原始输出。

---

## 心跳上报契约扩展

当前 `runtimePoolHeartbeatSchema` 已支持 `status` 与 `lastSeenVersion`。本方案建议：

1. 阶段一（无 schema 变更）
   - 直接复用 `status` 字段承载 sidecar 汇总状态（包含 gateway 健康结论）。
2. 阶段二（可选增强）
   - 增加可选字段：
     - `gatewayStatus`
     - `gatewayLastOkAt`
     - `gatewayLastErrorCode`
   - API 持久化后可用于控制面更细粒度告警与展示。

---

## 日志与可观测性

建议统一结构化日志字段：

- `event`: `gateway_probe` | `gateway_state_changed`
- `probeType`: `liveness` | `deep`
- `status`: `active` | `degraded` | `unhealthy`
- `latencyMs`
- `consecutiveFailures`
- `consecutiveSuccesses`
- `errorCode`（如 `cli_timeout`, `cli_exit_nonzero`, `parse_error`）

安全要求：

- 不记录 CLI 环境变量中的 token/password。
- 不记录完整命令输出（可能包含敏感上下文）。
- 不在错误日志打印完整命令参数。

---

## Gateway 配置文件路径识别

在健康检查和故障排查中，需要先确认 gateway 进程实际读取的配置文件路径，避免误把 sidecar 落盘路径与 gateway 读取路径当成同一个。

推荐检查命令：

```bash
openclaw gateway status --deep
```

应重点核对两项：

- `Config Path (CLI)`：当前 CLI 上下文解析到的配置路径。
- `Config Path (Service)`：后台 service 实际使用的配置路径（更权威）。

默认与覆盖规则：

- 默认路径：`~/.openclaw/openclaw.json`
- 若设置 `OPENCLAW_CONFIG_PATH`，则以该环境变量为准。

排障建议：

1. sidecar 的 `OPENCLAW_CONFIG_PATH` 与 gateway `Config Path (Service)` 必须一致。
2. 若出现 `Config Path Mismatch`，优先修正 service 环境变量或重装 service（`gateway install`）。
3. 在修正路径前，不要基于“文件已写入”直接判定热加载成功。

---

## 失败语义与告警建议

建议控制面按状态持续时间告警，而非瞬时告警：

- `degraded` 持续 `>= 2min`：warning
- `unhealthy` 持续 `>= 1min`：critical
- `unhealthy` 恢复：发送恢复事件

并区分三类故障来源：

1. `network`（超时/连接拒绝）
2. `gateway_internal`（接口返回异常）
3. `config_or_channel`（deep health 暴露的业务层异常）

---

## Rollout 计划

### Phase 1（最小可用）

- 新增 liveness 探测与状态机。
- 仅影响 sidecar `status` 上报，不改 API schema。
- 观察 1-2 周，确认误报率。

### Phase 2（增强）

- 加入 deep health 探测。
- 引入 `unhealthy` 判定时间窗。

### Phase 3（可观测性增强）

- heartbeat schema 扩展网关明细字段。
- dashboard 增加 pool/gateway 健康可视化。

---

## 测试计划

### 单元测试

- 状态迁移表驱动测试（所有迁移路径）。
- 阈值、恢复阈值、最小驻留时间测试。
- 错误分类测试（timeout/5xx/network）。

### 集成测试

- 模拟 gateway 正常 -> 抖动 -> 故障 -> 恢复全过程。
- 验证 heartbeat `status` 与期望一致。
- 验证配置轮询失败与 gateway 探测失败并发时，状态优先级正确。

### 手工验证

1. 启动 gateway 与 sidecar，确认 `active`。
2. 停止 gateway 进程，确认 `degraded -> unhealthy`。
3. 恢复 gateway，确认 `unhealthy -> degraded -> active`。
4. 注入短时网络抖动，确认不会频繁误切状态。

---

## 风险与缓解

- **风险：误报导致状态抖动**
  - 缓解：阈值 + 最小驻留时间 + 成功恢复阈值。
- **风险：探测本身增加负载**
  - 缓解：高低频分层、轻量接口优先、超时严格限制。
- **风险：深度探测接口不可用**
  - 缓解：deep health 命令失败时可退化为低频 liveness 命令。
- **风险：日志泄露敏感信息**
  - 缓解：统一脱敏策略与字段白名单。

---

## Open Questions

1. 控制面是否需要区分 `sidecar_status` 与 `gateway_status` 两个字段？
2. `unhealthy` 是否触发自动重启策略，或仅告警交由平台处理？

---

## 决策建议（默认）

- 采用 CLI 统一探测：liveness 使用 `openclaw health --json`，deep health 使用 `openclaw status --deep --json`。
- 不依赖 HTTP health endpoint；命令超时、退出码、JSON 解析失败统一纳入状态机失败计数。
- 先只复用 heartbeat 的 `status` 字段，待观测稳定后再扩展 schema。
