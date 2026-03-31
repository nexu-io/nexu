---
id: 20260330-credit-storage
name: Credit Storage
status: designed
created: '2026-03-30'
---

## Overview

现在希望为 nexu 设计积分方案。nexu 目前是无限量使用，只有每周和每 5 小时的限额。后续会改成积分方案，有利于商业化。

商业化背景方案参考 pricing.pdf

积分方案会涉及到云端的 nexu-cloud 和 nexu-link 仓库。相关仓库的作用见 /Users/william/projects/nexu-stack/AGENTS.md

积分方案的第一步是设计积分持久化方案，先聚焦一下数据怎么存，确定之后就可以分工搞了。基本的原则是：写入在 cloud 做，读取在 link 做。

## Research

### 现有系统

- **nexu 当前接入方式是桌面端本地控制器拉取云端身份与模型信息**：控制器通过 cloud profile 选择 `cloudUrl` / `linkUrl`，走 device auth 拿到 API key，再从 `linkUrl/v1/models` 拉模型列表，并把结果持久化到本地 `desktop.cloud` / `desktop.cloudSessions`。关键位置：`apps/controller/src/store/nexu-config-store.ts:70`、`apps/controller/src/routes/desktop-compat-routes.ts:40`、`apps/controller/src/lib/openclaw-config-compiler.ts:273`。
- **nexu 运行时对 link 的使用方式是“读模型目录 + 带 Bearer key 走 OpenAI 兼容接口”**：编译器把 cloud session 注入为 `providers.link`，模型 ID 解析时只在 cloud models 中存在时才回退到 `link/...`。关键位置：`apps/controller/src/lib/openclaw-config-compiler.ts:277`、`apps/controller/src/lib/openclaw-config-compiler.ts:353`。
- **nexu 当前没有真正的积分/余额持久化实现**：现有显式限额只有 `/api/v1/bot-quota`，实现是固定返回 `available: true` 和 `now + 24h`，未落库。关键位置：`apps/controller/src/routes/channel-routes.ts:283`、`apps/controller/src/services/channel-service.ts:664`。
- **nexu 本地持久化模式当前以 JSON 文件为主**：`config.json` 保存控制器配置，`cloud-profiles.json` 保存 cloud profiles，`skill-ledger.json` 和 `analytics-state.json` 也都走原子 JSON 写入。关键位置：`apps/controller/src/app/env.ts:82`、`apps/controller/src/store/lowdb-store.ts:36`、`apps/controller/src/services/skillhub/skill-db.ts:43`。
- **nexu-cloud 当前职责偏身份与 API key 生命周期**：Better Auth 管登录态；桌面授权流分为 device-register、desktop-authorize、device-poll 三步；授权成功后生成 `nxk_...` API key，写入 `api_keys`，并把明文 key 加密暂存到 `device_authorizations` 供轮询取回。关键位置：`/Users/william/projects/nexu-stack/nexu-cloud/apps/api/src/routes/desktop-auth-routes.ts:19`、`:182`、`/Users/william/projects/nexu-stack/nexu-cloud/apps/api/src/db/schema/index.ts:109`。
- **nexu-cloud 当前数据表仍以 auth / user / api key 为主**：基线 migration 只有 `user`、`session`、`account`、`verification`、`users`、`api_keys`、`device_authorizations`，未发现 credit / billing / quota 表。关键位置：`/Users/william/projects/nexu-stack/nexu-cloud/apps/api/migrations/0000_baseline.sql:1`。
- **nexu-link 当前职责偏网关鉴权、限额执行、使用记录**：所有 `/v1/*` 都先过 API key 鉴权，中间件在请求进入 handler 前检查 usage limit；请求结束后把 usage event 写入 `link.usage_events`。关键位置：`/Users/william/projects/nexu-stack/nexu-link/internal/server/server.go:274`、`/Users/william/projects/nexu-stack/nexu-link/internal/middleware/auth.go:27`、`/Users/william/projects/nexu-stack/nexu-link/internal/usage/usage.go:48`。
- **nexu-link 当前的“额度”是 USD 窗口计数，不是积分余额**：配置从共享表 `public.api_key_usage_limits` 读取；消耗累计写入 `link.usage_limit_counters`；超限时返回 `429 usage_limit_exceeded`。关键位置：`/Users/william/projects/nexu-stack/nexu-link/internal/repositories/postgres.go:106`、`:339`、`/Users/william/projects/nexu-stack/nexu-link/internal/usage/limits.go:101`。
- **Refly 的积分方案是双账本模式：充值账本 + 消耗账本 + 欠款账本**：`credit_recharges` 记录每笔入账及剩余余额，`credit_usages` 记录每次扣费，`credit_debts` 记录透支；余额查询时会用可用 recharge 减去 active debt。关键位置：`/Users/william/projects/refly/apps/api/prisma/schema.prisma:1328`、`:1364`、`:1390`、`/Users/william/projects/refly/apps/api/src/modules/credit/credit.service.ts:1314`。
- **Refly 的扣费顺序是按即将过期的 recharge 先扣，余额不足则生成 debt**：扣费时先查询 `enabled && expiresAt >= now && balance > 0` 的 recharge，按 `expiresAt asc` 扣减；若剩余未扣完，则新增 `credit_debts`。关键位置：`/Users/william/projects/refly/apps/api/src/modules/credit/credit.service.ts:762`。
- **Refly 的价格配置与余额账本分离**：模型类价格由 `provider_items.credit_billing` 提供，工具类价格由 `tool_billing` 提供；最终扣费都汇总到 `credit_usages`。关键位置：`/Users/william/projects/refly/apps/api/prisma/schema.prisma:1390`、`/Users/william/projects/refly/apps/api/src/modules/skill/skill-invoker.service.ts:2131`、`/Users/william/projects/refly/apps/api/src/modules/tool/billing/billing.service.ts:114`。
- **Refly 生产库验证了该方案已在真实业务中运行**：生产库 `refly` schema 下存在 `credit_recharges`、`credit_usages`、`credit_debts`、`subscriptions`、`subscription_plans`、`credit_pack_plans`、`provider_items`、`tool_billing`、`token_usage_meters`。其中行数约为：`credit_recharges=106248`、`credit_usages=617586`、`credit_debts=4186`、`subscriptions=904`、`subscription_plans=13`、`credit_pack_plans=4`、`tool_billing=18`、`provider_items=269077`、`token_usage_meters=99818`。
- **Refly 生产库样本验证了多来源充值 + 欠款并存**：`credit_recharges.source` 真实出现 `gift`、`invitation`、`commission`，同一用户可同时存在多笔 recharge 且 `balance` 不同；`credit_debts.source` 真实出现 `usage_overdraft`。
- **Refly 生产库样本验证了 usage 表承载实际扣费流水**：`credit_usages` 中同时存在 `model_call` 与 `tool_call`，`amount` 与 `due_amount` 一并保存，`tool_call` 记录带 `tool_call_id`。
- **Refly 生产库样本验证了订阅配额与积分配额并行存在**：`subscription_plans` 同时保存 `credit_quota`、`daily_gift_credit_quota`、`t1/t2 count quota`、`t1/t2 token quota`，说明积分额度与请求/Token 配额在同一订阅计划里并行管理。
- **Refly 生产库样本验证了模型价格配置粒度**：`provider_items.credit_billing` 中同时存在 `1m_tokens` 与 `5k_tokens` 两种计费单位，并包含 `inputCost` / `outputCost` / `minCharge` / `isEarlyBirdFree` 等字段。
- **Refly 生产库样本验证了工具价格配置粒度**：`tool_billing.billing_rules` 已覆盖 audio / image / video 等不同媒介，按 `inventory_key + method_name` 存储规则，`billing_rules` 与可选 `token_pricing` 分开保存。

### 可用技术路径

- **路径 A：在 nexu-cloud 的共享身份侧落积分主账本，在 nexu-link 只做读取与消费记录**。这与当前 `public.api_keys` / `public.api_key_usage_limits` 由共享 schema 提供、`nexu-link` 负责读取和执行的模式一致。
- **路径 B：在 nexu-cloud 增加“余额/充值/债务”类账本表，在 nexu-link 增加“消费事件/聚合计数”类表**。这与 Refly 的 `credit_recharges` / `credit_usages` / `credit_debts` 分账方式，以及 nexu-link 现有 `usage_events` / `usage_limit_counters` 读写分层相似。
- **路径 C：保留 nexu-link 现有 USD 窗口限额能力，同时新增积分账本作为独立准入维度**。现有 `usage_limit_counters` 与 `usage_events` 可以继续记录成本与窗口消耗，积分账本只负责余额语义。
- **路径 D：把积分余额做成共享 schema 数据，把网关运行态统计继续保留在 `link.*`**。这与父级文档描述的“shared/default schema 存身份与共享配置、`link` schema 存网关运行数据”一致。关键位置：`/Users/william/projects/nexu-stack/AGENTS.md:54`。

### 约束与依赖

- **既定原则是“写入在 cloud 做，读取在 link 做”**，这是当前 spec 已给出的边界。`specs/change/20260330-credit-storage/spec.md:16`
- **nexu-cloud 与 nexu-link 被视为同一个逻辑 Postgres、不同 schema 的协作系统**，共享身份/配置类数据放 `public`，网关运行数据放 `link`。`/Users/william/projects/nexu-stack/AGENTS.md:54`
- **nexu-link 仓库明确不拥有 shared `public` schema 的 migration**；如果需要新增共享表，应视为 shared-schema 决策，而不是直接放进 link repo migration。`/Users/william/projects/nexu-stack/nexu-link/AGENTS.md:29`
- **nexu-cloud 当前 API key 表已经是 link 鉴权的数据源**，因此积分若与 key / user 绑定，link 侧已有读取共享表的既有模式。`/Users/william/projects/nexu-stack/nexu-cloud/apps/api/src/db/schema/index.ts:109`、`/Users/william/projects/nexu-stack/nexu-link/internal/repositories/postgres.go:43`
- **nexu 当前前端/控制器还没有积分 API 契约**，共享 schema 中与额度相关的公开响应只有 `botQuotaResponseSchema`。`packages/shared/src/schemas/channel.ts:124`
- **Refly 测试库有积分相关表结构，但样本业务数据接近空**：`credit_recharges` / `credit_usages` / `credit_debts` / `subscriptions` / `subscription_plans` 在测试库均为 0 行，仅 `tool_billing` 和单条 `provider_items.credit_billing` 可作为配置样本参考；本地库也未提供可用样本数据。
- **Refly 生产库只在 `refly` schema 下发现积分相关业务表**，未在 `public` schema 下发现对应表；这说明其生产环境业务数据主要收敛在业务 schema，而不是 `public`。
- **Refly 的账本支持过期余额、来源区分、透支补扣**：`credit_recharges` 有 `source`、`balance`、`expiresAt`，`credit_debts` 单独记录欠款，后续充值先还债。`/Users/william/projects/refly/apps/api/prisma/schema.prisma:1335`、`:1371`、`/Users/william/projects/refly/apps/api/src/modules/credit/credit.service.ts:52`

### 关键参考

- `apps/controller/src/store/nexu-config-store.ts:70` - nexu 默认 cloud/link profile 与本地 cloud session 持久化入口。
- `apps/controller/src/lib/openclaw-config-compiler.ts:277` - nexu 将 cloud session 编译成 `providers.link`。
- `apps/controller/src/services/channel-service.ts:664` - nexu 当前 bot quota 仅为 stub。
- `apps/controller/src/store/lowdb-store.ts:36` - nexu JSON 文件原子写入模式。
- `/Users/william/projects/nexu-stack/nexu-cloud/apps/api/src/routes/desktop-auth-routes.ts:19` - nexu-cloud device auth register/poll/authorize 流程。
- `/Users/william/projects/nexu-stack/nexu-cloud/apps/api/src/db/schema/index.ts:109` - nexu-cloud `api_keys` 表定义。
- `/Users/william/projects/nexu-stack/nexu-cloud/apps/api/migrations/0000_baseline.sql:1` - nexu-cloud 当前基线表结构。
- `/Users/william/projects/nexu-stack/nexu-link/internal/middleware/auth.go:56` - nexu-link 请求前 usage limit 检查。
- `/Users/william/projects/nexu-stack/nexu-link/internal/repositories/postgres.go:106` - nexu-link 从 `public.api_key_usage_limits` 读取共享限额配置。
- `/Users/william/projects/nexu-stack/nexu-link/internal/repositories/postgres.go:227` - nexu-link 记录 `link.usage_events`。
- `/Users/william/projects/nexu-stack/nexu-link/migrations/004_usage_limit_counters.up.sql:1` - nexu-link 的窗口计数表。
- `/Users/william/projects/refly/apps/api/prisma/schema.prisma:1328` - Refly `credit_recharges` 账本定义。
- `/Users/william/projects/refly/apps/api/prisma/schema.prisma:1364` - Refly `credit_debts` 欠款表定义。
- `/Users/william/projects/refly/apps/api/prisma/schema.prisma:1390` - Refly `credit_usages` 消耗表定义。
- `/Users/william/projects/refly/apps/api/src/modules/credit/credit.service.ts:762` - Refly 扣费与透支处理。
- `/Users/william/projects/refly/apps/api/src/modules/credit/credit.service.ts:1314` - Refly 余额聚合逻辑。
- `/Users/william/projects/refly/apps/api/src/modules/tool/billing/billing.service.ts:114` - Refly 工具计费配置加载。
- `/Users/william/projects/refly/apps/api/src/modules/skill/skill-invoker.service.ts:2131` - Refly 模型计费配置映射到批量积分扣费。

## Design

### Architecture

选择 **方案 C：务实平衡**。

核心原则：

- **shared `public` schema 存积分主账本**，由 `nexu-cloud` 负责 migration 与写入。
- **`nexu-link` 只读 shared DB** 做准入判断，不拥有 `public` schema migration。
- **`link.*` 只保留运行态遥测/对账信息**，不作为积分权威账本。
- **v1 只做双账本 + 账户投影**：充值账本、消耗账本、账户余额快照。
- **v1 不做 debt / allocation / 外部读 API**，先把主链路打通。

```text
充值/赠送/后台加积分
  -> nexu-cloud
  -> public.credit_recharges (append-only)
  -> public.credit_accounts.available_credits += amount

模型请求
  -> nexu-link 鉴权(api_key -> user_id)
  -> 读取 public.credit_accounts.available_credits (fast-path precheck)
  -> 进入“LLM 结算策略”分支（待拍板）
       A. reservation / hold：先冻结，再按实际 usage 结算
       B. platform absorb：不冻结，由平台吞掉超额差值
  -> 记录 link.usage_events
```

### Data Model

- **`public.credit_accounts`**
  - 每个 `user_id` 一行，给 `nexu-link` 提供快速准入读取。
  - 建议字段：
    - `id text primary key`
    - `user_id text not null unique`
    - `available_credits bigint not null default 0`
    - `total_recharged_credits bigint not null default 0`
    - `total_used_credits bigint not null default 0`
    - `version bigint not null default 0`
    - `created_at timestamptz not null default now()`
    - `updated_at timestamptz not null default now()`
  - 约束：`user_id` 唯一；`available_credits >= 0`；所有积分字段为 `bigint` 最小单位，避免浮点误差。
  - 不变量：在 v1 无 debt / expiry 前提下，`available_credits = total_recharged_credits - total_used_credits`。

- **`public.credit_recharges`**
  - 充值/赠送/后台补偿等入账流水，append-only。
  - 建议字段：
    - `id text primary key`
    - `user_id text not null`
    - `source text not null`
    - `amount_credits bigint not null`
    - `idempotency_key text not null unique`
    - `external_ref text null`
    - `metadata jsonb not null default '{}'::jsonb`
    - `created_at timestamptz not null default now()`
  - 推荐 `source`：`purchase`、`reward_redemption`、`invite_reward`、`admin_grant`、`compensation_refund`。
  - 索引：`(user_id, created_at desc)`；必要时可增加 `(source, external_ref)` 唯一约束。
  - v1 不要求 lot 级扣减，只要求保留完整入账历史。

- **`public.credit_usages`**
  - 模型调用等消耗流水，append-only。
  - 建议字段：
    - `id text primary key`
    - `user_id text not null`
    - `api_key_id text null`
    - `request_id text not null unique`
    - `usage_type text not null`
    - `amount_credits bigint not null`
    - `provider text null`
    - `model text null`
    - `metadata jsonb not null default '{}'::jsonb`
    - `created_at timestamptz not null default now()`
  - v1 `usage_type` 可以先收敛为 `model_call`。
  - 索引：`(user_id, created_at desc)`、可选 `(api_key_id, created_at desc)`。
  - `request_id` 必须由网关生成，用作幂等键，避免重试导致重复扣费。

- **继续保留 `link.usage_events`**
  - 用于网关运行态观察、排障、对账。
  - 不是积分权威账本，不承载余额语义。

- **v1 不新增单独的 package / reward / adjustment 表**
  - 积分包、奖励兑换、邀请奖励、后台赠送都先映射为 `credit_recharges` 的不同 `source`。
  - 套餐编码、支付单号、活动信息放入 `external_ref` / `metadata`。

- **LLM token 结算策略待拍板**
  - 因为 LLM 的最终成本通常要等 provider 返回 usage 后才能精确知道，当前设计保留两条候选路线，后续再定。
  - **路线 A：Reservation / Hold**
    - 给 `credit_accounts` 增加 `reserved_credits bigint not null default 0`。
    - 新增 `public.credit_reservations`：`id`、`user_id`、`api_key_id`、`request_id unique`、`reserved_credits`、`status`、`expires_at`、`metadata`、`created_at`、`updated_at`。
    - 语义：请求前先冻结上界额度，请求完成后再把真实消耗写入 `credit_usages`，并释放未使用部分。
  - **路线 B：Platform absorb overrun**
    - 不新增 reservation 表，保留当前 3 张核心表。
    - 但 `credit_usages` 需要能表达“实际成本”和“用户实际被扣金额”的差异；若采用该路线，需补充如 `actual_credits`、`charged_credits`、`platform_absorbed_credits` 三类字段，或等价字段组合。
    - 语义：请求前只做轻量准入检查，不冻结额度；请求结束后按实际 usage 结算，若最终超出可扣范围，差额由平台吸收。

### Read / Write Boundaries

- **Cloud 写入职责**
  - 固定负责充值、奖励、后台赠送等入账写入。
  - 若最终选择 **Option A / cloud internal API**，则 cloud 也负责 reservation / usage / refund 等模型消耗相关主账本写入。
  - 若最终选择 **Option B / link 直写部分 shared 数据**，则 cloud 保留 shared schema ownership 与入账类写入职责。

- **Link 读取职责**
  - 基于 `api_key -> user_id` 读取 `public.credit_accounts.available_credits`。
  - 作为 fast-path 预检查；最终如何控制 spend 取决于后续选定的 LLM 结算策略。
  - v1 不再依赖现有时间窗 / usage limit。

- **内部接口约定（非用户侧 API）**
  - 若采用 **cloud internal API** 路线：
    - `PostRecharge(userId, amountCredits, source, externalRef?)`
    - `CreateReservation(userId, apiKeyId?, requestId, reserveAmount, pricingContext)`（仅结算方案 A）
    - `FinalizeUsage(userId, apiKeyId?, requestId, actualAmountCredits, usageType, dimensions)`
  - 若采用 **link 直写部分 shared 数据** 路线：
    - 不需要额外 internal credit write API
    - 但 link 需要直接执行 `credit_accounts` / `credit_usages` / `credit_reservations`（如有）相关写事务
  - `GetAvailableCredits(userId)` 仅作为 link 的读模型，不在本轮设计外部接口。

### Why Service Call + DB Write Are Split (Option A)

> 本节是在解释 **候选路线 A：cloud 暴露 internal API，link 通过服务调用触发记账**。
> 另一条候选路线见下方 `Open Design Decision: Usage Write Boundary`。

这部分容易混淆，v1 设计里要明确区分 **“谁感知到一次消耗”** 和 **“谁真正把消耗记到账本里”**：

- **`nexu-link` 感知消耗发生**
  - 因为所有模型请求先到 link，link 最清楚“哪个用户发起了哪次模型调用”。
  - 所以 link 负责生成 `request_id`、构造 pricing context / admission guard、发起内部结算控制调用。

- **`nexu-cloud` 真正执行记账**
  - 因为设计原则是“写入在 cloud 做”。
  - 所以 reservation 创建、最终余额扣减、usage 流水写入，都必须由 cloud 在本地 DB transaction 中完成。

- **因此会同时存在两层记录**
  - `public.credit_usages`：权威积分账本，由 cloud 写。
  - `link.usage_events`：网关运行事件，由 link 写。

一句话：

```text
link 负责“发起结算控制”
cloud 负责“正式记账”
```

### Sequence: LLM Settlement Flow (Pending Decision, shown with Option A write boundary)

```text
User/API client
  -> nexu-link: 发起模型请求 + API key

nexu-link
  -> public.credit_accounts: 读取余额（仅预检查）
  -> 根据拍板结果进入 A / B 分支

A. reservation / hold
  nexu-link
    -> nexu-cloud/internal/credits/reservations: 创建 hold
  nexu-cloud
    -> DB transaction:
         1. 增加 credit_accounts.reserved_credits
         2. 插入 credit_reservations
    -> nexu-link: 返回 success / insufficient_credits

  If success:
    nexu-link -> model provider: 发起模型调用
    provider -> nexu-link: 返回最终 usage
    nexu-link -> nexu-cloud/internal/credits/finalize: 按实际金额结算

B. platform absorb overrun
  nexu-link -> model provider: 发起模型调用
  provider -> nexu-link: 返回最终 usage
  nexu-link -> nexu-cloud/internal/credits/finalize: 结算用户可扣金额 + 平台吸收差额

Both A/B:
  nexu-link -> link.usage_events: 记录运行态事件
```

### What Is And Is Not A Transaction

- **是事务的部分**
  - `nexu-cloud` 内部对 Postgres 的一次本地事务。
  - 例如：创建 reservation，或结算 `credit_usages` + 更新 `credit_accounts`。

- **不是事务的部分**
  - `nexu-link -> nexu-cloud` 的 HTTP / internal service call。
  - `nexu-link -> model provider` 的外部模型调用。

- **所以这不是跨服务分布式事务**
  - 没有 2PC。
  - 没有要求 link 和 cloud 同时 commit。
  - 真正的强一致只发生在 cloud 自己那次 DB transaction 里。

### Responsibility Matrix (Option A baseline)

| 动作 | 发起者 | 真正执行者 | 落库位置 |
|---|---|---|---|
| 读取余额预检查 | link | link | `public.credit_accounts` 只读 |
| 创建 reservation（仅方案 A） | link | cloud | `public.credit_accounts` + `public.credit_reservations` |
| 调模型 | link | link | 不写主账本 |
| 最终 usage 结算 | link | cloud | `public.credit_accounts` + `public.credit_usages` |
| 平台 absorb 差额记账（仅方案 B） | link | cloud | `public.credit_usages` |
| 运行态 usage 记录 | link | link | `link.usage_events` |

### Why Link Still Writes `usage_events` (Both Options)

无论最终是否让 link 直写部分 shared 数据，link 仍然要写 `link.usage_events`，原因是：

- 它是模型网关，天然拥有请求耗时、provider、model、状态码等运行态信息。
- 这些信息适合做排障、监控、对账。
- 但它们**不等于**权威余额账本；真正的余额语义仍以 shared 主账本里的 `credit_usages` / `credit_recharges` 为准。

可以把它理解成：

```text
credit_usages = 财务账
usage_events   = 运营日志
```

### Implementation Steps

1. **定义 shared schema**
   - 在 `nexu-cloud` 管理的 shared/public schema 中增加 `credit_accounts`、`credit_recharges`、`credit_usages`。
   - 为 `user_id`、`request_id`、时间序列查询建立索引。

2. **实现 cloud 写路径**
  - 充值写入：新增 recharge 流水，并原子增加 `credit_accounts`。
  - 模型消耗写路径待拍板：
    - 路线 A：cloud 暴露 internal API，cloud 执行 usage / reservation 写事务。
    - 路线 B：link 直接写 usage 相关 shared 表，cloud 仅负责 recharge 类写入。
  - 在任一路线下，`request_id` 幂等与余额条件更新都必须保留。

3. **切换 link 准入读取**
   - `nexu-link` 在鉴权后按 `user_id` 读取 `credit_accounts.available_credits`。
   - 余额不足时直接拒绝；其余请求再按最终拍板的结算策略进入 reservation 或 post-settlement 路径。

4. **保留运行态记录与对账能力**
   - `link.usage_events` 继续记录请求结果与成本维度。
   - 用于事后排障、补记、对账，不直接驱动余额。

5. **分阶段上线**
  - 先落 shared schema。
  - 再按拍板结果实现 cloud internal API 或 link direct writer。
  - 再切 link 的 admission gate。
  - 最后补齐对账/回放与运营工具能力。

### Pseudocode

#### Admission Check in Link

```text
Authenticate apiKey
Resolve userId from apiKey
Load creditAccount by userId
Compute admission_guard_amount from pricing context

If creditAccount missing:
  Reject as insufficient credits

If available_credits < admission_guard_amount:
  Reject as insufficient credits

Proceed to option A or B settlement path
```

#### Recharge Posting in Cloud

```text
Begin transaction
Insert credit_recharges row
Upsert credit_accounts by userId
Increase available_credits
Increase total_recharged_credits
Commit transaction
```

#### Usage Posting in Cloud

```text
Choose settlement strategy

If option A (reservation/hold):
  Create reservation before provider call
  After provider returns final usage:
    Capture actual amount into credit_usages
    Release unused reserved amount

If option B (platform absorb):
  Run provider call after light precheck
  After provider returns final usage:
    Deduct user-chargeable credits
    Record remaining delta as platform_absorbed_credits
    Write credit_usages
```

### Lifecycle Flows

#### Flow 1: 用户新注册

```text
Create user in cloud auth tables
Insert credit_accounts row with zero balance
Do not create recharge/usage rows
```

- 建议在注册时就创建 `credit_accounts`，避免后续“是否开户”分支。
- 若存在历史用户回填，link 仍应把缺失账户视为 0 余额。

#### Flow 2: 购买积分包

```text
Payment provider confirms order
Begin transaction
Insert credit_recharges with:
  source = purchase
  idempotency_key = payment_event_id
  external_ref = order_id or payment_intent_id
Upsert credit_accounts by user_id
Increase available_credits
Increase total_recharged_credits
Commit transaction
```

- 支付成功事件必须提供稳定 `idempotency_key`，防止 webhook 重放重复加积分。
- 积分包本身先不单独建表，套餐信息写入 `metadata.pack_code`。

#### Flow 3: 兑换奖励 / 邀请奖励 / 后台赠送

```text
Reward system validates eligibility
Begin transaction
Insert credit_recharges with:
  source = reward_redemption | invite_reward | admin_grant
  idempotency_key = reward_event_id
  external_ref = reward_id or campaign_id
Update credit_accounts
  available_credits += amount
  total_recharged_credits += amount
Commit transaction
```

- 奖励类入账与购买积分包共用同一张 recharge 账本，只区分 `source`。
- 若后续需要反作弊或活动审计，再在 reward 子系统补专属表，不放进 v1 积分主账本。

#### Flow 4: 使用模型并消耗积分

```text
Link authenticates api_key and resolves user_id
Link reads credit_accounts for fast-path precheck
Link generates request_id

Option A: reservation / hold
  Cloud creates reservation with bounded reserve amount
  If reservation succeeds:
    Link dispatches model request
    Provider returns final usage
    Cloud captures actual amount and releases the unused reserved amount

Option B: platform absorb overrun
  Link/cloud perform a light balance check without reservation
  Link dispatches model request
  Provider returns final usage
  Cloud deducts the user-chargeable portion
  Any overrun delta is recorded as platform-absorbed cost
```

- 当前未拍板点：在真实 LLM token 结算场景下，是采用 reservation / hold，还是允许平台吞掉最终超额差值。
- 两条路线都默认 **不引入 debt 表**；若后续要支持 overdraft / postpaid，再单独设计 debt ledger。

### Open Design Decision: LLM Settlement Strategy

#### Option A: Reservation / Hold

- **核心思路**
  - 请求前先冻结一个“可接受的上界额度”，请求后按真实 usage 结算。
- **数据库变化**
  - `credit_accounts` 增加 `reserved_credits`
  - 新增 `credit_reservations`
- **优点**
  - prepaid 语义最清晰
  - 不需要 debt
  - 并发、重试、超时释放更容易做对
- **缺点**
  - 多一张表
  - 需要 expiration / release / finalize 生命周期管理

#### Option B: Platform Absorb Overrun

- **核心思路**
  - 不冻结额度，请求先执行；结算时若最终成本超过用户可扣范围，差值由平台承担。
- **数据库变化**
  - 不新增 reservation 表
  - `credit_usages` 需要表达 `actual` / `charged` / `platform_absorbed` 三种金额语义
- **优点**
  - 结构更简单
  - 请求生命周期更短，不需要 hold 清理任务
- **缺点**
  - 平台承担成本波动风险
  - prepaid 边界更弱
  - 并发场景下更容易出现不可预期的平台补贴

#### Pending Decision

- 当前 design 同时保留上述两条路线，等待后续讨论拍板。
- 在拍板前，shared 主账本仍以 `credit_accounts + credit_recharges + credit_usages` 为基础模型。
- `credit_debts` 明确不纳入 v1。

### Open Design Decision: Usage Write Boundary

#### Option A: Cloud Internal API（保持 cloud 单点写入）

- **核心思路**
  - link 继续负责模型入口、余额预检查、usage telemetry。
  - 一旦需要 reservation / finalize / refund / usage 结算，由 link 调用 cloud internal API。
  - 真正的积分账本写入统一在 cloud 的本地 DB transaction 中完成。
- **数据库写入边界**
  - `cloud`：写 `credit_accounts`、`credit_recharges`、`credit_usages`、`credit_reservations`（如有）。
  - `link`：只写 `link.usage_events` 等运行态表。
- **优点**
  - 最符合当前“写入在 cloud 做，读取在 link 做”的原则。
  - `public` shared schema 只有一个积分主账本 writer，审计边界更清晰。
  - 计费规则、补偿、风控策略更容易集中在 cloud 演进。
- **缺点**
  - 模型请求链路中多一次 link -> cloud 服务调用。
  - 需要额外设计 service-to-service auth、internal endpoint、重试和超时策略。
  - 由于模型生命周期发生在 link，理解成本会更高。

#### Option B: Link Writes Usage-Related Shared Data（link 写部分 shared 数据）

- **核心思路**
  - 保持 recharge / grant / admin adjustment 仍由 cloud 写。
  - 但模型请求相关的 reservation / finalize / usage 结算，直接由 link 写 shared `public` 表。
  - link 在一次本地 DB transaction 中完成 `credit_accounts` 条件更新和 `credit_usages` / `credit_reservations` 写入。
- **数据库写入边界**
  - `cloud`：继续写 `credit_recharges` 与账户入账类变更。
  - `link`：新增对 `credit_accounts`、`credit_usages`、`credit_reservations`（如有）的写权限。
- **是否存在共同写一张表**
  - **有。`credit_accounts` 会成为 cloud + link 共同写入的 shared 表。**
  - `cloud` 负责入账方向更新：`available_credits += x`、`total_recharged_credits += x`。
  - `link` 负责消耗方向更新：`available_credits -= x`、`total_used_credits += x`，以及 reservation 相关 `reserved_credits` 变化（如采用 hold）。
  - 当前意图是把共同写表范围**收敛到 `credit_accounts` 一张表**：
    - `credit_recharges`：仍由 cloud 单写
    - `credit_usages`：由 link 单写
    - `credit_reservations`：若存在，则由 link 单写
  - 这意味着 Option B 的主要复杂度，不是“谁写 usage”，而是“`credit_accounts` 变成双 writer 表后的 ownership 与事务约束”。
- **优点**
  - 更贴近模型执行现场，link 更容易把 provider 返回的最终 usage 直接落账。
  - 少一跳 internal API，请求链路更短。
  - “谁发请求谁记 usage” 的心智模型更直接。
- **缺点**
  - 明确削弱“写入在 cloud 做”的原始边界。
  - shared `public` schema 变成 cloud + link 双 writer，长期 ownership 更容易变复杂。
  - 计费规则、补偿策略、风控逻辑可能分散到两个服务。
  - `credit_accounts` 上必须额外约束字段级责任、条件更新方式、幂等与并发测试，否则容易出现账不平。

#### Pending Decision

- 当前 spec 同时保留 **Option A / Option B**，等待后续讨论拍板。
- 无论选择哪条路线，shared schema 仍以 `credit_accounts + credit_recharges + credit_usages` 为基础。
- 若后续采用 reservation / hold，再额外引入 `credit_reservations`。
- 当前更贴近既定原则的是 **Option A**；更贴近模型调用现场的是 **Option B**。
- 若采用 **Option B**，需额外确认：模型失败补偿是否仍建模为 `credit_recharges`。
  - 若 **是**：则仍需保留 cloud refund 写入口，否则 `credit_recharges` 也会变成双写表。
  - 若 **否**：则需要单独定义 link 侧 usage rollback / adjustment 的表示方式。

### Files / Repos Likely Affected

- **This repo**
  - `specs/change/20260330-credit-storage/spec.md` — 设计与实施计划。

- **nexu-cloud**
  - `apps/api/src/db/schema/index.ts` — 新增 shared/public 积分表定义。
  - `apps/api/migrations/` — 新增积分表 migration。
  - `apps/api/src/services/credit/*` — 充值写入事务；若选 Option A，也承载 usage / reservation 写入事务。

- **nexu-link**
  - `internal/repositories/postgres.go` — 读取 `public.credit_accounts`；若选 Option B，也会新增 usage 相关 shared 写事务。
  - `internal/middleware/auth.go` — 用积分余额替换旧的 usage-limit admission gate。
  - `internal/server/server.go` / `internal/domain/types.go` — 注入 credit read model。

### Edge Cases

- **重复结算**：`credit_usages.request_id` 唯一，重试只会命中同一笔 usage。
- **重复支付通知 / 重复奖励发放**：`credit_recharges.idempotency_key` 唯一，防止重复入账。
- **并发扣减 / 并发 reservation**：无论最终由 cloud 还是 link 执行写入，任何冻结、释放、结算都必须在单次条件更新事务中完成，防止余额或 reserved 状态错乱。
- **用户尚未开户**：正常新注册流程应创建 `credit_accounts`；仅在历史回填/异常场景下把缺失账户视为 0 余额。
- **api key 轮换**：余额归属 `user_id`，不归属单个 key，避免 key 更换导致余额碎片化。
- **数值精度**：积分统一使用整数最小单位，不使用浮点。
- **reservation 路线的超时请求**：需要后台任务释放过期 hold，避免 `reserved_credits` 长期占用。
- **platform absorb 路线的超额成本**：需要把平台承担的差额显式记账，否则无法做财务归因与毛利分析。
- **本轮明确不做**：debt、过期余额 lot 分摊、订阅/礼包策略、对外余额读取 API。

## Plan

- [ ] Phase 1: 增加 shared 积分表结构并拍板 usage 写入边界
- [ ] Phase 2: 将 link 准入从窗口限额切换为积分余额读取
- [ ] Phase 3: 补齐对账、上线保护与运行验证

## Notes

<!-- Optional: Alternatives considered, open questions, etc. -->
