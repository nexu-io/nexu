# Remove Deprecated API And Gateway Packages

## Goal

Fully remove `apps/api` and `apps/gateway` from the monorepo now that the controller-first path is the only supported runtime, and clean up repo code, tooling, deploy assets, docs, and generated artifacts that still assume the legacy packages exist.

## Success criteria

- `apps/api` and `apps/gateway` are deleted from the workspace.
- Root scripts, CI, tests, and build tooling no longer reference `@nexu/api` or `@nexu/gateway`.
- Web, desktop, and controller flows compile and run without legacy compatibility dependencies on API/gateway packages.
- Deploy and infrastructure assets no longer build, deploy, or route traffic to legacy API/gateway services.
- Repo docs describe the controller-first architecture as the only active path.

## Non-goals

- Rebuilding a new cloud multi-tenant control plane in the same change.
- Preserving backward compatibility for deploy assets that still assume the old API/gateway topology.
- Cleaning every product-contract compatibility field in one pass if it is already served by controller and no longer blocks package deletion.

## Current blockers

- Legacy runtime-control flow still exists in API/gateway code and deploy assets.
- CI, test aliases, and build verification still include the deleted packages.
- Helm, Kustomize, Docker, and PM2 assets still ship `nexu-api` and `nexu-gateway`.
- Docs still point engineers to `apps/api` and `apps/gateway` as retained legacy packages.
- Some root scripts still reference legacy package filters and need to be removed or redirected.

## Workstreams

### 1. Remove legacy runtime-control code paths

Delete the old API <-> gateway control-plane assumptions once controller is the only runtime owner.

- Remove API-side pool/runtime code.
  - `apps/api/src/routes/pool-routes.ts`
  - `apps/api/src/services/runtime/*`
  - legacy Slack event forwarding and other gateway-targeted internal routes
- Remove gateway-side pull/sync loop code.
  - config polling
  - skills/template polling
  - API heartbeat/session sync
  - OpenClaw process management that only exists for the sidecar package
- Audit controller, desktop, and web for compatibility shims that only exist because API/gateway packages still exist.
  - Keep controller-served compatibility endpoints only if they are still used by the product.
  - Remove compatibility fields or route branches that are now dead code.

Exit criteria:

- No runtime path depends on `apps/api` or `apps/gateway` source files.
- Controller owns all supported local runtime orchestration.
- Web SDK generation remains controller-based and green.

### 2. Clean workspace, tooling, and tests

Remove package-level references so repo-wide checks pass after deletion.

- Update root scripts in `package.json`.
  - Remove `dev:legacy` and `dev:legacy:gateway`.
  - Remove or redirect any remaining `@nexu/api` / `@nexu/gateway` script targets.
- Update build/test config.
  - `vitest.config.ts` aliases for `#api` and `#gateway`
  - `scripts/check-esm-specifiers.mjs` scans of `apps/api/dist` and `apps/gateway/dist`
  - `biome.json` ignore entries tied to API migration metadata
- Remove or migrate tests that still import legacy code or read legacy artifacts.
  - `tests/api/**`
  - `tests/gateway/**`
  - tests that read `apps/api/openapi.json`
- Delete stale generated assets tied to the old packages.
  - `apps/api/openapi.json`
  - `apps/gateway/dist/**`

Exit criteria:

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` pass without legacy package references.
- No repo config assumes the deleted packages still exist.

### 3. Remove deploy and infrastructure assets

Delete infrastructure that still builds or routes to legacy services.

- Remove Docker build contexts for the deleted packages.
  - `apps/api/Dockerfile`
  - `apps/gateway/Dockerfile`
  - `apps/gateway/Dockerfile.sandbox`
- Remove Helm resources and values for API/gateway services.
  - deployments/statefulsets
  - service/env/token wiring
  - ingress routes pointing to `nexu-api`
  - `/openapi.json` exposure from the legacy API service
- Remove Kustomize base and overlay resources for `nexu-api` and gateway pools.
- Remove PM2 or shell scripts that still launch `@nexu/gateway`.
- Audit deploy scripts under `deploy/workspace-templates/` and other automation that still calls legacy internal API endpoints or shells into gateway pods.

Exit criteria:

- No deploy manifest, Helm value, or automation script references `nexu-api` or `nexu-gateway`.
- Supported deployment docs reflect the new controller-first or future replacement topology only.

### 4. Delete packages and finish doc cleanup

Once the above is green, physically remove the packages and update docs everywhere they are still described.

- Delete `apps/api`.
- Delete `apps/gateway`.
- Update repo maps and architecture docs.
  - `AGENTS.md`
  - `ARCHITECTURE.md`
  - `specs/references/api-patterns.md`
  - `specs/RELIABILITY.md`
  - `specs/references/infrastructure.md`
  - `specs/guides/local-runtime-sidecar.md`
  - `specs/guides/gateway-environment-guide.md`
- Remove package-specific READMEs or replace with tombstones only if a migration note is still useful.
- Run a final grep for `@nexu/api`, `@nexu/gateway`, `apps/api`, `apps/gateway`, `nexu-api`, and `nexu-gateway`.

Exit criteria:

- Workspace has no `apps/api` or `apps/gateway` directories.
- Docs and repo search no longer describe them as active packages.

## Suggested execution order

1. Remove legacy runtime-control code from controller/web/desktop dependencies outward.
2. Clean test/tooling/build references until CI passes without the packages.
3. Remove infra and deploy assets for the old services.
4. Delete `apps/api` and `apps/gateway`.
5. Finish docs and repo-wide grep cleanup.

## Verification checklist

- `pnpm install`
- `pnpm generate-types`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm dev`
- `pnpm start` and basic controller-first smoke verification
- repo grep returns no active references to legacy packages/services

## Risk notes

- Infra cleanup can be destructive if any environment still deploys the old API/gateway topology. Confirm there is no remaining production dependency before removing manifests.
- Some controller/web contract fields still use legacy names like `gatewayConnected` or `poolId`. These should be audited, but they do not need to block package deletion unless they still require legacy code to function.
- Remove generated and built output only after their source references are gone, or CI may fail in confusing ways.

## Recommended implementation split

- PR 1: runtime-control code removal and compatibility cleanup
- PR 2: tests/tooling cleanup
- PR 3: deploy/infra removal
- PR 4: package deletion and docs sweep
