# Dual-Layer Health Management with Semantic Coordination Protocol

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

Today, neither OpenClaw nor Desktop can deliver this loop alone:

- **OpenClaw** has strong internal monitoring (channel health, session stuck detection, tool loop circuit breakers, auth expiry) and can self-heal many application-level faults. But it cannot detect its own process-level wedge, has no way to escalate when internal recovery fails, and does not report to any remote system.

- **Desktop** runs HTTP probes against OpenClaw and can restart the process. But it treats health as binary alive/dead — it cannot tell a real deadlock from a config reload or channel reconnection, leading to false-positive alarms on benign operations.

- **The gap is coordination**: both sides have capabilities, but no shared language. Desktop doesn't know OpenClaw is self-healing; OpenClaw can't ask Desktop for help. There is no unified escalation path, no remote reporting trigger, and no user-facing repair entry point.

This is a solvable integration problem, not a missing-capability problem.

## 3. Goals

1. **End-to-end self-healing loop** — from anomaly detection through self-repair to remote reporting and user-reachable IM commands, as a single coherent system.
2. **Layered responsibility** — OpenClaw owns application-internal faults; Desktop owns process-external faults. Each layer tries to resolve before escalating.
3. **Semantic health coordination** — a formal protocol between OpenClaw and Desktop replaces implicit probe-only monitoring, so Desktop understands what OpenClaw is doing and vice versa.
4. **Minimal noise** — only report what the system truly cannot fix. Self-healed issues produce no alerts, no Sentry events, no user interruptions.
5. **User-reachable repair** — IM commands (`/diagnose`, `/fix`) let users inspect and repair from chat, without touching CLI or desktop UI.

## 4. Non-Goals

- Not building a full monitoring platform (Datadog continues that role).
- Not having OpenClaw upload directly to Sentry — Desktop owns remote reporting.
- Not using log text matching as a production protocol (replace POC `launchd_log_line` matching with semantic events).
- Not covering user-facing consent UX or rollout strategy in this spec.

---

## 5. Architecture

### Responsibility Boundary

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw (Application Layer)                │
│                                                                 │
│  Owns: channel, session, tool, auth, config anomalies           │
│  Actions: retry, restart channel, circuit break, doctor         │
│  Output: structured diagnostic events + semantic health status  │
│                                                                 │
│  If self-heal fails → emit escalation_requested event           │
└──────────────────────────┬──────────────────────────────────────┘
                           │ abnormal / recovery / escalation events
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│               Desktop / Controller (Supervision Layer)          │
│                                                                 │
│  Owns: process wedge, cold-start failure, renderer crash,       │
│        sleep/wake recovery, macOS permissions, port conflicts    │
│  Coordinates: sleep state, maintenance windows, self-heal       │
│               awareness (avoids conflicting with OpenClaw)      │
│  Escalates to: Sentry upload, IM notification, user interaction │
└─────────────────────────────────────────────────────────────────┘
```

### Interaction Model

```
Desktop ──── HTTP probe (5s) ────→ OpenClaw /health (semantic response)
Desktop ──── RPC commands ───────→ OpenClaw (diagnose, fix, prepare_for_restart, ...)
OpenClaw ─── WS/event channel ──→ Desktop  (abnormal signals, escalation, recovery)
```

---

## 6. Health Model

### 6.1 Health Status Enum

OpenClaw's `/health` response transitions from a binary alive/dead to a semantic state machine:

```typescript
type HealthStatus = "healthy" | "degraded" | "recovering" | "maintenance" | "unhealthy";
```

| Status | Meaning | Desktop should... |
|--------|---------|-------------------|
| `healthy` | All systems nominal | Normal probe cadence |
| `degraded` | Partial functionality loss, aware and handling | Log, extend wedge threshold |
| `recovering` | Active self-healing in progress | Pause wedge counter, wait for outcome |
| `maintenance` | Intentional operation (config reload, upgrade) | Suppress alarms entirely |
| `unhealthy` | Self-healing exhausted, needs external help | Begin Desktop-level intervention |

### 6.2 Enhanced Health Response Schema

```typescript
interface HealthResponse {
  status: HealthStatus;
  uptime: number;                // seconds since gateway start

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

  // Do we need Desktop to step in?
  escalationRequested: boolean;
  escalationReason?: string;     // "channel_restart_exhausted" | "self_heal_timeout"
}
```

### 6.3 Desktop Probe Behavior (updated from PR #725)

```
on probe response:
  if status == "healthy":
    reset consecutiveFailures = 0
    clear wedgeReported

  if status == "degraded" && selfHealingInProgress:
    // OpenClaw is aware and working on it — don't count as failure
    hold consecutiveFailures (no increment)
    extend wedge threshold to 24 (double grace period)

  if status == "maintenance":
    // intentional operation — fully suppress
    reset consecutiveFailures = 0

  if status == "unhealthy" || escalationRequested:
    // OpenClaw gave up — skip wedge threshold, intervene immediately
    trigger Desktop-level intervention

  if probe fails (timeout / connection refused):
    // can't reach OpenClaw at all — true failure
    increment consecutiveFailures
    if consecutiveFailures >= WEDGE_THRESHOLD:
      trigger wedge detection (existing PR #725 logic)
```

---

## 7. Coordination Protocol

### 7.1 OpenClaw → Desktop Events

Structured events emitted over the existing WS/event channel:

```typescript
// OpenClaw is attempting internal recovery
interface SelfHealingStarted {
  type: "self_healing_started";
  target: string;          // what is being healed
  strategy: string;        // "channel_restart" | "auth_refresh" | "circuit_break"
  timestamp: number;
}

interface SelfHealingSucceeded {
  type: "self_healing_succeeded";
  target: string;
  strategy: string;
  durationMs: number;
  timestamp: number;
}

interface SelfHealingFailed {
  type: "self_healing_failed";
  target: string;
  strategy: string;
  attempts: number;
  lastError: string;
  timestamp: number;
}

// OpenClaw cannot recover — requesting Desktop intervention
interface EscalationRequested {
  type: "escalation_requested";
  reason: string;            // "channel_restart_loop_exhausted" | "auth_refresh_failed"
  context: Record<string, unknown>;  // diagnostic context for Sentry/diagnostics
  suggestedAction?: "restart_gateway" | "notify_user" | "report_sentry";
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

### 7.2 Desktop → OpenClaw Commands

RPC methods added to OpenClaw's `server-methods/`:

```typescript
// Inform OpenClaw of Desktop-side context
interface DesktopSleepResumed {
  method: "desktop_sleep_resumed";
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

// Tell OpenClaw to reset transient counters after Desktop intervention
interface ResetTransientHealthCounters {
  method: "reset_transient_health_counters";
  reason: string;             // "post_restart" | "post_sleep_resume"
}
```

---

## 8. Recovery Flow

Layered escalation with noise minimization:

```
┌─ Layer 1: OpenClaw Internal ─────────────────────────────────┐
│                                                               │
│  Anomaly detected (channel monitor / diagnostic event)        │
│    → Attempt self-heal (retry / restart / circuit break)      │
│    → Emit self_healing_started                                │
│                                                               │
│  Outcome A: Recovery succeeds                                 │
│    → Emit self_healing_succeeded                              │
│    → Health returns to "healthy"                              │
│    → END (no noise, no report)                                │
│                                                               │
│  Outcome B: Recovery fails after max attempts                 │
│    → Emit self_healing_failed                                 │
│    → Emit escalation_requested                                │
│    → Health transitions to "unhealthy"                        │
│                                                               │
└───────────────────────────────────┬───────────────────────────┘
                                    │ escalation
                                    ▼
┌─ Layer 2: Desktop Intervention ──────────────────────────────┐
│                                                               │
│  Desktop receives escalation_requested OR wedge detected      │
│    → Send prepare_for_restart to OpenClaw                     │
│    → Wait grace period for state flush                        │
│    → Execute process restart                                  │
│    → Send reset_transient_health_counters                     │
│                                                               │
│  Outcome A: Restart succeeds, health returns to "healthy"     │
│    → Log gateway_recovery, END                                │
│                                                               │
│  Outcome B: Restart fails OR restart loop exhausted           │
│    → Proceed to Layer 3                                       │
│                                                               │
└───────────────────────────────────┬───────────────────────────┘
                                    │ still broken
                                    ▼
┌─ Layer 3: Remote Report + User Reach ────────────────────────┐
│                                                               │
│  Trigger three parallel outputs:                              │
│                                                               │
│  1. Sentry: captureMessage + diagnostics ZIP attachment       │
│     (includes OpenClaw diagnostic context from escalation)    │
│                                                               │
│  2. IM notification to user:                                  │
│     "Detected persistent gateway issue. Reply /diagnose       │
│      for details or /fix to attempt repair."                  │
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
| `self_healing_failed_and_escalated` | OpenClaw exhausted internal recovery, requested Desktop help, Desktop intervention also failed |
| `renderer_crash_before_ready` | Electron renderer process died before initialization complete |
| `restart_loop_exhausted` | Desktop restarted gateway N times within window, still unhealthy |

### 9.2 Deduplication & Rate Limiting

- **Per-episode dedup**: one Sentry event per failure episode (reuse PR #725's `wedgeReported` flag pattern)
- **Rate limit**: max 3 Sentry events per hour across all trigger types
- **Recovery reset**: all counters and flags reset when health returns to "healthy"
- **Cooldown**: after a Sentry report, suppress same trigger type for 30 minutes

### 9.3 Diagnostics Payload

Reuse existing `diagnostics-export.ts` with additions:

- Existing: runtime state, recent events, startup state, renderer failures, health metrics
- Added: OpenClaw's `escalation_requested` event context, self-healing attempt history, last N health responses with semantic status

---

## 10. IM Commands

### 10.1 `/diagnose` — Self-Check Report

**Trigger**: user sends `/diagnose` in any connected IM channel.

**Flow**:
1. Channel routes command to gateway (bypass AI agent path)
2. Gateway calls OpenClaw `run_diagnose(depth: "full")`
3. Desktop appends its own perspective (probe history, process stats, sleep/wake log)
4. Combined report returned to IM

**Report contents**:
```
Gateway Health: degraded
  - telegram:bot1: reconnecting (3rd attempt, started 45s ago)
  - auth:claude: expires in 2h
  - sessions: 3 active, 0 stuck

Process: running (PID 12345, uptime 6h)
Desktop probe: 0 consecutive failures
Last sleep/wake: 2h ago, recovered normally

Self-healing: 1 active recovery (telegram channel restart)
Escalations: none
```

### 10.2 `/fix` — Trigger Repair

**Trigger**: user sends `/fix` in any connected IM channel.

**Flow**:
1. Gateway calls OpenClaw `run_fix(scope: "safe")`
2. OpenClaw executes safe repairs (auth refresh, channel restart, session cleanup)
3. Results returned to IM
4. If safe repairs insufficient, IM asks: "Some issues require restarting the gateway (brief disconnection). Proceed? Reply `/fix confirm`"
5. On confirm: Desktop executes `prepare_for_restart` → process restart → `reset_transient_health_counters`

**Action tiers**:

| Tier | Actions | Requires confirm |
|------|---------|-----------------|
| Safe | Refresh auth tokens, restart unhealthy channels, clean stuck sessions | No |
| Moderate | Restart gateway process, reload config | Yes |
| Restricted | Clear session store, rebuild sandbox images | Yes + warning |

---

## 11. Rollout

### Phase 1: Health Semantics

- Enhance OpenClaw `/health` endpoint with `HealthResponse` schema (status enum, degradedReasons, selfHealingInProgress, escalationRequested)
- Update Desktop probe logic to respect semantic states (PR #725 evolution)
- **Validation**: no more false-positive wedge alarms during config reload or channel reconnection

### Phase 2: Coordination Protocol

- Implement OpenClaw → Desktop events (self_healing_*, escalation_requested, maintenance_*)
- Implement Desktop → OpenClaw commands (desktop_sleep_resumed, prepare_for_restart, reset_transient_health_counters)
- Wire Desktop's sleep/wake listener to send `desktop_sleep_resumed`
- **Validation**: Desktop correctly pauses wedge counting during OpenClaw self-healing

### Phase 3: Escalation & Reporting

- Implement layered recovery flow (Layer 1 → 2 → 3)
- Wire Sentry reporting to Layer 3 triggers only (per reporting policy)
- Include OpenClaw escalation context in diagnostics ZIP
- **Validation**: Sentry events only fire on genuine unrecoverable failures

### Phase 4: IM Commands

- Register `/diagnose` and `/fix` as gateway commands (bypass agent routing)
- Implement `run_diagnose` and `run_fix` server methods in OpenClaw
- Desktop contributes its perspective to `/diagnose` output
- Implement confirmation flow for moderate/restricted `/fix` actions
- **Validation**: user can diagnose and repair from IM without touching CLI or desktop UI

---

## 12. Outstanding Questions

1. Should `maintenance_started` / `maintenance_finished` be auto-emitted by OpenClaw on config reload, or explicitly triggered?
2. What's the right `escalation_requested` timeout — how long should OpenClaw try before giving up?
3. Should `/diagnose` and `/fix` be available on all channels or restricted to admin-designated channels?
4. How does this interact with multi-device scenarios (multiple Desktops connected to one OpenClaw)?
5. Should the IM notification on Layer 3 failure include a summary of what went wrong, or just a prompt to run `/diagnose`?

---

## 13. References

- OpenClaw health infrastructure: `src/commands/health.ts`, `src/gateway/server-methods/health.ts`, `src/gateway/channel-health-monitor.ts`
- OpenClaw diagnostic events: `src/infra/diagnostic-events.ts`, `src/logging/diagnostic.ts`
- OpenClaw doctor/repair: `src/commands/doctor.ts`, `src/commands/doctor-gateway-daemon-flow.ts`
- OpenClaw tool loop detection: `src/agents/tool-loop-detection.ts`
- Desktop health probe: `apps/controller/src/runtime/runtime-health.ts` (PR #725)
- Desktop wedge detection: `apps/controller/src/runtime/loops.ts` (PR #725)
- Sentry handled failure spec: `specs/change/20260326-desktop-handled-failure-sentry/spec.md`
