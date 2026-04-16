# Channel-status masquerade on OpenClaw gateway WS failure

Date: 2026-04-15
Related issue: [#856](https://github.com/…/issues/856) — "All channel connection states are reset in version 0.1.10-nightly.20260406"

## Symptom

After an update to `0.1.10-nightly.20260406`, users reported every IM channel (Feishu, DingTalk, WeCom, …) showing as disconnected with a "Reconnect required" CTA, forcing them to re-authenticate channels whose tokens on disk were still valid. Reported as "all channel connection states were reset."

## Root cause

Not data loss. The controller's `openclaw-gateway-service.ts:getAllChannelsLiveStatus` has two fallback paths — a pre-check when the WebSocket is not connected, and a catch block when the RPC throws mid-flight. Both paths were returning:

```ts
{
  gatewayConnected: false,
  channels: channels.map((channel) => ({
    …,
    status: "disconnected",
    configured: false,
    lastError: null,
  })),
}
```

The web UI (home.tsx, channels.tsx) treats `status: "disconnected" + configured: false` as a credential failure — same as a revoked token — and renders the red "Reconnect required" affordance. When the OpenClaw gateway WS was transiently unreachable (gateway restart loop from the Apr 3–6 nightly, skillhub sync churn, langfuse reload, etc.), every channel reported disconnected and every user was prompted to re-auth, despite nothing being wrong with their credentials.

The channel records on disk (`~/.nexu/config.json`) were never touched — only the live-status reply lied.

## Fix

`apps/controller/src/services/openclaw-gateway-service.ts`: in both the WS-not-connected branch and the catch branch, report the degraded state honestly:

```ts
{
  gatewayConnected: false,
  channels: channels.map((channel) => ({
    …,
    status: "connecting",   // we cannot yet observe live state
    configured: true,       // credentials on disk are still valid
    lastError: null,
  })),
}
```

The web UI already renders `"connecting"` as an amber spinner with no re-auth CTA (see `apps/web/src/pages/home.tsx:273-327` `getChannelStatusMeta`). The existing top-level "Offline" pill (driven by `/api/internal/desktop/ready`) and the "Agent starting…" pill (driven by `agent.alive`) already communicate the gateway-unavailable state clearly — no new banner or copy was needed.

Now-unused `runtimeState` / `isBootPhasePreReady` threading was removed from the service; `container.ts` and 2 test fixtures updated for the simplified constructor.

## Why the Apr 10–14 fixes masked the defect

The catch block itself has existed for a long time; it only became visibly problematic in the `0.1.10-nightly.20260406` build because that nightly had several OpenClaw-reload loops that kept flipping the WS connection:

| Commit | Fix |
| --- | --- |
| `7a03c2b0` | batch skillhub sync to prevent OpenClaw restart loop |
| `87ea4cb9` | deterministic openclaw.json serialization (stops key-reorder reloads) |
| `02e73549` | make langfuse-tracer always-allow to avoid gateway restart |
| `bf631409` | stop emitting `apiKey: ""` for OAuth providers (OpenClaw was rejecting the whole models.providers block) |

Those commits stabilized the gateway so the catch block stopped firing in practice, which is why testers stopped seeing the symptom after Apr 14. The latent masquerade stayed on main until this PR: any future WS flap would have reproduced #856 exactly.

## Verification

### Unit
- `apps/controller/tests/openclaw-gateway-service.test.ts`: two new cases covering the WS-not-connected and RPC-throws branches assert `gatewayConnected: false`, `status: "connecting"`, `configured: true`.
- Existing tests (`apps/web/tests/channel-live-status.test.ts`, `apps/controller/tests/route-compat.test.ts`) pass against the simplified service constructor.
- `pnpm typecheck` ✅ • `pnpm lint` ✅ (0 errors from this change) • controller suite: 255 passing / 24 pre-existing failures unchanged.

### Packaged smoke test (macOS arm64, unsigned build)

Baseline: Feishu connected, "Running", "Agent running" (all green). `curl /api/v1/channels/live-status` → `gatewayConnected: true, agent.alive: true, status: "connected"`.

Kill OpenClaw: `launchctl bootout gui/$(id -u)/io.nexu.openclaw && kill -9 <pid>`

Expected (and observed):
- Header pill flips to red **"Offline"**
- Agent pill flips to amber **"Agent starting…"**
- Feishu row shows amber **"Connecting…"** — *no* red shield, *no* "Reconnect" CTA
- API: `gatewayConnected: false`, `status: "connecting"`, `configured: true`, `agent.alive: false`

Restart OpenClaw: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.nexu.openclaw.plist`

Expected (and observed):
- Within ~2–3s: all pills return to green, no re-auth required
- API: `gatewayConnected: true`, `status: "connected"`, `agent.alive: true`

## Supervision sidebar: OpenClaw auto-restart

Surfaced while smoke-testing. In the packaged desktop the OpenClaw plist is configured for automatic supervision:

```
KeepAlive.OtherJobEnabled."io.nexu.controller" = true   # respawn while controller alive
ThrottleInterval = 5                                    # min 5s between respawns
RunAtLoad = false
```

A crashed OpenClaw (e.g. OOM, `kill -9`) is automatically respawned by launchd within 5s as long as the controller is alive. Verified live: killed pid 59414, launchd respawned as pid 63386 without any user action, API recovered to healthy within one poll cycle.

Scenarios where OpenClaw can stay down:
1. The controller itself has died (KeepAlive is gated on `io.nexu.controller`).
2. Someone (or an updater) explicitly `launchctl bootout`s the plist — used in teardown, update-install, and smoke tests.
3. The `MAX_CONSECUTIVE_RESTARTS=10` circuit breaker in `daemon-supervisor-restart.test.ts` trips after 10 consecutive failed respawns.

So the "Offline" state we occasionally saw during testing was a direct artifact of the test-only `launchctl bootout`, not a production regression. Normal crashes self-heal without user action.

## Out of scope

- Root-causing future WS flaps. The Apr 10–14 stability fixes removed the known loops; further regressions belong in their own tickets.
- Changes to `ChannelLiveStatus` enum / `channelLiveStatusResponseSchema`. The `"connecting"` value already existed and renders correctly; adding a new `"unknown"` variant would require SDK regeneration and UI work for no additional user benefit.
- `openclaw-ws-client.ts` reconnection policy.
