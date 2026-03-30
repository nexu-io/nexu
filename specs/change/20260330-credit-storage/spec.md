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
  -> 调用 nexu-cloud 执行权威扣费事务
  -> 扣费成功才放行模型请求
  -> 记录 link.usage_events
  -> 若模型调用失败，nexu-cloud 写补偿 recharge
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

### Read / Write Boundaries

- **Cloud 写入职责**
  - 创建充值流水并增加账户余额。
  - 创建消耗流水并扣减账户余额。
  - 所有积分写操作在 cloud 事务内完成。

- **Link 读取职责**
  - 基于 `api_key -> user_id` 读取 `public.credit_accounts.available_credits`。
  - 作为 fast-path 预检查；最终是否余额足够由 cloud 的扣费事务决定。
  - v1 不再依赖现有时间窗 / usage limit。

- **内部接口约定（非用户侧 API）**
  - `PostRecharge(userId, amountCredits, source, externalRef?)`
  - `PostUsage(userId, apiKeyId?, requestId, amountCredits, usageType, dimensions)`
  - `GetAvailableCredits(userId)` 仅作为 link 的读模型，不在本轮设计外部接口。

### Implementation Steps

1. **定义 shared schema**
   - 在 `nexu-cloud` 管理的 shared/public schema 中增加 `credit_accounts`、`credit_recharges`、`credit_usages`。
   - 为 `user_id`、`request_id`、时间序列查询建立索引。

2. **实现 cloud 写路径**
   - 充值写入：新增 recharge 流水，并原子增加 `credit_accounts`。
   - 消耗写入：基于 `request_id` 幂等插入 usage，并在同一事务里原子扣减余额。
   - 对模型失败等异常场景，允许写入 `compensation_refund` 类型 recharge 做补偿。

3. **切换 link 准入读取**
   - `nexu-link` 在鉴权后按 `user_id` 读取 `credit_accounts.available_credits`。
   - 余额不足直接拒绝；预检查通过后仍需 cloud 扣费事务成功才允许进入模型请求。

4. **保留运行态记录与对账能力**
   - `link.usage_events` 继续记录请求结果与成本维度。
   - 用于事后排障、补记、对账，不直接驱动余额。

5. **分阶段上线**
   - 先落 shared schema + cloud writer。
   - 再切 link 的 admission gate。
   - 最后补齐对账/回放与运营工具能力。

### Pseudocode

#### Admission Check in Link

```text
Authenticate apiKey
Resolve userId from apiKey
Load creditAccount by userId

If creditAccount missing:
  Reject as insufficient credits

If available_credits < required_credits:
  Reject as insufficient credits

Call cloud precharge with request_id and required_credits
If precharge fails:
  Reject as insufficient credits

Allow request
Record link.usage_events for telemetry
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
Begin transaction

If request_id already exists in credit_usages:
  Return existing result

Update credit_accounts
  set available_credits = available_credits - amount_credits,
      total_used_credits = total_used_credits + amount_credits,
      version = version + 1,
      updated_at = now()
  where user_id = ? and available_credits >= amount_credits

If no row updated:
  Fail with insufficient credits

Insert credit_usages row

Commit transaction
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
Link asks cloud to precharge amount_credits

Cloud transaction:
  Conditionally decrement credit_accounts where balance is sufficient
  Insert credit_usages(request_id, user_id, amount_credits, ...)

If precharge succeeds:
  Link dispatches model request
  Link records link.usage_events

If provider/model request fails after precharge:
  Cloud writes compensation_refund recharge with unique idempotency key
```

- v1 的 **严格拒绝** 依赖一个前提：`amount_credits` 在请求发出前就能确定。
- 如果未来改成“按最终 token 精确扣费”，则需要 reservation / hold 设计，明确不在本轮范围内。

### Files / Repos Likely Affected

- **This repo**
  - `specs/change/20260330-credit-storage/spec.md` — 设计与实施计划。

- **nexu-cloud**
  - `apps/api/src/db/schema/index.ts` — 新增 shared/public 积分表定义。
  - `apps/api/migrations/` — 新增积分表 migration。
  - `apps/api/src/services/credit/*` — 充值/消耗写入事务。

- **nexu-link**
  - `internal/repositories/postgres.go` — 读取 `public.credit_accounts`。
  - `internal/middleware/auth.go` — 用积分余额替换旧的 usage-limit admission gate。
  - `internal/server/server.go` / `internal/domain/types.go` — 注入 credit read model。

### Edge Cases

- **重复结算**：`credit_usages.request_id` 唯一，重试只会命中同一笔 usage。
- **重复支付通知 / 重复奖励发放**：`credit_recharges.idempotency_key` 唯一，防止重复入账。
- **并发扣减**：cloud 扣费事务必须以“余额足够”作为更新条件，防止写成负数。
- **用户尚未开户**：正常新注册流程应创建 `credit_accounts`；仅在历史回填/异常场景下把缺失账户视为 0 余额。
- **api key 轮换**：余额归属 `user_id`，不归属单个 key，避免 key 更换导致余额碎片化。
- **数值精度**：积分统一使用整数最小单位，不使用浮点。
- **扣费后模型调用失败**：写一笔 `compensation_refund` recharge 做补偿，保持账本 append-only。
- **link 预检查通过但 cloud 扣费失败**：以 cloud 事务结果为准，最终拒绝请求。
- **本轮明确不做**：debt、过期余额 lot 分摊、订阅/礼包策略、按最终 token 精确结算、对外余额读取 API。

## Plan

- [ ] Phase 1: 增加 shared 积分表结构与 cloud 事务写入链路
- [ ] Phase 2: 将 link 准入从窗口限额切换为积分余额读取
- [ ] Phase 3: 补齐对账、上线保护与运行验证

## Notes

<!-- Optional: Alternatives considered, open questions, etc. -->
