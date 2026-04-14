# OpenClaw Provider Registry Cache Invalidation

Date: 2026-04-14
Status: Shipped — PR #1094 (`fix(controller): restart OpenClaw on every provider/cloud change`)

## TL;DR

OpenClaw builds its provider/model registry **once at process boot** and does not re-read it when `openclaw.json` changes on disk. Every code path that mutates `models.providers` — cloud login/logout, BYOK add/delete/bulk-update, OAuth connect — must explicitly restart OpenClaw. In packaged desktop mode (where OpenClaw is supervised by launchd) the controller restart must go through `launchctl kickstart -k gui/<uid>/<label>`; `openclawProcess.stop()/start()` is a no-op because `env.manageOpenclawProcess === false`.

## Reported symptoms

1. **After Nexu cloud logout:** bot kept replying with `link/gemini-3.1-flash-lite-preview` even though `openclaw.json` on disk had `providers: []`.
2. **After Nexu cloud re-login:** bot errored with `FailoverError: Unknown model: link/gemini-3-flash-preview` despite `providers.link.models` clearly containing that id.
3. **After deleting BYOK providers:** bot errored with `No API key found for provider "openai-codex"` — the deleted provider's name — because OpenClaw's in-memory auth lookup still referenced it.

All three are the same class of bug: OpenClaw's registry and the on-disk config diverged.

## Root cause

Provider-level changes are not hot-reload-safe inside OpenClaw:

- `openclaw.json` is watched for skills, prompts, and some runtime state — but the `models.providers` block is consumed into an internal model registry at boot time only.
- Nexu compiles a fresh `openclaw.json` on every `syncAll()`, so disk state is always current.
- But absent a gateway restart, OpenClaw keeps whatever registry it built at boot.
- In packaged desktop the controller does not own the OpenClaw child process — launchd does. `openclawProcess.stop()/start()` early-returns when `env.manageOpenclawProcess === false` (`apps/controller/src/runtime/openclaw-process.ts:76-78, 117`). So the existing `container.ts` restart code was silently a no-op in packaged mode.
- Only the WhatsApp lifecycle path (`channel-service.ts:1586`) had already worked out the correct launchd pattern (`launchctl kickstart -k`). Nothing else used it.

## Fix

Three load-bearing changes:

| File | Change |
|---|---|
| `apps/controller/src/runtime/openclaw-process.ts` | New `restart(reason)` method handling both dev (`stop` + `start`) and launchd (`launchctl kickstart -k gui/<uid>/<label>`) modes |
| `apps/controller/src/app/container.ts` | `onCloudStateChanged` now always runs `ensureValidDefaultModel()` + `syncAll()` + `openclawProcess.restart("cloud_state_changed")` on every login/logout |
| `apps/controller/src/services/model-provider-service.ts` | `restartRuntime()` uses the new `restart()`; called from `setModelProviderConfigDocument`, `refreshNexuOfficialModels`, `deleteProvider`, MiniMax OAuth completion |

Supporting fixes surfaced during the investigation (independently real bugs):

- **`openclaw-config-compiler.ts` + `packages/shared/src/schemas/openclaw-config.ts`** — stop emitting `apiKey: ""` for OAuth providers (schema `apiKey` now `.optional()`). OpenClaw's normalizer rejected the entire `models.providers` block on `""`, which took `link` down with any OAuth entry.
- **`openclaw-auth-profiles-writer.ts`** — merge primary + fallback credentials (primary wins) instead of either-or, so Link auth survives when other providers coexist.
- **`nexu-config-store.ts`** — `disconnectDesktopCloud` clears managed default only if it was cloud-backed, preserving BYOK defaults.
- **`openclaw-sync-service.ts`** — strip `agents.defaults.model` + per-agent `model` when no providers exist; write locale-aware no-model guidance via `resolveNoModelConfiguredMessage(locale)`.
- **`openclaw-runtime-model-writer.ts`** — adds `writeNoModelState()`, `clear()`, bilingual (EN / zh-CN) no-model message helper.
- **`nexu-runtime-model/index.js`** — plugin no-ops cleanly when `selectedModelRef` is empty.

## Validated end-to-end (packaged desktop)

Observed `openclaw_restart_launchd_kickstarted domain=gui/501/io.nexu.openclaw` for each of:

| Transition | Restart reason |
|---|---|
| Cloud login | `cloud_state_changed` |
| Cloud logout | `cloud_state_changed` |
| BYOK add | `model_provider_config_changed` |
| BYOK delete | `model_provider_config_changed` |

Zero `Unknown model: link/*` errors across the full cycle. `openclaw.json` providers always matched the UI state post-transition.

## Known remaining gap (out of scope)

When **no** provider is configured, OpenClaw's hardcoded alias fallback (`anthropic/claude-opus-4-6`, defined in `openclaw/src/config/defaults.ts:21-34`) wins, so the user sees `No API key found for provider "anthropic"` instead of Nexu's bilingual `noModelMessage`. The message is written to `nexu-runtime-model.json` but no consumer on the Slack path reads it today. This is Layer 3 work: either a new OpenClaw plugin hook upstream, or a Nexu-side sentinel-override + channel-service rewrite. Does **not** modify OpenClaw source (hard rule).

## Retrospective: debugging bottleneck

Two traps consumed the most time:

1. **Treating the bug as a data-flow problem instead of a control-plane problem.** Early work focused on making `openclaw.json` correct on disk — which produced several real adjacent bugfixes (apiKey, auth-profiles merge, managed-default clearing) but never addressed the actual cause. OpenClaw's memory was ignored. Until the gateway is bounced, disk correctness is cosmetic.

2. **Dev-mode success masked the packaged-mode failure.** The existing `container.ts:stop() + start()` worked in `pnpm dev` and read as if the restart path was handled. In packaged desktop those calls are no-ops because OpenClaw runs under launchd, not as a controller child. The bug only reproduces in packaged mode, so every dev-mode smoke test gave false confidence.

**What would have short-circuited this:**

- **Compare memory vs. disk, not just disk.** The decisive evidence was `cat openclaw.json | grep link` (present ✅) + `openclaw.error.log` saying `Unknown model: link/...` simultaneously. Once we had that, the only viable hypothesis was "registry is stale."
- **Always smoke-test in packaged mode for anything touching `openclawProcess`.** Dev-mode tests won't catch the launchd-vs-child divergence.
- **Ratio of load-bearing to adjacent work on branch 1 was roughly 3:5:5** (fix : real-but-adjacent : cleanup). The carved-out branch 2 (#1094) shipped the combination that coherently explains itself.

## Related

- Branch (shipped): `fix/openclaw-restart-on-cloud-state-change`
- Parent branch (multi-commit accumulation): `fix/clear-model-on-provider-logout`
- OAuth-apiKey-empty root-cause detail: `/Users/alche/.claude/projects/-Users-alche-Documents-digit-sutando-nexu/memory/2026-04-14-oauth-apikey-empty-link-rejection.md`
- Pre-existing WhatsApp launchd pattern: `apps/controller/src/services/channel-service.ts:1586`
