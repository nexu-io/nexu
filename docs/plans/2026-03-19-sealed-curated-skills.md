# Curated Strict, Community Loose — Desktop Skill Install Policy

**Goal:** Remove runtime `npm install` from desktop skill installation, keep curated skills sealed and runtime-ready, and allow community skills to install as file bundles even when extra dependency setup is still needed. Add explicit runtime-readiness state so `installed` no longer implies `fully usable`.

**Policy:**
- **Curated skills:** strict. Must be sealed and prepackaged for desktop. If not runtime-ready, installation fails.
- **Community skills:** loose. Installation means files are present and discoverable. If extra setup is needed, install still succeeds, but the skill is marked `runtimeReady: false` with a reason.

**Why:** Nexu needs a higher trust bar for curated skills, but broad compatibility for community skills. The bug is not loose community installs; the bug is conflating `installed` with `ready`.

## Scope

**Fix now:**
1. Remove PATH-dependent runtime dependency installation from desktop.
2. Repair curated uninstall persistence through the API path.
3. Repair Installed tab polling so background curated installs are not hidden early.
4. Introduce explicit readiness state for installed skills.
5. Apply strict validation to curated installs only.
6. Apply best-effort validation to community installs and surface warnings and readiness.

**Out of scope:**
- Full upstream packaging standard for all community skills
- Automated dependency resolution by the desktop app
- Generic package-manager execution during install

## Product Semantics

### Curated skills

- `installed` means: skill files are present and the skill passed desktop packaging validation.
- If packaging validation fails, install returns failure.
- Curated skills must not appear as installed unless they are runtime-ready.

### Community skills

- `installed` means: skill files are present and discoverable.
- `runtimeReady` indicates whether the skill appears executable in the packaged desktop environment.
- A community skill may be:
  - `installed: true`
  - `runtimeReady: false`
  - `readinessReason: "missing-packaging"` or similar
- The agent may help the user resolve readiness later.

## Task 1: Remove runtime `npm install` from desktop installs

**Files:**
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts`

**Changes:**
- Remove `installSkillDeps()` entirely.
- Remove all call sites from:
  - `installSkill()`
  - `installCuratedSkills()`

**Rule:**
- Desktop install must never invoke `npm`, `pnpm`, `npx`, or rely on user PATH.

**Checks:**
```bash
pnpm typecheck
pnpm lint
```

## Task 2: Add packaging and readiness validation helpers

**Files:**
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts`
- Modify: `apps/desktop/shared/skillhub-types.ts`
- Modify: `apps/api/src/lib/skill-scanner.ts`
- Modify: `apps/api/src/routes/skillhub-routes.ts`
- Modify: `apps/web/src/pages/skills.tsx`

**New model:**
```ts
type InstalledSkill = {
  slug: string;
  source: "bundled" | "extension" | "curated" | "managed" | "personal";
  pluginId?: string;
  runtimeReady?: boolean;
  readinessReason?: string;
};
```

**Add helper in desktop catalog manager:**
```ts
private validateSkillPackaging(skillDir: string): {
  runtimeReady: boolean;
  reason?: string;
} {
  if (!existsSync(resolve(skillDir, "package.json"))) {
    return { runtimeReady: true };
  }

  if (existsSync(resolve(skillDir, "node_modules"))) {
    return { runtimeReady: true };
  }

  return {
    runtimeReady: false,
    reason: "Skill has package.json but no vendored runtime dependencies",
  };
}
```

**Note:**
- This is a pragmatic heuristic for now.
- Later this can be replaced by explicit manifest metadata.

## Task 3: Make curated installs strict

**Files:**
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts`

**Changes:**
- In `installCuratedSkills()`, after each successful `clawhub install`, run packaging validation.
- If validation fails:
  - log a warning or error
  - remove the just-installed curated skill directory
  - treat the skill as failed
  - do not record it in curated installed state
- Only validated curated skills are returned as installed.

**Behavior:**
- Curated skills fail closed.
- Curated skills are Nexu-endorsed, so `installed` must mean runtime-ready.

**Checks:**
```bash
pnpm typecheck
pnpm lint
```

## Task 4: Make community installs loose but explicit

**Files:**
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts`

**Changes:**
- In `installSkill()`, after successful install:
  - run packaging validation
  - if validation fails, still return `ok: true`
  - but record and log readiness as `runtimeReady: false`
- Ensure `getCatalog()` and `scanAllSources()` can surface this readiness info for managed and community skills.

**Behavior:**
- Community install succeeds as file installation.
- UI must not imply the skill is fully ready if validation failed.

**Optional near-term fallback if persistence is too much for one patch:**
- Derive readiness at read time by scanning installed dirs again.

## Task 5: Persist curated removals in API uninstall path

**Files:**
- Modify: `apps/api/src/routes/skillhub-routes.ts`

**Problem being fixed:**
- Removing a curated skill through `/api/v1/skillhub/uninstall` currently deletes the folder but does not update the curated removal ledger.
- On next desktop launch, the curated installer puts it back.

**Changes:**
- When uninstalling from curated dir:
  - also record curated removal in the same curated state ledger used by desktop
- Keep API and desktop uninstall behavior aligned.

**Behavior:**
- Curated skill removal survives restart.

**Checks:**
```bash
pnpm typecheck
pnpm test
```

## Task 6: Fix Installed tab polling

**Files:**
- Modify: `apps/web/src/pages/skills.tsx`

**Problem being fixed:**
- Polling stops after one unchanged count, but curated installs run in background batches, so the count may temporarily stall before completion.

**Changes:**
- Remove the `same count twice means done` heuristic.
- Poll for the full timeout window, or until an explicit completion signal is available.
- Preferred simple fix:
  - poll every 3s for 30s unconditionally after mount
- Better future fix:
  - stop only when backend exposes install status or completion

**Behavior:**
- Installed tab does not hide in-progress curated installs prematurely.

## Task 7: Reflect readiness in API and UI

**Files:**
- Modify: `apps/api/src/routes/skillhub-routes.ts`
- Modify: `apps/web/src/pages/skills.tsx`

**Changes:**
- Include `runtimeReady` and `readinessReason` in installed skill payloads.
- In UI:
  - curated installed skill should appear normal only if ready
  - community installed skill with `runtimeReady: false` should show a badge like:
    - `Needs setup`
    - `Dependencies not packaged`
- Do not present these as fully working without qualification.

**Behavior:**
- `Installed` and `Ready` are clearly separated for community skills.

## Recommended Validation Rules

### Curated

- `package.json` without packaged runtime support => fail install
- Optional future stronger rule:
  - require `skillhub.json` or `nexu-skill.json`
  - require `packaged: true`

### Community

- Same validation runs
- Failure downgrades readiness, not install success

## Summary Table

| Skill type | Install success means | Validation failure result |
|---|---|---|
| Curated | Installed and runtime-ready | Install fails |
| Community | Files installed and discoverable | Install succeeds, `runtimeReady: false` |
| Bundled / extension / personal | Source-dependent | Surface readiness if possible, otherwise leave undefined |

## Follow-up

- Add explicit packaging manifest for skills instead of relying on `package.json` and `node_modules` heuristic
- Add `Finish setup` action for community skills with `runtimeReady: false`
- Let agent workflows help resolve community skill dependency and setup issues after install
- Consider backend install-status endpoint instead of polling heuristics
