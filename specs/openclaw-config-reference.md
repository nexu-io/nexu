# OpenClaw 配置字段完整参考

> 基于 OpenClaw 2026.2.25 (4b5d4a4) 源码分析，供 Nexu 平台 config generator 参考。

---

## 目录

- [顶层结构](#顶层结构)
- [1. Gateway 配置](#1-gateway-配置)
- [2. Agents 配置](#2-agents-配置)
- [3. Channel 配置](#3-channel-配置)
- [4. Tools 配置](#4-tools-配置)
- [5. Models 配置](#5-models-配置)
- [6. Messages 配置](#6-messages-配置)
- [7. Commands 配置](#7-commands-配置)
- [8. Session 配置](#8-session-配置)
- [9. Logging & Diagnostics](#9-logging--diagnostics)
- [10. Authentication](#10-authentication)
- [11. Hooks](#11-hooks)
- [12. Browser](#12-browser)
- [13. Skills & Plugins](#13-skills--plugins)
- [14. Cron](#14-cron)
- [15. Memory](#15-memory)
- [16. Approvals](#16-approvals)
- [17. 其他](#17-其他)
- [Nexu 集成优先级建议](#nexu-集成优先级建议)

---

## 顶层结构

定义在 `src/config/types.openclaw.ts`，顶层 key 包括：

```
meta, auth, env, wizard, diagnostics, logging, update, browser, ui, skills,
plugins, models, nodeHost, agents, tools, bindings, broadcast, audio, messages,
commands, approvals, session, web, channels, cron, hooks, discovery, canvasHost,
talk, gateway, memory
```

---

## 1. Gateway 配置

定义在 `src/config/types.gateway.ts`

### Port & Binding

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `gateway.port` | number | 18789 | 单端口复用 WS + HTTP |
| `gateway.mode` | `"local" \| "remote"` | - | Gateway 运行模式 |
| `gateway.bind` | `"auto" \| "lan" \| "loopback" \| "custom" \| "tailnet"` | `"loopback"` | 绑定地址策略 |
| `gateway.customBindHost` | string | - | bind="custom" 时的自定义 IP |

### Control UI

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `gateway.controlUi.enabled` | boolean | true | 启用 Control UI |
| `gateway.controlUi.basePath` | string | - | UI 路径前缀 |
| `gateway.controlUi.root` | string | - | 静态资源目录 |
| `gateway.controlUi.allowedOrigins` | string[] | - | CORS 允许的源 |
| `gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback` | boolean | - | Host header 回退 |
| `gateway.controlUi.allowInsecureAuth` | boolean | - | 允许不安全认证 |
| `gateway.controlUi.dangerouslyDisableDeviceAuth` | boolean | - | 禁用设备身份检查 |

### Authentication

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `gateway.auth.mode` | `"none" \| "token" \| "password" \| "trusted-proxy"` | - | 认证模式 |
| `gateway.auth.token` | string | - | token 模式的共享 token |
| `gateway.auth.password` | string | - | password 模式的共享密码 |
| `gateway.auth.allowTailscale` | boolean | - | 允许 Tailscale 身份头 |
| `gateway.auth.rateLimit.maxAttempts` | number | 10 | IP 最大失败次数 |
| `gateway.auth.rateLimit.windowMs` | number | 60000 | 滑动窗口时长 (ms) |
| `gateway.auth.rateLimit.lockoutMs` | number | 300000 | 锁定时长 (ms) |
| `gateway.auth.rateLimit.exemptLoopback` | boolean | true | 免除 localhost |
| `gateway.auth.trustedProxy.userHeader` | string | - | 包含用户身份的 header |
| `gateway.auth.trustedProxy.requiredHeaders` | string[] | - | 必须存在的 headers |
| `gateway.auth.trustedProxy.allowUsers` | string[] | - | 用户白名单 |

### TLS

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `gateway.tls.enabled` | boolean | - | 启用 TLS |
| `gateway.tls.autoGenerate` | boolean | true | 自动生成自签名证书 |
| `gateway.tls.certPath` | string | - | PEM 证书路径 |
| `gateway.tls.keyPath` | string | - | PEM 私钥路径 |
| `gateway.tls.caPath` | string | - | CA 证书包路径 |

### HTTP Endpoints

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `gateway.http.endpoints.chatCompletions.enabled` | boolean | false | 暴露 POST /v1/chat/completions |
| `gateway.http.endpoints.responses.enabled` | boolean | false | 暴露 POST /v1/responses |
| `gateway.http.endpoints.responses.maxBodyBytes` | number | 20MB | 最大请求体 |
| `gateway.http.endpoints.responses.files.*` | - | - | 文件上传配置 (allowUrl, maxBytes, maxChars 等) |
| `gateway.http.endpoints.responses.images.*` | - | - | 图片上传配置 |
| `gateway.http.securityHeaders.strictTransportSecurity` | string \| false | - | HSTS header |

### Reload

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `gateway.reload.mode` | `"off" \| "restart" \| "hot" \| "hybrid"` | `"hybrid"` | 配置重载策略 |
| `gateway.reload.debounceMs` | number | 300 | 重载防抖窗口 (ms) |

### Tailscale

| 字段 | 类型 | 说明 |
|------|------|------|
| `gateway.tailscale.mode` | `"off" \| "serve" \| "funnel"` | Tailscale 暴露模式 |
| `gateway.tailscale.resetOnExit` | boolean | 关闭时重置 serve/funnel |

### Remote

| 字段 | 类型 | 说明 |
|------|------|------|
| `gateway.remote.url` | string | 远程 Gateway WebSocket URL |
| `gateway.remote.transport` | `"ssh" \| "direct"` | 传输方式 |
| `gateway.remote.token` | string | 远程认证 token |
| `gateway.remote.password` | string | 远程认证密码 |
| `gateway.remote.tlsFingerprint` | string | TLS 证书指纹 |
| `gateway.remote.sshTarget` | string | SSH 目标 (user@host) |
| `gateway.remote.sshIdentity` | string | SSH 密钥文件路径 |

### Nodes

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `gateway.nodes.browser.mode` | `"auto" \| "manual" \| "off"` | `"auto"` | 浏览器路由模式 |
| `gateway.nodes.browser.node` | string | - | 指定浏览器节点 |
| `gateway.nodes.allowCommands` | string[] | - | 允许的 node.invoke 命令 |
| `gateway.nodes.denyCommands` | string[] | - | 拒绝的命令 |

### Tools (Gateway 级别)

| 字段 | 类型 | 说明 |
|------|------|------|
| `gateway.tools.deny` | string[] | 通过 /tools/invoke 拒绝的工具 |
| `gateway.tools.allow` | string[] | 显式允许的工具 |

### Network

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `gateway.trustedProxies` | string[] | - | 可信反向代理 IP |
| `gateway.allowRealIpFallback` | boolean | false | 允许 x-real-ip 回退 |
| `gateway.channelHealthCheckMinutes` | number | 5 | Channel 健康检查间隔 |

### Discovery

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `gateway.discovery.wideArea.enabled` | boolean | - | 启用广域发现 |
| `gateway.discovery.wideArea.domain` | string | - | Unicast DNS-SD 域名 |
| `gateway.discovery.mdns.mode` | `"off" \| "minimal" \| "full"` | `"minimal"` | mDNS 广播模式 |

---

## 2. Agents 配置

### Agent Defaults

定义在 `src/config/types.agent-defaults.ts`，所有 agent 的全局默认值。

#### Model & Performance

| 字段 | 类型 | 说明 |
|------|------|------|
| `agents.defaults.model` | string \| {primary, fallbacks[]} | 主模型和回退 |
| `agents.defaults.imageModel` | string \| {primary, fallbacks[]} | 图像模型 |
| `agents.defaults.models` | Record\<string, {alias?, params?, streaming?}\> | 模型目录和别名 |
| `agents.defaults.contextTokens` | number | 上下文窗口上限 |
| `agents.defaults.cliBackends` | Record\<string, CliBackendConfig\> | CLI 后端回退 |

#### Workspace & Runtime

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `agents.defaults.workspace` | string | - | Agent 工作目录 |
| `agents.defaults.repoRoot` | string | - | 仓库根目录（覆盖自动检测） |
| `agents.defaults.skipBootstrap` | boolean | - | 跳过 BOOTSTRAP.md 创建 |
| `agents.defaults.bootstrapMaxChars` | number | 20000 | 单个 bootstrap 文件最大字符数 |
| `agents.defaults.bootstrapTotalMaxChars` | number | 150000 | bootstrap 总字符数上限 |
| `agents.defaults.userTimezone` | string (IANA) | - | 用户时区 |
| `agents.defaults.timeFormat` | `"auto" \| "12" \| "24"` | - | 系统提示中的时间格式 |
| `agents.defaults.envelopeTimezone` | `"utc" \| "local" \| "user" \| IANA` | `"utc"` | 信封时区 |
| `agents.defaults.envelopeTimestamp` | `"on" \| "off"` | `"on"` | 包含绝对时间戳 |
| `agents.defaults.envelopeElapsed` | `"on" \| "off"` | `"on"` | 包含经过时间 |

#### Memory & Indexing

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `agents.defaults.memorySearch.enabled` | boolean | true | 启用向量记忆搜索 |
| `agents.defaults.memorySearch.sources` | ("memory" \| "sessions")[] | ["memory"] | 搜索来源 |
| `agents.defaults.memorySearch.extraPaths` | string[] | - | 额外索引路径 |
| `agents.defaults.memorySearch.provider` | `"openai" \| "gemini" \| "local" \| "voyage" \| "mistral"` | - | 嵌入模型提供者 |
| `agents.defaults.memorySearch.model` | string | - | 嵌入模型 ID |
| `agents.defaults.memorySearch.fallback` | string \| "none" | - | 回退提供者 |
| `agents.defaults.memorySearch.remote` | object | - | baseUrl, apiKey, headers, batch 配置 |
| `agents.defaults.memorySearch.local` | object | - | GGUF model path, cache dir |
| `agents.defaults.memorySearch.store` | object | - | driver (sqlite), path, vector extension |
| `agents.defaults.memorySearch.chunking` | object | - | token size, overlap |
| `agents.defaults.memorySearch.sync` | object | - | onSessionStart, onSearch, watch, intervals |
| `agents.defaults.memorySearch.query` | object | - | maxResults, minScore, hybrid, MMR, temporal decay |
| `agents.defaults.contextPruning` | object | - | mode, TTL, cache strategies, tool allow/deny |

#### Thinking & Verbosity

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `agents.defaults.thinkingDefault` | `"off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh"` | 取决于模型 | 推理深度 |
| `agents.defaults.verboseDefault` | `"off" \| "on" \| "full"` | - | 详细程度 |
| `agents.defaults.elevatedDefault` | `"off" \| "on" \| "ask" \| "full"` | - | 提权默认值 |

#### Streaming & Delays

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `agents.defaults.blockStreamingDefault` | `"off" \| "on"` | - | 默认流式级别 |
| `agents.defaults.blockStreamingBreak` | `"text_end" \| "message_end"` | `"text_end"` | 流式边界 |
| `agents.defaults.blockStreamingChunk` | object | - | minChars, maxChars, breakPreference |
| `agents.defaults.blockStreamingCoalesce` | object | - | minChars, maxChars, idleMs |
| `agents.defaults.humanDelay.mode` | `"off" \| "natural" \| "custom"` | - | 人类延迟模式 |
| `agents.defaults.humanDelay.minMs` | number | 800 | 最小延迟 (ms) |
| `agents.defaults.humanDelay.maxMs` | number | 2500 | 最大延迟 (ms) |
| `agents.defaults.typingIntervalSeconds` | number | - | 打字指示器频率 |
| `agents.defaults.typingMode` | `"never" \| "instant" \| "thinking" \| "message"` | - | 何时显示正在输入 |

#### Media & Limits

| 字段 | 类型 | 说明 |
|------|------|------|
| `agents.defaults.mediaMaxMb` | number | 入站媒体最大 MB |
| `agents.defaults.imageMaxDimensionPx` | number (默认 1200) | 图片最大边长 |
| `agents.defaults.timeoutSeconds` | number | Agent 运行超时 |
| `agents.defaults.maxConcurrent` | number (默认 1) | 跨会话最大并发运行数 |

#### Heartbeat

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `agents.defaults.heartbeat.every` | duration string | "30m" | 心跳间隔 |
| `agents.defaults.heartbeat.activeHours` | object | - | start, end, timezone |
| `agents.defaults.heartbeat.model` | string | - | 心跳使用的模型 |
| `agents.defaults.heartbeat.session` | string | "main" | 会话 key |
| `agents.defaults.heartbeat.target` | `"last" \| "none" \| ChannelId` | "last" | 发送目标 |
| `agents.defaults.heartbeat.to` | string | - | 目标覆盖 (E.164 等) |
| `agents.defaults.heartbeat.prompt` | string | - | 自定义心跳提示词 |
| `agents.defaults.heartbeat.ackMaxChars` | number | 30 | HEARTBEAT_OK 后最大字符 |
| `agents.defaults.heartbeat.includeReasoning` | boolean | - | 返回推理内容 |

#### Compaction

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `agents.defaults.compaction.mode` | `"default" \| "safeguard"` | - | 总结模式 |
| `agents.defaults.compaction.reserveTokens` | number | - | Pi 保留 token 目标 |
| `agents.defaults.compaction.keepRecentTokens` | number | - | 保留最近 token 预算 |
| `agents.defaults.compaction.reserveTokensFloor` | number | - | 最小保留 (0=关闭) |
| `agents.defaults.compaction.maxHistoryShare` | number | 0.5 | 历史最大占比 (0.1-0.9) |
| `agents.defaults.compaction.memoryFlush` | object | - | enabled, softThresholdTokens, prompt |

#### Sub-agents

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `agents.defaults.subagents.maxConcurrent` | number | 1 | 子 agent 最大并发 |
| `agents.defaults.subagents.maxSpawnDepth` | number | 1 | 最大嵌套深度 |
| `agents.defaults.subagents.maxChildrenPerAgent` | number | 5 | 每个会话最大子 agent 数 |
| `agents.defaults.subagents.archiveAfterMinutes` | number | 60 | 归档超时 |
| `agents.defaults.subagents.model` | string \| {primary, fallbacks} | - | 子 agent 默认模型 |
| `agents.defaults.subagents.thinking` | string | - | 子 agent thinking 级别 |
| `agents.defaults.subagents.runTimeoutSeconds` | number | - | 运行超时 |

#### Sandbox

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `agents.defaults.sandbox.mode` | `"off" \| "non-main" \| "all"` | - | 沙箱模式 |
| `agents.defaults.sandbox.workspaceAccess` | `"none" \| "ro" \| "rw"` | - | 工作区访问 |
| `agents.defaults.sandbox.scope` | `"session" \| "agent" \| "shared"` | - | 容器作用域 |
| `agents.defaults.sandbox.docker.*` | object | - | image, network, memory, cpus, env, setupCommand 等 |
| `agents.defaults.sandbox.browser.*` | object | - | enabled, image, headless, ports 等 |
| `agents.defaults.sandbox.prune` | object | - | idleHours, maxAgeDays |

### Per-Agent 配置

定义在 `src/config/types.agents.ts`

| 字段 | 类型 | 说明 |
|------|------|------|
| `agents.list[].id` | string (必填) | 唯一 agent 标识 |
| `agents.list[].default` | boolean | 设为默认 agent |
| `agents.list[].name` | string | 显示名称 |
| `agents.list[].workspace` | string | 工作目录 |
| `agents.list[].agentDir` | string | Agent 目录 |
| `agents.list[].model` | string \| {primary, fallbacks} | 每 agent 模型 |
| `agents.list[].skills` | string[] | 技能白名单 (省略=全部, 空=无) |
| `agents.list[].memorySearch` | MemorySearchConfig | 每 agent 记忆搜索覆盖 |
| `agents.list[].humanDelay` | HumanDelayConfig | 每 agent 延迟覆盖 |
| `agents.list[].heartbeat` | HeartbeatConfig | 每 agent 心跳覆盖 |
| `agents.list[].identity` | object | name, theme, emoji, avatar |
| `agents.list[].groupChat` | object | mentionPatterns, historyLimit |
| `agents.list[].subagents` | object | allowAgents[], model |
| `agents.list[].sandbox` | AgentSandboxConfig | 每 agent 沙箱覆盖 |
| `agents.list[].params` | Record\<string, unknown\> | 每 agent stream 参数 |
| `agents.list[].tools` | AgentToolsConfig | 每 agent 工具覆盖 |

### Bindings 配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `bindings[].agentId` | string | 目标 agent ID |
| `bindings[].comment` | string | 文档注释 |
| `bindings[].match.channel` | string | Channel ID (discord, slack 等) |
| `bindings[].match.accountId` | string | 多账号 ID |
| `bindings[].match.peer.kind` | `"direct" \| "group" \| "thread"` | 聊天类型 |
| `bindings[].match.peer.id` | string | 聊天/对等 ID |
| `bindings[].match.guildId` | string | Discord guild ID |
| `bindings[].match.teamId` | string | MS Teams team ID |
| `bindings[].match.roles` | string[] | Discord 角色 ID（基于角色路由） |

---

## 3. Channel 配置

### Slack

定义在 `src/config/types.slack.ts`

#### Account 级别字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | string | - | 多账号显示名称 |
| `enabled` | boolean | true | 启用此账号 |
| `mode` | `"socket" \| "http"` | `"socket"` | 连接模式 |
| `botToken` | string | - | Bot token |
| `appToken` | string | - | App token (socket 模式必需) |
| `userToken` | string | - | 可选用户 token (只读访问) |
| `userTokenReadOnly` | boolean | true | 用户 token 只读 |
| `signingSecret` | string | - | HTTP 模式必需 |
| `webhookPath` | string | /slack/events | Events API 路径 |
| `capabilities` | string[] | - | 能力标签 |
| `requireMention` | boolean | true | 需要 @提及才回复 |
| `groupPolicy` | `"open" \| "disabled" \| "allowlist"` | - | 群组消息处理策略 |
| `dmPolicy` | `"pairing" \| "allowlist" \| "open" \| "disabled"` | - | DM 访问策略 |
| `allowFrom` | (string \| number)[] | - | DM 白名单 |
| `defaultTo` | string | - | 默认发送目标 |
| `allowBots` | boolean | false | 允许其他 bot 触发 |
| `configWrites` | boolean | true | 允许 channel 写操作 |
| `historyLimit` | number | - | 最大 channel 消息上下文 |
| `dmHistoryLimit` | number | - | 最大 DM 轮次上下文 |
| `textChunkLimit` | number | - | 出站消息分块大小 |
| `chunkMode` | `"length" \| "newline"` | `"length"` | 分块模式 |
| `streaming` | `"off" \| "partial" \| "block" \| "progress"` | `"partial"` | 流式输出模式 |
| `nativeStreaming` | boolean | true | 使用 chat.startStream API |
| `blockStreaming` | boolean | - | 启用块流式 |
| `blockStreamingCoalesce` | object | - | minChars, maxChars, idleMs |
| `mediaMaxMb` | number | - | 最大媒体大小 |
| `responsePrefix` | string | - | 出站回复前缀覆盖 |
| `ackReaction` | string | - | 确认反应 (shortcode, 如 "eyes") |
| `replyToMode` | `"off" \| "first" \| "all"` | - | 回复模式 |
| `markdown.tables` | `"off" \| "bullets" \| "code"` | - | 表格渲染方式 |
| `commands.native` | - | - | 原生命令开关 |
| `commands.nativeSkills` | - | - | 技能命令开关 |
| `dangerouslyAllowNameMatching` | boolean | false | 允许名称匹配 |

#### Slack Actions (工具能力)

| 字段 | 类型 | 说明 |
|------|------|------|
| `actions.reactions` | - | 表情反应 |
| `actions.messages` | - | 发送消息 |
| `actions.pins` | - | 置顶消息 |
| `actions.search` | - | 搜索消息 |
| `actions.permissions` | - | 权限查看 |
| `actions.memberInfo` | - | 成员信息 |
| `actions.channelInfo` | - | 频道信息 |
| `actions.emojiList` | - | Emoji 列表 |

#### Slack Thread 配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `thread.historyScope` | `"thread" \| "channel"` | `"thread"` | 线程历史范围 |
| `thread.inheritParent` | boolean | false | 继承父消息上下文 |
| `thread.initialHistoryLimit` | number | 20 | 初始历史限制 |

#### Slack DM 配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dm.enabled` | boolean | true | 接受 DM |
| `dm.policy` | DmPolicy | "pairing" | DM 策略 |
| `dm.allowFrom` | (string \| number)[] | - | 发送者白名单 |
| `dm.groupEnabled` | boolean | false | 启用群组 DM |
| `dm.groupChannels` | (string \| number)[] | - | 群组 DM 频道 |

#### Slack Slash Command

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `slashCommand.enabled` | boolean | false | 启用斜杠命令 |
| `slashCommand.name` | string | "openclaw" | 命令名称 |
| `slashCommand.sessionPrefix` | string | "slack:slash" | 会话前缀 |
| `slashCommand.ephemeral` | boolean | true | 临时消息 |

#### Slack Per-Channel 配置

| 字段 | 说明 |
|------|------|
| `channels[id].enabled` | 启用/禁用特定频道 |
| `channels[id].requireMention` | 该频道是否需要 @提及 |
| `channels[id].tools` | allow, alsoAllow, deny |
| `channels[id].toolsBySender` | 按发送者配置工具策略 |
| `channels[id].allowBots` | 允许 bot |
| `channels[id].users` | 用户白名单 |
| `channels[id].skills` | 技能白名单 |
| `channels[id].systemPrompt` | 频道级系统提示词 |

#### Slack 多账号

所有上述字段均支持通过 `channels.slack.accounts[id].*` 按账号配置。

#### Slack Heartbeat & Reactions

| 字段 | 类型 | 说明 |
|------|------|------|
| `heartbeat.showOk` | - | 显示心跳正常 |
| `heartbeat.showAlerts` | - | 显示告警 |
| `heartbeat.useIndicator` | - | 使用指示器 |
| `reactionNotifications` | `"off" \| "own" \| "all" \| "allowlist"` | 反应通知范围 (默认 "own") |
| `reactionAllowlist` | (string \| number)[] | 反应白名单 |

---

### Discord

定义在 `src/config/types.discord.ts`

#### Account 级别字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | string | - | 显示名称 |
| `enabled` | boolean | true | 启用 |
| `token` | string | - | Bot token |
| `proxy` | string | - | WebSocket HTTP(S) 代理 |
| `capabilities` | string[] | - | 能力标签 |
| `requireMention` | boolean | true | 需要 @提及才回复 |
| `groupPolicy` | `"open" \| "disabled" \| "allowlist"` | - | 群组消息策略 |
| `dmPolicy` | DmPolicy | - | DM 访问策略 |
| `allowFrom` | string[] | - | DM 白名单 |
| `defaultTo` | string | - | 默认发送目标 |
| `allowBots` | boolean | false | 允许其他 bot 触发 |
| `configWrites` | boolean | true | 允许配置写操作 |
| `textChunkLimit` | number | 2000 | 每消息字符上限 |
| `chunkMode` | `"length" \| "newline"` | `"length"` | 分块模式 |
| `maxLinesPerMessage` | number | 17 | 每消息软行数上限 |
| `historyLimit` | number | - | 最大上下文消息数 |
| `dmHistoryLimit` | number | - | DM 上下文轮次 |
| `mediaMaxMb` | number | - | 最大媒体 MB |
| `streaming` | `"off" \| "partial" \| "block" \| "progress"` | - | 流式输出 |
| `blockStreaming` | boolean | - | 启用块流式 |
| `draftChunk` | object | - | minChars, maxChars, breakPreference |
| `blockStreamingCoalesce` | object | - | minChars, maxChars, idleMs |
| `replyToMode` | `"off" \| "first" \| "all"` | - | 回复模式 |
| `responsePrefix` | string | - | 出站回复前缀 |
| `ackReaction` | string | - | 确认反应 (Unicode emoji) |
| `activity` | string | - | Bot 活动文字 |
| `status` | `"online" \| "dnd" \| "idle" \| "invisible"` | - | Bot 状态 |
| `activityType` | 0-5 | - | 活动类型 |
| `activityUrl` | string | - | 流媒体 URL |
| `markdown.tables` | - | - | 表格渲染 |
| `commands.native` | - | - | 原生命令 |
| `commands.nativeSkills` | - | - | 技能命令 |
| `dangerouslyAllowNameMatching` | boolean | false | 允许名称匹配 |
| `retry` | object | - | attempts, minDelayMs, maxDelayMs, jitter |

#### Discord Actions (工具能力)

| 字段 | 说明 |
|------|------|
| `actions.reactions` | 表情反应 |
| `actions.stickers` | 贴纸 |
| `actions.polls` | 投票 |
| `actions.permissions` | 权限管理 |
| `actions.messages` | 消息管理 |
| `actions.threads` | 线程管理 |
| `actions.pins` | 置顶 |
| `actions.search` | 搜索 |
| `actions.memberInfo` | 成员信息 |
| `actions.roleInfo` | 角色信息 |
| `actions.roles` | 角色管理 |
| `actions.channelInfo` | 频道信息 |
| `actions.voiceStatus` | 语音状态 |
| `actions.events` | 事件管理 |
| `actions.moderation` | 管理 (ban/kick 等) |
| `actions.emojiUploads` | Emoji 上传 |
| `actions.stickerUploads` | 贴纸上传 |
| `actions.channels` | 频道管理 |
| `actions.presence` | 在线状态 |

#### Discord Guild 配置

| 字段 | 说明 |
|------|------|
| `guilds[id].slug` | Guild 别名 |
| `guilds[id].requireMention` | 该 guild 是否需要 @提及 |
| `guilds[id].tools` | 工具策略 |
| `guilds[id].toolsBySender` | 按发送者工具策略 |
| `guilds[id].reactionNotifications` | 反应通知范围 |
| `guilds[id].users` | 用户白名单 |
| `guilds[id].roles` | 角色白名单 |
| `guilds[id].channels[channelId].*` | 每频道配置 (allow, requireMention, tools, skills, systemPrompt, users, roles 等) |

#### Discord DM 配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dm.enabled` | boolean | true | 接受 DM |
| `dm.policy` | DmPolicy | "pairing" | DM 策略 |
| `dm.allowFrom` | string[] | - | 发送者白名单 |
| `dm.groupEnabled` | boolean | false | 启用群组 DM |
| `dm.groupChannels` | string[] | - | 群组 DM 频道 |
| `dm.replyToMode` | string | - | 回复模式 |

#### Discord 高级功能

| 字段 | 类型 | 说明 |
|------|------|------|
| `execApprovals.enabled` | boolean | 代码执行审批 |
| `execApprovals.approvers` | - | 审批者 |
| `execApprovals.target` | - | 审批消息目标 |
| `agentComponents.enabled` | boolean | Agent 组件 |
| `ui.components.accentColor` | string | UI 强调色 |
| `slashCommand.ephemeral` | boolean | 斜杠命令临时消息 |
| `threadBindings.enabled` | boolean | 线程绑定 |
| `threadBindings.ttlHours` | number (默认 24) | 绑定 TTL |
| `threadBindings.spawnSubagentSessions` | boolean | 生成子 agent 会话 |
| `intents.presence` | boolean | 在线状态 intent |
| `intents.guildMembers` | boolean | 成员 intent |
| `voice.enabled` | boolean | 语音功能 |
| `voice.autoJoin` | string[] | 自动加入语音频道 |
| `voice.tts` | object | 语音合成配置 |
| `pluralkit` | object | PluralKit 身份解析 |

#### Discord 多账号

所有上述字段均支持通过 `channels.discord.accounts[id].*` 按账号配置。

---

### Telegram

定义在 `src/config/types.telegram.ts`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `botToken` | string | - | Bot token |
| `tokenFile` | string | - | Token 文件路径 |
| `dmPolicy` | DmPolicy | "pairing" | DM 策略 |
| `groupPolicy` | `"open" \| "disabled" \| "allowlist"` | - | 群组策略 |
| `allowFrom` | (string \| number)[] | - | DM 白名单 (Telegram user IDs) |
| `groupAllowFrom` | (string \| number)[] | - | 群组发送者白名单 |
| `defaultTo` | string \| number | - | 默认发送目标 |
| `customCommands` | [{command, description}] | - | 自定义命令 |
| `textChunkLimit` | number | 4000 | 分块大小 |
| `streaming` | string | - | 流式模式 |
| `webhookUrl` | string | - | Webhook URL |
| `webhookSecret` | string | - | Webhook 密钥 |
| `webhookPath` | string | - | Webhook 路径 |
| `webhookHost` | string | 127.0.0.1 | Webhook 主机 |
| `webhookPort` | number | 8787 | Webhook 端口 |
| `proxy` | string | - | HTTP(S) 代理 |
| `reactionLevel` | `"off" \| "ack" \| "minimal" \| "extensive"` | "ack" | 反应级别 |
| `linkPreview` | boolean | true | 链接预览 |
| `groups[id].*` | - | - | 每群组配置 (requireMention, tools, skills, topics 等) |

### WhatsApp

定义在 `src/config/types.whatsapp.ts`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `authDir` | string | - | 认证状态目录 |
| `selfChatMode` | boolean | - | 同手机设置 |
| `allowFrom` | string[] | - | E.164 DM 白名单 |
| `defaultTo` | string | - | E.164 或 group JID |
| `groupAllowFrom` | string[] | - | 群组发送者白名单 |
| `textChunkLimit` | number | 4000 | 分块大小 |
| `mediaMaxMb` | number | 50 | 媒体大小上限 |
| `debounceMs` | number | - | 批量快速消息 |
| `sendReadReceipts` | boolean | true | 发送已读回执 |
| `ackReaction.direct` | boolean | true | DM 确认反应 |
| `ackReaction.group` | `"always" \| "mentions" \| "never"` | "mentions" | 群组确认反应 |
| `groups[id].*` | - | - | 每群组配置 |

### Signal

| 字段 | 说明 |
|------|------|
| `account` | Signal 账号 |
| `httpUrl` / `httpHost` / `httpPort` | Signal HTTP 服务 |
| `cliPath` | signal-cli 路径 |
| `autoStart` | 自动启动 |
| `receiveMode` | 接收模式 |
| `ignoreAttachments` / `ignoreStories` | 忽略选项 |

### iMessage

| 字段 | 说明 |
|------|------|
| `cliPath` / `dbPath` | 命令行和数据库路径 |
| `remoteHost` | 远程主机 |
| `service` / `region` | 服务和区域 |
| `attachmentRoots` | 附件根目录 |

### Google Chat

| 字段 | 说明 |
|------|------|
| `serviceAccount` / `serviceAccountFile` | 服务账号凭据 |
| `audienceType` / `audience` | 受众类型 |
| `webhookPath` / `webhookUrl` | Webhook 配置 |
| `botUser` / `typingIndicator` | Bot 用户和打字指示 |

### MS Teams

| 字段 | 说明 |
|------|------|
| `appId` / `appPassword` / `tenantId` | Teams 应用凭据 |
| `webhook` | Webhook 配置 |
| `teams[id].channels` | 每 team/channel 配置 |

---

## 4. Tools 配置

定义在 `src/config/types.tools.ts`

### 基础工具策略

| 字段 | 类型 | 说明 |
|------|------|------|
| `tools.profile` | `"minimal" \| "coding" \| "messaging" \| "full"` | 基础工具集 |
| `tools.allow` | string[] | 白名单 |
| `tools.alsoAllow` | string[] | 额外白名单 (与 profile 合并) |
| `tools.deny` | string[] | 黑名单 |
| `tools.byProvider` | Record\<string, ToolPolicyConfig\> | 按 provider 覆盖 |

### Web 搜索

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `tools.web.search.enabled` | boolean | 取决于 API key | 启用 Web 搜索 |
| `tools.web.search.provider` | `"brave" \| "perplexity" \| "grok" \| "gemini" \| "kimi"` | - | 搜索提供者 |
| `tools.web.search.apiKey` | string | - | API key |
| `tools.web.search.maxResults` | number | 1-10 | 最大结果数 |
| `tools.web.search.timeoutSeconds` | number | - | 超时 |
| `tools.web.search.cacheTtlMinutes` | number | - | 缓存 TTL |
| `tools.web.search.perplexity.*` | object | - | apiKey, baseUrl, model |

### Exec 工具

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `tools.exec.host` | `"sandbox" \| "gateway" \| "node"` | `"sandbox"` | 执行主机 |
| `tools.exec.security` | `"deny" \| "allowlist" \| "full"` | `"deny"` | 安全策略 |
| `tools.exec.ask` | `"off" \| "on-miss" \| "always"` | `"on-miss"` | 审批模式 |
| `tools.exec.node` | string | - | 默认节点绑定 |
| `tools.exec.pathPrepend` | string[] | - | 额外 PATH 目录 |
| `tools.exec.safeBins` | string[] | - | 安全 stdin-only 二进制 |
| `tools.exec.safeBinTrustedDirs` | string[] | - | 受信目录 |
| `tools.exec.backgroundMs` | number | - | 自动后台 (ms) |
| `tools.exec.timeoutSec` | number | - | 自动 kill 超时 |
| `tools.exec.applyPatch.enabled` | boolean | - | 启用 patch 应用 |
| `tools.exec.applyPatch.workspaceOnly` | boolean | - | 仅限工作区 |

### 文件系统工具

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `tools.fs.workspaceOnly` | boolean | false | 限制为仅工作区 |

### 媒体理解

| 字段 | 说明 |
|------|------|
| `tools.media.concurrency` | 最大并发 |
| `tools.media.image.*` | 图片理解 (enabled, scope, maxBytes, models 等) |
| `tools.media.audio.*` | 音频理解 |
| `tools.media.video.*` | 视频理解 |

### 链接工具

| 字段 | 类型 | 说明 |
|------|------|------|
| `tools.link.enabled` | boolean | 启用链接预览 |
| `tools.link.maxLinks` | number | 最大链接数 |
| `tools.link.timeoutSeconds` | number | 超时 |

### 循环检测

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `tools.loopDetection.enabled` | boolean | false | 启用循环检测 |
| `tools.loopDetection.historySize` | number | 30 | 历史大小 |
| `tools.loopDetection.warningThreshold` | number | 10 | 警告阈值 |
| `tools.loopDetection.criticalThreshold` | number | 20 | 严重阈值 |
| `tools.loopDetection.globalCircuitBreakerThreshold` | number | 30 | 全局熔断阈值 |

### Per-Agent 工具覆盖

| 字段 | 说明 |
|------|------|
| `agents.list[].tools.profile` | 每 agent 工具集 |
| `agents.list[].tools.allow/deny` | 每 agent 白/黑名单 |
| `agents.list[].tools.exec` | 每 agent exec 覆盖 |
| `agents.list[].tools.fs` | 每 agent fs 覆盖 |
| `agents.list[].tools.elevated` | 提权工具 |
| `agents.list[].tools.sandbox.tools.allow/deny` | 沙箱工具 |

### Group/Channel 工具策略

每个 channel 和频道都支持：
- `tools` — allow, alsoAllow, deny
- `toolsBySender` — Record\<string, GroupToolPolicyConfig\>: 按发送者 ID 配置

---

## 5. Models 配置

定义在 `src/config/types.models.ts`

### Provider 配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `models.mode` | `"merge" \| "replace"` (默认 "merge") | 与默认模型合并或替换 |
| `models.providers[id].baseUrl` | string (必填) | API 基础 URL |
| `models.providers[id].apiKey` | string | API key |
| `models.providers[id].auth` | `"api-key" \| "aws-sdk" \| "oauth" \| "token"` | 认证方式 |
| `models.providers[id].api` | ModelApi | API 协议 |
| `models.providers[id].headers` | Record\<string, string\> | 自定义请求头 |
| `models.providers[id].authHeader` | string | 认证头名称 |

### Model 定义

| 字段 | 类型 | 说明 |
|------|------|------|
| `models[].id` | string | 模型标识 |
| `models[].name` | string | 显示名称 |
| `models[].api` | `"openai-completions" \| "openai-responses" \| "anthropic-messages" \| "google-generative-ai" \| "github-copilot" \| "bedrock-converse-stream" \| "ollama"` | API 协议 |
| `models[].reasoning` | boolean | 支持推理能力 |
| `models[].input` | ("text" \| "image")[] | 支持的输入类型 |
| `models[].cost` | {input, output, cacheRead, cacheWrite} | 成本 ($/1M tokens) |
| `models[].contextWindow` | number | 上下文窗口 tokens |
| `models[].maxTokens` | number | 最大输出 tokens |
| `models[].headers` | Record\<string, string\> | 每模型请求头 |
| `models[].compat.supportsStore` | boolean | 支持 store 参数 |
| `models[].compat.supportsDeveloperRole` | boolean | 支持 developer role |
| `models[].compat.supportsReasoningEffort` | boolean | 支持推理努力级别 |
| `models[].compat.supportsUsageInStreaming` | boolean | 流式中支持 usage |
| `models[].compat.supportsStrictMode` | boolean | 支持 strict mode |
| `models[].compat.maxTokensField` | string | max_tokens 字段名 |
| `models[].compat.thinkingFormat` | string | thinking 格式 |
| `models[].compat.requiresToolResultName` | boolean | 工具结果需要 name |
| `models[].compat.requiresAssistantAfterToolResult` | boolean | 工具结果后需要 assistant |
| `models[].compat.requiresThinkingAsText` | boolean | thinking 作为文本 |
| `models[].compat.requiresMistralToolIds` | boolean | Mistral 工具 ID 格式 |

### Bedrock Discovery

| 字段 | 类型 | 说明 |
|------|------|------|
| `models.bedrockDiscovery.enabled` | boolean | 启用 Bedrock 自动发现 |
| `models.bedrockDiscovery.region` | string | AWS 区域 |
| `models.bedrockDiscovery.providerFilter` | string[] | 提供者过滤 |
| `models.bedrockDiscovery.refreshInterval` | number | 刷新间隔 |

---

## 6. Messages 配置

定义在 `src/config/types.messages.ts`

### 回复前缀

| 字段 | 类型 | 说明 |
|------|------|------|
| `messages.responsePrefix` | string | 自动添加到所有回复的前缀 |

支持的变量：`{model}`, `{modelFull}`, `{provider}`, `{thinkingLevel}`, `{identity.name}` 等。特殊值 `"auto"` 从 agent identity 推导。

### 群聊

| 字段 | 类型 | 说明 |
|------|------|------|
| `messages.groupChat.mentionPatterns` | string[] | 自定义提及模式 |
| `messages.groupChat.historyLimit` | number | 最大上下文消息数 |

### 消息队列

| 字段 | 类型 | 说明 |
|------|------|------|
| `messages.queue.mode` | QueueMode | 消息队列策略 |
| `messages.queue.byChannel` | Record | 每 channel 队列模式 |
| `messages.queue.debounceMs` | number | 防抖窗口 |
| `messages.queue.cap` | number | 最大排队消息数 |
| `messages.queue.drop` | `"old" \| "new" \| "summarize"` | 丢弃策略 |

队列模式：`"steer"`, `"followup"`, `"collect"`, `"steer-backlog"`, `"steer+backlog"`, `"queue"`, `"interrupt"`

### 确认反应

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `messages.ackReaction` | string | - | Emoji (空=禁用) |
| `messages.ackReactionScope` | `"group-mentions" \| "group-all" \| "direct" \| "all"` | "group-mentions" | 范围 |
| `messages.removeAckAfterReply` | boolean | false | 回复后移除确认 |

### 状态反应

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `messages.statusReactions.enabled` | boolean | false | 启用状态反应 |
| `messages.statusReactions.emojis` | object | - | thinking, tool, coding, web, done, error 等 |
| `messages.statusReactions.timing` | object | - | debounceMs, stallSoftMs, stallHardMs 等 |

### 其他

| 字段 | 类型 | 说明 |
|------|------|------|
| `messages.suppressToolErrors` | boolean (默认 false) | 抑制工具错误 |
| `messages.tts` | TtsConfig | 文本转语音配置 |
| `messages.broadcast[peerId]` | string[] | 处理特定 peer 消息的 agent 列表 |

---

## 7. Commands 配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `commands.native` | `"auto" \| boolean` | "auto" | 注册原生命令 |
| `commands.nativeSkills` | `"auto" \| boolean` | "auto" | 注册技能命令 |
| `commands.text` | boolean | true | 启用文本命令解析 |
| `commands.bash` | boolean | false | 允许 `!` / `/bash` |
| `commands.bashForegroundMs` | number | 2000 | 前台超时 |
| `commands.config` | boolean | false | 允许 `/config` 命令 |
| `commands.debug` | boolean | false | 允许 `/debug` 命令 |
| `commands.restart` | boolean | true | 允许重启命令 |
| `commands.useAccessGroups` | boolean | true | 强制 channel 白名单 |
| `commands.ownerAllowFrom` | (string \| number)[] | - | 管理员白名单 |
| `commands.ownerDisplay` | `"raw" \| "hash"` | "raw" | 管理员 ID 显示方式 |
| `commands.ownerDisplaySecret` | string | - | ID 哈希密钥 |
| `commands.allowFrom` | Record\<string, (string \| number)[]\> | - | 每 provider 斜杠命令白名单 |

---

## 8. Session 配置

### Scope & Keys

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `session.scope` | `"per-sender" \| "global"` | "per-sender" | 会话作用域 |
| `session.dmScope` | `"main" \| "per-peer" \| "per-channel-peer" \| "per-account-channel-peer"` | "main" | DM 会话范围 |
| `session.identityLinks` | Record\<string, string[]\> | - | 跨平台身份关联 |
| `session.mainKey` | string | - | 覆盖默认主会话 key |
| `session.typingIntervalSeconds` | number | - | 打字指示频率 |
| `session.typingMode` | `"never" \| "instant" \| "thinking" \| "message"` | - | 打字指示时机 |

### Reset

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `session.reset.mode` | `"daily" \| "idle"` | "daily" | 重置模式 |
| `session.reset.atHour` | number (0-23) | - | 每日重置时间 |
| `session.reset.idleMinutes` | number | - | 空闲超时 |
| `session.resetByType.direct/group/thread` | SessionResetConfig | - | 按类型配置 |
| `session.resetByChannel[channelId]` | SessionResetConfig | - | 按 channel 配置 |
| `session.resetTriggers` | string[] | - | 自定义重置触发器 |

### Send Policy

| 字段 | 类型 | 说明 |
|------|------|------|
| `session.sendPolicy.default` | `"allow" \| "deny"` | 默认发送策略 |
| `session.sendPolicy.rules[]` | object | action, match (channel, chatType, keyPrefix) |

### 维护

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `session.maintenance.mode` | `"enforce" \| "warn"` | "warn" | 维护模式 |
| `session.maintenance.pruneAfter` | string \| number | "30d" | 清理阈值 |
| `session.maintenance.maxEntries` | number | 500 | 最大条目 |
| `session.maintenance.rotateBytes` | number \| string | "10mb" | 轮换大小 |
| `session.maintenance.maxDiskBytes` | number \| string | - | 磁盘上限 |

---

## 9. Logging & Diagnostics

### Logging

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `logging.level` | `"silent" \| "fatal" \| "error" \| "warn" \| "info" \| "debug" \| "trace"` | - | 日志级别 |
| `logging.file` | string | - | 日志文件路径 |
| `logging.maxFileBytes` | number | 500MB | 日志文件大小上限 |
| `logging.consoleLevel` | - | - | 控制台日志级别 |
| `logging.consoleStyle` | `"pretty" \| "compact" \| "json"` | - | 控制台样式 |
| `logging.redactSensitive` | `"off" \| "tools"` | "tools" | 敏感数据脱敏 |
| `logging.redactPatterns` | string[] | - | 自定义脱敏正则 |

### Diagnostics

| 字段 | 类型 | 说明 |
|------|------|------|
| `diagnostics.enabled` | boolean | 启用诊断 |
| `diagnostics.flags` | string[] | Ad-hoc 标志 |
| `diagnostics.otel.*` | object | OpenTelemetry: enabled, endpoint, traces, metrics, logs, sampleRate |
| `diagnostics.cacheTrace.*` | object | 缓存跟踪: enabled, filePath, includeMessages |

---

## 10. Authentication

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `auth.profiles[id]` | object | - | provider, mode, email |
| `auth.order[provider]` | string[] | - | Profile 优先级 |
| `auth.cooldowns.billingBackoffHours` | number | 5 | 计费回退时间 |
| `auth.cooldowns.billingMaxHours` | number | 24 | 最大回退时间 |
| `auth.cooldowns.failureWindowHours` | number | 24 | 失败窗口 |

---

## 11. Hooks

定义在 `src/config/types.hooks.ts`

| 字段 | 类型 | 说明 |
|------|------|------|
| `hooks.enabled` | boolean | 启用 hooks |
| `hooks.path` | string | Hooks 目录 |
| `hooks.token` | string | Bearer token |
| `hooks.defaultSessionKey` | string | 默认会话 key |
| `hooks.maxBodyBytes` | number | 最大请求体 |
| `hooks.presets` | string[] | Hook 预设名 |
| `hooks.transformsDir` | string | Transform 模块目录 |

### Hook Mapping

| 字段 | 说明 |
|------|------|
| `hooks.mappings[].id` | Hook ID |
| `hooks.mappings[].match` | path, source 匹配 |
| `hooks.mappings[].action` | "wake" \| "agent" |
| `hooks.mappings[].agentId` | 目标 agent |
| `hooks.mappings[].sessionKey` | 会话 key |
| `hooks.mappings[].messageTemplate` / `textTemplate` | 消息模板 |
| `hooks.mappings[].deliver` | 投递配置 |
| `hooks.mappings[].model` / `thinking` | 模型和推理级别 |
| `hooks.mappings[].timeoutSeconds` | 超时 |

### Gmail Hook

| 字段 | 说明 |
|------|------|
| `hooks.gmail.account` / `label` / `topic` | Gmail 配置 |
| `hooks.gmail.pushToken` / `hookUrl` | 推送配置 |
| `hooks.gmail.includeBody` / `maxBytes` | 内容配置 |
| `hooks.gmail.serve` | 本地服务配置 |
| `hooks.gmail.tailscale` | Tailscale 暴露 |

---

## 12. Browser

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `browser.enabled` | boolean | - | 启用浏览器 |
| `browser.evaluateEnabled` | boolean | true | 允许 act:evaluate |
| `browser.cdpUrl` | string | - | 远程 CDP 端点 |
| `browser.executablePath` | string | - | 自定义 Chrome 路径 |
| `browser.headless` | boolean | false | 无头模式 |
| `browser.noSandbox` | boolean | false | 无沙箱 |
| `browser.defaultProfile` | string | "chrome" | 默认配置 |
| `browser.profiles[name]` | object | - | cdpPort, driver, color |
| `browser.ssrfPolicy.*` | object | - | 网络安全策略 |
| `browser.extraArgs` | string[] | - | Chrome 启动参数 |

---

## 13. Skills & Plugins

### Skills

| 字段 | 类型 | 说明 |
|------|------|------|
| `skills.allowBundled` | string[] | 内置技能白名单 |
| `skills.load.extraDirs` | string[] | 额外技能目录 |
| `skills.load.watch` | boolean | 监听变化 |
| `skills.install.preferBrew` | boolean | 偏好 Homebrew |
| `skills.install.nodeManager` | `"npm" \| "pnpm" \| "yarn" \| "bun"` | 包管理器 |
| `skills.limits.*` | object | maxCandidates, maxSkillsLoaded, maxPromptChars 等 |
| `skills.entries[id]` | object | enabled, apiKey, env, config |

### Plugins

| 字段 | 类型 | 说明 |
|------|------|------|
| `plugins.enabled` | boolean | 启用插件 |
| `plugins.allow` / `deny` | string[] | 白/黑名单 |
| `plugins.load.paths` | string[] | 插件搜索路径 |
| `plugins.slots.memory` | string | 记忆插件 ("none" 禁用) |
| `plugins.entries[id]` | object | enabled, config |

---

## 14. Cron

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `cron.enabled` | boolean | - | 启用定时任务 |
| `cron.store` | string | - | 会话存储 |
| `cron.maxConcurrentRuns` | number | - | 最大并发 |
| `cron.webhookToken` | string | - | Bearer token |
| `cron.sessionRetention` | string \| false | "24h" | 完成后保留时间 |
| `cron.runLog.maxBytes` | number \| string | "2mb" | 日志大小上限 |
| `cron.runLog.keepLines` | number | 2000 | 保留行数 |

---

## 15. Memory

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `memory.backend` | `"builtin" \| "qmd"` | "builtin" | 记忆后端 |
| `memory.citations` | `"auto" \| "on" \| "off"` | "auto" | 引用标注 |
| `memory.qmd.*` | object | - | QMD 配置: command, searchMode, paths, sessions 等 |

---

## 16. Approvals

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `approvals.exec.enabled` | boolean | false | 启用执行审批 |
| `approvals.exec.mode` | `"session" \| "targets" \| "both"` | "session" | 审批模式 |
| `approvals.exec.agentFilter` | string[] | - | Agent 过滤 |
| `approvals.exec.sessionFilter` | string[] | - | 会话 key 过滤 |
| `approvals.exec.targets[]` | object | - | channel, to, accountId, threadId |

---

## 17. 其他

### Canvas Host

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `canvasHost.enabled` | boolean | - | 启用 canvas host |
| `canvasHost.root` | string | ~/.openclaw/workspace/canvas | 服务目录 |
| `canvasHost.port` | number | 18793 | HTTP 端口 |
| `canvasHost.liveReload` | boolean | true | 实时重载 |

### Talk (ElevenLabs 语音)

| 字段 | 类型 | 说明 |
|------|------|------|
| `talk.voiceId` | string | 默认语音 ID |
| `talk.voiceAliases` | Record\<string, string\> | 语音别名映射 |
| `talk.modelId` | string | ElevenLabs 模型 |
| `talk.outputFormat` | string | 输出格式 (如 mp3_44100_128) |
| `talk.apiKey` | string | API key |
| `talk.interruptOnSpeech` | boolean (默认 true) | 用户说话时停止 |

### UI

| 字段 | 类型 | 说明 |
|------|------|------|
| `ui.seamColor` | string (hex) | UI 强调色 |
| `ui.assistant.name` | string (≤50 chars) | 助手名称 |
| `ui.assistant.avatar` | string | Emoji/文本/URL/data URI (≤200 chars) |

### Update

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `update.channel` | `"stable" \| "beta" \| "dev"` | - | 更新渠道 |
| `update.checkOnStart` | boolean | - | 启动时检查更新 |
| `update.auto.enabled` | boolean | false | 自动更新 |

### Env Substitution

| 字段 | 类型 | 说明 |
|------|------|------|
| `env.shellEnv.enabled` | boolean | 从 login shell 导入 |
| `env.shellEnv.timeoutMs` | number (默认 15000) | 超时 |
| `env.vars` | Record\<string, string\> | 内联环境变量 |

### Web Provider

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `web.enabled` | boolean | true | 启用 Web provider |
| `web.heartbeatSeconds` | number | - | 心跳间隔 |
| `web.reconnect.*` | object | - | 重连策略 |

---

## Nexu 集成优先级建议

### 已集成

| 字段 | 状态 |
|------|------|
| `gateway.port/mode/bind/auth/reload/controlUi` | ✅ |
| `agents.list[].id/name/default/model` | ✅ |
| `channels.slack/discord` 基础字段 | ✅ |
| `models.providers` (LiteLLM) | ✅ |
| `bindings[].agentId/match.channel/accountId` | ✅ |
| `commands.native/nativeSkills/restart/ownerDisplay` | ✅ |
| `tools.exec.security/ask/host` | ✅ |

### 高优先级 — 用户体验

| 字段 | 说明 | 理由 |
|------|------|------|
| `agents.defaults.systemPrompt` | 系统提示词 | 用户自定义 bot 人设的核心需求 |
| `agents.defaults.humanDelay` | 模拟打字延迟 | 让 bot 回复更自然 |
| `agents.defaults.thinkingDefault` | thinking 级别 | 控制推理深度和成本 |
| `channels.*.streaming` | 流式输出控制 | Discord 可用 block, Slack 用 partial |
| `channels.discord.requireMention` | @提及才回复 | 群聊控制 |
| `channels.discord.activity/status` | Bot 状态文字 | "Playing xxx" 等展示 |
| `messages.responsePrefix` | 回复前缀 | 标识用哪个模型回复 |
| `session.scope` | per-sender / global | 独立对话还是共享上下文 |
| `session.reset.mode/idleMinutes` | 会话重置 | idle 超时自动清上下文 |

### 中优先级 — 安全和管控

| 字段 | 说明 |
|------|------|
| `tools.profile` | 工具集 (minimal/coding/messaging/full) |
| `tools.allow/deny` | 细粒度工具白/黑名单 |
| `tools.web.search` | Web 搜索开关和 provider |
| `commands.ownerAllowFrom` | 管理员命令白名单 |
| `channels.*.allowBots` | 允许其他 bot 触发 |
| `approvals.exec` | 代码执行审批流 |

### 低优先级 — 高级能力

| 字段 | 说明 |
|------|------|
| `agents.defaults.memorySearch` | 向量记忆搜索 |
| `agents.defaults.sandbox` | Docker 沙箱执行 |
| `agents.defaults.subagents` | 子 agent 并发 |
| `agents.defaults.heartbeat` | 定时心跳消息 |
| `bindings[].match.guildId/roles` | 按 guild/角色路由 |
| `cron` | 定时任务 |
| `hooks` | Webhook 触发 agent |
| `browser` | 浏览器自动化 |
| `talk` | ElevenLabs 语音 |

### Schema 注意事项

当前 `packages/shared/src/schemas/openclaw-config.ts` 的 Zod schema 很精简，很多字段会被 `.parse()` strip 掉。对需要透传的配置区块，建议使用 `.passthrough()` 避免丢失字段（参考已有的 `commandsConfigSchema.passthrough()` 用法）。
