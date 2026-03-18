# Workspace Templates

Workspace templates 让你自定义 OpenClaw agent 的 workspace 文件（AGENTS.md、BOOTSTRAP.md 等），通过 DB → API → sidecar 链路自动同步到所有 bot 的 workspace 目录。

## 概念

| 术语 | 说明 |
|------|------|
| Template | 一个命名的 `.md` 文件内容，如 `AGENTS.md` |
| writeMode | 写入策略：`seed`（首次写入）或 `inject`（标记块注入） |
| Snapshot | 所有 active 模板的聚合快照，带版本号和 hash |

### 写入策略

**`seed`** — 文件不存在时才写入。agent 删除或修改后不会被覆盖。适合一次性引导文件。

- 典型用途：`BOOTSTRAP.md`（首次引导脚本，agent 完成后会自行删除）

**`inject`** — 在已有文件中维护一个标记块，只更新块内容，保留 agent 的其他修改：

```markdown
<!-- NEXU-PLATFORM-START -->
这里是平台管理的内容，会被自动更新
<!-- NEXU-PLATFORM-END -->
```

- 标记块存在 → 替换块内容
- 标记块不存在但文件存在 → 追加到末尾
- 文件不存在 → 跳过（等 OpenClaw 初始化 workspace 后再写入）
- 典型用途：`AGENTS.md`（追加平台规则，不破坏 agent 自定义内容）

### writeMode 自动检测

部署脚本通过文件内容自动判断 writeMode：

- 文件包含 `<!-- NEXU-PLATFORM-START -->` 标记 → `inject`
- 文件不包含标记 → `seed`

无需手动配置。

### 同步时机

Sidecar 在以下两种情况触发写入：

1. **模板内容变更**（hash 变化）→ 全量重新 apply 到所有 workspace
2. **Config 变更**（新 bot/workspace 出现）→ 用缓存的模板 re-apply，确保新 workspace 也被覆盖

## 仓库中的模板文件

模板源文件维护在 `deploy/workspace-templates/` 目录：

```
deploy/workspace-templates/
├── AGENTS.md          # inject — 包含标记，注入平台规则（时区、文件分享、/feedback）
├── BOOTSTRAP.md       # seed — 无标记，首次引导脚本
└── deploy.sh          # 部署脚本（自动检测 writeMode）
```

## 部署

### 使用部署脚本

```bash
# 本地开发（默认 localhost:3000）
cd deploy/workspace-templates
./deploy.sh

# 指定目标环境
API_URL=https://api.nexu.app INTERNAL_API_TOKEN=xxx ./deploy.sh
```

脚本扫描目录中的 `*.md` 文件，自动检测 writeMode，PUT 到 API。

### 手动部署单个模板

```bash
curl -X PUT http://localhost:3000/api/internal/workspace-templates/AGENTS.md \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "<!-- NEXU-PLATFORM-START -->\n## Timezone Rules\n...\n<!-- NEXU-PLATFORM-END -->\n",
    "writeMode": "inject"
  }'
```

### 停用模板

```bash
curl -X PUT http://localhost:3000/api/internal/workspace-templates/AGENTS.md \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "",
    "writeMode": "inject",
    "status": "inactive"
  }'
```

## API

| Method | Path | 说明 |
|--------|------|------|
| `PUT` | `/api/internal/workspace-templates/{name}` | 部署/更新模板 |
| `GET` | `/api/internal/workspace-templates/latest` | 获取最新 snapshot（sidecar 轮询用） |

### PUT 请求体

```json
{
  "content": "模板内容...",
  "writeMode": "seed",
  "status": "active"
}
```

- `content` (必填) — 模板内容
- `writeMode` (可选, 默认 `seed`) — `"seed"` 或 `"inject"`
- `status` (可选, 默认 `active`) — `"active"` 或 `"inactive"`

模板名称必须匹配 `UPPERCASE.md` 格式（如 `AGENTS.md`、`BOOTSTRAP.md`、`SOUL.md`）。

### GET 响应

```json
{
  "version": 3,
  "templatesHash": "sha256...",
  "templates": {
    "AGENTS.md": { "content": "...", "writeMode": "inject" },
    "BOOTSTRAP.md": { "content": "...", "writeMode": "seed" }
  },
  "createdAt": "2026-03-05T..."
}
```

## 数据流

```
deploy/workspace-templates/*.md (仓库源文件)
  ↓ deploy.sh（自动检测 writeMode）
PUT /api/internal/workspace-templates/{name}
  ↓ 写入 workspace_templates 表
publishWorkspaceTemplatesSnapshot()
  ↓ 写入 workspace_template_snapshots 表
GET /api/internal/workspace-templates/latest
  ↓ sidecar 轮询 (每 ~2s)
writeTemplatesToWorkspaces()
  ↓ 写入每个 bot 的 workspace 目录
${OPENCLAW_STATE_DIR}/workspaces/{botId}/AGENTS.md
```

## 添加新模板

1. 在 `deploy/workspace-templates/` 创建新的 `.md` 文件
2. 如果是 inject 模式，在内容中加入 `<!-- NEXU-PLATFORM-START -->` / `<!-- NEXU-PLATFORM-END -->` 标记
3. 运行 `./deploy.sh` 部署
4. Sidecar 自动拉取并写入所有 workspace

## 注意事项

- `seed` 模式的文件被 agent 删除后不会重建（除非模板内容变更触发新 snapshot）
- `inject` 模式依赖文件已存在 — 如果 OpenClaw 还没初始化 workspace，inject 模板会在下一个 poll 周期重试
- Sidecar bootstrap 时在 OpenClaw 启动**之前**执行首次模板同步，确保 `seed` 文件能先于 OpenClaw 默认模板写入
- 模板文件的认证使用 `INTERNAL_API_TOKEN`，与 skills 和 config 接口相同
