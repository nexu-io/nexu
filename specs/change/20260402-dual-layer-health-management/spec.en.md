# End-to-End Self-Healing Loop for Nexu Desktop & OpenClaw

- **ID**: 20260402-dual-layer-health-management
- **Status**: Proposed
- **Created**: 2026-04-02
- **Related**:
  - [nexu-io/nexu#725](https://github.com/nexu-io/nexu/pull/725) — HTTP health probe & gateway wedge detection
  - `specs/change/20260326-desktop-handled-failure-sentry/spec.md` — Handled failure Sentry reporting

---

## 1. Vision

When something goes wrong in Nexu, the system should detect it, try to fix it, and — only if it can't — tell us exactly what happened. The user shouldn't need to notice, export logs, or file a ticket. The target experience is:

```
Auto-detect → Self-heal → Escalate → Remote report → IM notify → User-triggered repair
```

This is an **end-to-end self-healing loop**: the system resolves most issues silently, surfaces the rest to the team via Sentry and to the user via IM, and gives the user a one-command repair path (`/diagnose`, `/fix`) without leaving the chat.

## 2. Current Gap

Today, no single component can deliver this loop alone:

- **OpenClaw** has strong internal monitoring (channel health, session stuck detection, tool loop circuit breakers, auth expiry) and can self-heal many application-level faults. But it cannot detect its own process-level wedge, has no way to escalate when internal recovery fails, and does not report to any remote system.

- **Controller** runs HTTP probes against OpenClaw and manages the OpenClaw lifecycle (start, restart, health loop). But it treats health as binary alive/dead — it cannot tell a real deadlock from a config reload or channel reconnection, leading to false-positive alarms on benign operations.

- **Desktop** provides the host context (sleep/wake, renderer, macOS permissions) and owns the user-facing surface (diagnostics export, Sentry upload, UX). But it has no structured way to receive escalation signals from Controller or OpenClaw.

- **The gap is coordination**: all three have capabilities, but no shared language. Controller doesn't know OpenClaw is self-healing; OpenClaw can't ask Controller for help; Desktop can't contribute host context back. There is no unified escalation path, no remote reporting trigger, and no user-facing repair entry point.

This is a solvable integration problem, not a missing-capability problem.

## 3. Goals

1. **End-to-end self-healing loop** — from anomaly detection through self-repair to remote reporting and user-reachable IM commands, as a single coherent system.
2. **Three-layer responsibility** — OpenClaw owns application-internal faults; Controller is the sole runtime coordinator (probe, lifecycle, escalation decisions); Desktop provides host context and owns UX/reporting.
3. **Semantic health coordination** — a formal protocol between OpenClaw and Controller replaces implicit probe-only monitoring, so Controller understands what OpenClaw is doing.
4. **Minimal noise** — only report what the system truly cannot fix. Self-healed issues produce no alerts, no Sentry events, no user interruptions.
5. **User-reachable repair** — IM commands (`/diagnose`, `/fix`) let users inspect and repair from chat, without touching CLI or desktop UI.

## 4. Non-Goals

- Not building a full monitoring platform (Datadog continues that role).
- Not having OpenClaw upload directly to Sentry — Desktop owns remote reporting.
- Not using log text matching as a production protocol (replace POC `launchd_log_line` matching with semantic events).
- Not covering user-facing consent UX or rollout strategy in this spec.

---

## 5. Architecture

### 5.1 Role Definitions

**OpenClaw (Application Layer)** — the gateway process itself.
- Owns: channel, session, tool, auth, config anomalies
- Actions: retry, restart channel, circuit break, doctor
- Output: structured diagnostic events + semantic health status via `/health`
- When self-heal fails: transitions health to `unhealthy`, emits `escalation_requested`

**Controller (Runtime Coordinator)** — the sole authority for OpenClaw lifecycle.
- Owns: HTTP health probe, OpenClaw process lifecycle (start/stop/restart), health loop, escalation decisions, wedge detection
- Consumes: OpenClaw health responses + runtime events via the controller-owned event pipe
- Decides: whether to restart, escalate to Desktop, or wait
- Provides: host-context signals to OpenClaw (sleep/wake resume, prepare-for-restart)
- Boundary: Controller talks to OpenClaw; Desktop talks to Controller. No Desktop ↔ OpenClaw direct control path.

**Desktop (Host Context + UX + Reporting)** — the Electron shell.
- Owns: sleep/wake detection, renderer lifecycle, macOS permissions, diagnostics export, Sentry upload, user-facing IM notifications
- Provides to Controller: host signals (sleep/wake state, renderer health)
- Receives from Controller: escalation triggers, diagnostic snapshots
- Does NOT directly probe or restart OpenClaw

### 5.2 Interaction Model

```
                    Controller-owned event pipe
OpenClaw ──── /health response ──────→ Controller
OpenClaw ──── runtime events ────────→ Controller
Controller ── RPC commands ──────────→ OpenClaw  (diagnose, fix, prepare_for_restart)

                    Desktop ↔ Controller interface
Desktop ──── host signals ──────────→ Controller (sleep_resumed, renderer_state)
Controller ── escalation triggers ──→ Desktop    (report_to_sentry, notify_user)
Desktop ──── diagnostics/Sentry ────→ External   (Sentry, local export)
```

**Key constraint**: all OpenClaw coordination flows through Controller. Desktop never sends commands directly to OpenClaw. This prevents dual control paths and keeps Controller as the single source of truth for runtime state.

---

## 6. Health Model

### 6.1 Health Status Enum

OpenClaw's `/health` response transitions from binary alive/dead to a semantic state machine:

```typescript
type HealthStatus = "healthy" | "degraded" | "recovering" | "maintenance" | "unhealthy";
```

### 6.2 State Transition Rules

```
                    ┌──────────────┐
         ┌─────────│   healthy    │←────────────────┐
         │         └──────┬───────┘                  │
         │                │ anomaly detected          │ all clear
         │                ▼                           │ (+ RECOVERY_HYSTERESIS)
         │         ┌──────────────┐                  │
         │    ┌───→│   degraded   │───┐              │
         │    │    └──────┬───────┘   │              │
         │    │           │ self-heal  │ self-heal    │
         │    │           │ started    │ succeeds     │
         │    │           ▼            │              │
         │    │    ┌──────────────┐   │              │
         │    │    │  recovering  │───┘              │
         │    │    └──────┬───────┘                  │
         │    │           │ MAX_RECOVERING_DURATION  │
         │    │           │ exceeded or self-heal    │
         │    │           │ fails                    │
         │    │           ▼                          │
         │    │    ┌──────────────┐    restart/fix   │
         │    └────│  unhealthy   │──────────────────┘
         │         └──────────────┘
         │
         │  (explicit operation)
         │         ┌──────────────┐
         └────────→│ maintenance  │─── MAINTENANCE_TTL exceeded
                   └──────┬───────┘    → unhealthy
                          │ operation completes
                          └──────────→ healthy
```

### 6.3 State Timing Constraints

| State | Max Dwell Time | On Timeout |
|-------|---------------|------------|
| `healthy` | Unlimited | — |
| `degraded` | 5 min (`MAX_DEGRADED_DURATION`) | → `unhealthy` |
| `recovering` | 10 min (`MAX_RECOVERING_DURATION`) | → `unhealthy` + emit `escalation_requested` |
| `maintenance` | 15 min (`MAINTENANCE_TTL`) | → `unhealthy` (maintenance stuck) |
| `unhealthy` | Unlimited (waiting for external intervention) | — |

### 6.4 Anti-Flap Rules

- **Recovery hysteresis**: after transitioning from `unhealthy` → `healthy`, maintain a 60s `RECOVERY_HYSTERESIS` window. During this window, health is reported as `healthy` but Controller keeps its wedge counter at a non-zero "watch" level rather than resetting to 0.
- **Degraded debounce**: do not enter `degraded` for transient issues lasting < 5s. Only transition after the anomaly persists for `DEGRADED_DEBOUNCE` (5s).
- **Counter reset**: `consecutiveFailures` resets to 0 only after `RECOVERY_HYSTERESIS` elapses with continuous `healthy` status.

### 6.5 Enhanced Health Response Schema

```typescript
interface HealthResponse {
  status: HealthStatus;
  uptime: number;                // seconds since gateway start
  statusSince: number;           // epoch ms when current status began (enables TTL checks)

  // Why are we not healthy?
  degradedReasons?: string[];    // e.g. ["channel:telegram:reconnecting", "auth:claude:expiring"]

  // What are we doing about it?
  selfHealingInProgress: boolean;
  activeRecoveries?: Array<{
    type: string;                // "channel_restart" | "auth_refresh" | "session_cleanup"
    target: string;              // "telegram:bot1" | "claude:default"
    startedAt: number;           // epoch ms
    estimatedDurationMs?: number;
  }>;

  // Do we need Controller to step in?
  escalationRequested: boolean;
  escalationReason?: string;     // "channel_restart_exhausted" | "self_heal_timeout"
}
```

### 6.6 Controller Probe Behavior (updated from PR #725)

```
on probe response:
  if status == "healthy":
    if within RECOVERY_HYSTERESIS window:
      keep consecutiveFailures at "watch" level (do not fully reset)
    else:
      reset consecutiveFailures = 0
      clear wedgeReported

  if status == "degraded":
    // OpenClaw is aware — don't count as failure
    hold consecutiveFailures (no increment)
    // BUT: check statusSince. If degraded longer than MAX_DEGRADED_DURATION,
    // Controller treats as unhealthy.
    if now - statusSince >= MAX_DEGRADED_DURATION:
      trigger Controller-level intervention

  if status == "recovering":
    // Active self-healing — pause wedge counter, wait
    hold consecutiveFailures (no increment)
    // BUT: cap at MAX_RECOVERING_DURATION
    if now - statusSince >= MAX_RECOVERING_DURATION:
      trigger Controller-level intervention

  if status == "maintenance":
    // Intentional operation — suppress, but respect TTL
    reset consecutiveFailures = 0
    if now - statusSince >= MAINTENANCE_TTL:
      trigger Controller-level intervention (maintenance stuck)

  if status == "unhealthy" || escalationRequested:
    // OpenClaw gave up — intervene, but scope-aware (see §8)
    trigger Controller-level intervention

  if probe fails (timeout / connection refused):
    // Can't reach OpenClaw at all — true failure
    increment consecutiveFailures
    if consecutiveFailures >= WEDGE_THRESHOLD:
      trigger wedge detection (existing PR #725 logic)
```

---

## 7. Coordination Protocol

### 7.1 Protocol Channel

All OpenClaw → Controller events flow through the **controller-owned runtime event pipe** (the existing mechanism by which Controller subscribes to OpenClaw runtime events). This is NOT a new channel — it extends the existing `runtime/events` subscription with new event types.

Controller → OpenClaw commands use the **existing RPC interface** (HTTP/WS methods on OpenClaw's gateway server).

Desktop ↔ Controller communication uses the **existing controller API** (the internal interface Desktop already uses to interact with Controller).

**No new transport is introduced.** All changes are additive event types and RPC methods on existing channels.

### 7.2 OpenClaw → Controller Events

New event types emitted on the existing runtime event pipe:

```typescript
// OpenClaw is attempting internal recovery
interface SelfHealingStarted {
  type: "self_healing_started";
  scope: IncidentScope;    // what category of thing is broken
  target: string;          // what is being healed
  strategy: string;        // "channel_restart" | "auth_refresh" | "circuit_break"
  timestamp: number;
}

interface SelfHealingSucceeded {
  type: "self_healing_succeeded";
  scope: IncidentScope;
  target: string;
  strategy: string;
  durationMs: number;
  timestamp: number;
}

interface SelfHealingFailed {
  type: "self_healing_failed";
  scope: IncidentScope;
  target: string;
  strategy: string;
  attempts: number;
  lastError: string;       // redacted error message (no tokens/secrets)
  timestamp: number;
}

// OpenClaw cannot recover — requesting Controller intervention
interface EscalationRequested {
  type: "escalation_requested";
  scope: IncidentScope;
  severity: "warning" | "critical";
  reason: string;            // "channel_restart_loop_exhausted" | "auth_refresh_failed"
  context: EscalationContext;
  recommendedAction: EscalationAction;
  reportable: boolean;       // should this be sent to Sentry?
  dedupeKey: string;         // for per-episode dedup (e.g. "channel:telegram:bot1")
  timestamp: number;
}

// Intentional operation — suppress alarms
interface MaintenanceStarted {
  type: "maintenance_started";
  operation: string;         // "config_reload" | "plugin_update"
  estimatedDurationMs?: number;
  timestamp: number;
}

interface MaintenanceFinished {
  type: "maintenance_finished";
  operation: string;
  success: boolean;
  timestamp: number;
}
```

### 7.3 Incident Scope & Escalation Model

Not every escalation means "restart the gateway." The escalation carries a scope so Controller can choose the right response:

```typescript
type IncidentScope = "channel" | "auth" | "config" | "session" | "process";

type EscalationAction =
  | "restart_channel"     // scope: channel — restart specific channel
  | "refresh_auth"        // scope: auth — re-trigger auth flow
  | "reload_config"       // scope: config — reload configuration
  | "clear_session"       // scope: session — clean stuck session
  | "restart_gateway"     // scope: process — full process restart (last resort)
  | "notify_user"         // any scope — just tell the user
  | "report_sentry";      // any scope — report to Sentry

// Controller decision matrix:
//   scope: channel   → try restart_channel first, then escalate to Desktop
//   scope: auth      → try refresh_auth, notify user if manual re-auth needed
//   scope: config    → try reload_config, restart_gateway only if reload fails
//   scope: session   → clear_session, no restart needed
//   scope: process   → restart_gateway (only scope that warrants it by default)
```

### 7.4 Escalation Context Schema

The `context` field uses a **typed allowlist schema**, not an open `Record<string, unknown>`:

```typescript
interface EscalationContext {
  // Required fields
  errorMessage: string;        // redacted — no tokens, secrets, or credentials
  errorCode?: string;          // e.g. "ECONNREFUSED", "AUTH_EXPIRED"
  component: string;           // e.g. "channel-health-monitor", "auth-health"

  // Scope-specific fields (all optional, allowlisted)
  channelType?: string;        // "telegram" | "discord" | "slack" | ...
  channelAccount?: string;     // account identifier (redacted)
  authProvider?: string;       // "claude" | "openai" | ...
  selfHealAttempts?: number;
  selfHealDurationMs?: number;
  lastHealthStatus?: HealthStatus;

  // Size constraint: serialized context MUST be < 4KB.
  // Fields exceeding this are truncated, not omitted.
}
```

**Redaction rule**: all `EscalationContext` fields pass through OpenClaw's existing redaction layer (`redaction.ts`) before emission. Any field not in this allowlist is stripped. This is enforced at the event emission site, not at the consumer.

### 7.5 Controller → OpenClaw Commands

RPC methods added to OpenClaw's `server-methods/`:

```typescript
// Inform OpenClaw of host-side context (from Desktop via Controller)
interface HostSleepResumed {
  method: "host_sleep_resumed";
  sleepDurationMs: number;    // how long was the machine asleep
}

// Request OpenClaw to prepare for external restart
interface PrepareForRestart {
  method: "prepare_for_restart";
  reason: string;             // "wedge_detected" | "user_requested" | "update"
  gracePeriodMs: number;      // time to flush state before kill
}

// Trigger comprehensive self-check (for /diagnose command)
interface RunDiagnose {
  method: "run_diagnose";
  depth: "quick" | "full";    // quick = health summary; full = doctor-level
}

// Trigger auto-repair (for /fix command)
interface RunFix {
  method: "run_fix";
  scope: "safe" | "moderate"; // safe = no-downtime; moderate = may restart channels
  targets?: string[];         // optional: specific subsystems to fix
}

// Tell OpenClaw to reset transient counters after Controller intervention
interface ResetTransientHealthCounters {
  method: "reset_transient_health_counters";
  reason: string;             // "post_restart" | "post_sleep_resume"
}
```

### 7.6 Desktop → Controller Signals

Desktop provides host context to Controller through the existing controller API:

```typescript
// Desktop notifies Controller of host events
interface HostSleepWakeEvent {
  type: "host_sleep_resumed";
  sleepDurationMs: number;
}

interface RendererStateEvent {
  type: "renderer_state_changed";
  state: "healthy" | "crashed" | "unresponsive";
}
```

Controller forwards relevant signals to OpenClaw (e.g., `host_sleep_resumed`) and uses others for its own decisions (e.g., renderer crash → Sentry report via Desktop).

---

## 8. Recovery Flow

Layered escalation with scope-aware response:

```
┌─ Layer 1: OpenClaw Internal ─────────────────────────────────┐
│                                                               │
│  Anomaly detected (channel monitor / diagnostic event)        │
│    → Attempt self-heal (retry / restart / circuit break)      │
│    → Emit self_healing_started { scope, target, strategy }    │
│                                                               │
│  Outcome A: Recovery succeeds                                 │
│    → Emit self_healing_succeeded                              │
│    → Health returns to "healthy" (after RECOVERY_HYSTERESIS)  │
│    → END (no noise, no report)                                │
│                                                               │
│  Outcome B: Recovery fails / state TTL exceeded               │
│    → Emit self_healing_failed                                 │
│    → Emit escalation_requested { scope, recommendedAction }   │
│    → Health transitions to "unhealthy"                        │
│                                                               │
└───────────────────────────────────┬───────────────────────────┘
                                    │ escalation (via controller event pipe)
                                    ▼
┌─ Layer 2: Controller Intervention ───────────────────────────┐
│                                                               │
│  Controller receives escalation_requested OR detects wedge    │
│                                                               │
│  Scope-aware response:                                        │
│    scope: channel → restart_channel (targeted, no downtime)   │
│    scope: auth    → refresh_auth or notify user               │
│    scope: config  → reload_config, restart only if fails      │
│    scope: session → clear_session                             │
│    scope: process → prepare_for_restart → restart gateway     │
│    (probe-unreachable / wedge → always restart gateway)       │
│                                                               │
│  Outcome A: Intervention succeeds, health → "healthy"         │
│    → Log recovery, END                                        │
│                                                               │
│  Outcome B: Intervention fails OR restart loop exhausted      │
│    → Controller signals Desktop to escalate to Layer 3        │
│                                                               │
└───────────────────────────────────┬───────────────────────────┘
                                    │ still broken
                                    ▼
┌─ Layer 3: Desktop — Report + User Reach ─────────────────────┐
│                                                               │
│  Desktop receives escalation trigger from Controller.         │
│  Triggers three parallel outputs:                             │
│                                                               │
│  1. Sentry: captureMessage + diagnostics ZIP attachment       │
│     (includes escalation context from Controller)             │
│                                                               │
│  2. IM notification to user:                                  │
│     "Detected persistent issue. Reply /diagnose for details   │
│      or /fix to attempt repair."                              │
│                                                               │
│  3. Local diagnostics snapshot (existing export mechanism)    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

## 9. Reporting Policy

### 9.1 Sentry Trigger Conditions

Only report when escalation has genuinely failed — not on every diagnostic event:

| Trigger | Description |
|---------|-------------|
| `wedge_confirmed` | HTTP probe consecutive failures exceeded threshold, process unresponsive |
| `cold_start_failed` | Gateway failed to reach healthy state within boot timeout |
| `self_healing_failed_and_escalated` | OpenClaw exhausted internal recovery, Controller intervention also failed |
| `renderer_crash_before_ready` | Electron renderer process died before initialization complete |
| `restart_loop_exhausted` | Controller restarted gateway N times within window, still unhealthy |

### 9.2 Deduplication & Rate Limiting

- **Per-episode dedup**: one Sentry event per failure episode, keyed by `dedupeKey` from `EscalationRequested`
- **Rate limit**: max 3 Sentry events per hour across all trigger types
- **Recovery reset**: all counters and flags reset after `RECOVERY_HYSTERESIS` elapses with healthy status
- **Cooldown**: after a Sentry report, suppress same `dedupeKey` for 30 minutes
- **IM notify cooldown**: IM notifications share the same `dedupeKey` and 30-minute cooldown as Sentry. Same bot disconnecting repeatedly does not spam the user — one notification per episode, silence until cooldown expires or the issue changes.

### 9.3 Diagnostics Payload

Reuse existing `diagnostics-export.ts` with additions:

- Existing: runtime state, recent events, startup state, renderer failures, health metrics
- Added: `EscalationContext` from the triggering event, self-healing attempt history, last N health responses with semantic status and `statusSince` timestamps

---

## 10. IM Commands

**DM only**: `/diagnose` and `/fix` only respond in direct messages (DM / private chat) with the bot. In group channels, the bot ignores these commands or replies: "Please DM me to run this command." This prevents accidental or unintended repair actions in shared channels.

### 10.1 `/diagnose` — Self-Check Report

**Trigger**: user sends `/diagnose` in a DM with the bot.

**Flow**:
1. Controller calls OpenClaw `run_diagnose(depth: "full")`
2. Controller appends its own perspective (probe history, process stats, escalation state)
3. Desktop appends host context (sleep/wake log, renderer state)
4. Combined report returned to IM

**Report contents**:
```
Gateway Health: degraded (since 45s ago)
  - telegram:bot1: reconnecting (3rd attempt, started 45s ago)
  - auth:claude: expires in 2h
  - sessions: 3 active, 0 stuck

Process: running (PID 12345, uptime 6h)
Controller probe: 0 consecutive failures
Last sleep/wake: 2h ago, recovered normally

Self-healing: 1 active recovery (telegram channel restart)
Escalations: none
```

### 10.2 `/fix` — Trigger Repair

**Trigger**: user sends `/fix` in a DM with the bot.

**Flow**:
1. Controller calls OpenClaw `run_fix` which runs the **doctor** diagnostic and repair flow internally
2. Doctor identifies root causes and attempts targeted repairs (e.g., detect expired webhook → re-register, detect port conflict → kill stale process, detect broken LaunchAgent → reload)
3. Results returned to IM with what was found and fixed
4. If doctor repairs resolve the issue → done, no further action
5. If doctor cannot resolve → IM asks: "Doctor couldn't fix this. Restart gateway? (brief disconnection) Reply `/fix restart`"
6. On confirm: Controller executes `prepare_for_restart` → process restart → `reset_transient_health_counters`

**Repair escalation** (doctor first, restart last):

| Step | Actions | Requires confirm |
|------|---------|-----------------|
| 1. Doctor | Root-cause diagnosis, auth refresh, webhook re-register, port conflict resolution, LaunchAgent repair, channel restart, session cleanup | No |
| 2. Restart | Restart gateway process | Yes — "Doctor couldn't fix this. Restart gateway?" |
| 3. Rebuild | Clear session store, rebuild sandbox images | Yes — "WARNING: this may lose in-progress conversations." |

**Degraded mode**: when OpenClaw is unreachable (wedge/crash), `/fix` falls back to Controller-only actions: process restart, diagnostics export. IM response indicates reduced capability.

### 10.3 Example Scenario

A concrete end-to-end example of the self-healing loop in action:

```
1. OpenClaw detects: telegram:bot1 disconnected
   → Auto-reconnect attempt 1/3... failed (webhook URL changed)
   → Auto-reconnect attempt 2/3... failed
   → Auto-reconnect attempt 3/3... failed
   → Emits escalation_requested { scope: "channel", target: "telegram:bot1" }

2. Controller receives escalation
   → Attempts restart_channel... still failing
   → Signals Desktop to escalate to Layer 3

3. User receives IM notification:
   "telegram:bot1 持续断连，自动重连未恢复。
    输入 /diagnose 查看详情，或 /fix 尝试修复。"

4. User replies: /fix

5. OpenClaw doctor runs:
   → Detects: Telegram webhook URL changed after bot token refresh
   → Repairs: re-registers webhook with new URL
   → Restarts telegram:bot1 channel
   → Channel reconnects successfully

6. User receives IM reply:
   "已修复：Telegram webhook URL 已更新并重新注册。
    telegram:bot1 已恢复连接。"
```

---

## 11. Upstream Dependencies

This spec requires changes in both Nexu and OpenClaw. Not all changes can be made from the Nexu side.

### 11.1 Nexu-Side (Can Implement Now)

These changes live entirely within the Nexu repo and can proceed without OpenClaw upstream changes:

| Change | Component | Notes |
|--------|-----------|-------|
| Controller probe logic respects semantic health | Controller | Evolve PR #725 to handle new status values |
| Controller escalation decision engine | Controller | Scope-aware response logic |
| Desktop ↔ Controller host signal interface | Desktop + Controller | sleep/wake, renderer state |
| Desktop Sentry reporting on Layer 3 triggers | Desktop | Extend handled-failure-reporter |
| Desktop diagnostics payload enrichment | Desktop | Add escalation context to ZIP |
| IM `/diagnose` and `/fix` command routing | Controller | Command dispatch, authorization |
| State timing enforcement (TTLs) | Controller | Monitor `statusSince` in probe responses |

### 11.2 OpenClaw Upstream (Requires Coordination)

These changes require modifications to OpenClaw source code:

| Change | Priority | Fallback without it |
|--------|----------|---------------------|
| `/health` returns `HealthStatus` enum + `statusSince` | **Phase 1 — critical** | Controller treats all non-200 as failure (current behavior) |
| `/health` returns `selfHealingInProgress` + `activeRecoveries` | Phase 1 | Controller cannot suppress alarms during self-healing; higher false-positive rate |
| `self_healing_*` events on runtime event pipe | Phase 2 | Controller relies solely on `/health` polling; less responsive |
| `escalation_requested` event with scope + context | Phase 2 | Controller detects escalation-worthy situations only via health status timeout |
| `maintenance_started` / `maintenance_finished` events | Phase 2 | Controller uses `maintenance` health status only (no advance notice) |
| `run_diagnose` RPC method | Phase 4 | `/diagnose` returns Controller-only perspective |
| `run_fix` RPC method | Phase 4 | `/fix` limited to Controller-side actions (process restart) |
| `host_sleep_resumed` RPC method | Phase 2 | OpenClaw doesn't know about sleep/wake; no counter reset |
| `prepare_for_restart` RPC method | Phase 2 | Controller kills OpenClaw without graceful shutdown |
| `EscalationContext` allowlist schema + redaction | Phase 2 | No structured context in Sentry reports |

### 11.3 Phased Approach

The rollout phases are ordered so that Nexu-side work can start immediately, and OpenClaw upstream changes are requested incrementally:

- **Phase 1**: Nexu-side probe logic + OpenClaw `/health` enhancement (smallest upstream ask)
- **Phase 2**: Full coordination protocol (larger upstream ask, but builds on Phase 1)
- **Phase 3**: Sentry integration (Nexu-side only, consuming Phase 2 events)
- **Phase 4**: IM commands (requires OpenClaw `run_diagnose` / `run_fix`)

If OpenClaw upstream changes are delayed, each phase has a documented fallback that delivers partial value with Nexu-only changes.

---

## 12. Rollout

### Phase 1: Health Semantics

- **OpenClaw upstream**: enhance `/health` to return `HealthStatus` enum, `statusSince`, `degradedReasons`, `selfHealingInProgress`, `escalationRequested`
- **Nexu (Controller)**: update probe logic to respect semantic states, enforce TTLs via `statusSince`, implement anti-flap rules
- **Fallback**: if upstream is delayed, Controller adds its own timeout-based degraded detection (less accurate but functional)
- **Validation**: no more false-positive wedge alarms during config reload or channel reconnection

### Phase 2: Coordination Protocol

- **OpenClaw upstream**: emit `self_healing_*`, `escalation_requested`, `maintenance_*` events; accept `host_sleep_resumed`, `prepare_for_restart`, `reset_transient_health_counters` commands
- **Nexu (Controller)**: consume events, implement scope-aware escalation decisions, forward host signals from Desktop
- **Nexu (Desktop)**: send sleep/wake and renderer signals to Controller
- **Fallback**: if upstream events are delayed, Controller infers escalation from health status TTL expiry
- **Validation**: Controller correctly pauses wedge counting during self-healing; scope-aware response avoids unnecessary restarts

### Phase 3: Escalation & Reporting

- **Nexu only** (no upstream dependency beyond Phase 2 events)
- Implement layered recovery flow (Layer 1 → 2 → 3)
- Wire Sentry reporting to Layer 3 triggers only (per reporting policy)
- Include `EscalationContext` in diagnostics ZIP
- **Validation**: Sentry events only fire on genuine unrecoverable failures

### Phase 4: IM Commands

- **OpenClaw upstream**: implement `run_diagnose` and `run_fix` server methods
- **Nexu (Controller)**: register `/diagnose` and `/fix` command routing, authorization enforcement
- **Nexu (Desktop)**: contribute host context to `/diagnose` output
- **Fallback**: without upstream `run_diagnose`/`run_fix`, commands return Controller-only perspective and can only do process-level actions
- **Validation**: authorized operator can diagnose and repair from IM without touching CLI or desktop UI

---

## 13. Outstanding Questions

1. Should `maintenance_started` / `maintenance_finished` be auto-emitted by OpenClaw on config reload, or explicitly triggered by the operation?
2. What's the right `MAX_RECOVERING_DURATION` — 10 min is the current proposal, but channel reconnection over flaky networks may legitimately take longer.
3. How does this interact with multi-device scenarios (multiple Desktops connected to one Controller)?
4. Should the IM notification on Layer 3 failure include a summary of what went wrong, or just a prompt to run `/diagnose`?
5. What is the process for proposing the OpenClaw upstream changes — RFC, issue, or direct PR?

---

## 14. References

- OpenClaw health infrastructure: `src/commands/health.ts`, `src/gateway/server-methods/health.ts`, `src/gateway/channel-health-monitor.ts`
- OpenClaw diagnostic events: `src/infra/diagnostic-events.ts`, `src/logging/diagnostic.ts`
- OpenClaw doctor/repair: `src/commands/doctor.ts`, `src/commands/doctor-gateway-daemon-flow.ts`
- OpenClaw tool loop detection: `src/agents/tool-loop-detection.ts`
- Controller health probe: `apps/controller/src/runtime/runtime-health.ts` (PR #725)
- Controller wedge detection: `apps/controller/src/runtime/loops.ts` (PR #725)
- Sentry handled failure spec: `specs/change/20260326-desktop-handled-failure-sentry/spec.md`
