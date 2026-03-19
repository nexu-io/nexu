# 分阶段执行计划

## 第一阶段：冻结目标边界，形成 ADR

### 目标

在真正改代码前，先把单用户模式的产品边界定清楚。

### 需要确定的问题

- 单用户模式下是否仍支持浏览器登录
- 是否仍保留 desktop cloud connection
- 是否保留多个 bot / agent，还是收敛到默认 agent 模型
- 是否要求当前 OpenAPI 路径在迁移期完全兼容
- `apps/api` 是否需要保留一个短期兼容壳层，还是直接切到 `apps/controller`

### 交付物

- 一份短 ADR，说明目标架构与取舍
- 一份明确的“保留能力 / 删除能力”列表

### 完成标准

- 团队对“多用户、invite、claim、pool 概念下线”达成一致

## 第二阶段：建立 service / repository 边界

### 目标

先把 route 里直接操作 DB 的模式拆掉，但暂时不改变实际行为。

### 工作内容

- 从 `apps/api/src/routes/bot-routes.ts` 中抽出 bot service，并迁入 `apps/controller`
- 从 `apps/api/src/routes/session-routes.ts` 中抽出 session service，并迁入 `apps/controller`
- 从 `apps/api/src/routes/model-routes.ts` 中抽出 provider service，并迁入 `apps/controller`
- 从 `apps/api/src/routes/integration-routes.ts` 中抽出 integration service，并迁入 `apps/controller`
- 从 `apps/api/src/routes/artifact-routes.ts` 中抽出 artifact service，并迁入 `apps/controller`
- 将当前 runtime 相关 service 中的 DB snapshot 逻辑抽象成接口

### 要求

- routes 不再直接 import `db`
- routes 只依赖 service interface
- 核心 service interface 优先落在 `apps/controller`，`apps/api` 如仍存在只做转接
- service 背后暂时仍可以接 Drizzle repository，以便平滑迁移

### 完成标准

- route 层不再直接出现 `db.select()` / `db.insert()` / `db.update()` / `db.delete()`

## 第三阶段：接入 OpenClaw runtime client 与下发层

### 目标

让 `apps/controller` 能读取 OpenClaw 的运行态信息，并具备向 OpenClaw 单向下发配置的能力。

### 需要封装的 runtime 能力

- `sessions.list`
- `sessions.preview`
- `sessions.reset`
- `sessions.delete`
- `health`

### 需要封装的配置下发能力

- 写入 `OPENCLAW_CONFIG_PATH`
- 或调用 Gateway `config.apply` / `config.patch`
- 必要时触发 reload / watcher 感知

### 需要封装的 skills 下发能力

- 根据 lowdb 管理的 `~/.nexu/config.json.skills` 物化 OpenClaw skills 目录
- 对 skills 做原子写入、更新、删除和启停同步
- 必要时触发 watcher 感知

### 实现建议

- 优先使用 Gateway RPC client
- 必要时增加 config 文件 / session 文件的 fallback 读取能力
- 所有 runtime 调用统一封装到 `apps/controller/src/runtime/` 目录下
- 将原 `apps/gateway` 的 config/skills/template/health 逻辑迁入 `apps/controller` 进程内，避免 API <-> Gateway 内部 HTTP 往返

### 完成标准

- 不依赖 DB，也可以读取 sessions、health 等运行态数据
- Nexu 可以将自身配置与 skills 单向写入 OpenClaw
- `apps/controller` 不再依赖独立 Gateway sidecar 才能完成配置同步

## 第四阶段：建立 Nexu 配置模型，切掉 DB 配置路径

### 目标

先把 bots、channels、runtime config 从 DB 迁移到由 lowdb 管理的 `~/.nexu/config.json`，并保持 Nexu 为唯一配置真源。

### Bot / Agent 配置改造

重构：

- `apps/api/src/routes/bot-routes.ts`
- `apps/api/src/lib/bot-helpers.ts`

替换为：

- 读取 lowdb 中的 `~/.nexu/config.json.bots`
- 由 Nexu service 映射为 OpenClaw `agents.list`

### Channels 配置改造

重构：

- `apps/api/src/routes/channel-routes.ts`
- 与 channel credential、webhook route 相关的 DB 逻辑

替换为：

- 读取/写入 lowdb 中的 `~/.nexu/config.json.channels`
- 读取/写入 lowdb 中的 `~/.nexu/config.json.secrets`
- 由 Nexu service 编译为 OpenClaw channels 配置与 bindings

### Runtime Config 改造

重构：

- `apps/api/src/lib/config-generator.ts`
- `apps/api/src/routes/pool-routes.ts` 中的 config 生成逻辑

替换为：

- 读取 lowdb 中的 `~/.nexu/config.json.runtime`
- 组合 `bots`、`channels`、`providers` 等配置
- 生成最终 OpenClaw config

### Session 运行态读取改造

重构：

- `apps/api/src/routes/session-routes.ts`
- 任何依赖 `sessions` 表做 session 查找的逻辑

替换为：

- runtime session list / preview
- 基于 transcript 或 routing key 的辅助解析

### Skills 配置改造

重构：

- `apps/api/src/routes/skill-routes.ts`

替换为：

- 读取/写入 lowdb 中的 `~/.nexu/config.json.skills`
- 由 Nexu 负责物化到 OpenClaw skills 目录

### 完成标准

- 在禁用数据库读权限后，bots、channels、runtime config 仍然可读可改
- OpenClaw config 由 Nexu 配置成功单向生成

## 第五阶段：引入 lowdb 文件存储，接管 Nexu 自有状态

### 目标

把 OpenClaw 不负责的数据从 DB 迁移到基于 lowdb 的本地文件存储。

### Provider 配置

替换 `apps/api/src/routes/model-routes.ts` 中对 `modelProviders` 的依赖：

- provider 元数据写入 lowdb 管理的 `~/.nexu/config.json.providers`
- API key 等敏感值写入 lowdb 管理的 `~/.nexu/config.json.secrets`

### Integrations 配置

替换 `apps/api/src/routes/integration-routes.ts` 中对 `userIntegrations`、`integrationCredentials` 的依赖：

- integrations 元数据写入 lowdb 管理的 `~/.nexu/config.json.integrations`
- 敏感值写入 lowdb 管理的 `~/.nexu/config.json.secrets`

### Artifacts

替换 `apps/api/src/routes/artifact-routes.ts` 中对 `artifacts` 表的依赖：

- 使用 `~/.nexu/artifacts/index.json`

### Templates

替换 `workspaceTemplates` 与 `workspaceTemplateSnapshots`：

- 写入 lowdb 管理的 `~/.nexu/config.json.templates`
- 如仍需要版本或 hash，可对 templates section 做本地派生计算

### Desktop / App 本地状态

用 lowdb 管理的 `~/.nexu/config.json.app` 与 `~/.nexu/config.json.desktop` 替换仍然需要保留的本地状态表。

### 完成标准

- provider、integration、template、desktop bootstrap 不再依赖 DB
- 所有 Nexu 特有配置都集中到 lowdb 管理的 `~/.nexu/config.json`
- artifact 仅在需要时保留为独立索引文件

## 第六阶段：建立单向 OpenClaw 配置同步链路

### 目标

让所有 Nexu 配置变更都先写入 lowdb 管理的 `~/.nexu/config.json`，再由 Nexu 单向编译并同步到 OpenClaw。

### 同步链路设计

建议采用统一链路：

1. 用户或 API 修改 lowdb 管理的 `~/.nexu/config.json`
2. Nexu 对配置做 schema 校验
3. Nexu 生成 OpenClaw config
4. Nexu 写入 `OPENCLAW_CONFIG_PATH` 或调用 `config.apply` / `config.patch`
5. OpenClaw 热重载或 watcher 感知变更

### 配置编译职责

新增一个明确的编译层，将：

- `bots`
- `channels`
- `runtime`
- `providers`
- `templates`

编译为最终 OpenClaw config。

### Bot 写入改造

重构：

- `POST /api/v1/bots`
- `PATCH /api/v1/bots/{botId}`
- `DELETE /api/v1/bots/{botId}`

替换为：

- 更新 lowdb 中的 `~/.nexu/config.json.bots`
- 由同步链路生成并下发新的 OpenClaw config
- 如果最终只保留默认 agent，则可以顺势收缩 API 能力

### Channel 写入改造

重构 channel 配置与凭证流程为：

- 写 lowdb 中的 `~/.nexu/config.json.channels` 与 `~/.nexu/config.json.secrets`
- 由同步链路重新生成并下发 OpenClaw channels config

### Runtime Config 写入改造

重构 runtime 配置更新流程为：

- 写 lowdb 中的 `~/.nexu/config.json.runtime`
- 由同步链路重新生成并下发 OpenClaw runtime config

### Skill 写入改造

把 internal skill upsert 改为：

- 更新 lowdb 中的 `~/.nexu/config.json.skills`
- 由同步链路将 skills 物化到 OpenClaw skills 目录
- 依赖 OpenClaw hot reload 机制生效

### Template 写入改造

改为：

- 直接写 template 文件
- 必要时触发重新加载

### Session 写入改造

会话相关更新改为：

- 调用 runtime 方法
- 或直接删除 DB 镜像式 session upsert 逻辑

### 完成标准

- 支持的写操作路径不再以 DB 作为主要落点
- bots、channels、runtime config、skills 的唯一写入源是 lowdb 管理的 `~/.nexu/config.json`
- OpenClaw 只接收由 Nexu 编译后的配置结果与 skills 目录物化结果

## 第七阶段：删除多用户和租户模型

### 目标

彻底移除 `apps/controller` 主运行路径中的 SaaS 用户模型，并同步清理 `apps/api` 中遗留的多用户壳层代码。

### 删除认证栈

删除或替换：

- `apps/api/src/auth.ts`
- `apps/api/src/middleware/auth.ts`
- `apps/api/src/routes/auth-routes.ts`
- `apps/api/src/routes/user-routes.ts`

### 替换为单用户上下文

实现一个轻量级 local-user middleware：

- 解析当前本地用户
- 不依赖 Better Auth
- 不依赖 session cookie
- 如仍需要 desktop pairing / cloud bootstrap，则只保留最小能力

### 删除共享工作区与认领流程

删除：

- `apps/api/src/routes/claim-routes.ts`
- `apps/api/src/routes/shared-slack-claim-routes.ts`
- `apps/api/src/routes/invite-routes.ts`
- `apps/api/src/routes/feishu-oauth-routes.ts` 中与共享工作区相关的大部分逻辑

### 完成标准

- `apps/controller` 暴露的 `/api/v1/*` 不再依赖多用户 session 与用户表

## 第八阶段：删除 pool 架构

### 目标

移除共享 runtime 编排概念，让 `apps/controller` 只面向单一 runtime。

### 删除内容

- `apps/api/src/routes/pool-routes.ts`
- `apps/api/src/services/runtime/pool-config-service.ts`
- `apps/api/src/services/runtime/pool-health-monitor.ts`
- `gatewayPools`
- `gatewayAssignments`
- `poolConfigSnapshots`
- `poolSecrets`

### 替代方式

- `apps/controller` 只保留一个 runtime target
- 不再保留 pool 级配置快照，而是直接从 lowdb 管理的 `~/.nexu/config.json` 生成 current OpenClaw config
- health 改为单 runtime health
- 不再保留 assignment / heartbeat / snapshot 语义

### 额外说明

`apps/gateway` 当前仍有 pool 命名和架构假设，迁移时需要把这些命名与状态模型吸收到 `apps/controller` 的单 runtime 语义中。

### 完成标准

- `apps/controller` 运行路径中不再把 runtime 当作 pool registry

## 第九阶段：创建 `apps/controller` 并废弃 `apps/api` / `apps/gateway`

### 目标

删除 API 与 Gateway 的分离架构，让单用户模式下只保留一个 `apps/controller` 服务进程。

### 需要收敛到 `apps/controller` 的能力

- `apps/gateway/src/config.ts` 的 config 写入能力
- `apps/gateway/src/skills.ts` 的 skills 同步能力
- `apps/gateway/src/workspace-templates.ts` 的模板写入能力
- `apps/gateway/src/bootstrap.ts` 的启动与 watcher 触发逻辑
- `apps/gateway/src/openclaw-process.ts` 的 OpenClaw 进程管理能力（如仍需要）
- `apps/gateway/src/api.ts` 中面向 API 的内部 HTTP 调用链路
- `apps/api/src/routes/*` 中仍需保留的公开 HTTP / OpenAPI 接口
- `apps/api/src/lib/*` 与 `apps/api/src/services/*` 中仍有价值的控制面编排逻辑

### 收敛原则

- `apps/controller` 直接调用本地 service，不再通过 `/api/internal/pools/*` 自己请求自己
- 配置生成、写入、热重载、健康检查都在一个进程内完成
- 若桌面模式仍需编排 OpenClaw 进程，则由 `apps/controller` 直接调用本地 runtime manager
- 公开 HTTP 路由、runtime adapter、store、同步链路都以 `apps/controller` 为新的代码组织中心
- `apps/api` 与 `apps/gateway` 如需短期保留，只允许做兼容转发，不再承载新逻辑

### 废弃/删除内容

- `apps/gateway` 中仅为 sidecar 架构存在的 polling loop
- `apps/gateway` 中仅为内部 HTTP 拉取存在的 API client
- `apps/gateway` 中仅为 pool 注册/heartbeat 存在的状态维护逻辑
- `apps/api` 中仅为旧包边界存在的重复 route 装配、兼容 glue code 与启动入口

### 完成标准

- 单用户模式下只需要启动 `apps/controller`
- 配置同步与运行探测在 `apps/controller` 进程内完成
- 不再存在 `apps/gateway -> apps/api` 的内部控制面调用链路
- `apps/api` 与 `apps/gateway` 不再承载主功能，并具备明确删除时间点

## 第十阶段：彻底移除数据库运行时依赖

### 目标

让 `apps/controller` 在没有 Postgres / Drizzle 的情况下正常启动和运行，并完成对旧包的替代。

### 删除内容

- `apps/api/src/db/index.ts`
- `apps/api/src/db/schema/index.ts`
- 所有运行时代码中的 `drizzle-orm` import
- `apps/api` / `apps/gateway` 中仅为了兼容迁移而短暂保留的多余启动代码

### 配套清理

同步更新：

- `AGENTS.md`
- 与 DB migration、DB 控制面相关的文档
- package scripts 中不再适用于单用户 controller 的 DB 命令

### 完成标准

- `apps/controller` 启动不再需要 `DATABASE_URL`

## 数据迁移方案

### 核心原则

只迁移在单用户模式下仍有产品价值的数据。

### 需要迁移的数据

- `bots` + `botChannels` + `channelCredentials` -> lowdb 中的 `~/.nexu/config.json.bots` + `~/.nexu/config.json.channels` + `~/.nexu/config.json.secrets`
- 与 pool config 相关但仍有产品意义的运行配置 -> lowdb 中的 `~/.nexu/config.json.runtime`
- `modelProviders` -> lowdb 中的 `~/.nexu/config.json.providers`
- `userIntegrations` + `integrationCredentials` -> lowdb 中的 `~/.nexu/config.json.integrations` + `~/.nexu/config.json.secrets`
- `workspaceTemplates` -> lowdb 中的 `~/.nexu/config.json.templates`
- `deviceAuthorizations` / 本地 bootstrap 状态 -> lowdb 中的 `~/.nexu/config.json.app` / `~/.nexu/config.json.desktop`
- `skills` -> lowdb 中的 `~/.nexu/config.json.skills`
- `artifacts` -> `~/.nexu/artifacts/index.json`

### 不迁移的数据

- auth / user 记录
- invites / onboarding
- claims / workspace memberships
- pools / assignments 的编排语义
- pool config snapshots

### 迁移工具要求

做一个一次性导出脚本，负责：

- 读取当前 DB 数据
- 聚合生成单个由 lowdb 管理的 `~/.nexu/config.json`
- 对 artifacts 单独生成 `~/.nexu/artifacts/index.json`
- 使用 Zod 校验
- 通过 lowdb adapter 原子写入目标文件
- 支持 dry-run

### 迁移校验

- 导出前后记录数量对比
- `~/.nexu/config.json` schema 校验与 hash 校验
- 启动后自检配置文件可读性与兼容性
- 校验同一份 Nexu 配置可稳定生成 OpenClaw config

## 风险与应对

### 风险一：路由里混了大量业务逻辑，不只是 CRUD

像这些文件都不只是简单查表：

- `apps/api/src/routes/channel-routes.ts`
- `apps/api/src/routes/session-routes.ts`
- `apps/api/src/routes/artifact-routes.ts`

### 应对

- 先抽 service，再换存储
- 先稳定逻辑边界，再做 runtime/file store 替换

### 风险二：前端仍依赖旧的 user 语义

前端很可能依赖：

- `/api/v1/me`
- invite acceptance
- user 维度的 bot ownership
- cookie session

### 应对

- 第一阶段尽量保持 API contract 不变
- 等 runtime adapter 落地后，再统一裁剪前端依赖

### 风险三：创建 `apps/controller` 会牵涉启动编排、包边界迁移和本地运行链路

当前 `apps/gateway` 不只是配置同步器，还承担了一部分 bootstrap、watcher 触发和 OpenClaw 进程管理职责；而 `apps/api` 里也已有大量 route、service、schema 装配。

### 应对

- 先抽取 `apps/api` 与 `apps/gateway` 中可复用的纯函数与 service，再迁入 `apps/controller`
- 优先删除内部 HTTP 回环，最后再移除独立 sidecar 进程
- 桌面模式保留一段时间兼容开关，允许 `apps/controller` 与旧入口短期并存

### 风险四：Nexu 配置模型与 OpenClaw 配置 / skills 物化结果可能发生漂移

由于 bots、channels、runtime config、skills 由 Nexu 自己维护，再单向编译/物化到 OpenClaw，编译层会成为新的关键一致性点。

### 应对

- 显式维护 Nexu -> OpenClaw 的编译映射层
- 为编译输出建立快照测试
- 对 `~/.nexu/config.json` 的每次写入执行 schema 校验与编译校验
- 增加“生成但不下发”的 dry-run / validate 模式

### 风险五：文件存储引入损坏和并发写风险

### 应对

- 所有写操作使用 temp + rename
- 所有读操作都经过 Zod 校验
- 引入 `schemaVersion`
- 必要时在重写前保留备份副本

## 测试与验收

### 单元测试

- file store 原子写入行为
- schema 校验与坏数据恢复
- Nexu config -> OpenClaw config 编译测试
- Nexu skills -> OpenClaw skills 目录物化测试
- secrets 加解密流程
- runtime client 的错误映射与 fallback 行为

### 集成测试

- 在无 DB 环境下启动 `apps/controller`
- 在无独立 `apps/gateway` 进程的情况下完成配置同步
- 从 `~/.nexu/config.json` 生成 OpenClaw config
- 将 OpenClaw config 成功写入 `OPENCLAW_CONFIG_PATH` 或成功调用下发接口
- 将 skills 从 `~/.nexu/config.json.skills` 成功物化到 OpenClaw skills 目录
- 读取 runtime sessions
- 读取 runtime channels
- 将 providers / integrations / templates 写入 `~/.nexu/config.json`
- 将 artifacts 写入本地索引文件

### 手工验证

- desktop 在没有 Postgres 的情况下启动
- desktop 在没有独立 Gateway sidecar 的情况下启动
- 用户可以直接查看和编辑 `~/.nexu/config.json`
- 编辑 bots / channels / runtime / skills 后，OpenClaw 实际加载结果随之变化
- provider 配置可编辑且重启后保留
- skill 增删后 runtime 可见
- session 列表与 preview 正常
- artifact 创建后可持久保留

### 最终验收标准

- `pnpm --filter @nexu/controller dev` 在没有 Postgres 的情况下可以运行
- 核心本地使用路径可正常工作
- Nexu 成为 bots、channels、runtime config、skills 的唯一事实来源
- OpenClaw 成为会话与运行态信息的主要事实来源
- 单用户模式下不再依赖独立 `apps/gateway` 进程，且主入口为 `apps/controller`

## 建议实施顺序

1. 先写 ADR，冻结目标边界
2. 抽 service / repository 边界
3. 接入 runtime clients
4. 引入 file-backed stores
5. 建立 Nexu -> OpenClaw config/skills 单向同步链路
6. 创建 `apps/controller`，并将 `apps/api` / `apps/gateway` 能力收敛进去
7. 删除多用户与 pool 能力
8. 移除 DB 运行时依赖
9. 清理文档、脚本和对外 API 面

## 完成定义

当以下条件全部满足时，可以视为本次重构完成：

- `apps/controller` 正常运行不再依赖关系型数据库
- 多用户、多租户、pool 概念从主运行路径中消失
- Nexu 负责 bots、channels、runtime config、skills，并单向控制 OpenClaw
- OpenClaw 负责 sessions、health 等运行态信息
- Nexu 特有配置集中保存在 `~/.nexu/config.json`
- 单用户模式下 `apps/controller` 已吸收原 `apps/api` 与 `apps/gateway` 的核心能力
- `apps/api` 与 `apps/gateway` 已废弃或仅保留极薄兼容层，且不再承载主逻辑
- 前端与桌面端可以基于新的单用户架构正常工作
