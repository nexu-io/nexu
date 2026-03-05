# DB Migration 方案

## 现状

- 基于 db/schema/index.ts 维护数据表定义
- 同步方式：维护 migrate.ts（AI or 手动更新），服务启动时自动运行 migrate 逻辑
- 存在的问题：migrate.ts 可能 out of sync，可能导致启动服务自动执行后出现数据丢失或不同步

## 目标

- DDL 更新全部自动化，测试环境可自动更新，生产环境需要人工审批变更，其余环节自动更新
- DML 更新支持方便的触发入口，比如产运同学需要刷数据或者做一些临时操作，可以让 Agent 生成 DML，审批通过后即可变更

## 设计原则

### 原则

- SSoT：只在一个地方定义 DB 的「期望状态」，保证系统状态与真理一致。DDL 期望状态即 Drizzle 的 schema TS 文件
- DB 变更代码化 (IaC)，DDL/DML 变更都使用代码维护，提交到仓库
- DB 变更使用 Git 进行版本控制，可追溯、可恢复、可审批

### 约束

- 团队使用 GitHub Free，私有仓库

### 推导

- migration sql 放在 PR，是最好的执行记录与审批载体
- DDL migration sql 默认工具自动生成，特殊情况（复杂的表结构迁移）可以人工进行调整
- DML sql 可以人工 + AI 辅助编写
- 生产环境的 DDL/DML 变更使用单独的「变更执行 PR」进行人工审批，记录审批过程，审批通过（PR 合并）绑定运行变更动作
- 应用运行时不执行 DDL/DML（否则其实是将变更与审批解耦，且难以追溯变更历史）

## 整体流程（阶段一：Drizzle 方案）

### 本地开发阶段

1. 使用 TS schema (apps/api/src/db/schema/index.ts) 定义目标结构，作为 SSoT
2. 使用 drizzle-kit generate 生成 migration sql，放在 apps/api/migrations/ 目录下
3. （可选）对于复杂场景，编辑 migration sql 文件，添加自定义数据迁移逻辑
4. （可选）本地测试 migration sql

### PR 阶段

1. CI 检查 TS schema 和 migration sql 是否一致
  - 运行 `drizzle-kit generate`，然后看 git 状态
2. CI 检查 migration sql 中的危险操作（启发式脚本）
3. Code Review: 有 DB 变更（修改了 apps/api/migrations/ 目录）的 PR，需要 infra 对应的 owner 审批通过。

### 测试环境 DB 变更

1. PR 合并后，CI 自动执行 migration sql，更新测试环境数据库。

### 生产环境 DB 变更

1. 发版时拉出 release 分支
2. 生成一个 release 分支的 PR，用于审批此次发版的 DB 变更
3. 在发版 CI 中，添加 DB 变更步骤，执行 DB 变更

### 其他说明

- 禁止 push：停止用 drizzle-kit push（本地开发环境除外）
- 禁止启动时迁移：从 apps/api/src/index.ts 移除 await migrate()，迁移改成独立 CI 步骤（测试环境、生产环境）

## 整体流程（阶段二：Atlas 方案）

### 本地开发阶段

1. 使用 TS schema (apps/api/src/db/schema/index.ts) 定义目标结构，作为 SSoT
2. 使用 `atlas migrate diff` 生成 migration sql，放在 apps/api/migrations/ 目录下
3. （可选）对于复杂场景，编辑 migration sql 文件，添加自定义数据迁移逻辑
4. （可选）本地测试 migration sql

### PR 阶段

1. CI 检查 TS schema 和 migration sql 是否一致
  - 运行 `atlas migrate diff --check`
2. CI 检查 migration sql 中的问题
  - 运行 `atlas migrate lint`，检查：锁表风险、命名规范、数据一致性
3. Code Review: 有 DB 变更（修改了 apps/api/migrations/ 目录）的 PR，需要 infra 对应的 owner 审批通过。

### 测试环境 DB 变更

1. PR 合并后，CI 自动执行 migration sql，更新测试环境数据库
  - 运行 `atlas migrate apply`

### 生产环境 DB 变更

1. 发版时拉出 release 分支
2. 生成一个 release 分支的 PR，用于审批此次发版的 DB 变更
3. 在发版 CI 中，添加 DB 变更步骤，执行 DB 变更
  - 运行 `atlas migrate apply`

### 日常巡检

1. 定期巡检线上库与分支的差异，发现问题发送告警

## Notes

- 建议补充 DML 变更流程：使用独立的「DML 变更执行 PR」模板，至少包含影响范围、执行 SQL、预期结果、回滚/补偿方案、审批人。
- 建议明确生产变更执行策略：谁可触发、在哪个 GitHub Environment 执行、需要几级审批、失败后是否自动中止后续发布步骤。
- 建议明确回滚策略：约定是 forward-only（追加修复 migration）还是必须提供 down SQL，并给出对应的适用场景与操作规范。
