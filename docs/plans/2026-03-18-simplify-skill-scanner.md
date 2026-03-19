# Simplify Skill Scanner — Two Folders Only

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restrict Nexu's skill scanning to only `state/bundled-skills/` and `state/skills/`, removing bundled/extension/personal tiers. Expand curated skill list to include all 19 skills (including those already in OpenClaw's bundled folder) so they're self-contained with dependencies.

**Architecture:** Simplify `scanInstalledSkills` to only scan two directories (`curatedDir` and `managedDir`), remove the `bundledDir`, `extensionsDir`, and `personalDir` parameters. Remove dead code (extension scanner, bundled/personal env vars). Expand the curated slugs list to 19 skills. Update all call sites, types, and tests.

**Tech Stack:** TypeScript, Vitest

---

## Full curated skills list (19 skills)

All installed via `clawhub install` into `state/bundled-skills/` on first launch:

```
1password, apple-notes, clawhub, coding-agent, github, gh-issues, healthcheck,
session-logs, skill-creator, video-frames, weather,
file-organizer-skill, imap-smtp-email, calendar, multi-search-engine,
xiaohongshu-mcp, humanize-ai-text, find-skills, skill-vetter
```

---

### Task 1: Expand curated skills list to 19 slugs

**Files:**
- Modify: `apps/desktop/main/skillhub/curated-skills.ts:4-21`

**Step 1: Update the slug list and comment**

Replace the `CURATED_SKILL_SLUGS` array and its comment:

```typescript
/**
 * All skills to pre-install into `state/bundled-skills/` on first launch.
 * Installed via `clawhub install` so each skill ships with its own
 * dependencies, avoiding version conflicts with the OpenClaw sidecar.
 */
export const CURATED_SKILL_SLUGS: readonly string[] = [
  // Security & tools
  "1password",
  "healthcheck",
  "skill-vetter",
  // Coding & GitHub
  "coding-agent",
  "github",
  "gh-issues",
  // Search & information
  "multi-search-engine",
  "xiaohongshu-mcp",
  "weather",
  // Communication & calendar
  "imap-smtp-email",
  "calendar",
  // Notes & content
  "apple-notes",
  "humanize-ai-text",
  // File & system
  "file-organizer-skill",
  "video-frames",
  "session-logs",
  // Skill management
  "clawhub",
  "find-skills",
  "skill-creator",
] as const;
```

**Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```
feat(desktop): expand curated skills list to 19 slugs
```

---

### Task 2: Simplify skill scanner to two folders only

Remove bundled, extension, and personal tiers. Only scan `curatedDir` and `managedDir`.

**Files:**
- Modify: `apps/api/src/lib/skill-scanner.ts`
- Modify: `tests/api/lib/skill-scanner.test.ts`

**Step 1: Rewrite the scanner**

Replace the entire file with:

```typescript
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export type SkillSource = "curated" | "managed";

export type InstalledSkill = {
  slug: string;
  source: SkillSource;
};

export type ScanDirs = {
  curatedDir?: string;
  managedDir?: string;
};

/**
 * Returns the slugs of all subdirectories in `dir` that contain a `SKILL.md`
 * file. Returns an empty array if the directory does not exist or cannot be
 * read.
 */
function scanDir(dir: string): string[] {
  if (!dir || !existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(resolve(dir, entry.name, "SKILL.md")),
      )
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Scans curated and managed skill directories and returns a deduplicated
 * flat array of `InstalledSkill` objects.
 *
 * Precedence (lowest to highest — later source wins on slug collision):
 *   curated < managed
 */
export function scanInstalledSkills(dirs: ScanDirs): InstalledSkill[] {
  const merged = new Map<string, InstalledSkill>();

  // Tier 1: curated (Nexu bundled defaults — lower precedence)
  for (const slug of scanDir(dirs.curatedDir ?? "")) {
    merged.set(slug, { slug, source: "curated" });
  }

  // Tier 2: managed (user community installs — higher precedence)
  for (const slug of scanDir(dirs.managedDir ?? "")) {
    merged.set(slug, { slug, source: "managed" });
  }

  return Array.from(merged.values());
}
```

**Step 2: Rewrite the tests**

Replace the entire test file with:

```typescript
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanInstalledSkills } from "#api/lib/skill-scanner.js";

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `skill-scanner-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkill(dir: string, slug: string, content = "# Test Skill"): void {
  const skillDir = resolve(dir, slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(resolve(skillDir, "SKILL.md"), content, "utf8");
}

describe("scanInstalledSkills", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("returns empty array when no dirs exist", () => {
    const result = scanInstalledSkills({});
    expect(result).toEqual([]);
  });

  it("scans curated skills directory", () => {
    const curatedDir = resolve(tempRoot, "curated");
    writeSkill(curatedDir, "weather");
    writeSkill(curatedDir, "github");

    const result = scanInstalledSkills({ curatedDir });
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ slug: "weather", source: "curated" });
    expect(result).toContainEqual({ slug: "github", source: "curated" });
  });

  it("scans managed skills directory", () => {
    const managedDir = resolve(tempRoot, "managed");
    writeSkill(managedDir, "my-skill");

    const result = scanInstalledSkills({ managedDir });
    expect(result).toEqual([{ slug: "my-skill", source: "managed" }]);
  });

  it("managed overrides curated with same slug", () => {
    const curatedDir = resolve(tempRoot, "curated");
    const managedDir = resolve(tempRoot, "managed");
    writeSkill(curatedDir, "weather");
    writeSkill(managedDir, "weather");

    const result = scanInstalledSkills({ curatedDir, managedDir });
    const skill = result.find((s) => s.slug === "weather");
    expect(skill?.source).toBe("managed");
    expect(result).toHaveLength(1);
  });

  it("combines both sources without duplicates", () => {
    const curatedDir = resolve(tempRoot, "curated");
    const managedDir = resolve(tempRoot, "managed");
    writeSkill(curatedDir, "weather");
    writeSkill(curatedDir, "github");
    writeSkill(managedDir, "deploy");

    const result = scanInstalledSkills({ curatedDir, managedDir });
    expect(result).toHaveLength(3);
    expect(result).toContainEqual({ slug: "weather", source: "curated" });
    expect(result).toContainEqual({ slug: "github", source: "curated" });
    expect(result).toContainEqual({ slug: "deploy", source: "managed" });
  });

  it("ignores directories without SKILL.md", () => {
    const managedDir = resolve(tempRoot, "managed");
    const emptySkillDir = resolve(managedDir, "broken-skill");
    mkdirSync(emptySkillDir, { recursive: true });
    writeFileSync(resolve(emptySkillDir, "README.md"), "not a skill", "utf8");

    const result = scanInstalledSkills({ managedDir });
    expect(result).toEqual([]);
  });
});
```

**Step 3: Run tests**

Run: `pnpm exec vitest run tests/api/lib/skill-scanner.test.ts`
Expected: PASS (6 tests)

**Step 4: Commit**

```
refactor(api): simplify skill scanner to curated + managed only
```

---

### Task 3: Update API route — remove bundled/extension/personal env getters

**Files:**
- Modify: `apps/api/src/routes/skillhub-routes.ts`

**Step 1: Update the schema**

Replace the `installedSkillSchema` source enum:

```typescript
const installedSkillSchema = z.object({
  slug: z.string(),
  source: z.enum(["curated", "managed"]),
});
```

Remove the `pluginId` field — it's no longer needed.

**Step 2: Remove dead env getter functions**

Delete `getBundledSkillsDir()`, `getExtensionsDir()`, and `getPersonalSkillsDir()`. Keep only `getSkillsDir()` and `getCuratedSkillsDir()`.

**Step 3: Update the catalog route handler**

```typescript
const installedSkills = scanInstalledSkills({
  curatedDir: getCuratedSkillsDir(),
  managedDir: getSkillsDir(),
});
```

**Step 4: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```
refactor(api): remove bundled/extension/personal from skill routes
```

---

### Task 4: Update desktop CatalogManager — remove bundled/extension/personal scanning

**Files:**
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts`
- Modify: `apps/desktop/shared/skillhub-types.ts`

**Step 1: Update shared types**

Replace `SkillSource` in `skillhub-types.ts`:

```typescript
export type SkillSource = "curated" | "managed";
```

Remove `pluginId` from `InstalledSkill`:

```typescript
export type InstalledSkill = {
  slug: string;
  source: SkillSource;
};
```

**Step 2: Remove dead properties and methods from CatalogManager**

Remove these private properties:
- `bundledSkillsDir`
- `extensionsDir`
- `personalSkillsDir`

Remove these private methods:
- `scanExtensionSkills()`

Remove their initialization from the constructor.

Remove the imports for `getOpenclawBundledSkillsDir` and `getOpenclawExtensionsDir` from `../../shared/desktop-paths`.

Remove the `homedir` import from `node:os` (if only used for personalSkillsDir).

**Step 3: Simplify `scanAllSources()`**

Replace with:

```typescript
private scanAllSources(): InstalledSkill[] {
  const merged = new Map<string, InstalledSkill>();

  // Tier 1: Curated (Nexu bundled defaults — lower precedence)
  for (const slug of this.scanDir(this.curatedSkillsDir)) {
    merged.set(slug, { slug, source: "curated" });
  }

  // Tier 2: Managed (user community installs — higher precedence)
  for (const slug of this.scanDir(this.skillsDir)) {
    merged.set(slug, { slug, source: "managed" });
  }

  return Array.from(merged.values());
}
```

**Step 4: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```
refactor(desktop): simplify CatalogManager to curated + managed only
```

---

### Task 5: Clean up desktop manifest — remove unused env vars

**Files:**
- Modify: `apps/desktop/main/runtime/manifests.ts`
- Modify: `apps/desktop/shared/desktop-paths.ts`

**Step 1: Remove unused env vars from API sidecar manifest**

In the API sidecar env block, remove:
- `OPENCLAW_BUNDLED_SKILLS_DIR`
- `OPENCLAW_EXTENSIONS_DIR`

Keep `OPENCLAW_SKILLS_DIR` and `OPENCLAW_CURATED_SKILLS_DIR`.

**Step 2: Remove unused path helpers**

In `desktop-paths.ts`, remove:
- `getOpenclawBundledSkillsDir()`
- `getOpenclawExtensionsDir()`

Keep `getOpenclawSkillsDir()` and `getOpenclawCuratedSkillsDir()`.

**Step 3: Remove unused import in manifests.ts**

Remove `getOpenclawBundledSkillsDir` and `getOpenclawExtensionsDir` from the import.

**Step 4: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```
chore(desktop): remove unused bundled/extension skill path helpers
```

---

### Task 6: Update frontend types and UI

**Files:**
- Modify: `apps/web/src/types/desktop.d.ts`
- Modify: `apps/web/src/pages/skills.tsx`

**Step 1: Simplify SkillSource type**

In `desktop.d.ts`:

```typescript
export type SkillSource = "curated" | "managed";

export type InstalledSkill = {
  slug: string;
  source: SkillSource;
};
```

**Step 2: Simplify SOURCE_LABELS and SOURCE_ORDER**

In `skills.tsx`:

```typescript
const SOURCE_LABELS: Record<string, { label: string; description: string }> = {
  curated: {
    label: "Recommended",
    description: "Pre-installed skills recommended by Nexu",
  },
  managed: {
    label: "Installed",
    description: "Community skills you installed",
  },
};

const SOURCE_ORDER = ["curated", "managed"] as const;
```

**Step 3: Simplify canUninstall**

All skills are now uninstallable (both curated and managed):

```typescript
const canUninstall = true;
```

**Step 4: Remove unused pluginId reference in InstalledTab**

In the placeholder `MinimalSkill` creation, remove the `skill.pluginId` check. Replace:

```typescript
description:
  skill.pluginId
    ? `From ${skill.pluginId} plugin`
    : `${meta.label} skill`,
```

With:

```typescript
description: `${meta.label} skill`,
```

**Step 5: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 6: Commit**

```
refactor(web): simplify installed skills UI to curated + managed
```

---

### Task 7: Update IPC fallback

**Files:**
- Modify: `apps/desktop/main/ipc.ts`

**Step 1: Verify the IPC fallback still has correct shape**

The fallback return should already have `installedSkills: []` from our earlier fix. Confirm it's there. No change needed if it already matches the simplified type.

**Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

---

### Task 8: Full verification

**Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 2: Lint**

Run: `pnpm lint`
Expected: PASS (fix with `pnpm format` if needed)

**Step 3: Run tests**

Run: `pnpm exec vitest run tests/api/lib/skill-scanner.test.ts`
Expected: PASS (6 tests)

**Step 4: Run full test suite**

Run: `pnpm test`
Expected: No new failures

---

## Summary of changes

| File | Change |
|------|--------|
| `apps/desktop/main/skillhub/curated-skills.ts` | Expand to 19 slugs |
| `apps/api/src/lib/skill-scanner.ts` | Remove bundled/extension/personal, keep curated + managed |
| `tests/api/lib/skill-scanner.test.ts` | Rewrite tests for 2-folder model |
| `apps/api/src/routes/skillhub-routes.ts` | Remove dead env getters, simplify schema |
| `apps/desktop/shared/skillhub-types.ts` | Simplify `SkillSource` to 2 values |
| `apps/desktop/main/skillhub/catalog-manager.ts` | Remove bundled/extension/personal scanning |
| `apps/desktop/shared/desktop-paths.ts` | Remove unused path helpers |
| `apps/desktop/main/runtime/manifests.ts` | Remove unused env vars from API sidecar |
| `apps/web/src/types/desktop.d.ts` | Simplify types |
| `apps/web/src/pages/skills.tsx` | Simplify UI to 2 sections |
