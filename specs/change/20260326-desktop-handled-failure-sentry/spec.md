---
id: "20260326-desktop-handled-failure-sentry"
name: "Desktop Handled Failure Reporting via Sentry"
status: proposed
created: "2026-03-26"
---

## Overview

Nexu Desktop 已经能够把 renderer/main JavaScript exception 和 native crash 上报到 Sentry，但这条链路还不足以覆盖另一类更影响排障效率的问题：应用没有 crash，也不一定抛出有意义的异常，但关键功能链路已经异常、中断、降级或行为不符合预期。

这类问题目前仍然高度依赖用户手动执行 `Help -> Export Diagnostics` 并反馈给团队，排查成本高，现场也容易丢失。

本 spec 目标是为 desktop 中“非 crash、非 uncaught exception”的功能链路异常建立新的自动上报目标：在异常发生时，自动保留并上传足够完整的诊断现场，减少对用户手动导出 diagnostics 的依赖。短期优先目标是**多发现、快排查、快修复**，而不是做一套长期监控体系，并且尽量复用现有 diagnostics export 和 Sentry 基础设施，降低实现成本和落地周期。

范围上，in scope 的是 Desktop 内“没有 crash、没有有价值 Error 对象，但需要远程排查”的功能链路异常，例如 OpenClaw 进程异常退出、关键 runtime 链路断开、启动完成但处于 degraded 状态、功能行为异常但未抛顶层错误。out of scope 的是详细 rollout 计划、精确代码修改点列表、告警策略，以及面向用户的 consent/提示 UX 细节。

同时，本工作不打算替代 Datadog 的指标、监控面板或趋势分析能力，也不在本文件中确定最终代码实现细节、完整触发点清单或最终事件 schema，不把范围扩展到 controller / web / 全链路统一可观测性方案，也不在本阶段过早优化体积、成本或长期治理策略而牺牲短期问题发现率。

## Research

当前状态如下：

- Desktop Sentry 已经覆盖 main-process JavaScript exception、renderer JavaScript exception 和 native crash。见 `specs/current/sentry/SENTRY.md`。
- Desktop 已经维护了持久化 diagnostics snapshot，并且已经有 diagnostics export ZIP 流程。相关参考：
  - `specs/current/diagnostics/diagnostics.md`
  - `apps/desktop/main/desktop-diagnostics.ts`
  - `apps/desktop/main/diagnostics-export.ts`
- 现有 diagnostics 数据已经包含不少对排障有价值的现场信息，包括 runtime state、recent runtime events、cold-start state、renderer/webview failures、startup health 等。
- `diagnostics-export.ts` 已经具备收集、脱敏、打包 ZIP 的核心能力，理论上可以复用于自动上传路径，只是当前入口仍然是手动导出。

目标状态是让 Nexu Desktop 新增一类面向 **handled functional failures** 的自动上报能力：应用仍然活着，可能没有有意义的 `Error` 对象，但用户可感知的重要功能链路已经断裂、降级或异常，系统应自动附带足够完整的本地诊断现场，以支持远程排查。

在当前阶段，这个目标不再追求“只上传轻量摘要”，而是倾向于只要触发信号足够可信，就优先上传**完整 diagnostics ZIP**；先提高问题发现率和可排查性，再在后续阶段优化体积、采样、频率和治理策略。

## Design

关键设计决策如下：

### Use Sentry for handled desktop failure diagnosis

短期继续复用 Sentry 作为 desktop 远程失败诊断的承载链路。

Reasoning:
- Desktop Sentry 已经上线并按环境区分 project。
- release / dist / build metadata / sourcemap 流程已经存在。
- 当前需求是快速增强“问题发现 + 远程排查”，不是另起一套上传或监控平台。

### Target handled failures, not uncaught exceptions

这次要解决的问题明确不是现有的 crash / uncaught exception pipeline，而是 handled failure。

Examples:
- OpenClaw 异常退出，但 desktop shell 仍在运行。
- 某条 runtime 链路中断、卡死或失联。
- 启动流程最终完成，但处于 degraded 状态。
- 某条关键功能链路行为异常，但没有抛出可用异常。

### Optimize for diagnosis, not monitoring

短期目标是提高功能链路异常的发现率和排查效率，不是让 Sentry 承担长期监控、趋势分析或 SLO 角色。

Implications:
- Datadog 继续承担 metrics / monitoring 角色。
- Sentry 这里优先承载“能让人定位问题的现场”，而不是高频统计数据。

### Prefer full diagnostics ZIP over lightweight snapshots

在当前阶段，默认优先考虑自动上传完整 diagnostics ZIP，而不是只上传轻量 snapshot。

Implications:
- 复用现有 `diagnostics-export.ts` 的收集、脱敏、打包 ZIP 能力。
- 通过 Sentry attachment / diagnostics bundle 的方式复用现有链路，优先降低开发成本。
- 手动 export flow 仍然保留，作为显式支持路径和人工兜底。
- 需要接受短期内体积、配额和噪音可能更高的现实，并在后续阶段再治理。

### Allow signal-driven events without exception-shaped payloads

这类事件很可能没有 stack trace，也没有真实 `Error` 对象，触发条件更多来自“观测信号”而不是 exception。

Implications:
- 上报设计必须允许“信号触发 + 附带诊断 ZIP”，而不是强依赖异常对象。
- 与其制造假的 exception，不如把高质量现场带上去。

### Drive triggering from trusted abnormal signals

初始触发点应来自少量高价值、可信度高的异常信号，而不是广泛捕获所有 warning。

Implications:
- 例如：OpenClaw 进程挂掉、关键 runtime unit 异常退出、启动降级、关键链路失联。
- 避免把短暂重试、普通 warning、可预期波动都升级成 diagnostics ZIP 上传。

### Reuse the normal Sentry SDK pipeline first

基于当前调研，复用 Sentry SDK attachment 能力上传 diagnostics ZIP 在短期内是可接受的工程路径。

Implications:
- 对于常规大小的 ZIP，这是最省实现成本的方案。
- 但 Sentry attachment 受 envelope 大小限制约束，超限会被丢弃；因此即便短期追求完整，也仍需要基础的大小认知和失败兜底。
- 后续如果 ZIP 体积、频率或成本不可接受，再考虑独立上传路径。

工作原则：

- **发现优先：** 短期先优先发现和定位问题，而不是优先控制上传体积。
- **信号触发：** 只在可信异常信号出现时触发自动上传。
- **完整现场优先：** 在当前阶段，现场完整性优先于“只保留摘要”。
- **默认脱敏：** 自动远程上传仍然必须建立在现有 redaction 基础上。
- **复用优先：** 能复用 diagnostics export / Sentry 现有链路，就不额外新造系统。
- **保留手动兜底：** 自动上传不能替代手动导出，只是减少其发生频率。

## POC

本次做了一个以“验证整条链路可行”为目标的最小 POC，不追求最终触发策略，只验证以下问题：

- desktop 是否可以在非 crash、非 uncaught exception 的情况下主动向 Sentry 发送 handled failure 事件。
- 是否可以复用现有 diagnostics export 能力，自动生成并上传 diagnostics ZIP attachment。
- 本地是否存在一个足够容易、稳定、可重复的触发方式，用于验证整条链路。

### POC 思路

POC 采用“复用现有能力 + 最小新增 glue code”的方式：

- 继续使用 desktop 现有 Sentry SDK 初始化与上报链路。
- 复用 `apps/desktop/main/diagnostics-export.ts` 的 diagnostics 收集、脱敏、打 ZIP 逻辑。
- 新增一个 main-process reporter，监听 desktop runtime event，在命中目标信号时：
  1. 导出 diagnostics ZIP 到临时目录
  2. 调用 Sentry `captureMessage(...)` 创建 handled failure 事件
  3. 通过 attachment 把 ZIP 一起上传
  4. 上传完成后删除本地临时 ZIP

### 触发信号选择与调整

最初尝试的信号是 `openclaw` runtime unit 的 `process_exited`。从语义上它最贴近“OpenClaw 异常退出”，但在本地 desktop 的 launchd 模式下，手动 `kill` OpenClaw 后，实际稳定出现的是：

- `launchd_log_line`
- 日志内容包含 `signal SIGTERM received` / `received SIGTERM; shutting down`
- 随后 launchd 自动拉起新的 OpenClaw PID

也就是说，在当前本地验证环境里，`process_exited` 并不是最稳定可见的信号，导致第一轮没有触发 Sentry 上报。

因此 POC 将触发条件调整为：

- `unitId === "openclaw"`
- 且满足以下任一条件：
  - `reasonCode === "process_exited"`
  - `reasonCode === "launchd_log_line"` 且 message 包含 `signal SIGTERM received`
  - `reasonCode === "launchd_log_line"` 且 message 包含 `received SIGTERM; shutting down`

这个调整不是最终产品策略，只是为了让 launchd 模式下的本地 kill 场景能够稳定命中，验证“trigger -> diagnostics export -> Sentry event -> attachment”整条链路。

### 实施过程

POC 过程中新增了两个最小改动点：

- 在 `apps/desktop/main/diagnostics-export.ts` 中补充可复用的无 UI 导出入口，允许直接导出 diagnostics ZIP 到指定路径。
- 新增 `apps/desktop/main/handled-failure-reporter.ts`，在 desktop main process 中订阅 runtime event，并在命中 handled failure trigger 时发往 Sentry。

事件上报时使用统一 message：

- `desktop.handled_failure.openclaw_process_exited`

并附带以下 tags / context 作为检索与排障入口：

- `nexu.handled_failure=true`
- `nexu.handled_failure_kind=openclaw_process_exited`
- `nexu.runtime_unit=openclaw`
- `nexu.runtime_reason_code=<实际命中的 reasonCode>`
- `nexu.runtime_trigger_source=<实际命中的 reasonCode>`
- `handled_failure` context（包含 logId、message、ts、phase、warnings 等）

### 本地验证步骤

本地使用 launchd dev runtime 进行验证，步骤如下：

1. 启动 desktop 本地运行时
2. 确认 `openclaw` 处于 running 状态
3. 手动执行 `kill -TERM <openclaw pid>`
4. 观察 launchd 自动拉起新的 OpenClaw PID
5. 查询 Sentry `nexu-desktop-dev` project 中是否出现新的 handled failure issue / event
6. 确认 event 是否包含 diagnostics ZIP attachment

### 验证结果

POC 验证通过，链路已经打通。

实际观察结果：

- 手动 kill OpenClaw 后，launchd 会自动重启 OpenClaw，新 PID 能稳定出现。
- 本地 `openclaw.log` 中稳定出现：
  - `signal SIGTERM received`
  - `received SIGTERM; shutting down`
- Sentry `nexu-desktop-dev` 中成功创建并聚合 handled failure issue：
  - issue: `NEXU-DESKTOP-DEV-J`
  - title: `desktop.handled_failure.openclaw_process_exited`
- 最新 event 成功带上 diagnostics ZIP attachment：
  - filename: `nexu-diagnostics.zip`
  - size: `44361` bytes

这说明当前方案至少已经证明以下事实：

- desktop 可以不依赖 crash / exception，也能主动产生 handled failure Sentry event。
- diagnostics ZIP 可以通过现有 export 逻辑生成，并作为 attachment 成功进入 Sentry。
- 现有 Sentry project 足以承载这一类“signal-driven handled failure”事件，不需要先建设新的上传基础设施。

### POC 结论

本 spec 关注的核心方向是可行的。

具体来说，Nexu Desktop 已经具备实现“trusted abnormal signal 触发 -> 自动导出 diagnostics ZIP -> 自动上报到 Sentry”这条 handled failure reporting 链路的工程基础。后续要做的主要不是证明能不能做，而是决定：

- 第一批正式触发信号选哪些
- 如何控制噪音和分组
- 何时需要从 Sentry attachment 升级为独立上传路径

## Plan

- [ ] Phase 1: Clarify handled failure reporting boundaries
  - [ ] Confirm the first batch of trusted abnormal signals to avoid noisy uploads
  - [ ] Define what qualifies as a handled functional failure versus an existing crash/exception event
  - [ ] Decide how these events should be grouped, tagged, and queried in the desktop Sentry project
- [ ] Phase 2: Define diagnostics payload and transport strategy
  - [ ] Define diagnostics ZIP size expectations, truncation rules, and send-failure fallback behavior
  - [ ] Confirm which existing diagnostics export artifacts can be reused directly for automatic upload
  - [ ] Validate the short-term Sentry attachment/envelope constraints for expected desktop diagnostics bundles
- [ ] Phase 3: Validate privacy and rollout assumptions
  - [ ] Review whether any additional fields or files must be removed beyond the current redaction layer for default auto-upload
  - [ ] Preserve the manual diagnostics export flow as an explicit support fallback
  - [ ] Document the threshold for switching to a separate upload path if Sentry attachment cost or size becomes unacceptable

## Notes

Open questions:

- 第一批触发信号具体选哪些，才能在“发现率”和“噪音”之间取得平衡？
- diagnostics ZIP 的体积上限、截断策略和发送失败兜底应该如何定义？
- 这类 handled failure 事件在现有 desktop Sentry project 中如何分组、标记和检索，避免与 crash issue 混淆？
- 上传完整 diagnostics ZIP 时，还需要额外剔除哪些字段或文件，才能满足默认自动上传的安全边界？
- 如果 Sentry attachment 体积或频率不可接受，后续切换独立上传链路的分界点是什么？

References:

- `specs/current/sentry/SENTRY.md`
- `specs/current/diagnostics/diagnostics.md`
- `apps/desktop/main/desktop-diagnostics.ts`
- `apps/desktop/main/diagnostics-export.ts`
- `apps/desktop/main/redaction.ts`
- `apps/desktop/main/runtime/daemon-supervisor.ts`
