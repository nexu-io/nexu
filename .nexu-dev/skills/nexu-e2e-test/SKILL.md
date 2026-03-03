---
name: nexu-e2e-test
description: Use when verifying OpenClaw gateway fixes end-to-end, testing skill loading after restart, or running integration tests against the local Nexu+OpenClaw stack. Triggers on "e2e test", "verify fix", "test gateway", "test skills loading".
---

# Nexu E2E Testing — OpenClaw Gateway

Run end-to-end verification of the Nexu → OpenClaw gateway stack locally.

## Known Constraints

The OpenClaw gateway has architectural constraints that block naive E2E approaches. **Read this before attempting any gateway testing.**

| Approach | Blocker | Status |
|----------|---------|--------|
| HTTP `POST /v1/chat/completions` | Endpoint exists (`openai-http.ts`) but uses `agentCommand()` — same embedded agent path as CLI, bypasses session store | Works for smoke tests (same as CLI) |
| HTTP `POST /v1/responses` | Endpoint exists (`openresponses-http.ts`) but also uses `agentCommand()` | Works for smoke tests (same as CLI) |
| WebSocket `chat.send` | Requires device pairing for `operator.write` scope — `clearUnboundScopes()` in `message-handler.ts:483-488` clears all self-declared scopes without device identity | Dead end without device keys |
| `openclaw agent --session-id` | Uses embedded agent path (`sessionKey=unknown`), bypasses session store cache | Works for smoke tests, NOT for session-store bugs |
| Direct module import from dist | Rollup bundles with hashed filenames, can't import individual modules | Dead end |
| `tsx` from `/tmp` | Module resolution fails for imports outside project root | Dead end |
| Vitest in-project `.test.ts` | Full module resolution, mocking, TypeScript support | **Primary method** |

**Key insight:** All HTTP and CLI approaches use the embedded agent path via `agentCommand()` (imported from `commands/agent.js`). Only messages arriving through connected channels (Slack/Discord) go through `dispatchInboundMessage()` → auto-reply pipeline → `ensureSkillSnapshot()`, which is the code path that uses the session store.

## Viable Test Methods

### 1. Vitest Unit/Integration Tests (Primary)

Write `.test.ts` files **inside the OpenClaw worktree** and run with vitest. This is the only reliable way to test internal functions like `ensureSkillsWatcher`, `getSkillsSnapshotVersion`, `ensureSkillSnapshot`.

```bash
cd <OPENCLAW_WORKTREE>
OPENCLAW_TEST_FAST=1 npx vitest run src/agents/skills/refresh.test.ts
```

Key patterns:
- Mock `chokidar` with `vi.mock("chokidar", ...)`
- Use `await import("./refresh.js")` for dynamic imports after mocking
- Use unique workspace paths per test (`/tmp/test-<name>-${Date.now()}`)
- `OPENCLAW_TEST_FAST=1` skips filesystem scanning in session-updates

### 2. `openclaw agent` CLI or HTTP Smoke Tests

For "do skills load after restart" verification. Does NOT test session-store caching logic (all use embedded agent path).

**CLI approach:**
```bash
# Prerequisites: gateway must be running with a valid workspace
OPENCLAW_STATE_DIR=~/.openclaw \
OPENCLAW_CONFIG_PATH=<config-with-local-workspace> \
openclaw agent --session-id "<session>" --message "<msg>" --json --timeout 60
```

**HTTP approach (OpenAI-compatible):**
```bash
curl -s http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <gw-token>" \
  -d '{"model":"default","messages":[{"role":"user","content":"list your skills"}]}'
```

Parse results (CLI JSON output):
```bash
| python3 -c "
import json,sys
d=json.load(sys.stdin)
entries=d.get('result',{}).get('meta',{}).get('systemPromptReport',{}).get('skills',{}).get('entries',[])
managed=[e['name'] for e in entries if e['name'] in ('static-deploy','test-greeting')]
print(f'Skills: {len(entries)}, Managed: {managed}')
"
```

### 3. Connected Channel (Slack/Discord)

The only way to test the full auto-reply pipeline with session-store caching. Requires a running channel with active bot.

## Gateway Setup for Testing

### Config Pitfall: `/data/` workspace path

Production configs have `"workspace": "/data/openclaw/workspaces/..."` which doesn't exist locally. Create a test config:

```bash
cat ~/.openclaw/openclaw.json | python3 -c "
import json, sys
cfg = json.load(sys.stdin)
cfg['agents']['list'][0]['workspace'] = '/tmp/openclaw-test-workspace'
json.dump(cfg, sys.stdout, indent=2)
" > /tmp/openclaw-test-config.json
```

### Start gateway with test config

```bash
OPENCLAW_STATE_DIR=~/.openclaw \
OPENCLAW_CONFIG_PATH=/tmp/openclaw-test-config.json \
openclaw gateway run --allow-unconfigured --bind loopback --port 18789 --force --verbose
```

### Wait for port readiness (not just process start)

```bash
for i in $(seq 1 15); do
  lsof -i :18789 -P 2>/dev/null | grep -q LISTEN && break
  sleep 1
done
```

## WebSocket Protocol Reference

If you ever need to attempt WS testing (e.g., after implementing device pairing):

| Detail | Value |
|--------|-------|
| Frame format | `{"type": "req", "id": "<uuid>", "method": "...", "params": {...}}` (NOT JSON-RPC) |
| Protocol version | `3` (as of 2026.2.25) |
| Valid client IDs | `gateway-client`, `cli`, `webchat-ui`, `openclaw-control-ui`, `node-host`, `test`, `webchat`, `fingerprint`, `openclaw-probe`, `openclaw-macos`, `openclaw-ios`, `openclaw-android` (defined in `protocol/client-info.ts`) |
| Valid client modes | `webchat`, `cli`, `ui`, `backend`, `node`, `probe`, `test` |
| Auth flow | Challenge → `connect` RPC with nonce → needs device identity for write scopes |
| Scope for `chat.send` | `operator.write` — requires device pairing, token-only auth gets zero scopes |
| Scope exception | `controlUiAuthPolicy.allowBypass: true` preserves scopes without device identity (dev/control-UI only, see `message-handler.ts:489-542`) |

## Restart Verification Checklist

When verifying a fix that involves skills/sessions after gateway restart:

1. **Build the fix:** `cd <worktree> && pnpm build`
2. **Link globally:** `cd <worktree> && pnpm link --global`
3. **Verify version:** `openclaw --version`
4. **Write unit tests** in the worktree for core logic (vitest)
5. **Run smoke test:** gateway restart → `openclaw agent` → check skill count
6. **Check sessions.json** at `~/.openclaw/agents/<agent>/sessions/sessions.json` for snapshot versions
7. **Check logs** at gateway stdout for skill watcher events

## Session Store Locations

```
~/.openclaw/agents/<agent-id>/sessions/sessions.json   # Session entries with skillsSnapshot
~/.openclaw/agents/<agent-id>/sessions/<session-id>.jsonl  # Session transcript
```

Key fields in session entry:
- `skillsSnapshot.version` — timestamp, should be non-zero after fix
- `skillsSnapshot.skills[]` — array of loaded skill names and locations
- `skillsSnapshot.prompt` — the `<available_skills>` XML injected into system prompt
