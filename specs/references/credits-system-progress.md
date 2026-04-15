# Credits System — 错误提示 & Compaction 反馈进度

## PR

https://github.com/nexu-io/nexu/pull/834
分支：`feat/credits-system`

## 已完成

### 1. LLM 错误文案 i18n（13 种 link error codes）
- **Patch 位置**：`prepare-openclaw-sidecar.mjs` → `formatRawAssistantErrorForUi()`
- **原理**：在 OpenClaw 的错误文本生成源头注入 `[code=xxx]` 匹配 + 中英文文案映射
- **Locale 来源**：`nexu-credit-guard-state.json`（controller `doSync()` 写入，mtime 缓存热读）
- **ESM 兼容**：helper bundles 需要 `import { readFileSync as __nexuRFS, statSync as __nexuSS } from "node:fs"` （有 `path` 默认导入的用 `path.join`，没有的用 `import __nexuPath from "node:path"`）
- **覆盖的 error codes**：`missing_api_key`, `invalid_api_key`, `forbidden_api_key`, `insufficient_credits`, `usage_limit_exceeded`, `invalid_json`, `invalid_model`, `invalid_request`, `model_not_found`, `request_too_large`, `internal_error`, `streaming_unsupported`, `upstream_error`
- **依赖**：link 服务需在 `error.message` 中带 `[code=xxx]` 前缀

### 2. Error priority patch
- **问题**：`lastAssistant.errorMessage`（原始 provider 错误）优先于 `formattedAssistantErrorText`（我们的格式化文案）
- **Patch**：交换优先级，让格式化文案优先
- **两处 patch**：
  - `assistantErrorText` 赋值（`reply-*.js`）
  - failover error 构造（`reply-*.js`）— 把 `lastAssistant?.errorMessage` 移到 fallback 位置

### 3. Context overflow 文案替换
- **原文**：`"Context limit exceeded. I've reset our conversation to start fresh..."`
- **替换为**：`"当前对话内容已超出模型处理上限，自动整理未能成功，已为你重置会话。请重新发送消息继续使用。"`
- **覆盖 bundles**：`reply-*.js`, `compact-*.js`, `pi-embedded-*.js`（所有包含此文本的 dist 文件）
- **注意**：`reply-*.js` 里只有 1 处（during compaction），`compact-*.js` 和 `pi-embedded-*.js` 各有 2 处

### 4. Fast-exit failover loop
- **问题**：内层 failover 循环最多 160 次迭代 + backoff，provider 持续报错时用户等几分钟
- **Patch**：在 `const authFailure = isAuthAssistantError(lastAssistant)` 后注入计数器，连续 2 次失败后 `break`
- **覆盖**：`reply-*.js` + `compact-*.js` + `pi-embedded-*.js`

### 5. Empty payloads fallback
- **问题**：agent run 失败后 `payloadArray` 为空 → `return` 不投递任何消息 → bot 沉默
- **两层 patch**：
  - `const payloadArray = runResult.payloads ?? []; if (payloadArray.length === 0) return;` → push error text 作为 fallback
  - `return { kind: "success", runId, runResult, ...}` → 检查 `runResult.meta.error`，有则改为 `kind: "final"`

### 6. Stop followup on empty payloads
- **问题**：`finalizeWithFollowup(void 0, queueKey, runFollowupTurn)` 在 payloads 为空时触发 followup turn → 无限循环
- **Patch**：`if (payloadArray.length === 0) return finalizeWithFollowup(...)` → `if (payloadArray.length === 0) return;`

### 7. LLM 超时 600s → 120s
- **位置**：`openclaw-config-compiler.ts` → `agents.defaults.timeoutSeconds: 120`
- **不影响 compaction**：compaction 有独立的 5 分钟超时（`EMBEDDED_COMPACTION_TIMEOUT_MS = 300_000`）

### 8. Compaction status feedback
- **Safeguard compaction 路径**（`onAgentEvent` 在 `agent-runner-execution.ts`）：`signalTextDelta("⏳ 正在整理对话记录...")`（流式 channel 有效）
- **Followup runner 路径**（`onAgentEvent` 在 `followup-runner.ts`）：`sendFollowupPayloads([{ text: "⏳ 正在整理对话记录，预计30秒内完成..." }], queued)`（独立消息，所有 channel 有效）
- **Compaction 完成消息**：去掉 verbose 条件，始终发送 `"✅ 对话记录整理完成。"`

### 9. Compaction maxHistoryShare 0.5 → 0.3
- **位置**：`openclaw-config-compiler.ts`

### 10. Locale sync on language switch
- **问题**：`setDesktopLocale` 没触发 `syncAll()`，locale 文件不更新
- **修复**：在 `desktop-routes.ts` 的 locale PUT handler 里加 `await container.openclawSyncService.syncAll()`

### 11. Platform plugins allowlist
- **问题**：channel plugins 设 allowlist 时，`nexu-runtime-model` 等平台插件被排除
- **修复**：`openclaw-config-compiler.ts` 里加 `platformPluginIds` 合并到 `allow` 数组

### 12. NEXU_WORKSPACE_ROOT fix
- **问题**：`dev-launchd.sh` 启动 Electron 时没传 `NEXU_WORKSPACE_ROOT`，build 后 `import.meta.dirname` 算出错误路径 → launchd plist 里 controller 路径变成 `apps/apps/controller`
- **修复**：`scripts/dev-launchd.sh` 加 `NEXU_WORKSPACE_ROOT="$REPO_ROOT"`

### 13. Controller supervisor debounce
- **问题**：`tools/dev/src/supervisors/controller.ts` 的 chokidar watcher 没有 debounce/锁，文件变化连续触发多个并发 restart
- **修复**：500ms debounce + `restartPending` 锁

## 待解决

### 1. Compaction 反馈验证
- **状态**：代码已写好但未验证
- **原因**：mock server 无法触发真实的 safeguard compaction（safeguard 检查 `isRealConversationMessage`，mock 的 error 消息被认为不是真正对话）
- **验证方法**：用真实 provider（如 `link/gemini-3-flash-preview`）聊足够长的对话，或把模型 context window 调小（通过 API `PUT /api/internal/desktop/default-model` 切模型，然后手动改 `openclaw.json` 里的 `contextWindow`）
- **已切换模型**：当前已通过 API 切到 `link/gemini-3-flash-preview`

### 2. Session reset 后的 120s 等待
- **现象**：context overflow → session reset → 新 session agent run → 内层 fast-exit break 了 → 但函数级别的 120s timeout 仍在等待 → 用户等 2 分钟
- **根因**：`AbortSignal.timeout(120000)` 在函数入口创建，fast-exit break 后函数虽然到了 return 路径，但可能有 `await markAuthProfileGood/Used` 卡住
- **影响**：从 10 分钟沉默改善到 2 分钟等待+有回复，但仍不够快
- **可能的修复**：在 fast-exit break 后跳过 `markAuthProfileGood/Used` 的 await

### 3. Safeguard compaction 的 "正在整理" 消息未显示
- **根因**：Pi auto-compaction 通过 `session_before_compact` extension API 触发 safeguard，**不经过 subscriber handler**，所以 `onAgentEvent({ stream: "compaction" })` 不会收到事件
- **我们的 patch 只覆盖**：emergency compaction（run.ts 显式调 `contextEngine.compact()`）→ subscriber → `onAgentEvent`
- **验证结果**：debug 日志确认 safeguard 的 `session_before_compact` 被调用了（`messagesToSummarize=1, real=true`），compaction LLM 调用也发了，但 `onAgentEvent` 没收到事件
- **可行方案**：
  1. 在 `compactionSafeguardExtension` 函数里（`compact-*.js`），cancel 检查通过后、LLM 调用前，直接写一个特殊日志 → controller 的 `openclaw-process.ts` log processor 检测 → `gatewayService.sendChannelMessage()` 发独立消息
  2. 或者 patch `handleAutoCompactionStart`（`pi-embedded-subscribe.handlers.compaction.ts`）让它也在 safeguard 路径触发
- **当前状态**：compaction 时用户看到 bot 延迟回复（几秒到几十秒），但不会沉默，回复最终会来

### 4. Emergency compaction 没有用户反馈
- **现象**：emergency compaction（run.ts 内层直接调 `contextEngine.compact()`）不经过 `onAgentEvent`，我们的 compaction feedback patch 不触发
- **影响**：用户只看到 "对话内容已超出上限" 的最终消息，看不到 "正在整理"
- **原因**：emergency compaction 8ms 就被 safeguard 取消了（新 session 没有足够的对话消息），即使有反馈也来不及显示
- **结论**：真实场景下 emergency compaction 很少发生；safeguard compaction（正常长对话触发）才是用户会遇到的，那个路径我们已经加了反馈

## 本地测试注意事项

### Patch 会被还原
- 当前 patch source-of-truth 在 `packages/slimclaw/runtime-patches/`，不是顶层 `openclaw-runtime/`
- `pnpm start` 会触发 build/prepare；源码 patch 文件不会被还原，但运行时产物会按 slimclaw 的 prepare/stage 流程重新生成
- 如果你在 prepared runtime 产物里做临时手改（例如 `packages/slimclaw/.dist-runtime/openclaw/...` 或桌面 sidecar staging 目录），后续 `pnpm slimclaw:prepare`、桌面打包、或相关 prepare 流程会覆盖这些改动
- 手动 patch 后用 `launchctl kickstart -k gui/$(id -u)/io.nexu.openclaw.dev` 只重启 OpenClaw（不触发 build/install）

### 需要 patch 的 bundle 文件
| Bundle 类型 | 匹配模式 | 内容 |
|---|---|---|
| `pi-embedded-helpers-*.js` | 4 个 | `formatRawAssistantErrorForUi` — 错误文案 i18n |
| `reply-C5LKjXcC.js` | 1 个 | agent-runner-execution — error priority, fast-exit, compaction feedback, empty payloads |
| `compact-B247y5Qt.js` | 1 个 | followup-runner — compaction feedback, stop followup, empty payloads |
| `pi-embedded-C6ITuRXf.js`, `pi-embedded-DoQsYfIY.js` | 2 个 | 同 compact，不同 bundle variant |

### ESM 注意事项
- OpenClaw dist 是 ESM 模块，不能用 `require()`
- 需要在文件顶部加 `import { readFileSync as __nexuRFS } from "node:fs"` 等
- 有的 helper bundle 已有 `import path from "node:path"`（可直接用 `path.join`），有的没有（需要加 `import __nexuPath from "node:path"`）
- `globalThis.__nexuCgLocale` 是跨 bundle 共享 locale 的方式（helper 写入，reply/compact 读取）

### Mock server
- `scripts/mock-link-errors.mjs`
- `--mode sequential`：循环 13 种错误
- `--mode fill`：返回大段正常回复（用于填充 session 触发 compaction）
- `--mode success`：纯正常回复
- `--mode random`：随机错误

### 自动化测试消息发送

**模拟用户发消息给机器人**（触发 agent 回复）：
```bash
# 通过 openclaw agent 命令模拟用户消息 → agent 处理 → 回复到飞书
OPENCLAW_CONFIG_PATH=.tmp/desktop/nexu-home/runtime/openclaw/state/openclaw.json \
OPENCLAW_STATE_DIR=.tmp/desktop/nexu-home/runtime/openclaw/state \
./openclaw-wrapper agent \
  -m "你的消息内容" \
  --agent 2e18466f-29a0-4a26-8ebc-f398e6747d45 \
  --to "oc_4e4588adb88ddd3f8093c834441bf64a" \
  --channel feishu \
  --deliver
```
- `--agent` 指定飞书绑定的 agent ID（从 openclaw.json 的 agents.list 获取）
- `--to` 指定飞书 chat ID（从日志 `feishu[...]: received message from ... in oc_xxx` 获取）
- `--deliver` 让 agent 把回复发到飞书 channel
- 不加 `--deliver` 则只在终端显示 agent 回复

**机器人主动发消息**（不触发 agent）：
```bash
OPENCLAW_CONFIG_PATH=.tmp/desktop/nexu-home/runtime/openclaw/state/openclaw.json \
OPENCLAW_STATE_DIR=.tmp/desktop/nexu-home/runtime/openclaw/state \
./openclaw-wrapper message send \
  --target "oc_4e4588adb88ddd3f8093c834441bf64a" \
  --channel feishu \
  --message "机器人主动发的消息" \
  --json
```

**切换模型**（通过 controller API）：
```bash
curl -X PUT http://localhost:50800/api/internal/desktop/default-model \
  -H "Content-Type: application/json" \
  -d '{"modelId": "link/gemini-3-flash-preview"}'
```

### Compaction 反馈实现方案（确认可行）
- `handleAutoCompactionStart`（subscriber handler）确认会被调用
- 但它 emit 的 `onAgentEvent({ stream: "compaction" })` **不会传到 `agent-runner-execution.ts`**（不同执行上下文）
- **可行方案**：在 `handleAutoCompactionStart` 里 `console.error("NEXU_EVENT compaction.started <payload>")`，controller 的 `emitRuntimeEventFromLine` 捕获，然后通过 `gatewayService.sendChannelMessage()` 发独立消息
- 需要两层改动：patch `handleAutoCompactionStart` + controller 加 `compaction.started` 事件处理
- **已实现**：patch + controller handler 代码都已提交
- **✅ 已验证**（2026-04-04）：
  - 触发条件：`contextWindow=16000` + `recentTurnsPreserve=1` + `keepRecentTokens=2000` + mock server fill 模式（大段回复）
  - 结果：safeguard PASSED（`messagesToSummarize=4, real=true`），NEXU_EVENT 成功 emit
  - Controller handler 收到事件但 `channel=null`（`openclaw agent` 用 main session 无 channel）
  - 飞书场景下 `channel="feishu"` + `to="ou_xxx"`（从 session key 解析），handler 会调 `sendChannelMessage`
- **注意**：`doSync()` 会覆盖手动改的 `openclaw.json`，测试时需在 `openclaw-sync-service.ts` 的 `compiled` 后临时注入 context window 覆盖
- **Pi tokenizer 不用 mock server 报的 usage**，只用自己的 tokenizer 估算。mock server 的 `usage` 字段对 compaction 决策无影响
- **Provider catalog** 会覆盖本地设的 context window（link provider 的 model catalog 优先级高于 config）

### 切换模型 API
```bash
curl -X PUT http://localhost:50800/api/internal/desktop/default-model \
  -H "Content-Type: application/json" \
  -d '{"modelId": "link/gemini-3-flash-preview"}'
```

## 下一步

### Mock server 增强（用于 compaction 测试）
- 采集真实 provider（如 gemini-3-flash-preview）的响应格式：`usage` 字段的真实 token 数、`content` 的真实长度、streaming chunk 格式
- Mock server fill 模式：每条回复返回 **真实规模的 token 数**（prompt_tokens 累加、completion_tokens 2000-4000），让 Pi 框架的 tokenizer 估算和实际一致
- Context window 设为 16000-32000（最小值），几轮对话就能触发 safeguard compaction
- 加 `--mode compaction-test`：前 N 条正常回复（大段文字 + 真实 usage），第 N+1 条模拟 compaction LLM 调用（延迟 5s 返回摘要格式的 response）
- 目标：稳定复现 safeguard compaction 的 start → LLM summarize → end 全流程

### 测试覆盖
- 单元测试：`createOpenClawLogEventProcessor` 的 error code 提取（已有 `openclaw-process.test.ts`）
- E2E 测试：mock server + `pnpm start` → 飞书/web chat 发消息 → 验证错误文案、compaction 提示、无沉默
- Patch 回归测试：`prepare-openclaw-sidecar.mjs --dry-run` 验证所有 patch anchor 仍然匹配

## 关键文件路径

| 文件 | 用途 |
|---|---|
| `apps/desktop/scripts/prepare-openclaw-sidecar.mjs` | 所有 OpenClaw patch 的 source of truth |
| `apps/controller/src/lib/openclaw-config-compiler.ts` | 生成 OpenClaw config（timeout、compaction、allowlist） |
| `apps/controller/src/services/openclaw-sync-service.ts` | doSync 写 locale 文件 |
| `apps/controller/src/app/env.ts` | creditGuardStatePath |
| `apps/controller/src/routes/desktop-routes.ts` | locale 切换触发 sync |
| `scripts/dev-launchd.sh` | NEXU_WORKSPACE_ROOT fix |
| `tools/dev/src/supervisors/controller.ts` | supervisor debounce |
| `specs/references/openclaw-error-handling-internals.md` | 技术调研文档 |
| `AGENTS.md` | 链接了调研文档 |
