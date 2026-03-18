# OpenClaw 架构内部机制与多租户设计分析

> 基于 openclaw 源码（2026-02-25）的完整分析，供 Nexu 多租户平台设计参考。

---

## 目录

1. [核心概念与名词解释](#1-核心概念与名词解释)
2. [Agent-Session-Gateway 关系模型](#2-agent-session-gateway-关系模型)
3. [消息流转全链路](#3-消息流转全链路)
4. [私聊场景](#4-私聊场景)
5. [群聊场景](#5-群聊场景)
6. [同群多 Agent（多数字员工）场景](#6-同群多-agent多数字员工场景)
7. [Config 热加载机制](#7-config-热加载机制)
8. [Agent 隔离机制](#8-agent-隔离机制)
9. [多租户设计建议](#9-多租户设计建议)

---

## 1. 核心概念与名词解释

### Gateway（网关）

**一个运行中的 Node.js 进程**，是 openclaw 的运行时核心。

- 监听单个 HTTP/WS 端口（默认 18789）
- 加载一个 `openclaw.json` 配置文件
- 管理所有 Agent、Channel、Session 的生命周期
- **不是微服务**——一个 gateway 进程内包含所有功能

```
Gateway 进程
├── HTTP Server（接收 webhook、API 请求）
├── WebSocket Server（CLI/浏览器/移动端连接）
├── Channel Monitors（每个 account 一个监听器）
├── Config Watcher（chokidar 监听配置变更）
└── Agent Runtime（按需处理消息）
```

**关键认知**：Gateway 是一个"万能容器"，通过配置文件声明它要服务哪些 Agent 和 Channel。

### Agent（代理/数字员工）

**配置文件中的一段声明**，不是独立进程。

```json
{
  "agents": {
    "list": [
      {
        "id": "alice-clone",
        "name": "Alice 的数字分身",
        "default": true,
        "model": { "primary": "gpt-4o" }
      },
      {
        "id": "bob-clone",
        "name": "Bob 的数字分身",
        "model": { "primary": "claude-sonnet-4-6" }
      }
    ]
  }
}
```

每个 Agent 拥有：
- **Workspace**（工作区）：`~/.openclaw/workspace-{agentId}/`，含 `SOUL.md`（人设）、`MEMORY.md`（记忆）等
- **Session 目录**：`~/.openclaw/agents/{agentId}/sessions/`，所有会话记录
- **Memory 数据库**：`~/.openclaw/memory/{agentId}.sqlite`，向量记忆索引
- **Agent 目录**：`~/.openclaw/agents/{agentId}/agent/`，工作文件

**关键认知**：Agent 是"身份"而非"进程"。一个 Gateway 内可以有 N 个 Agent，它们共享同一个进程但数据完全隔离。

### Channel（渠道）

消息的来源和去向。每个 Channel 类型支持多个 Account。

```json
{
  "channels": {
    "slack": {
      "accounts": {
        "alice-workspace": {
          "botToken": "xoxb-alice-...",
          "mode": "http",
          "webhookPath": "/slack/events/alice",
          "requireMention": true,
          "groupPolicy": "open"
        },
        "bob-workspace": {
          "botToken": "xoxb-bob-...",
          "mode": "http",
          "webhookPath": "/slack/events/bob",
          "requireMention": true,
          "groupPolicy": "open"
        }
      }
    }
  }
}
```

**支持的 Channel 类型**：
| Channel | 核心/插件 | 连接方式 |
|---------|----------|---------|
| Slack | 核心 | Socket Mode / HTTP Webhook |
| Discord | 核心 | WebSocket (Gateway API) |
| Telegram | 核心 | Polling / Webhook |
| WhatsApp | 核心 | Web 协议 |
| Signal | 核心 | signal-cli |
| iMessage | 核心 | AppleScript |
| 飞书 (Feishu) | 插件 | WebSocket / Webhook |
| Matrix | 插件 | Matrix CS API |
| MS Teams | 插件 | Bot Framework |

**关键认知**：一个 botToken = 一个 Slack 机器人身份 = 一个 Account。不同的 Account 在 Slack 中表现为不同的机器人用户。

### Account（账号）

Channel 下的多账号抽象。一个 Channel 类型可以配置多个 Account。

```
channels.slack.accounts
├── "alice-workspace"  → botToken A → Slack 里的 "Alice Assistant" 机器人
├── "bob-workspace"    → botToken B → Slack 里的 "Bob Assistant" 机器人
└── "shared-org"       → botToken C → Slack 里的 "Org Bot" 机器人
```

每个 Account **独立运行**一个 Monitor（消息监听器），拥有独立的：
- 连接（WebSocket/HTTP）
- 消息去重缓存
- 权限策略（allowlist、groupPolicy、dmPolicy）
- requireMention 设置

### Binding（绑定）

**路由规则**，定义"哪个 Channel Account 的消息由哪个 Agent 处理"。

```json
{
  "bindings": [
    {
      "agentId": "alice-clone",
      "match": { "channel": "slack", "accountId": "alice-workspace" }
    },
    {
      "agentId": "bob-clone",
      "match": { "channel": "slack", "accountId": "bob-workspace" }
    }
  ]
}
```

**路由优先级**（从高到低）：

| 优先级 | 匹配方式 | 示例 |
|--------|---------|------|
| 1 | `binding.peer` | 指定频道/用户 ID |
| 2 | `binding.peer.parent` | thread 继承父频道 |
| 3 | `binding.guild+roles` | Discord 服务器 + 角色 |
| 4 | `binding.guild` | Discord 服务器 |
| 5 | `binding.team` | Slack workspace |
| 6 | `binding.account` | 指定 accountId |
| 7 | `binding.channel` | accountId 通配符 `"*"` |
| 8 | `default` | 默认 Agent |

### Session（会话）

Agent 与某个对话上下文的持久化记录。

**Session Key 格式**：
```
agent:{agentId}:{channel}:{peerKind}:{peerId}
```

**示例**：
```
agent:alice-clone:slack:direct:U_BOB          ← Alice 和 Bob 的私聊
agent:alice-clone:slack:channel:C_GENERAL     ← Alice 在 #general 的群聊
agent:alice-clone:slack:channel:C_GENERAL:thread:1234567890.123  ← #general 中某个 thread
```

**存储**：
```
~/.openclaw/agents/alice-clone/sessions/
├── sessions.json                                    ← 会话索引
├── agent_alice-clone_slack_direct_u_bob.jsonl       ← 与 Bob 的私聊记录
├── agent_alice-clone_slack_channel_c_general.jsonl  ← #general 群聊记录
└── ...
```

**关键认知**：Session 是按 `agentId + channel + peerId` 三元组隔离的。同一个 Agent 的不同对话（不同群、不同人）各有独立 Session。

---

## 2. Agent-Session-Gateway 关系模型

```
                         ┌─────────────────────────────────┐
                         │           Gateway 进程           │
                         │                                  │
                         │  ┌───────────────────────────┐  │
                         │  │     openclaw.json 配置     │  │
                         │  └───────────────────────────┘  │
                         │           │                      │
                         │     ┌─────┼──────────┐          │
                         │     ▼     ▼          ▼          │
                         │  Agent A  Agent B  Agent C      │
                         │  (alice)  (bob)    (carol)      │
                         │     │       │        │          │
                         │  ┌──┴──┐ ┌──┴──┐  ┌──┴──┐     │
                         │  │  S  │ │  S  │  │  S  │     │  S = Session Store
                         │  │  M  │ │  M  │  │  M  │     │  M = Memory DB
                         │  │  W  │ │  W  │  │  W  │     │  W = Workspace
                         │  └─────┘ └─────┘  └─────┘     │
                         │                                  │
                         │  ┌───────────────────────────┐  │
                         │  │    Channel Monitors        │  │
                         │  │  ┌──────┐ ┌──────┐       │  │
                         │  │  │Slack │ │Slack │       │  │
                         │  │  │Acct A│ │Acct B│       │  │
                         │  │  └──┬───┘ └──┬───┘       │  │
                         │  └─────┼────────┼───────────┘  │
                         │        │        │               │
                         └────────┼────────┼───────────────┘
                                  │        │
                    ┌─────────────┘        └──────────────┐
                    ▼                                      ▼
            Slack Workspace                        Slack Workspace
            (alice's token)                        (bob's token)
```

**核心关系**：
- **1 Gateway : N Agents** — 一个进程服务多个 Agent
- **1 Agent : N Sessions** — 一个 Agent 有多个独立对话
- **1 Account : 1 Monitor** — 每个 botToken 独立监听
- **Binding 决定 Account → Agent 的映射**

---

## 3. 消息流转全链路

以 Slack HTTP 模式为例：

```
用户在 Slack 发消息 "@alice-bot 你好"
         │
         ▼
[1] Slack 服务器发送 HTTP POST 到 Gateway
    POST /slack/events/alice-workspace
         │
         ▼
[2] Gateway HTTP Handler 接收
    → 验证 signing secret
    → 解析 event payload
         │
         ▼
[3] Slack Monitor (alice-workspace account) 处理
    → 消息去重检查（channelId:ts）
    → 检查 requireMention（是否 @了自己）
    → 检查 groupPolicy（群聊是否允许）
    → 检查 allowlist（发送者是否被允许）
         │
         ▼
[4] 路由解析 resolveAgentRoute()
    输入: channel="slack", accountId="alice-workspace",
          peer={kind:"channel", id:"C_GENERAL"}
    → 遍历 bindings，按优先级匹配
    → 返回: agentId="alice-clone", sessionKey="agent:alice-clone:slack:channel:c_general"
         │
         ▼
[5] Session 定位
    → 根据 sessionKey 查找/创建会话文件
    → 加载历史上下文（JSONL 格式）
         │
         ▼
[6] Agent 处理
    → 加载 SOUL.md（人设）、MEMORY.md（记忆）
    → 向量记忆搜索（相关上下文）
    → 调用 LLM（GPT-4o / Claude 等）
    → 生成回复
         │
         ▼
[7] 回复投递
    → 通过 alice-workspace account 的 botToken
    → 调用 Slack chat.postMessage API
    → 消息出现在 #general，显示为 "Alice Assistant" 机器人发送
```

---

## 4. 私聊场景

### 场景：Bob 在 Slack 中私聊 Alice 的数字分身

```
Bob → DM → "Alice Assistant" 机器人
```

**消息流转**：
1. Slack 发送 event 到 Gateway（alice-workspace account 的 webhook）
2. Monitor 检查 dmPolicy：
   - `"open"`：任何人都能私聊
   - `"pairing"`：需要配对码确认
   - `"allowlist"`：只有白名单用户可以私聊
3. 路由解析：`peer={kind:"direct", id:"U_BOB"}`
4. Session Key：`agent:alice-clone:slack:direct:u_bob`
5. **Bob 和 Alice 分身的对话完全独立于其他人与 Alice 分身的对话**

### Session 隔离示意

```
Alice 的数字分身 (agent: alice-clone)
├── 与 Bob 的私聊   → session: agent:alice-clone:slack:direct:u_bob
├── 与 Carol 的私聊 → session: agent:alice-clone:slack:direct:u_carol
├── 与 Dave 的私聊  → session: agent:alice-clone:slack:direct:u_dave
└── （各自独立的对话历史、上下文记忆）
```

### dmScope 配置

控制私聊 session 的隔离粒度：

| dmScope | Session Key 格式 | 效果 |
|---------|-----------------|------|
| `"main"` | `agent:alice:main` | 所有 DM 共享一个 session |
| `"per-peer"` | `agent:alice:direct:{peerId}` | 每人独立 session（默认） |
| `"per-channel-peer"` | `agent:alice:slack:direct:{peerId}` | 跨渠道也隔离 |
| `"per-account-channel-peer"` | `agent:alice:slack:acct1:direct:{peerId}` | 最细粒度 |

---

## 5. 群聊场景

### 场景：#general 中有 Alice 的数字分身

```
#general 群聊
├── Alice（真人，不在线）
├── Bob（真人）
├── Carol（真人）
└── Alice Assistant（Alice 的数字分身机器人）

Bob: "@Alice Assistant 帮我查一下上季度报表"
```

**消息流转**：
1. 所有群消息都发送到 Gateway
2. **requireMention 检查**（默认 `true`）：
   - Bob 的消息 @了 Alice Assistant → 通过
   - Carol 随便聊天没 @ → **跳过，不处理**
3. 路由到 agent `alice-clone`
4. Session Key：`agent:alice-clone:slack:channel:c_general`
5. 这个 session 记录了 alice-clone 在 #general 中的所有对话历史

### Thread 处理

```
#general
├── Bob: "@Alice Assistant 查报表"         → session: ...channel:c_general
│   └── Alice Assistant: "好的..."
│       └── Bob: "再详细点"                → session: ...channel:c_general:thread:1234567890.123
│           └── Alice Assistant: "详细如下..."
```

Thread 会创建独立的 sub-session，但可以继承父 session 的上下文（`thread.inheritParent` 配置）。

### groupPolicy 配置

| groupPolicy | 效果 |
|-------------|------|
| `"open"` | 任何群聊都可以，通过 @mention 触发 |
| `"allowlist"` | 只允许配置的群聊 ID |
| `"disabled"` | 禁止所有群聊消息 |

---

## 6. 同群多 Agent（多数字员工）场景

### 这是多租户场景的核心问题

**场景**：#general 中有 Alice 和 Bob 两个人的数字分身

```
#general 群聊
├── Alice（真人，不在线）
├── Bob（真人，不在线）
├── Carol（真人）
├── Alice Assistant（Alice 的数字分身，botToken A）
└── Bob Assistant（Bob 的数字分身，botToken B）
```

### 前提条件：每个数字分身需要独立的 Slack Account

在 openclaw 中，**一个 botToken = 一个 Slack 机器人身份**。要让两个数字分身在同一个群里独立存在，必须使用不同的 botToken。

```json
{
  "channels": {
    "slack": {
      "accounts": {
        "alice-ws": { "botToken": "xoxb-alice-...", "requireMention": true },
        "bob-ws": { "botToken": "xoxb-bob-...", "requireMention": true }
      }
    }
  },
  "bindings": [
    { "agentId": "alice-clone", "match": { "channel": "slack", "accountId": "alice-ws" } },
    { "agentId": "bob-clone", "match": { "channel": "slack", "accountId": "bob-ws" } }
  ]
}
```

### 消息分发机制

当 Carol 在 #general 发送消息时：

```
Carol: "大家好"（没有 @ 任何人）

Gateway 内部：
├── alice-ws Monitor 收到消息
│   → requireMention=true → 没有 @Alice Assistant → 跳过 ✗
└── bob-ws Monitor 收到消息
    → requireMention=true → 没有 @Bob Assistant → 跳过 ✗

结果：两个分身都不回复（正确行为）
```

```
Carol: "@Alice Assistant 你觉得呢？"

Gateway 内部：
├── alice-ws Monitor 收到消息
│   → requireMention=true → 检测到 @Alice Assistant → 通过 ✓
│   → 路由到 agent alice-clone
│   → Alice 的分身回复
└── bob-ws Monitor 收到消息
    → requireMention=true → 没有 @Bob Assistant → 跳过 ✗

结果：只有 Alice 的分身回复（正确行为）
```

```
Carol: "@Alice Assistant @Bob Assistant 你们两个讨论一下"

Gateway 内部：
├── alice-ws Monitor 收到消息
│   → 检测到 @Alice Assistant → 通过 ✓
│   → 路由到 alice-clone → Alice 回复
└── bob-ws Monitor 收到消息
    → 检测到 @Bob Assistant → 通过 ✓
    → 路由到 bob-clone → Bob 回复

结果：两个分身都回复（各自独立处理，独立 session）
```

### 关键机制总结

| 机制 | 说明 |
|------|------|
| **独立 Monitor** | 每个 Account 有独立的 Slack Bolt App 实例和消息监听器 |
| **独立去重** | 去重 key 包含 accountId：`slack:{accountId}:{threadKey}:{senderId}` |
| **独立过滤** | requireMention、groupPolicy、allowlist 均按 Account 独立判断 |
| **独立路由** | 通过 Binding 映射到不同 Agent |
| **独立 Session** | 不同 Agent 的 session 完全隔离 |

---

## 7. Config 热加载机制

### 加载模式

```json
{
  "gateway": {
    "reload": {
      "mode": "hybrid",
      "debounceMs": 300
    }
  }
}
```

| 模式 | 行为 |
|------|------|
| `"off"` | 忽略配置变更 |
| `"hot"` | 尽量热加载，无法热加载的忽略 |
| `"restart"` | 任何变更都重启 gateway |
| `"hybrid"`（默认） | 尽量热加载，无法热加载的才重启 |

### Reload Rule 分类（源码 `config-reload.ts`）

openclaw 对每个配置路径定义了 reload rule，分为三种 `kind`：

| kind | 含义 |
|------|------|
| `"none"` | 新 config 加载到内存即可生效，无需额外操作 |
| `"hot"` | 需要执行特定热加载动作（如重启 channel monitor），不重启 gateway |
| `"restart"` | 需要重启整个 gateway 进程 |

| 配置路径 | reload kind | 效果 |
|----------|------------|------|
| `channels.*` | `hot` | 重启对应 channel 的 monitor |
| `hooks` | `hot` | 重新加载 hooks |
| `agents` | `none` | **新 config 直接生效，新 agent 立即可路由** |
| `bindings` | `none` | **路由表内存更新，立即生效** |
| `models` | `none` | **直接生效** |
| `tools` | `none` | **直接生效** |
| `gateway` | `restart` | 需要重启 |
| `plugins` | `restart` | 需要重启 |

### 多租户场景的意义

```
用户在 Dashboard 创建新 bot
  → Control Plane 重新生成 config.json
  → 写入文件（原子写：写 temp 文件再 rename）
  → chokidar 检测到变更（300ms 防抖）
  → Gateway 热加载
    - agents 新增条目 → 新 config 加载到内存，新 agent ID 立即可用于路由（kind: "none"）
    - bindings 新增条目 → 路由表内存更新（kind: "none"）
    - channels 新增 account → 启动新 monitor（kind: "hot"）
```

**关键结论**：新增 Agent、Binding、Channel 均可热加载，**整个过程零中断，不需要重启 gateway**。只有 `gateway` 和 `plugins` 配置变更才需要重启，而这些在多租户场景中不会变更。

---

## 8. Agent 隔离机制

### 完整隔离矩阵

| 维度 | 隔离方式 | 路径 |
|------|---------|------|
| Session 会话 | 完全隔离 | `~/.openclaw/agents/{agentId}/sessions/` |
| Memory 向量记忆 | 完全隔离 | `~/.openclaw/memory/{agentId}.sqlite` |
| Workspace 工作区 | 完全隔离 | `~/.openclaw/workspace-{agentId}/` |
| SOUL.md 人设 | 完全隔离 | 在各自 workspace 下 |
| Tools 工具 | 部分共享 | 共享基础设施，per-agent allowlist |
| 跨 Agent 访问 | 默认禁止 | `tools.agentToAgent.enabled` 需显式开启 |

### Memory 搜索配置（per-agent）

```json
{
  "agents": {
    "list": [{
      "id": "alice-clone",
      "memorySearch": {
        "enabled": true,
        "sources": ["memory"],
        "provider": "openai",
        "query": {
          "maxResults": 6,
          "minScore": 0.35,
          "hybrid": {
            "vectorWeight": 0.7,
            "textWeight": 0.3
          }
        }
      }
    }]
  }
}
```

每个 Agent 有独立的 SQLite 向量数据库，包含：
- `chunks` 表：文本分块 + embedding 向量
- `chunks_fts` 表：全文搜索索引（FTS5）
- `files` 表：已索引文件的 hash/mtime 追踪
- `embedding_cache` 表：embedding 缓存

---

## 9. 多租户设计建议

### 核心映射关系

基于以上分析，推荐的多租户映射：

```
1 个用户 = 1 个数字分身 = 1 个 Agent = 1 个 Slack Account（botToken）
```

#### 为什么是 1:1:1:1？

| 层级 | 理由 |
|------|------|
| 1 用户 : 1 Agent | 数字分身 = 一个人的 AI 替身，天然 1:1 |
| 1 Agent : 独立 Memory | SOUL.md 人设 + MEMORY.md 记忆 + 向量 DB，不能共享 |
| 1 Agent : 1 Account | 每个分身需要独立的机器人身份（头像、名字、token） |
| 1 Account : 1 Binding | 直接映射，简单可靠 |

### 同 workspace 多分身方案

**问题**：一个 Slack workspace 里多个人都想有自己的数字分身。

**方案 A：共享 Slack App + OAuth（推荐）**

```
中央 Slack App（平台统一创建）
  └── 用户 Alice 安装到 workspace X → 获得 botToken-alice
  └── 用户 Bob  安装到 workspace Y → 获得 botToken-bob
```

每次 OAuth 安装产生独立的 botToken，自然隔离。但**同一个 workspace 只能安装一次同一个 App**。

**方案 B：多 Slack App**

为每个用户创建独立的 Slack App：
- 用户在 Dashboard 自己填 botToken（自建应用模式）
- 或平台批量创建 App（需要 Slack 企业级权限）

**方案 C：单 App + 用户路由（非 Slack 原生方式）**

一个 Slack App 安装到 workspace，但在消息层面区分：
- 通过 slash command 切换分身：`/clone @alice` → 后续消息路由给 alice-clone
- 通过 thread 绑定：在特定 thread 中 @某人的分身
- 需要在 Control Plane 层维护 `slack_user → agent` 映射表
- **openclaw 原生不支持**，需要在 webhook router 层实现

### MVP 推荐架构

```
┌──────────────────────────────────────────────────┐
│                  Control Plane                    │
│                                                    │
│  ┌─────────┐  ┌──────────┐  ┌──────────────┐    │
│  │ Auth    │  │ Bot CRUD │  │ Config Gen   │    │
│  │(better- │  │ Channel  │  │ DB → JSON    │    │
│  │ auth)   │  │ Connect  │  │              │    │
│  └─────────┘  └──────────┘  └──────┬───────┘    │
│                                      │            │
│  ┌──────────────┐                    │            │
│  │ Webhook      │                    ▼            │
│  │ Router       │           config.json 写入      │
│  │ (内置)       │                    │            │
│  └──────┬───────┘                    │            │
└─────────┼────────────────────────────┼────────────┘
          │                            │
          ▼                            ▼
  ┌───────────────────────────────────────────┐
  │            OpenClaw Gateway               │
  │                                            │
  │  Agent: alice-clone    Agent: bob-clone    │
  │  Account: alice-ws     Account: bob-ws     │
  │  Binding: alice↔alice  Binding: bob↔bob    │
  │                                            │
  │  独立 Session / Memory / Workspace         │
  └───────────────────────────────────────────┘

  ┌───────────────────────────────────────────┐
  │          Next.js Dashboard                 │
  │  创建分身 → 连接 Slack → 查看配置 → 用量   │
  └───────────────────────────────────────────┘
```

### Config 生成示例

当 Alice 和 Bob 都在 pool-1 上时，Control Plane 生成的 config.json：

```json
{
  "gateway": {
    "port": 18789,
    "bind": "lan",
    "auth": { "mode": "token", "token": "<internal-token>" },
    "reload": { "mode": "hybrid" }
  },
  "agents": {
    "list": [
      {
        "id": "user-alice-bot",
        "name": "Alice 的数字分身",
        "default": true,
        "model": { "primary": "gpt-4o" },
        "workspace": "/data/workspaces/user-alice-bot"
      },
      {
        "id": "user-bob-bot",
        "name": "Bob 的数字分身",
        "model": { "primary": "claude-sonnet-4-6" },
        "workspace": "/data/workspaces/user-bob-bot"
      }
    ]
  },
  "channels": {
    "slack": {
      "accounts": {
        "slack-T123": {
          "botToken": "xoxb-alice-token",
          "mode": "http",
          "webhookPath": "/slack/events/slack-T123",
          "requireMention": true,
          "groupPolicy": "open",
          "enabled": true
        },
        "slack-T456": {
          "botToken": "xoxb-bob-token",
          "mode": "http",
          "webhookPath": "/slack/events/slack-T456",
          "requireMention": true,
          "groupPolicy": "open",
          "enabled": true
        }
      }
    }
  },
  "bindings": [
    {
      "agentId": "user-alice-bot",
      "match": { "channel": "slack", "accountId": "slack-T123" }
    },
    {
      "agentId": "user-bob-bot",
      "match": { "channel": "slack", "accountId": "slack-T456" }
    }
  ]
}
```

### 消息流转完整示例

```
[群聊] Carol: "@Alice Assistant 帮我看看代码"

1. Slack → POST /slack/events/slack-T123 → Gateway
2. alice-ws Monitor:
   - 去重: slack:slack-T123:{threadKey}:{carol_id} → 未见过 ✓
   - requireMention: 检测到 @Alice Assistant → 通过 ✓
   - groupPolicy: "open" → 通过 ✓
3. resolveAgentRoute:
   - channel="slack", accountId="slack-T123"
   - binding 匹配: slack-T123 → user-alice-bot
   - sessionKey: "agent:user-alice-bot:slack:channel:c_general"
4. Agent "user-alice-bot" 处理:
   - 加载 /data/workspaces/user-alice-bot/SOUL.md
   - 搜索 memory/user-alice-bot.sqlite（相关知识）
   - 调用 GPT-4o 生成回复
5. 通过 xoxb-alice-token 发送回复到 #general

同时:
bob-ws Monitor 也收到 Carol 的消息
  → requireMention=true → 没有 @Bob Assistant → 跳过 ✗
```

### 扩展性考量

| 维度 | 当前方案 | 规模瓶颈 | 应对策略 |
|------|---------|---------|---------|
| Agent 数量 | 50/Pod（保守） | 内存（空闲 ~0MB） | 实测可达数百 |
| Session 并发 | 按 Agent 隔离 | LLM API 并发 | 按需横向扩 Pod |
| Config 大小 | 全量生成 | 50 bot 的 JSON ~50KB | 增量更新（Phase 2） |
| Channel Account | 每个 bot 1 个 | Slack rate limit | 按 workspace 分 Pod |

---

## 附录：源码关键文件索引

| 用途 | 文件路径 |
|------|---------|
| Gateway 启动 | `src/gateway/server.impl.ts` |
| HTTP 服务器 | `src/gateway/server-http.ts` |
| Config 加载 | `src/config/io.ts` |
| Config 类型 | `src/config/types.openclaw.ts` |
| Config 热加载 | `src/gateway/config-reload.ts` |
| Channel 启动 | `src/gateway/server-channels.ts` |
| 路由解析 | `src/routing/resolve-route.ts` |
| Binding 匹配 | `src/routing/bindings.ts` |
| Session Key 构建 | `src/routing/session-key.ts` |
| Agent 配置解析 | `src/agents/agent-scope.ts` |
| Agent 工作区 | `src/agents/workspace.ts` |
| Agent CRUD API | `src/gateway/server-methods/agents.ts` |
| Memory 管理 | `src/memory/manager.ts` |
| Memory 配置 | `src/agents/memory-search.ts` |
| Session 存储 | `src/config/sessions/store.ts` |
| Session 路径 | `src/config/sessions/paths.ts` |
| 跨 Agent 访问控制 | `src/agents/tools/sessions-access.ts` |
| Slack 类型 | `src/config/types.slack.ts` |
| Slack Monitor | `src/slack/monitor/provider.ts` |
| Slack 消息处理 | `src/slack/monitor/message-handler/prepare.ts` |
| Slack 消息去重 | `src/slack/monitor/context.ts` |
| Slack 事件注册 | `src/slack/monitor/events/messages.ts` |
| Plugin SDK | `src/plugin-sdk/index.ts` |
| Plugin 注册表 | `src/plugins/registry.ts` |
| 飞书插件 | `extensions/feishu/src/channel.ts` |
| Channel 插件类型 | `src/channels/plugins/types.plugin.ts` |
