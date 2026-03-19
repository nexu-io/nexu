# Controller Parity Remaining Checklist

## Goal

Track the remaining work required for `apps/controller` to fully replace the old local control-path responsibilities currently split across `apps/api`, `apps/gateway`, and parts of desktop runtime integration.

## Recent progress

- 2026-03-19: controller desktop sidecar replaced separate desktop API/gateway sidecars.
- 2026-03-19: controller compiler gained a larger config-generation parity slice for agent workspaces/defaults, BYOK provider mapping, desktop cloud link provider support, richer channel config emission, skills extraDirs, commands, and diagnostics defaults.
- 2026-03-19: controller channel storage moved closer to legacy account ID conventions for Slack/Discord and now persists Feishu connection mode metadata for config compilation.
- 2026-03-19: controller added local auth/user compatibility shims plus desktop-side cold-start simplification away from API DB bootstrap assumptions.
- 2026-03-19: controller channel routes added manual credential validation plus channel status and bot quota compatibility endpoints.
- 2026-03-19: controller lowdb store added schema-default migration preprocessing plus backup-based recovery coverage for broken primary config files.
- 2026-03-19: controller added compatibility routes for local auth/user, invite validation, desktop model/cloud stubs, shared-slack claim resolution, Feishu bind URL, and skillhub endpoints so web/desktop can target controller OpenAPI directly.
- 2026-03-19: web SDK generation now points at `apps/controller/openapi.json` and web typecheck passes against controller-generated SDK output.
- 2026-03-19: controller sessions runtime now supports internal create/update plus public get/list/reset/delete flows backed by OpenClaw-side filesystem session state.
- 2026-03-19: controller integration routes now expose a controller-managed toolkit catalog with list/connect/refresh/delete compatibility shapes that satisfy current web callers.
- 2026-03-19: local-only secret handling is treated as a lower-priority hardening concern for now, not a blocker for controller parity work.
- 2026-03-19: controller test coverage now includes route-level compatibility checks plus end-to-end sync coverage for store -> compiler -> runtime writers.
- 2026-03-19: desktop dev diagnostics and cold-start logs confirm controller-first boot succeeds with `controller + pglite + web + openclaw`, and runtime unit metadata still populates in desktop diagnostics.
- 2026-03-19: current controller file IO is now confined to `src/store/*` and `src/runtime/*`, and current web local callers compile against controller-generated SDK output without API-only client gaps.
- 2026-03-19: controller manual Slack and Discord channel connects now validate live credentials before persisting local channel state, and preserve bot user ids for local UX.
- 2026-03-19: controller channel HTTP surface now covers list/connect/status/disconnect/quota flows for Slack, Discord, and Feishu local manual setup.
- 2026-03-19: cloud-specific integration work is intentionally deferred for now; controller integration parity is tracked against the local credential-based lifecycle used by current local web flows.
- 2026-03-19: controller store now exposes semantic methods for profile, cloud state, secrets, channels, providers, integrations, templates, skills, and runtime config updates instead of route/service-level raw JSON mutation.
- 2026-03-19: for controller parity tracking, compiler/channel/runtime validation is now judged against the current local controller-first desktop path rather than obsolete SaaS-only branches from `apps/api`.
- 2026-03-19: local-only scope does not currently require extra secret-storage hardening beyond filesystem persistence under the user-owned home directory.
- 2026-03-19: desktop cold-start/dev diagnostics, controller route tests, and sync/writer integration tests now cover the accepted local verification scope for controller parity.
- 2026-03-19: root local dev docs/scripts now point at the controller-first path by default, desktop CI path filters no longer treat `apps/api` / `apps/gateway` changes as desktop-runtime triggers, and the old local sidecar guide is explicitly marked deprecated.
- 2026-03-19: repo audit still shows `apps/api` / `apps/gateway` are required by legacy DB scripts, deploy manifests, Helm templates, and other SaaS/runtime assets, so package deletion remains blocked even though local desktop parity is complete.

## P0 - Runtime correctness and migration blockers

- [x] Reach compiler parity in `apps/controller/src/lib/openclaw-config-compiler.ts` for the current local controller-first desktop/runtime path.
- [x] Port full channel credential/config compilation needed by the current Slack/Discord/Feishu local manual-connect flows, including account key formats and controller-managed secret usage rules.
- [x] Verify generated OpenClaw config against real desktop/local runtime scenarios, not only schema validation.
- [x] Replace placeholder provider/model mapping with the real provider semantics used by current Nexu routes and runtime paths.
- [x] Finish controller-side OpenClaw process lifecycle behavior: startup sequencing, restart policy, readiness gating, stale lock cleanup, and failure diagnostics.
- [x] Add stronger sync-state reporting for config, skills, templates, and runtime health so desktop can diagnose degraded states.

## P0 - HTTP/API parity required by desktop and web

- [x] Audit every route currently used by desktop/web local flows and confirm whether `apps/controller` already serves it, needs a compatibility shape, or should be intentionally removed.
- [x] Complete channel route parity in `apps/controller/src/routes/channel-routes.ts` and `apps/controller/src/services/channel-service.ts`.
- [x] Remove Slack OAuth-specific route/flow expectations from the remaining parity scope and keep only manual/local connection support.
- [x] Port the remaining Slack manual connect validation and conflict handling semantics from `apps/api/src/routes/channel-routes.ts`.
- [x] Port the remaining Discord manual validation and conflict handling semantics from `apps/api/src/routes/channel-routes.ts`.
- [x] Port the missing Feishu validation and reconnect semantics from `apps/api/src/routes/channel-routes.ts`.
- [x] Add channel status/quota endpoints if desktop/web still depend on them.
- [x] Complete integration route parity in `apps/controller/src/routes/integration-routes.ts` and `apps/controller/src/services/integration-service.ts`.
- [x] Replace the current simplified integration storage with a controller-managed local credential lifecycle suitable for current local product flows (cloud-specific lifecycle deferred).
- [x] Complete session route parity in `apps/controller/src/routes/session-routes.ts` and `apps/controller/src/services/session-service.ts`.
- [x] Add missing session actions such as preview, delete, reset, or transcript-derived metadata if still required by current UX.
- [x] Confirm workspace template and skills internal endpoints match the shapes expected by desktop runtime code.

## P0 - Local persistence and data model hardening

- [x] Add schema-version migration handling for `~/.nexu/config.json`.
- [x] Add backup/recovery handling for corrupted config files beyond the current default-reset fallback.
- [x] Ensure store writes are safely serialized and robust against interrupted writes.
- [x] Decide whether any additional secret-storage hardening is still needed for controller-managed local state in local-only environments.
- [x] Move any remaining direct file-write logic behind `apps/controller/src/store/*` or explicit runtime writers.
- [x] Add semantic store APIs for all domains that still manipulate raw JSON-like structures.

## P1 - Desktop integration parity

- [x] Audit `apps/desktop` for remaining API-era assumptions and convert them to controller-native behavior.
- [x] Replace remaining desktop auth/session assumptions that still rely on old API concepts where appropriate.
- [x] Verify desktop cold start end-to-end with `controller + pglite + web + openclaw` only.
- [x] Verify packaged desktop runtime works with the new controller sidecar layout.
- [x] Remove dead desktop code paths that only existed for separate API/gateway sidecars.
- [x] Ensure runtime logs, diagnostics, and unit metadata still make sense after the controller-sidecar swap.

## P1 - Frontend and SDK migration

- [x] Point web local mode to controller-specific OpenAPI directly while preserving compatibility with the old `apps/api` contract.
- [x] Regenerate and validate SDK/types using controller OpenAPI as the intended source of truth.
- [x] Update frontend callers that still assume old multi-tenant/API-auth behavior when running locally.

## P1 - Behavior verification

- [x] Add integration tests for controller store -> compiler -> runtime writers.
- [x] Add route-level tests for bots, channels, integrations, sessions, artifacts, skills, templates, and runtime config.
- [x] Add desktop-oriented acceptance coverage for cold start and readiness.
- [x] Validate controller-managed Slack/Discord/Feishu connection flows against controller within the accepted local/manual verification scope.
- [x] Validate skills hot reload and workspace template sync within the accepted local writer/materialization verification scope.

## P2 - Cleanup and repo-level migration finish

- [x] Mark the old local runtime path in `apps/api` and `apps/gateway` as deprecated in docs.
- [ ] Remove or isolate legacy code paths only after controller-based desktop/local flow is proven stable.
- [x] Update architecture and execution-plan docs so they describe the controller-first path as the active implementation.
- [ ] Sync any important migration findings into project memory and cross-project knowledge if needed.

## Suggested execution order

1. Compiler parity and runtime correctness
2. Channel/integration/session route parity
3. Store hardening and secret strategy
4. Desktop end-to-end parity and packaged runtime verification
5. Frontend/SDK cleanup
6. Legacy-path deprecation and documentation cleanup
