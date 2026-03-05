# DB Migrate Workflow MVP（Debug）

## 目标

- 在开发阶段先验证 migration 文件提取与 manifest 参数传递。
- 暂不调用 `nexu-db migrate apply`，调试范围只到 manifest 生成与日志打印。

## 当前实现

- Workflow 文件：`.github/workflows/db-migrate.yml`
- 触发方式：`push`（所有分支）
- 并发控制：同一分支仅保留最新一次运行（`cancel-in-progress: true`）

## 执行逻辑

1. `checkout` 仓库（`fetch-depth: 0`）。
2. 以 `origin/main` 为基线，计算 `merge-base(origin/main, HEAD)`。
3. 过滤 `apps/api/migrations/**/*.sql` 的变更文件。
4. 若无 SQL 变更：直接跳过。
5. 若有 SQL 变更：生成 manifest 并完整打印到日志。

## Manifest 结构

- 顶层字段：`repository` / `ref` / `sha` / `runId` / `eventName` / `generatedAt`
- `files[]` 字段：
  - `path`
  - `sha256`
  - `sql`（完整 SQL 内容）

## 现阶段约束

- Debug 模式下不执行 CLI：日志会输出 `Debug mode: manifest generated only; CLI call skipped.`
- 生产/合并场景的触发与权限策略（如 PR merged 到 main、OIDC、环境审批）尚未接入。

## 本次验证样例

- Mock migration：`apps/api/migrations/0003_mvp_debug_mock.sql`
- 验证结果：可正确识别该文件并打印完整 manifest。
