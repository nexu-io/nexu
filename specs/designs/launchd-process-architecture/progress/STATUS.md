# Implementation Status

**Last Updated**: 2026-03-23
**Branch**: `refactor/launchd-process-architecture`

---

## Overall Progress

| Phase | Status | Notes |
|-------|--------|-------|
| 1. LaunchdManager service | **Done** | Core launchd wrapper |
| 2. Plist generation | **Done** | Controller + OpenClaw templates |
| 3. Embedded Web Server | **Done** | Replace web sidecar |
| 4. Bootstrap flow | **Done** | Desktop startup sequence |
| 5. Exit behavior | **Done** | Quit dialog + graceful shutdown |
| 6. Dev mode scripts | **Done** | launchd-based dev workflow |
| 7. Logging unification | **Done** | Unified to ~/.nexu/logs/ |
| 8. Testing | Not Started | Integration tests |

---

## Current Task

**Phase 8** - Integration tests

---

## Completed

- [x] Design document (PR #356 merged)
- [x] Cherry-pick WebSocket close code fix (PR #365)
- [x] Change namespace to `io.nexu.*`
- [x] LaunchdManager service (`apps/desktop/main/services/launchd-manager.ts`)
- [x] Plist generator (`apps/desktop/main/services/plist-generator.ts`)
- [x] Embedded web server (`apps/desktop/main/services/embedded-web-server.ts`)
- [x] Bootstrap flow (`apps/desktop/main/services/launchd-bootstrap.ts`)
- [x] Logging unified to `~/.nexu/logs/`
- [x] Quit handler (`apps/desktop/main/services/quit-handler.ts`)
- [x] Dev mode script (`scripts/dev-launchd.sh`)
- [x] Integration into index.ts (behind feature flag)

---

## Blockers

None currently.

---

## TODO Checklist

### Phase 1: LaunchdManager Service
- [ ] Create `apps/desktop/src/main/services/launchd-manager.ts`
- [ ] Implement `installService()`, `uninstallService()`
- [ ] Implement `startService()`, `stopService()`, `stopServiceGracefully()`
- [ ] Implement `getServiceStatus()`, `isServiceRegistered()`, `isServiceInstalled()`
- [ ] Add unit tests

### Phase 2: Plist Generation
- [ ] Create `apps/desktop/src/main/services/plist-generator.ts`
- [ ] Controller plist template
- [ ] OpenClaw plist template
- [ ] Dev vs prod label handling

### Phase 3: Embedded Web Server
- [ ] Create `apps/desktop/src/main/embedded-web-server.ts`
- [ ] Static file serving with async fs
- [ ] API proxy to Controller
- [ ] SPA fallback logic

### Phase 4: Bootstrap Flow
- [ ] Modify `apps/desktop/main/index.ts` for launchd bootstrap
- [ ] Service installation on first run
- [ ] Health check and readiness waiting

### Phase 5: Exit Behavior
- [ ] Implement quit dialog (Quit Completely / Run in Background / Cancel)
- [ ] Graceful service shutdown

### Phase 6: Dev Mode
- [ ] Create `scripts/dev-launchd.sh`
- [ ] Dev plist templates
- [ ] Cleanup on script exit

### Phase 7: Logging
- [ ] Unify log paths to `~/.nexu/logs/`
- [ ] Update Controller log config
- [ ] Update OpenClaw log config

### Phase 8: Testing
- [ ] LaunchdManager unit tests
- [ ] Embedded web server tests
- [ ] Integration tests
