# SkillHub: Single Skills Directory Refactor

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify all skill types (curated, managed, custom) into one `skillsDir` directory. The lowdb JSON ledger is the single source of truth for categorization — disk layout no longer determines source.

**Architecture:** Currently curated skills live in `curatedSkillsDir` (bundled-skills/) and managed/custom in `skillsDir` (skills/). This causes path mismatches between desktop dev mode and the controller. The fix: all skills install to `skillsDir`. On first launch, existing skills from `bundled-skills/` are migrated (moved) to `skillsDir` and recorded in the ledger as `source: "curated"`. After migration, `curatedSkillsDir` is no longer read. `getCatalog()` reads exclusively from the DB ledger and enriches with SKILL.md frontmatter from `skillsDir`.

**Tech Stack:** TypeScript, lowdb, Zod, Hono OpenAPI, Vitest

---

## Task 1: Migrate curated-skills.ts to target skillsDir

The functions `copyStaticSkills` and `resolveCuratedSkillsToInstall` currently take a `curatedDir` param. Change them to accept a `targetDir` param instead — this is the single skills directory where everything goes.

**Files:**
- Modify: `apps/controller/src/services/skillhub/curated-skills.ts`

**Step 1: Rename `curatedDir` to `targetDir` in both functions**

```typescript
// copyStaticSkills
export function copyStaticSkills(params: {
  staticDir: string;
  targetDir: string;
  skillDb: SkillDb;
}): { copied: string[]; skipped: string[] } {
  // ... replace all params.curatedDir with params.targetDir
}

// resolveCuratedSkillsToInstall
export function resolveCuratedSkillsToInstall(params: {
  targetDir: string;
  skillDb: SkillDb;
}): { toInstall: string[]; toSkip: string[] } {
  // ... replace params.curatedDir with params.targetDir
}
```

**Step 2: Verify typecheck**

```bash
cd apps/controller && npx tsc --noEmit
```

This will show errors in catalog-manager.ts where these functions are called — that's expected, fixed in Task 2.

---

## Task 2: Refactor CatalogManager to use single skillsDir

Remove `curatedSkillsDir` from CatalogManager entirely. All install/uninstall/read operations use `skillsDir`. The `source` field in the DB ledger is the only way to distinguish curated from managed from custom.

**Files:**
- Modify: `apps/controller/src/services/skillhub/catalog-manager.ts`

**Step 1: Remove `curatedSkillsDir` field and constructor option**

Remove the `curatedSkillsDir` field from the class and the `curatedSkillsDir` option from the constructor. Keep `curatedSkillsDir` as a constructor option but ignore it (for backward compat with desktop manifests that still pass it).

Actually — the cleaner approach: keep accepting `curatedSkillsDir` in opts but don't store it. All internal code uses `this.skillsDir`.

```typescript
constructor(
  cacheDir: string,
  opts: {
    skillsDir?: string;
    curatedSkillsDir?: string; // accepted but unused — all skills go to skillsDir
    staticSkillsDir?: string;
    skillDb: SkillDb;
    log?: SkillhubLogFn;
  },
) {
  this.cacheDir = cacheDir;
  this.skillsDir = opts.skillsDir ?? "";
  this.db = opts.skillDb;
  this.staticSkillsDir = opts.staticSkillsDir ?? "";
  // ... rest unchanged
}
```

**Step 2: Update `getCatalog()` — read from DB, enrich from skillsDir only**

```typescript
getCatalog(): SkillhubCatalogData {
  const skills = this.readCachedSkills();
  const dbRecords = this.db.getAllInstalled();

  const installedSkills: InstalledSkill[] = dbRecords
    .map((r) => {
      const skillMdPath = resolve(this.skillsDir, r.slug, "SKILL.md");
      const { name, description } = this.parseFrontmatter(skillMdPath);
      return {
        slug: r.slug,
        source: r.source,
        name: name || r.slug,
        description: description || "",
        installedAt: r.installedAt,
      };
    })
    .sort((a, b) => {
      if (a.installedAt && b.installedAt) {
        const cmp = a.installedAt.localeCompare(b.installedAt);
        if (cmp !== 0) return cmp;
      } else if (a.installedAt && !b.installedAt) {
        return -1;
      } else if (!a.installedAt && b.installedAt) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

  const installedSlugs = installedSkills.map((s) => s.slug);
  const meta = this.readMeta();
  return { skills, installedSlugs, installedSkills, meta };
}
```

**Step 3: Update `installCuratedSkills()` — all installs to skillsDir**

Change all `this.curatedSkillsDir` references to `this.skillsDir`:
- `copyStaticSkills({ staticDir, targetDir: this.skillsDir, skillDb })`
- `resolveCuratedSkillsToInstall({ targetDir: this.skillsDir, skillDb })`
- ClawHub `--workdir` uses `this.skillsDir`
- npm deps path uses `this.skillsDir`
- Step 1b (on-disk scan) scans `this.skillsDir` for untracked curated skills

**Step 4: Update `uninstallSkill()` — only check skillsDir**

Replace the two-dir check with a single-dir check. Look up source from DB:

```typescript
async uninstallSkill(slug: string): Promise<{ ok: boolean; error?: string }> {
  // ...
  const skillPath = resolveSkillPath(this.skillsDir, slug);
  if (skillPath && existsSync(skillPath)) {
    const dbRecords = this.db.getAllInstalled();
    const record = dbRecords.find((r) => r.slug === slug);
    const source = record?.source ?? "managed";
    rmSync(skillPath, { recursive: true, force: true });
    this.db.recordUninstall(slug, source);
    this.log("info", `uninstall ok (${source}) slug=${slug}`);
  } else {
    this.log("warn", `uninstall skip slug=${slug} — dir not found`);
  }
  return { ok: true };
}
```

**Step 5: Update `reconcileDbWithDisk()` — single dir**

Replace the two-dir loop with a single `this.skillsDir` scan:
- DB→disk check: all records look in `this.skillsDir`
- Disk→DB scan: only scan `this.skillsDir`, default source is `"managed"` for untracked skills

**Step 6: Update `importSkillZip()` method**

This already uses `this.skillsDir` — verify it records with `source: "custom"`.

**Step 7: Add download count fallback in `buildMinimalCatalog()`**

Add constant and apply:
```typescript
const DEFAULT_DOWNLOAD_COUNT = 1000;
// in .map():
const rawDownloads = Number(stats.downloads ?? entry.downloads ?? 0);
downloads: rawDownloads > 0 ? rawDownloads : DEFAULT_DOWNLOAD_COUNT,
```

**Step 8: Verify typecheck**

```bash
cd apps/controller && npx tsc --noEmit
```

---

## Task 3: Add legacy bundled-skills migration to SkillhubService.start()

On first launch after upgrade, skills exist in `bundled-skills/` but not in `skills/`. We need a one-time migration that moves them.

**Files:**
- Modify: `apps/controller/src/services/skillhub/catalog-manager.ts` (add `migrateLegacyBundledSkills` method)
- Modify: `apps/controller/src/services/skillhub-service.ts` (call migration before curated install)

**Step 1: Add `migrateLegacyBundledSkills()` to CatalogManager**

This method:
1. Checks if `curatedSkillsDir` (passed via env, the old bundled-skills path) exists and has skills
2. For each skill dir in `curatedSkillsDir` that has a SKILL.md:
   - If the skill does NOT already exist in `this.skillsDir`, copy it over
   - Record it in the DB as `source: "curated"`
3. Log what was migrated

```typescript
migrateLegacyBundledSkills(legacyCuratedDir: string): void {
  if (!legacyCuratedDir || !existsSync(legacyCuratedDir)) return;

  const migrated: string[] = [];
  try {
    const entries = readdirSync(legacyCuratedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const srcSkillMd = resolve(legacyCuratedDir, entry.name, "SKILL.md");
      if (!existsSync(srcSkillMd)) continue;

      const destDir = resolve(this.skillsDir, entry.name);
      if (existsSync(resolve(destDir, "SKILL.md"))) continue; // already in skillsDir

      mkdirSync(destDir, { recursive: true });
      cpSync(resolve(legacyCuratedDir, entry.name), destDir, { recursive: true });

      if (!this.db.isInstalled(entry.name, "curated")) {
        this.db.recordInstall(entry.name, "curated");
      }
      migrated.push(entry.name);
    }
  } catch {
    // Best-effort migration
  }

  if (migrated.length > 0) {
    this.log("info", `migrated ${migrated.length} skills from legacy bundled-skills: ${migrated.join(", ")}`);
  }
}
```

Add `import { cpSync } from "node:fs"` to the imports (it's already imported via `existsSync` etc but cpSync needs to be added).

Wait — `cpSync` is not in the current imports. Check: the `curated-skills.ts` file imports `cpSync`. The catalog-manager doesn't. Add it.

**Step 2: Call migration in SkillhubService.start()**

```typescript
start(): void {
  this.catalogManager.start();
  if (process.env.CI) return;

  // Migrate legacy bundled-skills to skillsDir on first run
  this.catalogManager.migrateLegacyBundledSkills(this.legacyCuratedDir);

  void this.catalogManager
    .installCuratedSkills()
    .then(() => {
      this.catalogManager.reconcileDbWithDisk();
    })
    .catch(() => {});
}
```

Pass `legacyCuratedDir` from env through to the service:

In `SkillhubService.create()`:
```typescript
static async create(env: ControllerEnv): Promise<SkillhubService> {
  const skillDb = await SkillDb.create(env.skillDbPath);
  const catalogManager = new CatalogManager(env.skillhubCacheDir, {
    skillsDir: env.openclawSkillsDir,
    staticSkillsDir: env.staticSkillsDir,
    skillDb,
    log: (level, message) => {
      console[level === "error" ? "error" : "log"](`[skillhub] ${message}`);
    },
  });
  return new SkillhubService(catalogManager, env.openclawCuratedSkillsDir);
}
```

Store it:
```typescript
private constructor(
  catalogManager: CatalogManager,
  private readonly legacyCuratedDir: string,
) {
  this.catalogManager = catalogManager;
}
```

**Step 3: Fix the SkillDb creation — remove try/catch, let it fail loudly**

The current code silently swallows SkillDb init errors. This is the root cause of the "missing skills" bug. Fix:

```typescript
static async create(env: ControllerEnv): Promise<SkillhubService> {
  const skillDb = await SkillDb.create(env.skillDbPath);
  // No try/catch — if lowdb init fails, the controller should fail to start
```

**Step 4: Verify typecheck**

```bash
cd apps/controller && npx tsc --noEmit
```

---

## Task 4: Verify install and uninstall flows

Both `installSkill()` and `uninstallSkill()` are two-step processes that must keep disk and DB in sync.

### Install flow (user clicks "Install" from Explore tab)

1. **Step A:** Download the skill via clawhub into `skillsDir`
2. **Step B:** Record the install in lowdb with `source: "managed"` and `installedAt` timestamp

The order is A→B (disk first, DB second). If clawhub fails, no ghost record is created.

### Uninstall flow (user clicks "Uninstall" from Yours tab)

1. **Step A:** Look up the skill's `source` from the DB record (could be "curated", "managed", or "custom")
2. **Step B:** Delete the skill directory from `skillsDir`
3. **Step C:** Record the uninstall in lowdb with the correct `source` and `uninstalledAt` timestamp

The order is A→B→C. The source lookup from DB is critical — without it, we'd lose track of what kind of skill was uninstalled (matters for curated re-install prevention via `isRemovedByUser`).

**Files:**
- Verify: `apps/controller/src/services/skillhub/catalog-manager.ts` — `installSkill()` and `uninstallSkill()` methods

**Step 1: Verify `installSkill` uses `this.skillsDir`**

Check that the `--workdir` arg to clawhub is `this.skillsDir` and the npm deps path is `resolve(this.skillsDir, slug)`. Confirm no references to `curatedSkillsDir` remain.

**Step 2: Verify `db.recordInstall(slug, "managed")` is called after successful clawhub install**

The line `this.db.recordInstall(slug, "managed")` must come AFTER the clawhub `execFileAsync` succeeds. Confirm this ordering.

**Step 3: Verify `uninstallSkill` looks up source from DB before deleting**

The method must:
1. Find the skill in `this.skillsDir` only (not `curatedSkillsDir` — it no longer exists)
2. Look up `source` from DB via `this.db.getAllInstalled().find(r => r.slug === slug)`
3. Delete the folder
4. Call `this.db.recordUninstall(slug, source)` with the correct source

**Step 4: Verify curated uninstall prevents re-install**

After uninstalling a curated skill:
- `db.isRemovedByUser(slug)` returns `true`
- On next startup, `resolveCuratedSkillsToInstall` skips that slug
- The skill does NOT reappear in Yours tab

**Step 5: Manual test**

After `pnpm start`, with the app running:
1. Go to Explore tab, click "Install" on any skill
2. Verify: skill appears in Yours tab, `skill-ledger.json` has `source: "managed"`, `status: "installed"`, `skills/<slug>/SKILL.md` exists
3. Click "Uninstall" on the same skill
4. Verify: skill gone from Yours tab, `skill-ledger.json` has `status: "uninstalled"`, `uninstalledAt` set, `skills/<slug>/` deleted
5. For a curated skill: uninstall, restart app, verify it does NOT come back

---

## Task 5: Run tests and fix

**Step 1: Run tests**

```bash
pnpm test
```

**Step 2: Fix any failures from the refactor**

The `skillhub-service.test.ts` may need updating if it mocks `CatalogManager` constructor — the `curatedSkillsDir` param is now ignored but still accepted.

**Step 3: Verify full typecheck and lint**

```bash
pnpm typecheck
pnpm lint
```

---

## Task 6: Manual verification with `pnpm start`

**Step 1: Clear stale state**

```bash
rm -rf .tmp/desktop/electron/.nexu/skill-ledger.json
rm -rf .tmp/desktop/electron/runtime/openclaw/state/skills/*
```

**Step 2: Start desktop**

```bash
pnpm start
```

**Step 3: Verify startup flow in logs:**
- `migrated N skills from legacy bundled-skills: ...` appears (if old bundled-skills exist)
- `curated skills: nothing to install (N skipped)` or `curated skills: installing N skills`
- `reconcile: DB and disk are in sync`
- No duplicates in the UI
- Yours tab shows all 24 skills (20 curated + 4 static)
- Explore tab sorted by downloads desc

**Step 4: Verify Install from Explore tab**
- Find any uninstalled skill in Explore
- Click "Install" — skill installs and appears in Yours tab
- Check `skill-ledger.json` has `source: "managed"`, `installedAt` set
- Check `skills/<slug>/SKILL.md` exists on disk
- Uninstall — skill removed from Yours, folder deleted, DB record updated

**Step 5: Verify Import button (custom source)**
- Click "+ Import", select a zip with SKILL.md
- Skill appears under "Installed" sub-tab with `source: "custom"`
- Check `skill-ledger.json` has `source: "custom"`, `installedAt` set
- Check `skills/<slug>/SKILL.md` exists on disk
