# Curated Skills First-Launch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Pre-install a curated set of community skills into `state/bundled-skills/` on first launch, so new users have useful skills out of the box without browsing the catalog.

**Architecture:** Add a `state/bundled-skills/` directory alongside the existing `state/skills/`. On first launch (detected by absence of a stamp file), the CatalogManager installs 8 curated skills from ClawHub into this directory. The skill scanner and OpenClaw config treat it as a separate `extraDirs` entry with its own source tag `"curated"`. Users can uninstall curated skills. On app update, missing curated skills are re-installed (unless user explicitly uninstalled them — tracked via a removals ledger).

**Tech Stack:** TypeScript, Electron (desktop main process), clawhub CLI, filesystem stamp file

---

## Curated Skills List

**8 skills to install from ClawHub:**

| Skill | ClawHub Slug |
|-------|-------------|
| File Organizer | `file-organizer-skill` |
| Email (IMAP/SMTP) | `imap-smtp-email` |
| Calendar | `calendar` |
| Multi Search Engine | `multi-search-engine` |
| Xiaohongshu | `xiaohongshu-mcp` |
| Humanize AI Text | `humanize-ai-text` |
| Find Skills | `find-skills` |
| Skill Vetter | `skill-vetter` |

**11 skills already bundled in OpenClaw (no action needed):**
`1password`, `apple-notes`, `clawhub`, `coding-agent`, `github`, `gh-issues`, `healthcheck`, `session-logs`, `skill-creator`, `video-frames`, `weather`

---

### Task 1: Add curated skills directory path helper

**Files:**
- Modify: `apps/desktop/shared/desktop-paths.ts`

**Step 1: Add the path helper**

Add after existing exports:

```typescript
export function getOpenclawCuratedSkillsDir(userDataPath: string): string {
  return resolve(userDataPath, "runtime/openclaw/state/bundled-skills");
}
```

**Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```
feat(desktop): add curated skills directory path helper
```

---

### Task 2: Pass curated skills dir to API sidecar and ensure directory exists

**Files:**
- Modify: `apps/desktop/main/runtime/manifests.ts`

**Step 1: Update import**

Add `getOpenclawCuratedSkillsDir` to the import from `../../shared/desktop-paths`.

**Step 2: Ensure directory is created at startup**

After the existing `ensureDir(getOpenclawSkillsDir(userDataPath))` line (around line 241), add:

```typescript
ensureDir(getOpenclawCuratedSkillsDir(userDataPath));
```

**Step 3: Add env var to API sidecar manifest**

In the API sidecar env block (the `id: "api"` manifest entry), add after `OPENCLAW_BUNDLED_SKILLS_DIR`:

```typescript
OPENCLAW_CURATED_SKILLS_DIR: getOpenclawCuratedSkillsDir(userDataPath),
```

**Step 4: Add env var to gateway sidecar manifest**

In the gateway sidecar env block (the `id: "gateway"` manifest entry), add:

```typescript
OPENCLAW_CURATED_SKILLS_DIR: getOpenclawCuratedSkillsDir(userDataPath),
```

**Step 5: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 6: Commit**

```
feat(desktop): ensure curated skills dir and pass to sidecars
```

---

### Task 3: Add curated skills dir to OpenClaw config generator extraDirs

The config generator must include `state/bundled-skills/` in `extraDirs` so OpenClaw loads curated skills.

**Files:**
- Modify: `apps/api/src/lib/config-generator.ts` (around line 682-688, the `config.skills` block)

**Step 1: Read the current config.skills block**

Find the block that sets `config.skills`:

```typescript
config.skills = {
  load: {
    watch: true,
    watchDebounceMs: 250,
    extraDirs: [`${stateDir}/skills`],
  },
};
```

**Step 2: Add curated skills dir to extraDirs**

Update to:

```typescript
const curatedSkillsDir = process.env.OPENCLAW_CURATED_SKILLS_DIR ?? `${stateDir}/bundled-skills`;

config.skills = {
  load: {
    watch: true,
    watchDebounceMs: 250,
    extraDirs: [
      `${stateDir}/bundled-skills`,
      `${stateDir}/skills`,
    ],
  },
};
```

Note: `bundled-skills` comes first in the array because `extraDirs` is the lowest precedence tier — and within `extraDirs`, later entries override earlier ones (they're iterated in order and inserted into the same Map). So `state/skills/` (user installs) should come after `state/bundled-skills/` (curated) to ensure user installs override curated defaults with the same name.

**Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```
feat(api): add curated skills dir to OpenClaw extraDirs config
```

---

### Task 4: Update skill scanner to support curated source

**Files:**
- Modify: `apps/api/src/lib/skill-scanner.ts`
- Modify: `tests/api/lib/skill-scanner.test.ts`

**Step 1: Write the failing test**

Add to the test file:

```typescript
it("scans curated skills directory", () => {
  const curatedDir = resolve(tempRoot, "curated");
  writeSkill(curatedDir, "multi-search-engine");
  writeSkill(curatedDir, "find-skills");

  const result = scanInstalledSkills({ curatedDir });
  expect(result).toHaveLength(2);
  expect(result).toContainEqual({ slug: "multi-search-engine", source: "curated" });
  expect(result).toContainEqual({ slug: "find-skills", source: "curated" });
});

it("managed overrides curated with same slug", () => {
  const curatedDir = resolve(tempRoot, "curated");
  const managedDir = resolve(tempRoot, "managed");
  writeSkill(curatedDir, "find-skills");
  writeSkill(managedDir, "find-skills");

  const result = scanInstalledSkills({ curatedDir, managedDir });
  const skill = result.find((s) => s.slug === "find-skills");
  expect(skill?.source).toBe("managed");
  expect(result).toHaveLength(1);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/api/lib/skill-scanner.test.ts`
Expected: FAIL — `curatedDir` not in `ScanDirs` type

**Step 3: Update the types and scanner**

In `skill-scanner.ts`, update the `SkillSource` type:

```typescript
export type SkillSource = "bundled" | "extension" | "curated" | "managed" | "personal";
```

Update `ScanDirs`:

```typescript
export type ScanDirs = {
  bundledDir?: string;
  extensionsDir?: string;
  curatedDir?: string;
  managedDir?: string;
  personalDir?: string;
};
```

Update `scanInstalledSkills` — add curated tier between extension and managed:

```typescript
// Tier 3: curated (Nexu-bundled defaults)
for (const slug of scanDir(dirs.curatedDir ?? "")) {
  merged.set(slug, { slug, source: "curated" });
}
```

Full precedence order in the function:
1. bundled (lowest)
2. extension
3. curated
4. managed
5. personal (highest)

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/api/lib/skill-scanner.test.ts`
Expected: PASS (all 10 tests)

**Step 5: Commit**

```
feat(api): add curated source to skill scanner
```

---

### Task 5: Update API route to include curated skills dir

**Files:**
- Modify: `apps/api/src/routes/skillhub-routes.ts`

**Step 1: Update the schema**

In `installedSkillSchema`, add `"curated"` to the source enum:

```typescript
const installedSkillSchema = z.object({
  slug: z.string(),
  source: z.enum(["bundled", "extension", "curated", "managed", "personal"]),
  pluginId: z.string().optional(),
});
```

**Step 2: Add env getter**

Add near the other env getters:

```typescript
function getCuratedSkillsDir(): string | undefined {
  return process.env.OPENCLAW_CURATED_SKILLS_DIR;
}
```

**Step 3: Update the catalog route handler**

Add `curatedDir` to the `scanInstalledSkills` call:

```typescript
const installedSkills = scanInstalledSkills({
  bundledDir: getBundledSkillsDir(),
  extensionsDir: getExtensionsDir(),
  curatedDir: getCuratedSkillsDir(),
  managedDir: getSkillsDir(),
  personalDir: getPersonalSkillsDir(),
});
```

**Step 4: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```
feat(api): include curated skills dir in catalog scan
```

---

### Task 6: Update desktop CatalogManager with curated skills support

**Files:**
- Modify: `apps/desktop/shared/skillhub-types.ts`
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts`

**Step 1: Update shared types**

In `skillhub-types.ts`, update `SkillSource`:

```typescript
export type SkillSource = "bundled" | "extension" | "curated" | "managed" | "personal";
```

**Step 2: Add curated dir to CatalogManager**

Import `getOpenclawCuratedSkillsDir` from desktop-paths.

Add private property:

```typescript
private readonly curatedSkillsDir: string;
```

Initialize in constructor:

```typescript
this.curatedSkillsDir = getOpenclawCuratedSkillsDir(userDataPath);
```

**Step 3: Update scanAllSources()**

Add curated tier between extension and managed:

```typescript
// Tier 3: Curated (Nexu defaults)
for (const slug of this.scanDir(this.curatedSkillsDir)) {
  merged.set(slug, { slug, source: "curated" });
}
```

**Step 4: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```
feat(desktop): add curated tier to CatalogManager scanner
```

---

### Task 7: Implement first-launch curated skills installer

This is the core logic: on first launch, install 8 curated skills from ClawHub into `state/bundled-skills/`.

**Files:**
- Create: `apps/desktop/main/skillhub/curated-skills.ts`
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts`

**Step 1: Create the curated skills module**

```typescript
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Slugs of community skills to pre-install for new users.
 * These are installed into `state/bundled-skills/` on first launch.
 *
 * Skills already bundled in OpenClaw (1password, apple-notes, clawhub,
 * coding-agent, github, gh-issues, healthcheck, session-logs,
 * skill-creator, video-frames, weather) are NOT listed here.
 */
export const CURATED_SKILL_SLUGS: readonly string[] = [
  "file-organizer-skill",
  "imap-smtp-email",
  "calendar",
  "multi-search-engine",
  "xiaohongshu-mcp",
  "humanize-ai-text",
  "find-skills",
  "skill-vetter",
] as const;

type CuratedState = {
  /** Slugs the user explicitly uninstalled — don't re-install on update */
  removedByUser: string[];
  /** Last set of slugs we attempted to install */
  lastInstalledVersion: string[];
};

function readState(statePath: string): CuratedState {
  if (!existsSync(statePath)) {
    return { removedByUser: [], lastInstalledVersion: [] };
  }
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as CuratedState;
  } catch {
    return { removedByUser: [], lastInstalledVersion: [] };
  }
}

function writeState(statePath: string, state: CuratedState): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

export type CuratedInstallResult = {
  installed: string[];
  skipped: string[];
  failed: string[];
};

/**
 * Returns the list of curated skill slugs that need to be installed.
 * Skips slugs the user explicitly removed and slugs already present on disk.
 */
export function resolveCuratedSkillsToInstall(params: {
  curatedDir: string;
  statePath: string;
}): { toInstall: string[]; toSkip: string[] } {
  const state = readState(params.statePath);
  const removedSet = new Set(state.removedByUser);
  const toInstall: string[] = [];
  const toSkip: string[] = [];

  for (const slug of CURATED_SKILL_SLUGS) {
    if (removedSet.has(slug)) {
      toSkip.push(slug);
      continue;
    }
    const skillDir = resolve(params.curatedDir, slug);
    if (existsSync(resolve(skillDir, "SKILL.md"))) {
      toSkip.push(slug);
      continue;
    }
    toInstall.push(slug);
  }

  return { toInstall, toSkip };
}

/**
 * Records that the user explicitly uninstalled a curated skill,
 * so it won't be re-installed on the next app update.
 */
export function recordCuratedRemoval(params: {
  slug: string;
  statePath: string;
}): void {
  const state = readState(params.statePath);
  if (!state.removedByUser.includes(params.slug)) {
    state.removedByUser.push(params.slug);
    writeState(params.statePath, state);
  }
}

/**
 * Updates the state file after a successful installation round.
 */
export function recordCuratedInstallation(params: {
  statePath: string;
  installed: string[];
}): void {
  const state = readState(params.statePath);
  state.lastInstalledVersion = [...CURATED_SKILL_SLUGS];
  writeState(params.statePath, state);
}
```

**Step 2: Add `installCuratedSkills` method to CatalogManager**

In `catalog-manager.ts`, import from the new module:

```typescript
import {
  CURATED_SKILL_SLUGS,
  recordCuratedInstallation,
  recordCuratedRemoval,
  resolveCuratedSkillsToInstall,
  type CuratedInstallResult,
} from "./curated-skills";
```

Add a private property for the state file path:

```typescript
private readonly curatedStatePath: string;
```

Initialize in constructor:

```typescript
this.curatedStatePath = resolve(this.curatedSkillsDir, ".curated-state.json");
```

Add the install method:

```typescript
async installCuratedSkills(): Promise<CuratedInstallResult> {
  const { toInstall, toSkip } = resolveCuratedSkillsToInstall({
    curatedDir: this.curatedSkillsDir,
    statePath: this.curatedStatePath,
  });

  if (toInstall.length === 0) {
    this.log("info", `curated skills: nothing to install (${toSkip.length} skipped)`);
    return { installed: [], skipped: toSkip, failed: [] };
  }

  this.log("info", `curated skills: installing ${toInstall.length} skills`);

  const installed: string[] = [];
  const failed: string[] = [];

  for (const slug of toInstall) {
    try {
      const clawHubBin = resolveClawHubBin();
      await execFileAsync(process.execPath, [
        clawHubBin,
        "install",
        slug,
        "--force",
        "--dir",
        this.curatedSkillsDir,
      ]);
      installed.push(slug);
      this.log("info", `curated install ok: ${slug}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push(slug);
      this.log("error", `curated install failed: ${slug} — ${message}`);
    }
  }

  recordCuratedInstallation({
    statePath: this.curatedStatePath,
    installed,
  });

  return { installed, skipped: toSkip, failed };
}
```

Update `uninstallSkill` to record curated removals. Add this check inside `uninstallSkill`, after the successful `rmSync`:

```typescript
// If this was a curated skill, record the removal so it isn't re-installed
if (CURATED_SKILL_SLUGS.includes(slug)) {
  recordCuratedRemoval({ slug, statePath: this.curatedStatePath });
}
```

Wait — `uninstallSkill` only operates on `this.skillsDir` (managed skills). Curated skills live in `this.curatedSkillsDir`. We need to update `uninstallSkill` to also check the curated dir. Update the method:

```typescript
async uninstallSkill(slug: string): Promise<{ ok: boolean; error?: string }> {
  if (!isValidSlug(slug)) {
    this.log("warn", `uninstall rejected slug=${slug} — invalid slug`);
    return { ok: false, error: "Invalid skill slug" };
  }

  this.log("info", `uninstalling skill slug=${slug}`);
  try {
    // Check managed dir first, then curated dir
    const managedPath = resolveSkillPath(this.skillsDir, slug);
    const curatedPath = resolveSkillPath(this.curatedSkillsDir, slug);

    let removed = false;

    if (managedPath && existsSync(managedPath)) {
      rmSync(managedPath, { recursive: true, force: true });
      removed = true;
      this.log("info", `uninstall ok (managed) slug=${slug}`);
    }

    if (curatedPath && existsSync(curatedPath)) {
      rmSync(curatedPath, { recursive: true, force: true });
      removed = true;
      this.log("info", `uninstall ok (curated) slug=${slug}`);
      recordCuratedRemoval({ slug, statePath: this.curatedStatePath });
    }

    if (!removed) {
      this.log("warn", `uninstall skip slug=${slug} — dir not found`);
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    this.log("error", `uninstall failed slug=${slug}: ${message}`);
    return { ok: false, error: message };
  }
}
```

**Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```
feat(desktop): implement curated skills installer with removal tracking
```

---

### Task 8: Trigger curated skills install on app startup

**Files:**
- Modify: `apps/desktop/main/index.ts` (around line 577, after `catalogMgr.start()`)

**Step 1: Find the CatalogManager start() call**

Look for:
```typescript
catalogMgr.start();
```

**Step 2: Add curated skills installation after it**

```typescript
catalogMgr.start();

// Install curated skills on first launch (or re-install missing ones on update).
// Runs in background — does not block window creation.
void catalogMgr.installCuratedSkills().catch((err) => {
  log("error", `curated skills setup failed: ${String(err)}`);
});
```

This is fire-and-forget — it doesn't block the main window from appearing. Skills install in the background while the user sees the app.

**Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```
feat(desktop): trigger curated skills install on startup
```

---

### Task 9: Update API uninstall route to support curated dir

The API server's uninstall handler also needs to check the curated dir.

**Files:**
- Modify: `apps/api/src/routes/skillhub-routes.ts`

**Step 1: Add curated dir to uninstall logic**

Update the `skillhubUninstallRoute` handler. After removing from `skillsDir`, also check and remove from curated dir:

```typescript
app.openapi(skillhubUninstallRoute, async (c) => {
  const { slug } = c.req.valid("json");
  const skillsDir = getSkillsDir();
  const curatedDir = getCuratedSkillsDir();

  logger.info({ slug }, "skillhub uninstall requested");

  if (!skillsDir && !curatedDir) {
    logger.error({ slug }, "skillhub uninstall failed: no skills dirs configured");
    return c.json({ ok: false, error: "Skills directory not configured" }, 200);
  }

  try {
    let removed = false;

    // Check managed dir
    if (skillsDir) {
      const managedPath = resolveSkillhubPath(skillsDir, slug);
      if (managedPath && existsSync(managedPath)) {
        rmSync(managedPath, { recursive: true, force: true });
        removed = true;
        logger.info({ slug }, "skillhub uninstall ok (managed)");
      }
    }

    // Check curated dir
    if (curatedDir) {
      const curatedPath = resolveSkillhubPath(curatedDir, slug);
      if (curatedPath && existsSync(curatedPath)) {
        rmSync(curatedPath, { recursive: true, force: true });
        removed = true;
        logger.info({ slug }, "skillhub uninstall ok (curated)");
      }
    }

    if (!removed) {
      logger.warn({ slug }, "skillhub uninstall skipped: dir not found");
    }

    return c.json({ ok: true }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ slug, error: message }, "skillhub uninstall failed");
    return c.json({ ok: false, error: message }, 200);
  }
});
```

**Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```
feat(api): support uninstalling curated skills
```

---

### Task 10: Update frontend types and UI labels

**Files:**
- Modify: `apps/web/src/types/desktop.d.ts`
- Modify: `apps/web/src/pages/skills.tsx`

**Step 1: Update SkillSource type**

In `desktop.d.ts`, update:

```typescript
export type SkillSource = "bundled" | "extension" | "curated" | "managed" | "personal";
```

**Step 2: Add curated to SOURCE_LABELS and SOURCE_ORDER**

In `skills.tsx`, update the constants:

```typescript
const SOURCE_LABELS: Record<string, { label: string; description: string }> = {
  managed: { label: "Installed", description: "Community skills you installed" },
  curated: { label: "Recommended", description: "Pre-installed skills recommended by Nexu" },
  personal: { label: "Personal", description: "Your custom skills from ~/.agents/skills" },
  bundled: { label: "Core", description: "Built-in skills shipped with OpenClaw" },
  extension: { label: "Extensions", description: "Skills from enabled plugins" },
};

const SOURCE_ORDER = ["managed", "curated", "personal", "bundled", "extension"] as const;
```

**Step 3: Allow uninstall for curated skills**

In the `InstalledTab` component, update the `canUninstall` check:

```typescript
const canUninstall = source === "managed" || source === "curated";
```

**Step 4: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```
feat(web): add curated skills section to Installed tab
```

---

### Task 11: Full verification

**Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 2: Lint**

Run: `pnpm lint`
Expected: PASS (fix formatting with `pnpm format` if needed)

**Step 3: Run tests**

Run: `pnpm exec vitest run tests/api/lib/skill-scanner.test.ts`
Expected: PASS (all 10 tests including new curated tests)

**Step 4: Manual smoke test**

Run: `pnpm desktop:start`
Check logs: `pnpm desktop:logs`
Verify:
- 8 curated skills appear in `state/bundled-skills/`
- Installed tab shows "Recommended" section with 8 skills
- Uninstalling a curated skill removes it and it doesn't come back on restart
- Core (bundled) skills still show as read-only

---

## Summary of changes

| Layer | File | Change |
|-------|------|--------|
| Path helper | `apps/desktop/shared/desktop-paths.ts` | Add `getOpenclawCuratedSkillsDir` |
| Desktop manifest | `apps/desktop/main/runtime/manifests.ts` | Ensure dir, pass env var to API + gateway |
| Config generator | `apps/api/src/lib/config-generator.ts` | Add `bundled-skills` to `extraDirs` |
| Scanner types | `apps/api/src/lib/skill-scanner.ts` | Add `"curated"` source + `curatedDir` |
| Scanner tests | `tests/api/lib/skill-scanner.test.ts` | Add curated test cases |
| API route | `apps/api/src/routes/skillhub-routes.ts` | Scan + uninstall curated dir |
| Shared types | `apps/desktop/shared/skillhub-types.ts` | Add `"curated"` to `SkillSource` |
| CatalogManager | `apps/desktop/main/skillhub/catalog-manager.ts` | Curated scanning + uninstall |
| Curated module | `apps/desktop/main/skillhub/curated-skills.ts` | Slug list, state tracking, removal ledger |
| App startup | `apps/desktop/main/index.ts` | Trigger curated install |
| Frontend types | `apps/web/src/types/desktop.d.ts` | Add `"curated"` to `SkillSource` |
| Frontend UI | `apps/web/src/pages/skills.tsx` | "Recommended" section, uninstall support |

## Key design decisions

1. **Separate directory** — `state/bundled-skills/` is distinct from `state/skills/` so curated defaults don't mix with user installs.
2. **Removal ledger** — `.curated-state.json` tracks user removals so uninstalled curated skills don't reappear on app update.
3. **Non-blocking startup** — curated install runs as fire-and-forget `void` promise; app window appears immediately.
4. **Uninstallable** — curated skills can be removed by users (unlike bundled OpenClaw skills).
5. **Update-safe** — on app update, new curated slugs added to the list get installed; user-removed ones stay removed.
6. **Precedence** — `state/bundled-skills/` < `state/skills/` in extraDirs, so user installs of the same slug override curated.
