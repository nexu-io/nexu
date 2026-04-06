# Model Provider Registry + OpenClaw SSoT Remaining Work

Date: 2026-04-05

Related plan:

- `specs/plans/2026-04-04-model-provider-registry-ssot-plan.md`

## Strict implementation sequence

### 1. Expand registry + alias coverage first

- [x] Add missing registry entries:
  - [x] `mistral`
  - [x] `xai`
  - [x] `together`
  - [x] `huggingface`
  - [x] `qwen`
  - [x] `volcengine`
  - [x] `qianfan`
  - [x] `vllm`
  - [x] `byteplus`
  - [x] `venice`
  - [x] `github-copilot`
  - [x] `xiaomi`
  - [x] `chutes`
- [x] Add/verify alias normalization for the new entries
- [x] Decide which of those providers should be visible in the Models UI vs hidden

### 2. Finalize the API surface before removing legacy routes

- [x] Decide whether instance-oriented APIs are required (`config.models.providers` stays the canonical CRUD surface; no duplicate instance CRUD helpers yet)
- [x] Add the non-legacy validation surface needed before removing legacy routes:
  - [x] `POST /api/v1/model-providers/{providerId}/validate`
  - [x] `POST /api/v1/model-providers/instances/validate`
- [x] Add the non-legacy OAuth aliases still required by the Models page:
  - [x] `POST /api/v1/model-providers/{providerId}/oauth/start`
  - [x] `GET /api/v1/model-providers/{providerId}/oauth/status`
  - [x] `GET /api/v1/model-providers/{providerId}/oauth/provider-status`
  - [x] `POST /api/v1/model-providers/{providerId}/oauth/disconnect`
  - [x] `GET /api/v1/model-providers/minimax/oauth/status`
  - [x] `POST /api/v1/model-providers/minimax/oauth/login`
  - [x] `DELETE /api/v1/model-providers/minimax/oauth/login`
- [x] Confirm long-term validation API shape for protocol-aware custom providers (instance-key-scoped validation while canonical writes stay config-document-based)

### 3. Finish persisted model-ref migration

- [x] Rewrite legacy provider-prefixed refs to canonical form on save
- [x] Remove product-facing dependence on `byok_*` refs
- [x] Verify custom-instance runtime refs stay deterministic across restarts
- [x] Audit all persisted model-ref locations that still need rewrite coverage

### 4. Cut over persistence to canonical-only writes

- [x] Stop writing legacy `config.providers`
- [x] Keep migration-read compatibility only for old configs
- [x] Add a migration/version marker for the canonical `config.models.providers` cutover

### 5. Remove transitional legacy APIs and controller assumptions

- [x] Remove legacy `/api/v1/providers/*` CRUD routes after consumers move off them
- [x] Remove remaining legacy provider assumptions from controller services/store

### 6. Final cleanup

- [x] Verify web flows use registry + canonical config only
- [x] Verify controller sync/compiler paths no longer depend on legacy provider semantics
- [x] Delete any leftover compatibility-only code once the migration window closes

## Done when

- [x] `config.models.providers` is the only canonical persisted provider config
- [x] legacy `config.providers` is read-only for migration or deleted
- [x] legacy provider CRUD APIs are removed
- [ ] registry contains the agreed provider inventory + alias coverage
- [x] web flows use registry + canonical config only
- [x] saved model refs are canonicalized
- [x] custom provider keys/runtime refs are stable and deterministic
