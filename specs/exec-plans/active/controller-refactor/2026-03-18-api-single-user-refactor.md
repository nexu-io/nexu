# Apps Controller 单用户化重构执行方案

## 目标

创建新的 `apps/controller` 包，承接原 `apps/api` 的对外控制面职责与原 `apps/gateway` 的本地运行编排职责，
将其重构为面向单用户场景、以 OpenClaw 运行时为中心的统一控制层。

最终目标是：

- 移除多用户、多租户、邀请、认领、共享工作区、pool 编排等 SaaS 概念
- 保留 Nexu 对 agents（bots）、channels、runtime config 的主控权
- Nexu 根据自身配置单向生成并写入 OpenClaw 配置，不再从 OpenClaw 反向回收这三类配置
- 大幅简化数据库，最好彻底移除关系型数据库依赖
- 新增 `apps/controller` 作为唯一控制面进程，并逐步废弃 `apps/api` 与 `apps/gateway`
- 仅将 Nexu 自己独有的少量本地状态持久化到用户 home 目录下的 `~/.nexu/`

## 背景与问题

当前 `apps/api` 同时承担了两类职责：

1. 多租户控制面
2. OpenClaw 运行时状态镜像

这导致 API 层和数据库中沉淀了大量只在 SaaS 模式下才有意义的概念，或者本来就应该由 OpenClaw 自身管理的数据。

目前比较典型的 DB 驱动逻辑分布在：

- `apps/api/src/lib/config-generator.ts`
- `apps/api/src/routes/bot-routes.ts`
- `apps/api/src/routes/session-routes.ts`
- `apps/api/src/routes/channel-routes.ts`
- `apps/api/src/routes/pool-routes.ts`

而 OpenClaw 本身已经具备以下能力或数据来源：

- Gateway RPC 提供 sessions、health 等读取能力，也具备 config 管理能力
- OpenClaw 会消费 skills 目录，但 skills 的内容与启用状态由 Nexu 维护
- sessions 以 transcript / JSONL 文件存在
- 当前运行配置由 OpenClaw config 管理

因此，重构的关键不是“把 PostgreSQL 换成另一个数据库”，而是新建 `apps/controller`，把 `apps/api` 和 `apps/gateway` 的核心能力收敛进去，形成一个单用户运行服务：

- Nexu 单用户控制面
- OpenClaw 单向下游执行与运行态读取面

迁移完成后：

- `apps/controller` 成为唯一长期保留的 Nexu 本地服务包
- `apps/api` 与 `apps/gateway` 停止承载主运行路径并进入废弃状态

## 目标架构

### 核心原则

`apps/controller` 成为新的 Nexu 单用户配置控制面，直接承接当前 `apps/api` 的 HTTP / OpenAPI 职责，以及当前 `apps/gateway` 的配置同步与本地运行编排职责。

新的原则是：

- Nexu 维护 bots、channels、runtime config、skills
- Nexu 负责把这些配置编译成 OpenClaw config
- 以 `apps/controller` 为唯一控制面进程，避免 API / Gateway 双进程和内网回调链路
- OpenClaw 只作为被下发配置的运行时，不再作为这三类配置的主事实来源
- 对于 sessions、health 等运行态信息，仍可读取 OpenClaw runtime
- `apps/api` 与 `apps/gateway` 只在迁移期承担兼容壳层或转发职责，最终废弃

### 职责拆分

#### Nexu 配置负责

- agents / bots 定义
- channels 配置与凭证引用
- runtime config
- skills 内容、启用状态与分发
- provider / BYOK 配置
- integrations 配置
- workspace templates
- desktop / app 本地状态

#### OpenClaw 负责

- 执行由 Nexu 下发的 config
- sessions 与会话历史
- runtime health
- 已加载配置与 skills 的运行态表现

#### Nexu 本地文件存储负责

- 一个由 lowdb 管理的统一 Nexu JSON 配置文件，承载全部 Nexu 特有配置
- 少量非配置型本地数据（例如 artifacts 索引）如确有必要再单独存放

#### `apps/controller` 负责

- 对外暴露稳定的 HTTP / OpenAPI 接口
- 请求校验与响应整形
- 维护 Nexu 配置模型
- 将 Nexu 配置单向编译为 OpenClaw config 并写入/下发
- 将 Nexu skills 物化到 OpenClaw skills 目录
- 读取 OpenClaw 的运行态数据
- 直接承担当前 `apps/gateway` 的本地同步、watcher 触发、运行探测职责
- 实现少量 OpenClaw 不负责但 Nexu 仍需要的业务逻辑

#### `apps/controller` 的包内分层

建议把 `apps/controller` 明确拆成 6 层，避免把原 `apps/api` 与 `apps/gateway` 的代码原样搬进来后再次耦合：

1. `src/app/`：启动、依赖装配、配置注入、生命周期管理
2. `src/routes/`：HTTP / OpenAPI route 定义、请求校验、响应 schema
3. `src/services/`：面向业务能力的用例编排层
4. `src/runtime/`：OpenClaw runtime 访问、config/skills/template 下发、健康探测、进程管理
5. `src/store/`：`~/.nexu/` lowdb 存储、schema 校验、原子写入
6. `src/lib/`：纯函数、schema 转换、编译器、共享工具

约束：

- `routes -> services -> runtime/store/lib` 单向依赖
- `runtime` 不反向依赖 `routes`
- `store` 不感知 HTTP 概念
- `lib` 尽量保持纯函数，不直接读写外部系统
- 所有新逻辑优先落到 `apps/controller`，不再继续扩写 `apps/api` 或 `apps/gateway`

#### `apps/controller` 建议目录树

```text
apps/controller/
  src/
    app/
      create-app.ts
      container.ts
      env.ts
      bootstrap.ts
    routes/
      bot-routes.ts
      channel-routes.ts
      session-routes.ts
      model-routes.ts
      integration-routes.ts
      artifact-routes.ts
      skill-routes.ts
      runtime-config-routes.ts
      workspace-template-routes.ts
    services/
      agent-service.ts
      channel-service.ts
      session-service.ts
      skill-service.ts
      runtime-config-service.ts
      model-provider-service.ts
      integration-service.ts
      artifact-service.ts
      template-service.ts
      openclaw-sync-service.ts
    runtime/
      gateway-client.ts
      sessions-runtime.ts
      runtime-health.ts
      openclaw-config-writer.ts
      openclaw-skills-writer.ts
      workspace-template-writer.ts
      openclaw-watch-trigger.ts
      openclaw-process.ts
    store/
      lowdb-store.ts
      schemas.ts
      nexu-config-store.ts
      artifacts-store.ts
      compiled-openclaw-store.ts
    lib/
      openclaw-config-compiler.ts
      channel-binding-compiler.ts
      skill-manifest.ts
      secrets.ts
      path-utils.ts
```

#### 模块迁移来源定义

`apps/controller` 中每类模块的默认迁移来源应先定义清楚，避免实施时反复摇摆：

- `src/app/`：以 `apps/api` 的服务启动入口为主，吸收 `apps/gateway/src/bootstrap.ts` 的本地编排初始化逻辑
- `src/routes/`：主要从 `apps/api/src/routes/*` 迁移；`apps/gateway` 不再保留独立 HTTP 控制面路由
- `src/services/`：优先从 `apps/api` 的 route 内业务逻辑、`lib/*`、`services/*` 中抽出；少量同步编排能力从 `apps/gateway` 吸收
- `src/runtime/`：主要从 `apps/gateway/src/*` 迁移；补充 `apps/api` 现有 runtime client / adapter 中仍有价值的代码
- `src/store/`：主要是新建；如 `apps/api` 中已有局部文件读写逻辑，可抽入这里统一收口
- `src/lib/`：同时吸收 `apps/api` 与 `apps/gateway` 中可保持纯函数形态的 compiler、mapper、schema helper、path helper

#### 细粒度迁移映射

| `apps/controller` 模块                     | 主要职责                                       | 主要迁移来源                                |
| ------------------------------------------ | ---------------------------------------------- | ------------------------------------------- |
| `src/app/create-app.ts`                    | 装配 Hono/OpenAPI app、中间件、route 注册      | `apps/api`                                  |
| `src/app/bootstrap.ts`                     | 启动时执行同步、watcher、runtime 初始化        | `apps/gateway` + `apps/api`                 |
| `src/app/container.ts`                     | 统一依赖注入与 service/runtime/store 装配      | 新建                                        |
| `src/routes/*`                             | 保持现有 HTTP path 与 schema，转为只调 service | `apps/api/src/routes/*`                     |
| `src/services/agent-service.ts`            | bots/agents 配置读写与编译前业务校验           | `apps/api`                                  |
| `src/services/channel-service.ts`          | channels、credentials 引用、bindings 编排      | `apps/api`                                  |
| `src/services/session-service.ts`          | session 查询、preview、reset、delete 编排      | `apps/api` + `apps/gateway` runtime client  |
| `src/services/skill-service.ts`            | skills catalog 管理、启停、物化触发            | `apps/api` + `apps/gateway`                 |
| `src/services/runtime-config-service.ts`   | runtime 配置更新、编译、下发入口               | `apps/api` + `apps/gateway`                 |
| `src/services/model-provider-service.ts`   | providers / BYOK 管理                          | `apps/api`                                  |
| `src/services/integration-service.ts`      | integrations 与 secrets 管理                   | `apps/api`                                  |
| `src/services/artifact-service.ts`         | artifacts 索引读写                             | `apps/api`                                  |
| `src/services/template-service.ts`         | workspace template 管理与写入触发              | `apps/api` + `apps/gateway`                 |
| `src/services/openclaw-sync-service.ts`    | 统一串联 config/skills/template 同步链路       | `apps/gateway` 为主                         |
| `src/runtime/gateway-client.ts`            | 调 OpenClaw Gateway RPC/health                 | `apps/gateway`                              |
| `src/runtime/sessions-runtime.ts`          | sessions runtime 读取与 fallback               | `apps/gateway` + `apps/api` runtime adapter |
| `src/runtime/runtime-health.ts`            | runtime health probe                           | `apps/gateway`                              |
| `src/runtime/openclaw-config-writer.ts`    | 写 `OPENCLAW_CONFIG_PATH`、触发 reload         | `apps/gateway/src/config.ts`                |
| `src/runtime/openclaw-skills-writer.ts`    | skills 目录物化、manifest、清理                | `apps/gateway/src/skills.ts`                |
| `src/runtime/workspace-template-writer.ts` | template 文件同步                              | `apps/gateway/src/workspace-templates.ts`   |
| `src/runtime/openclaw-watch-trigger.ts`    | watcher 感知触发、热更新辅助                   | `apps/gateway/src/bootstrap.ts`             |
| `src/runtime/openclaw-process.ts`          | OpenClaw 进程拉起、停止、探活                  | `apps/gateway/src/openclaw-process.ts`      |
| `src/store/lowdb-store.ts`                 | lowdb 装配、原子落盘、错误恢复                 | 新建                                        |
| `src/store/nexu-config-store.ts`           | `~/.nexu/config.json` 聚合读写                 | 新建                                        |
| `src/store/artifacts-store.ts`             | `~/.nexu/artifacts/index.json` 管理            | 新建                                        |
| `src/store/compiled-openclaw-store.ts`     | 可选的编译产物快照/诊断缓存                    | 新建                                        |
| `src/lib/openclaw-config-compiler.ts`      | Nexu config -> OpenClaw config 编译            | `apps/api/src/lib/config-generator.ts` 为主 |
| `src/lib/channel-binding-compiler.ts`      | channels/bindings 编译辅助                     | `apps/api`                                  |
| `src/lib/skill-manifest.ts`                | skills hash / manifest 生成                    | 新建，参考 `apps/gateway`                   |

#### 迁移边界原则

- 从 `apps/api` 迁移过来的代码，优先拆掉对 `db`、auth、多租户上下文的直接依赖后再进入 `apps/controller`
- 从 `apps/gateway` 迁移过来的代码，优先拆掉 sidecar 专属 polling、内部 HTTP client、pool 注册语义后再进入 `apps/controller`
- 若某块逻辑既有 API 面又有 runtime 面，应以 `service` 为边界切开：HTTP 相关留在 `routes/services`，OpenClaw 相关下沉到 `runtime`
- 若某块逻辑只是数据映射、schema 转换、config 编译，应下沉到 `lib`
- 若某块逻辑的状态最终落到 `~/.nexu/`，必须进入 `store`，不要继续散落在 service 或 runtime 内直接写文件

### 进程模型

重构后的推荐进程模型：

- `apps/controller` 作为唯一的 Nexu 本地服务进程
- `apps/controller` 通过 lowdb 管理 `~/.nexu/config.json`
- `apps/controller` 直接写入 `OPENCLAW_CONFIG_PATH` 与 OpenClaw skills 目录
- `apps/controller` 直接调用 OpenClaw Gateway RPC / health 接口读取运行态信息
- 删除当前 `apps/gateway -> apps/api` 的内部 HTTP 拉取与回写链路
- `apps/api` 与 `apps/gateway` 在过渡期仅保留兼容入口，最终由 `apps/controller` 完全替代

## 建议的新模块结构

在删除数据库之前，先建立新的 runtime 和 store 边界。

### 运行时适配层

新增目录：`apps/controller/src/runtime/`

建议包含：

- `gateway-client.ts`
- `sessions-runtime.ts`
- `runtime-health.ts`
- `openclaw-config-writer.ts`
- `openclaw-skills-writer.ts`
- `openclaw-watch-trigger.ts`
- `openclaw-process.ts`

说明：

- 不再以 `agents-runtime.ts`、`channels-runtime.ts`、`config-runtime.ts` 为主读取层
- 对于 agents、channels、runtime config，主路径改为 Nexu 自己维护配置，再单向写入 OpenClaw
- runtime 层主要负责运行态读取、config 下发、skills 物化和进程协同，而不是把 OpenClaw 作为配置真源

## 本地持久化设计

建议优先使用“单一 JSON 配置文件 + lowdb + Zod 校验”，并将配置放在用户 home 目录下，而不是放进 `OPENCLAW_STATE_DIR`。

### 为什么优先 lowdb 管理的单文件方案

- 仍然保持单文件 JSON 的可读性与可备份性
- lowdb 适合单用户、本地优先、低并发的配置场景
- 可以把默认值注入、读写封装、局部更新统一收口到 store 层
- 与 OpenClaw 当前的文件型 runtime 模型更一致
- 用户依然可以查看、比较和在必要时手工修改底层文件

### 配置文件原则

所有 Nexu 特有配置应尽量集中到一个文件中，例如：

- `~/.nexu/config.json`

这个文件应承载：

- app 级状态
- bots / agents 定义
- providers / BYOK 配置
- integrations 配置
- channels 配置、凭证引用与 Nexu 自有 channel 扩展配置
- runtime config
- workspace templates
- skills 定义、内容与启用状态
- desktop pairing / bootstrap 等本地状态

只有以下内容可以不进入这个单文件：

- OpenClaw 自己已经管理的数据
- 体积明显更大、更新频率更高、天然更像“记录/索引”而不是“配置”的数据，例如 artifact 索引

### lowdb 使用约束

`~/.nexu/config.json` 仍然是底层落盘文件，但应通过 lowdb 统一读写，并满足：

- 启动时先加载 lowdb，再将数据映射为受 Zod 约束的领域对象
- 每次写入前使用 Zod 校验
- lowdb adapter 需要保证临时文件写入后 `rename` 的原子落盘语义
- 文件包含显式 schema 标识，便于编辑器提示与未来版本演进
- 文件内包含 `schemaVersion`
- 对坏数据和历史格式具备恢复或降级读取能力

### store 分层建议

- `lowdb-store.ts`：负责 adapter、初始化、原子落盘、坏文件恢复
- `nexu-config-store.ts`：负责面向业务的读写接口、默认值补齐、版本迁移
- `schemas.ts`：负责 lowdb 数据与 Zod schema 的收口
- 业务层不直接操作 lowdb collection 或原始 JSON 结构，只通过 store 暴露的方法访问

### lowdb adapter 实现建议

- 优先封装一个 Nexu 自己的 lowdb adapter，而不是让业务代码直接依赖默认 adapter 细节
- 写入流程建议固定为：内存态更新 -> Zod 校验 -> 写临时文件 -> `fsync` -> `rename` 替换目标文件
- 如果 lowdb 默认 adapter 无法完整满足原子落盘要求，可以在 `lowdb-store.ts` 外包一层持久化实现
- 启动加载时先尝试读取主文件；若解析失败，可回退到最近一次备份文件并产出诊断事件
- 建议维护 `config.json.bak` 或按时间戳保留最近 1-2 份快照，用于坏文件恢复
- 并发模型建议保持单进程串行写；同进程内通过 store 队列化写入，避免多个 service 同时 `db.write()`
- 如果后续存在多进程同时写 `~/.nexu/config.json` 的风险，再补充文件锁；第一阶段不要把锁设计做重
- 版本迁移建议在启动时执行：读取旧数据 -> 按 `schemaVersion` 迁移 -> Zod 校验 -> 回写新版本
- 对外暴露的 store API 应尽量是语义化方法，如 `updateBots()`、`setRuntimeConfig()`、`upsertSkill()`，不要泄露 lowdb 的集合更新细节

### 建议配置结构

在用户 home 目录下新增 `~/.nexu/`：

```text
~/.nexu/
  config.json
  artifacts/
    index.json
```

建议 `~/.nexu/config.json` 的顶层结构大致如下：

```json
{
  "$schema": "https://nexu.io/config.json",
  "schemaVersion": 1,
  "app": {},
  "bots": [],
  "runtime": {},
  "providers": [],
  "integrations": [],
  "channels": {},
  "templates": {},
  "skills": {},
  "desktop": {},
  "secrets": {}
}
```

说明：

- `$schema` 用于声明配置文件 schema 位置，便于用户在编辑器中获得校验与补全能力
- `bots`、`channels`、`runtime`、`skills` 是 Nexu 的主配置模型
- OpenClaw config 与 OpenClaw skills 目录都应由这些 Nexu 配置派生生成
- `templates` 建议直接内嵌在 JSON 中，方便查看和整体导入导出
- `secrets` 是否明文存放由后续安全策略决定，但结构上仍放在同一个配置文件中
- 若出于安全考虑不希望用户直接看到明文，可存密文或引用，并在文档中说明

### 单向控制原则

本方案采用“`~/.nexu/config.json` -> OpenClaw config”的单向控制模型：

- 用户修改 `~/.nexu/config.json`，或经由 API 写入 lowdb store
- Nexu 通过 lowdb 读取并校验配置
- Nexu 生成 OpenClaw 所需 config
- Nexu 将生成结果写入 `OPENCLAW_CONFIG_PATH` 或通过 Gateway config 接口下发
- OpenClaw 按生成结果运行

明确不做的事情：

- 不从 OpenClaw 反向同步 bots 配置回 Nexu
- 不从 OpenClaw 反向同步 channels 配置回 Nexu
- 不把 OpenClaw 当前 config 当作 Nexu 配置的主事实来源
- 不把 OpenClaw skills 目录当作 skills 配置的主事实来源

### `config.json.skills` 详细设计

`~/.nexu/config.json.skills` 建议采用“声明式 catalog”结构，由 lowdb 负责读写，而不是直接把 OpenClaw 目录结构原样塞进配置文件。

建议顶层结构：

```json
{
  "version": 1,
  "defaults": {
    "enabled": true,
    "source": "inline"
  },
  "items": {
    "daily-standup": {
      "name": "daily-standup",
      "enabled": true,
      "source": "inline",
      "content": "# Daily Standup\n...",
      "files": {
        "notes.md": "..."
      },
      "metadata": {
        "title": "Daily Standup",
        "description": "Run standup workflow",
        "owner": "nexu",
        "tags": ["team", "ritual"],
        "category": "workflow"
      }
    }
  }
}
```

建议字段说明：

- `version`: `skills` 区块自己的 schema 版本，便于后续独立演进
- `defaults.enabled`: 新增 skill 的默认启用状态
- `defaults.source`: skill 默认来源，建议初期只支持 `inline`
- `items`: 以 `skillSlug` 为 key 的 skill 集合

单个 skill 建议字段：

- `name`: skill 的稳定标识，必须与目录名一致
- `enabled`: 是否参与物化；`false` 时 Nexu 不应将其写入 OpenClaw skills 目录
- `source`: 初期建议支持：
  - `inline`: 内容直接存放在 `config.json`
  - `local-path`: 指向用户本地某个只读目录，供高级用户使用
- `content`: 主 `SKILL.md` 内容；`source=inline` 时必填
- `files`: 附加文件映射，key 为相对路径，value 为文件内容
- `metadata.title`: 展示名
- `metadata.description`: 简短说明
- `metadata.owner`: 来源标记，例如 `nexu` / `user`
- `metadata.tags`: 标签列表
- `metadata.category`: 分类，例如 `workflow`、`tooling`、`knowledge`

建议约束：

- `items` 的 key、`name`、最终目录名必须一致，统一使用 kebab-case slug
- `files` 中禁止绝对路径和 `..` 路径跳转
- 必须保证最终存在 `SKILL.md`，可由 `content` 直接映射生成
- 若 `source=local-path`，仍应在配置中保留 `enabled` 与 `metadata`，但不把外部目录内容完整复制进配置文件

### Skills 物化规则

Nexu 应负责把 lowdb 中的 `~/.nexu/config.json.skills` 视图物化为 OpenClaw 可消费的 skills 目录。

建议目标目录：

- 开发/桌面模式：使用当前 `OPENCLAW_STATE_DIR` 下的 skills 目录
- 非桌面模式：仍通过网关约定的 OpenClaw skills 目录

建议物化流程：

1. 从 lowdb 读取并校验 `~/.nexu/config.json.skills`
2. 对每个 `enabled=true` 的 skill 生成目标目录 `${skillsDir}/${skillSlug}/`
3. 将 `content` 写入 `${skillsDir}/${skillSlug}/SKILL.md`
4. 将 `files` 中的附加文件写入对应相对路径
5. 对已不存在或 `enabled=false` 的 skill 执行删除或归档
6. 通过原子写入和目录级同步保证 OpenClaw watcher 感知到变更

建议目录映射规则：

- `content` -> `${skillDir}/SKILL.md`
- `files["foo.txt"]` -> `${skillDir}/foo.txt`
- `files["docs/guide.md"]` -> `${skillDir}/docs/guide.md`

建议写入策略：

- 单文件写入采用 `tmp + rename`
- 新 skill 先写入临时目录，再整体 rename 到目标目录
- 更新 skill 时仅覆写受影响文件，并清理已删除文件
- 删除 skill 时优先移动到 `.trash/` 或临时备份目录，再异步清理

建议一致性规则：

- lowdb 管理下的 `~/.nexu/config.json.skills` 永远是唯一事实来源
- OpenClaw skills 目录永远是物化产物，不允许手工修改后反向覆盖配置
- 每次物化后生成 manifest 或 hash，用于检测目录是否与配置一致

建议为每个 skill 生成一个内部 manifest，例如：

- `${skillDir}/.nexu-skill.json`

示例内容：

```json
{
  "slug": "daily-standup",
  "source": "inline",
  "hash": "sha256:...",
  "generatedAt": "2026-03-18T12:00:00.000Z"
}
```

manifest 的作用：

- 标记该目录由 Nexu 管理
- 支持差异比对与增量更新
- 支持诊断“配置已更新但目录未同步”的问题

建议失败处理规则：

- 单个 skill 物化失败不应破坏其他 skill
- 失败结果应记录到同步状态中，供 API 或桌面诊断界面读取
- 若部分物化失败，保留上一次成功版本，避免产出半写状态

## 数据事实来源映射

### 由 Nexu 配置文件替代并继续由 Nexu 主控的表

- `bots` -> `~/.nexu/config.json.bots`
- `botChannels` -> `~/.nexu/config.json.channels`
- `channelCredentials` -> `~/.nexu/config.json.secrets`
- `webhookRoutes` -> 从 Nexu 配置编译推导，不再单独存储
- `gatewayPools` / `gatewayAssignments` / `poolConfigSnapshots` 的配置职能 -> `~/.nexu/config.json.runtime`

### 由 OpenClaw runtime 承担的运行态数据

- `sessions` -> OpenClaw sessions / transcript 文件
- `sessionParticipants` -> 如仍需要，改成从 session/routing 信息推导
- channel 连接状态 / probe 结果 -> OpenClaw runtime health / channel status

### 由本地单一配置文件替代的表

- `modelProviders` -> `~/.nexu/config.json.providers`
- `userIntegrations` -> `~/.nexu/config.json.integrations`
- `integrationCredentials` -> `~/.nexu/config.json.secrets`
- `workspaceTemplates` 与 `workspaceTemplateSnapshots` -> `~/.nexu/config.json.templates`
- `deviceAuthorizations` -> `~/.nexu/config.json.desktop`
- `apiKeys` -> 若仍需保留 cloud 连接，可放入 `~/.nexu/config.json.secrets` 或 `~/.nexu/config.json.app`
- `skills` -> `~/.nexu/config.json.skills`

### 仍可保留为单独本地文件的数据

- `artifacts` -> `~/.nexu/artifacts/index.json`

这部分不属于“配置”，更像运行历史或索引数据，因此可以继续独立于配置文件存在。

### 直接删除或完全去运行时依赖的表

- `authUsers`
- `authSessions`
- `authAccounts`
- `authVerifications`
- `users`
- `inviteCodes`
- `workspaceMemberships`
- `claimTokens`
- `claimCardDedup`
- `oauthStates`
- `poolSecrets`
- `usageMetrics`
- `supportedSkills`（如果仍未真正参与运行时）

## HTTP / OpenAPI 面的迁移策略

最稳妥的方式是分两步走：

1. 先保持 API path 和 response schema 尽量稳定，但将实现逐步迁入 `apps/controller`
2. 等前端与桌面端完成适配后，再删除真正废弃的接口，并废弃 `apps/api` / `apps/gateway`

迁移期建议：

- `apps/controller` 直接暴露正式 HTTP / OpenAPI 服务
- 如有必要，`apps/api` 可短暂保留为薄兼容层、反向代理或启动别名
- 不再在 `apps/gateway` 中保留长期存在的 sidecar HTTP 控制面

### 预计保留，但内部重写的接口

- `/api/v1/bots`
- `/api/v1/channels`
- `/api/v1/runtime-config`
- `/api/v1/sessions`
- `/api/v1/models`
- `/api/v1/integrations`
- `/api/v1/artifacts`
- `/api/v1/workspace-templates`
- 一部分 internal runtime 辅助接口

### 预计删除的接口

- `/api/auth/*`
- `/api/v1/me`
- `/api/v1/me/auth-source`
- invite / onboarding 相关接口
- claim / shared workspace 相关接口
- pools register / heartbeat / config snapshot 相关接口
