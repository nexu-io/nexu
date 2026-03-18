# OpenClaw config.json Schema 参考

Config 生成器必须输出符合此格式的 JSON。OpenClaw gateway 通过 chokidar 监听文件变更自动热加载。

---

## 顶层结构

```jsonc
{
  "gateway":  { /* 必填：服务器配置 */ },
  "models":   { /* 可选：LLM provider（LiteLLM 等） */ },
  "agents":   { /* 必填：Agent 列表 */ },
  "channels": { /* 必填：Channel 账号 */ },
  "bindings": [ /* 必填：路由规则 */ ],
  "skills":   { /* 可选：技能热加载 */ },
  "commands": { /* 可选：命令控制 */ },
  "plugins":  { /* 可选：插件启用 */ }
}
```

---

## gateway

```json
{
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": { "mode": "token", "token": "gw-secret-token" },
    "reload": { "mode": "hybrid" }
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | number | 18789 | 监听端口 |
| `mode` | `"local"` \| `"remote"` | - | 必须设为 `"local"` |
| `bind` | `"loopback"` \| `"lan"` \| `"auto"` | `"loopback"` | 网络绑定 |
| `auth.mode` | `"none"` \| `"token"` | `"token"` | 认证模式 |
| `auth.token` | string | - | 共享 token（`mode: "token"` 时必填） |
| `reload.mode` | `"off"` \| `"hot"` \| `"hybrid"` | `"hybrid"` | 热加载策略 |

---

## models

自定义 LLM 提供商配置。**当使用 LiteLLM 代理时必填。**

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "litellm": {
        "baseUrl": "https://litellm.example.com",
        "apiKey": "sk-your-key",
        "api": "openai-completions",
        "models": [
          {
            "id": "anthropic/claude-sonnet-4",
            "name": "Claude Sonnet 4",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 8192,
            "compat": { "supportsStore": false }
          }
        ]
      }
    }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `mode` | `"merge"` \| `"replace"` | `merge` = 追加到内置 provider；`replace` = 覆盖 |
| `providers.<name>.baseUrl` | string | Provider API 地址 |
| `providers.<name>.apiKey` | string | API key |
| `providers.<name>.api` | string | API 协议，LiteLLM 用 `"openai-completions"` |
| `providers.<name>.models[].id` | string | 模型 ID（需与 provider 实际 ID 匹配） |
| `providers.<name>.models[].compat.supportsStore` | boolean | **LiteLLM/Bedrock 必须设为 `false`**，否则发送 `store` 参数导致 400 |

### 模型 ID 前缀规则

在 `agents.defaults.model` 和 `agents.list[].model` 中引用自定义 provider 的模型时，必须加 provider 名称前缀：

```
原始 model ID:  anthropic/claude-sonnet-4
引用时写:       litellm/anthropic/claude-sonnet-4
              ^^^^^^^^ provider 名称作前缀
```

Config 生成器在检测到 `LITELLM_BASE_URL` 环境变量时会自动添加此前缀。

---

## agents

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-20250514"
    },
    "list": [
      {
        "id": "tenant-abc",
        "name": "ABC Corp Bot",
        "default": true,
        "workspace": "/data/workspaces/tenant-abc"
      }
    ]
  }
}
```

### agents.list[] 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | **是** | 唯一标识符，用于 `bindings[].agentId` 匹配 |
| `name` | string | 否 | 显示名称 |
| `default` | boolean | 否 | 标记为默认 agent（最多一个） |
| `workspace` | string | 否 | 工作目录路径 |
| `model` | string \| `{ primary, fallbacks }` | 否 | 模型覆盖 |

---

## channels

### 飞书 (feishu)

```json
{
  "channels": {
    "feishu": {
      "accounts": {
        "feishu-tenant-abc": {
          "enabled": true,
          "appId": "cli_a1b2c3d4",
          "appSecret": "secret_value",
          "connectionMode": "websocket"
        }
      }
    }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 启用/禁用 |
| `appId` | string | 飞书应用 ID |
| `appSecret` | string | 飞书应用密钥 |
| `connectionMode` | `"websocket"` \| `"webhook"` | 连接模式。webhook 模式需额外设 `verificationToken` |
| `verificationToken` | string | webhook 验证 token（webhook 模式必填） |
| `webhookPath` | string | webhook 路径（如 `/feishu/events/tenant-abc`） |
| `domain` | `"feishu"` \| `"lark"` | API 域名（国内用 feishu，国际用 lark） |
| `dmPolicy` | `"open"` \| `"pairing"` \| `"allowlist"` | 私聊策略 |
| `groupPolicy` | `"open"` \| `"allowlist"` \| `"disabled"` | 群聊策略 |

### Slack

Slack channel 有**顶层字段**和 **account 字段**两级。顶层控制全局默认策略，account 级别控制单个 workspace。

```json
{
  "channels": {
    "slack": {
      "mode": "http",
      "signingSecret": "abc123",
      "enabled": true,
      "groupPolicy": "open",
      "requireMention": false,
      "dmPolicy": "open",
      "allowFrom": ["*"],
      "accounts": {
        "slack-team-T123": {
          "enabled": true,
          "botToken": "xoxb-...",
          "signingSecret": "abc123",
          "mode": "http",
          "webhookPath": "/slack/events/team-T123",
          "appToken": "xapp-placeholder-not-used-in-http-mode"
        }
      }
    }
  }
}
```

#### 顶层字段（`channels.slack.*`）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mode` | `"socket"` \| `"http"` | **是** | 连接模式，多租户必须 `"http"` |
| `signingSecret` | string | **是** | 顶层需要一个 signingSecret（可用任一 account 的） |
| `enabled` | boolean | 推荐 | 启用/禁用 |
| `groupPolicy` | `"open"` \| `"allowlist"` \| `"disabled"` | **推荐** | 频道消息策略。**不设时运行时默认 `"allowlist"`，bot 会忽略所有频道消息** |
| `requireMention` | boolean | **推荐** | 是否需要 @mention 才响应。**默认 `true`** |
| `dmPolicy` | `"pairing"` \| `"allowlist"` \| `"open"` | **推荐** | 私聊策略 |
| `allowFrom` | string[] | 条件必填 | 允许的用户/频道。**`dmPolicy: "open"` 时必须设为 `["*"]`** |

#### account 字段（`channels.slack.accounts.<id>.*`）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `enabled` | boolean | 是 | 启用/禁用 |
| `botToken` | string | **是** | Bot token (`xoxb-...`) |
| `signingSecret` | string | HTTP 模式 | Signing secret |
| `appToken` | string | **是** | HTTP 模式下也必填（placeholder 即可），用于通过 `isConfigured` 检查 |
| `mode` | `"socket"` \| `"http"` | 是 | 连接模式 |
| `webhookPath` | string | HTTP 模式 | webhook 路径，如 `/slack/events/slack-T123` |
| `dmPolicy` | `"pairing"` \| `"allowlist"` \| `"open"` | 否 | 覆盖顶层 |
| `groupPolicy` | `"open"` \| `"allowlist"` \| `"disabled"` | 否 | 覆盖顶层 |

---

## bindings

路由规则：将 channel 消息分发到指定 agent。

```json
{
  "bindings": [
    {
      "agentId": "tenant-abc",
      "match": {
        "channel": "feishu",
        "accountId": "feishu-tenant-abc"
      }
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | **是** | 必须匹配 `agents.list[].id` |
| `match.channel` | string | **是** | channel 类型（`"feishu"`, `"slack"` 等） |
| `match.accountId` | string | 推荐 | 必须匹配 `channels.<type>.accounts` 的 key |

### 路由优先级（从高到低）

1. peer 精确匹配（channel + account + peer）
2. guild + roles（Discord）
3. guild（Discord）
4. team（Slack）
5. **account（最常用：channel + accountId）**
6. channel 通配（`accountId: "*"`）
7. 默认 agent

---

## skills

技能热加载配置。Config 生成器自动设置。

```json
{
  "skills": {
    "load": {
      "watch": true,
      "watchDebounceMs": 250,
      "extraDirs": ["/data/openclaw/skills"]
    }
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `load.watch` | boolean | `false` | 启用 chokidar 文件监听，检测 SKILL.md 变化后自动刷新 snapshot |
| `load.watchDebounceMs` | number | `250` | 文件变化去抖时间（毫秒） |
| `load.extraDirs` | string[] | `[]` | 额外技能扫描目录。**必须包含 sidecar 写入目录**（`${OPENCLAW_STATE_DIR}/skills`），否则 managed skills 在生产环境不可见 |

### 常见坑点

17. **`extraDirs` 必须包含 sidecar 写入路径** — OpenClaw 默认只扫描 `CONFIG_DIR/skills`（基于 `os.homedir()`）和 workspace 目录。sidecar 写入的 `${OPENCLAW_STATE_DIR}/skills` 在生产容器中通常与这些路径不同，必须通过 `extraDirs` 显式添加。

---

## commands

控制 Gateway 命令系统行为。Config 生成器自动设置。

```json
{
  "commands": {
    "native": "auto",
    "nativeSkills": "auto",
    "restart": true,
    "ownerDisplay": "raw"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `native` | `"auto"` \| `"off"` | 原生命令（`/help` 等） |
| `nativeSkills` | `"auto"` \| `"off"` | 原生技能 |
| `restart` | boolean | 是否允许通过命令重启 |
| `ownerDisplay` | `"raw"` \| `"friendly"` | 用户名显示模式 |

---

## 完整示例：3 租户（2 飞书 + 1 Slack）

```json
{
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "lan",
    "auth": { "mode": "token", "token": "gw-secret-2026" },
    "reload": { "mode": "hybrid" }
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-20250514"
    },
    "list": [
      {
        "id": "acme-corp",
        "name": "Acme Corp Bot",
        "default": true,
        "workspace": "/data/workspaces/acme-corp"
      },
      {
        "id": "globex-inc",
        "name": "Globex Inc Bot",
        "workspace": "/data/workspaces/globex-inc"
      },
      {
        "id": "initech-llc",
        "name": "Initech LLC Bot",
        "workspace": "/data/workspaces/initech-llc",
        "model": { "primary": "openai/gpt-4o" }
      }
    ]
  },
  "channels": {
    "feishu": {
      "accounts": {
        "feishu-acme": {
          "enabled": true,
          "appId": "cli_a1b2c3d4e5",
          "appSecret": "secret_acme"
        },
        "feishu-globex": {
          "enabled": true,
          "appId": "cli_f6g7h8i9j0",
          "appSecret": "secret_globex",
          "domain": "lark"
        }
      }
    },
    "slack": {
      "accounts": {
        "slack-initech": {
          "enabled": true,
          "botToken": "xoxb-initech-token",
          "signingSecret": "initech-signing-secret",
          "mode": "http",
          "webhookPath": "/slack/events/initech"
        }
      }
    }
  },
  "bindings": [
    { "agentId": "acme-corp",   "match": { "channel": "feishu", "accountId": "feishu-acme" } },
    { "agentId": "globex-inc",  "match": { "channel": "feishu", "accountId": "feishu-globex" } },
    { "agentId": "initech-llc", "match": { "channel": "slack",  "accountId": "slack-initech" } }
  ],
  "plugins": {
    "entries": {
      "feishu": { "enabled": true }
    }
  }
}
```

---

## 常见坑点

### 基础

1. **`accountId` 是 accounts 对象的 key，不是 appId**
   ```
   正确: "accountId": "feishu-acme"     (匹配 accounts.feishu-acme)
   错误: "accountId": "cli_a1b2c3d4e5"  (这是 appId，不是 key)
   ```

2. **`agentId` 大小写不敏感**，内部会 normalize 为小写

3. **省略 `accountId` 匹配的是 "default" 账号**，不是通配。通配用 `"*"`

4. **一个 config 中只能有一个 `default: true` 的 agent**

5. **`workspace` 目录必须存在**，gateway 不会自动创建

### Slack 专项（极易踩坑）

6. **`groupPolicy` 不设就是 `"allowlist"`** — Gateway 运行时 `resolveOpenProviderRuntimeGroupPolicy` 会在无显式配置时回退到 `"allowlist"`，导致 bot 默默丢弃所有频道消息而不报错。**务必显式设 `"groupPolicy": "open"`**。

7. **`requireMention` 默认 `true`** — `defaultRequireMention` 在代码中 `?? true`。如果希望 bot 回应所有消息而非仅 @mention，需显式设 `false`。

8. **`dmPolicy: "open"` 必须配套 `allowFrom: ["*"]`** — 否则 Gateway 启动时 schema 校验报错 `dmPolicy="open" requires allowFrom to include "*"`。

9. **Slack HTTP 模式必须设 `signingSecret`**，Socket 模式必须设 `appToken`

10. **Slack account 必须设 `appToken`（即使 HTTP 模式不用它）** — OpenClaw Slack 插件的 `isConfigured` 检查会验证该字段。用 `"xapp-placeholder-not-used-in-http-mode"` 占位即可。

11. **顶层 `channels.slack` 需要 `mode` 和 `signingSecret`** — 不只是 account 里需要，顶层也得有，否则 gateway 验证不通过。

### 模型（LiteLLM）

12. **Model ID 必须加 provider 前缀** — agents 里写 `"litellm/anthropic/claude-sonnet-4"`，models.providers 里的 `id` 写 `"anthropic/claude-sonnet-4"`（无前缀）。

13. **LiteLLM/Bedrock 模型必须设 `compat.supportsStore: false`** — OpenClaw 默认发送 `store: false` 参数（OpenAI 协议字段），Bedrock 不识别该字段会返回 400 `"store: Extra inputs are not permitted"`。

14. **Model ID 必须与 provider 实际支持的匹配** — 用 `curl <base_url>/v1/models -H "Authorization: Bearer <key>"` 查看可用列表，不要凭猜测填。

### 飞书

15. **飞书 webhook 模式必须设 `verificationToken`**，否则 schema 校验报错

16. **`plugins.entries.feishu.enabled: true`** 是必需的，否则飞书插件不加载
