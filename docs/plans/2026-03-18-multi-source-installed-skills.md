# Multi-Source Installed Skills Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show all skill sources (bundled, extension/plugin, personal, managed) in the Installed tab, grouped by source, so users can see everything OpenClaw actually loads.

**Architecture:** Add two new env vars (`OPENCLAW_BUNDLED_SKILLS_DIR`, `OPENCLAW_EXTENSIONS_DIR`) to the API sidecar manifest so the API can scan all skill directories. Extend the catalog API response to return skills grouped by source instead of a flat `installedSlugs` list. Update the Installed tab UI to render source-grouped sections with appropriate labels and actions (uninstall only for managed/community skills).

**Tech Stack:** TypeScript, Hono (API), React (frontend), Zod schemas, OpenAPI codegen

---

### Task 1: Add new env vars to desktop manifest

The API sidecar currently only receives `OPENCLAW_SKILLS_DIR` (managed skills). It needs two more paths to discover bundled and extension skills.

**Files:**
- Modify: `apps/desktop/main/runtime/manifests.ts:337-355` (API sidecar env block)
- Modify: `apps/desktop/shared/desktop-paths.ts` (add helper functions)

**Step 1: Add path helpers to desktop-paths.ts**

```typescript
// Add after existing exports in desktop-paths.ts
export function getOpenclawBundledSkillsDir(userDataPath: string): string {
  return resolve(userDataPath, "runtime/openclaw-sidecar/node_modules/openclaw/skills");
}

export function getOpenclawExtensionsDir(userDataPath: string): string {
  return resolve(userDataPath, "runtime/openclaw-sidecar/node_modules/openclaw/extensions");
}
```

**Step 2: Pass new env vars to API sidecar**

In `manifests.ts`, add to the API sidecar env block (around line 354):

```typescript
OPENCLAW_SKILLS_DIR: getOpenclawSkillsDir(userDataPath),
OPENCLAW_BUNDLED_SKILLS_DIR: getOpenclawBundledSkillsDir(userDataPath),
OPENCLAW_EXTENSIONS_DIR: getOpenclawExtensionsDir(userDataPath),
```

Import the new helpers alongside the existing `getOpenclawSkillsDir` import.

**Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS (no type errors)

**Step 4: Commit**

```
feat(desktop): pass bundled and extensions skill dirs to API sidecar
```

---

### Task 2: Create multi-source skill scanner utility

A shared utility that scans multiple directories and returns skills tagged by source. This replaces the single-directory `getInstalledSlugs()` function.

**Files:**
- Create: `apps/api/src/lib/skill-scanner.ts`
- Test: `apps/api/src/lib/skill-scanner.test.ts`

**Step 1: Write the failing test**

```typescript
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scanInstalledSkills, type InstalledSkill } from "./skill-scanner.js";

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

  it("scans managed skills directory", () => {
    const managedDir = resolve(tempRoot, "managed");
    writeSkill(managedDir, "my-skill");

    const result = scanInstalledSkills({ managedDir });
    expect(result).toEqual([
      { slug: "my-skill", source: "managed" },
    ]);
  });

  it("scans bundled skills directory", () => {
    const bundledDir = resolve(tempRoot, "bundled");
    writeSkill(bundledDir, "weather");
    writeSkill(bundledDir, "github");

    const result = scanInstalledSkills({ bundledDir });
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ slug: "weather", source: "bundled" });
    expect(result).toContainEqual({ slug: "github", source: "bundled" });
  });

  it("scans extension skills from plugin subdirectories", () => {
    const extensionsDir = resolve(tempRoot, "extensions");
    // Extensions have structure: extensions/<plugin>/skills/<skill>/SKILL.md
    // The manifest declares skills: ["./skills"]
    const feishuSkillsDir = resolve(extensionsDir, "feishu", "skills");
    writeSkill(feishuSkillsDir, "feishu-doc");
    writeSkill(feishuSkillsDir, "feishu-drive");
    // Plugin manifest declaring skills path
    mkdirSync(resolve(extensionsDir, "feishu"), { recursive: true });
    writeFileSync(
      resolve(extensionsDir, "feishu", "openclaw.plugin.json"),
      JSON.stringify({ id: "feishu", skills: ["./skills"] }),
      "utf8",
    );
    // Slack has no skills field — should be skipped
    mkdirSync(resolve(extensionsDir, "slack"), { recursive: true });
    writeFileSync(
      resolve(extensionsDir, "slack", "openclaw.plugin.json"),
      JSON.stringify({ id: "slack", channels: ["slack"] }),
      "utf8",
    );

    const result = scanInstalledSkills({ extensionsDir });
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ slug: "feishu-doc", source: "extension", pluginId: "feishu" });
    expect(result).toContainEqual({ slug: "feishu-drive", source: "extension", pluginId: "feishu" });
  });

  it("scans personal skills directory", () => {
    const personalDir = resolve(tempRoot, "personal");
    writeSkill(personalDir, "my-custom");

    const result = scanInstalledSkills({ personalDir });
    expect(result).toEqual([
      { slug: "my-custom", source: "personal" },
    ]);
  });

  it("combines all sources without duplicates (higher tier wins)", () => {
    const bundledDir = resolve(tempRoot, "bundled");
    const managedDir = resolve(tempRoot, "managed");
    writeSkill(bundledDir, "weather");
    writeSkill(managedDir, "weather"); // same name in managed — managed wins
    writeSkill(managedDir, "deploy");

    const result = scanInstalledSkills({ bundledDir, managedDir });
    const weatherSkill = result.find((s) => s.slug === "weather");
    expect(weatherSkill?.source).toBe("managed"); // higher precedence
    expect(result).toHaveLength(2); // weather + deploy, no duplicates
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

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nexu/api test -- src/lib/skill-scanner.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type SkillSource = "bundled" | "extension" | "managed" | "personal";

export type InstalledSkill = {
  slug: string;
  source: SkillSource;
  pluginId?: string;
};

type ScanDirs = {
  bundledDir?: string;
  extensionsDir?: string;
  managedDir?: string;
  personalDir?: string;
};

function scanDir(dir: string): string[] {
  if (!dir || !existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          existsSync(resolve(dir, e.name, "SKILL.md")),
      )
      .map((e) => e.name);
  } catch {
    return [];
  }
}

type PluginManifest = {
  id?: string;
  skills?: string[];
};

function scanExtensionSkills(extensionsDir: string): InstalledSkill[] {
  if (!extensionsDir || !existsSync(extensionsDir)) return [];
  const results: InstalledSkill[] = [];

  try {
    const pluginDirs = readdirSync(extensionsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory());

    for (const pluginEntry of pluginDirs) {
      const pluginRoot = resolve(extensionsDir, pluginEntry.name);
      const manifestPath = resolve(pluginRoot, "openclaw.plugin.json");

      if (!existsSync(manifestPath)) continue;

      let manifest: PluginManifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PluginManifest;
      } catch {
        continue;
      }

      if (!manifest.skills || manifest.skills.length === 0) continue;

      const pluginId = manifest.id ?? pluginEntry.name;

      for (const skillPath of manifest.skills) {
        const skillsDir = resolve(pluginRoot, skillPath);
        const slugs = scanDir(skillsDir);
        for (const slug of slugs) {
          results.push({ slug, source: "extension", pluginId });
        }
      }
    }
  } catch {
    // extensions dir not readable
  }

  return results;
}

export function scanInstalledSkills(dirs: ScanDirs): InstalledSkill[] {
  // Build in precedence order: bundled < extension < managed < personal
  // Later entries override earlier ones (matching OpenClaw's precedence)
  const merged = new Map<string, InstalledSkill>();

  // Tier 1: Bundled (lowest precedence)
  for (const slug of scanDir(dirs.bundledDir ?? "")) {
    merged.set(slug, { slug, source: "bundled" });
  }

  // Tier 2: Extension skills
  for (const skill of scanExtensionSkills(dirs.extensionsDir ?? "")) {
    merged.set(skill.slug, skill);
  }

  // Tier 3: Managed (community installs + Nexu-synced)
  for (const slug of scanDir(dirs.managedDir ?? "")) {
    merged.set(slug, { slug, source: "managed" });
  }

  // Tier 4: Personal (~/.agents/skills)
  for (const slug of scanDir(dirs.personalDir ?? "")) {
    merged.set(slug, { slug, source: "personal" });
  }

  return Array.from(merged.values());
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nexu/api test -- src/lib/skill-scanner.test.ts`
Expected: PASS (all 7 tests)

**Step 5: Commit**

```
feat(api): add multi-source skill scanner utility
```

---

### Task 3: Update API response schema and route handler

Replace the flat `installedSlugs: string[]` with a richer `installedSkills` array that includes source information. Keep `installedSlugs` for backward compatibility.

**Files:**
- Modify: `apps/api/src/routes/skillhub-routes.ts` (schema + route handler)

**Step 1: Add new schema alongside existing ones**

After `minimalSkillSchema` (line 50), add:

```typescript
const installedSkillSchema = z.object({
  slug: z.string(),
  source: z.enum(["bundled", "extension", "managed", "personal"]),
  pluginId: z.string().optional(),
});
```

Update `skillhubCatalogResponseSchema` to include the new field:

```typescript
const skillhubCatalogResponseSchema = z.object({
  skills: z.array(minimalSkillSchema),
  installedSlugs: z.array(z.string()), // keep for backward compat
  installedSkills: z.array(installedSkillSchema),
  meta: catalogMetaSchema.nullable(),
});
```

**Step 2: Update the route handler**

Replace the catalog route handler to use `scanInstalledSkills`:

```typescript
import { scanInstalledSkills } from "../lib/skill-scanner.js";
import { homedir } from "node:os";

// Update getters
function getBundledSkillsDir(): string | undefined {
  return process.env.OPENCLAW_BUNDLED_SKILLS_DIR;
}

function getExtensionsDir(): string | undefined {
  return process.env.OPENCLAW_EXTENSIONS_DIR;
}

function getPersonalSkillsDir(): string {
  return resolve(homedir(), ".agents", "skills");
}
```

Update the `skillhubCatalogRoute` handler:

```typescript
app.openapi(skillhubCatalogRoute, async (c) => {
  const cacheDir = getCacheDir();

  if (!cacheDir) {
    return c.json({ skills: [], installedSlugs: [], installedSkills: [], meta: null }, 200);
  }

  const skills = readCatalog(cacheDir);
  const meta = readMeta(cacheDir);
  const installedSkills = scanInstalledSkills({
    bundledDir: getBundledSkillsDir(),
    extensionsDir: getExtensionsDir(),
    managedDir: getSkillsDir(),
    personalDir: getPersonalSkillsDir(),
  });
  const installedSlugs = installedSkills.map((s) => s.slug);

  return c.json({ skills, installedSlugs, installedSkills, meta }, 200);
});
```

**Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Regenerate frontend SDK types**

Run: `pnpm generate-types`
Expected: new `installedSkills` field appears in generated types

**Step 5: Commit**

```
feat(api): return multi-source installed skills in catalog response
```

---

### Task 4: Update desktop CatalogManager

Mirror the same multi-source scanning in the desktop's `CatalogManager` class, which serves the IPC path.

**Files:**
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts`
- Modify: `apps/desktop/shared/skillhub-types.ts`

**Step 1: Update shared types**

Add to `skillhub-types.ts`:

```typescript
export type SkillSource = "bundled" | "extension" | "managed" | "personal";

export type InstalledSkill = {
  slug: string;
  source: SkillSource;
  pluginId?: string;
};
```

Update `SkillhubCatalogData`:

```typescript
export type SkillhubCatalogData = {
  skills: MinimalSkill[];
  installedSlugs: string[];
  installedSkills: InstalledSkill[];
  meta: CatalogMeta | null;
};
```

**Step 2: Update CatalogManager**

Add new directory properties and update `getCatalog()` and `getInstalledSlugs()` to use multi-source scanning. The `CatalogManager` constructor already receives `userDataPath` — use the new path helpers.

Import the new path helpers:

```typescript
import {
  getOpenclawSkillsDir,
  getOpenclawBundledSkillsDir,
  getOpenclawExtensionsDir,
} from "../../shared/desktop-paths";
```

Add new private properties alongside `skillsDir`:

```typescript
private readonly bundledSkillsDir: string;
private readonly extensionsDir: string;
private readonly personalSkillsDir: string;
```

Initialize in constructor:

```typescript
this.bundledSkillsDir = getOpenclawBundledSkillsDir(userDataPath);
this.extensionsDir = getOpenclawExtensionsDir(userDataPath);
this.personalSkillsDir = resolve(homedir(), ".agents", "skills");
```

Note: The scan logic should be extracted into a shared utility, but since `apps/api` and `apps/desktop` are separate build targets, the simplest approach is to duplicate the scan functions in the CatalogManager. Alternatively, move the scanner to `packages/shared` — but that adds a node:fs dependency to the shared package. The pragmatic choice: **inline a simplified version** in the CatalogManager for now, and extract to shared later if needed.

Add private scanning methods mirroring the API's `scanInstalledSkills` logic (scan each dir, read `openclaw.plugin.json` for extensions, merge by precedence).

Update `getCatalog()`:

```typescript
getCatalog(): SkillhubCatalogData {
  const skills = this.readCachedSkills();
  const installedSkills = this.scanAllSources();
  const installedSlugs = installedSkills.map((s) => s.slug);
  const meta = this.readMeta();
  return { skills, installedSlugs, installedSkills, meta };
}
```

**Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```
feat(desktop): scan multi-source skills in CatalogManager
```

---

### Task 5: Update frontend Installed tab with source groups

Render installed skills grouped by source with section headers. Only managed/community skills show uninstall buttons.

**Files:**
- Modify: `apps/web/src/pages/skills.tsx` (InstalledTab component)
- Modify: `apps/web/src/types/desktop.ts` (if the generated types aren't auto-picked up)

**Step 1: Update InstalledTab to group by source**

Replace the `InstalledTab` component:

```tsx
const SOURCE_LABELS: Record<string, { label: string; description: string }> = {
  bundled: { label: "Core", description: "Built-in skills shipped with OpenClaw" },
  extension: { label: "Extensions", description: "Skills from enabled plugins" },
  managed: { label: "Installed", description: "Community skills you installed" },
  personal: { label: "Personal", description: "Your custom skills from ~/.agents/skills" },
};

const SOURCE_ORDER = ["managed", "personal", "bundled", "extension"] as const;

function InstalledTab() {
  const { data, isLoading } = useCommunitySkills();

  const installedSkills = data?.installedSkills ?? [];
  const allCatalogSkills = data?.skills ?? [];

  // Group by source
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof installedSkills>();
    for (const skill of installedSkills) {
      const existing = groups.get(skill.source) ?? [];
      existing.push(skill);
      groups.set(skill.source, existing);
    }
    return groups;
  }, [installedSkills]);

  // Build MinimalSkill lookup from catalog
  const catalogMap = useMemo(() => {
    const map = new Map<string, MinimalSkill>();
    for (const s of allCatalogSkills) {
      map.set(s.slug, s);
    }
    return map;
  }, [allCatalogSkills]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    );
  }

  if (installedSkills.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="flex justify-center items-center mx-auto mb-3 w-12 h-12 rounded-xl bg-accent/10">
          <Zap size={20} className="text-accent" />
        </div>
        <p className="text-[13px] text-text-muted">No skills installed</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {SOURCE_ORDER.map((source) => {
        const skills = grouped.get(source);
        if (!skills || skills.length === 0) return null;

        const meta = SOURCE_LABELS[source];
        const canUninstall = source === "managed";

        return (
          <div key={source}>
            <div className="mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-text-primary">
                  {meta.label}
                </h3>
                <span className="text-[11px] text-text-muted tabular-nums">
                  {skills.length}
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5">
                {meta.description}
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {skills.map((skill) => {
                const catalogEntry = catalogMap.get(skill.slug);
                const displaySkill: MinimalSkill = catalogEntry ?? {
                  slug: skill.slug,
                  name: skill.slug,
                  description:
                    skill.pluginId
                      ? `From ${skill.pluginId} plugin`
                      : `${meta.label} skill`,
                  downloads: 0,
                  stars: 0,
                  tags: [],
                  version: "",
                  updatedAt: "",
                };
                return (
                  <CommunitySkillCard
                    key={skill.slug}
                    skill={displaySkill}
                    isInstalled={canUninstall}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

**Step 2: Update the installed count in DesktopSkillsContent**

The tab badge should still show total count. No change needed — `installedSlugs.length` still works.

**Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Visually verify**

Run: `pnpm dev`
Navigate to Skills → Installed tab. Verify:
- Skills appear grouped under Core / Extensions / Installed / Personal headers
- Only "Installed" (managed) group shows uninstall buttons
- Bundled skills show as read-only cards
- Extension skills show the plugin name in description

**Step 5: Commit**

```
feat(web): group installed skills by source in Installed tab
```

---

### Task 6: Update the hook to expose installedSkills

The `useCommunitySkills` hook currently returns `SkillhubCatalogData` which needs the new `installedSkills` field.

**Files:**
- Modify: `apps/web/src/hooks/use-community-catalog.ts` (if types aren't auto-generated)
- Modify: `apps/web/src/types/desktop.ts` (if manually maintained)

**Step 1: Check if types auto-update after `pnpm generate-types`**

If `SkillhubCatalogData` in `apps/web/src/types/desktop.ts` is manually maintained (not generated), update it to match the shared type:

```typescript
export type SkillSource = "bundled" | "extension" | "managed" | "personal";

export type InstalledSkill = {
  slug: string;
  source: SkillSource;
  pluginId?: string;
};

// Add to existing SkillhubCatalogData
export type SkillhubCatalogData = {
  skills: MinimalSkill[];
  installedSlugs: string[];
  installedSkills: InstalledSkill[];
  meta: CatalogMeta | null;
};
```

The hook itself (`useCommunitySkills`) needs no changes — it already returns the full `SkillhubCatalogData` from the API response.

**Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```
feat(web): add InstalledSkill types for multi-source display
```

---

### Task 7: Run full verification

**Step 1: Typecheck all packages**

Run: `pnpm typecheck`
Expected: PASS

**Step 2: Run linter**

Run: `pnpm lint`
Expected: PASS (fix any formatting issues with `pnpm format`)

**Step 3: Run tests**

Run: `pnpm test`
Expected: PASS (including new skill-scanner tests)

**Step 4: Manual smoke test**

Run: `pnpm desktop:start`
Navigate to Skills → Installed tab. Verify all source groups render correctly.

**Step 5: Final commit if any fixes needed**

---

## Summary of changes

| Layer | File | Change |
|-------|------|--------|
| Desktop paths | `apps/desktop/shared/desktop-paths.ts` | Add `getOpenclawBundledSkillsDir`, `getOpenclawExtensionsDir` |
| Desktop manifest | `apps/desktop/main/runtime/manifests.ts` | Pass new env vars to API sidecar |
| Shared types | `apps/desktop/shared/skillhub-types.ts` | Add `InstalledSkill`, `SkillSource` types |
| Scanner util | `apps/api/src/lib/skill-scanner.ts` | New multi-source scanner with tests |
| API schema | `apps/api/src/routes/skillhub-routes.ts` | Add `installedSkills` to response |
| Desktop catalog | `apps/desktop/main/skillhub/catalog-manager.ts` | Multi-source scanning |
| Frontend types | `apps/web/src/types/desktop.ts` | Add `InstalledSkill` type |
| Frontend UI | `apps/web/src/pages/skills.tsx` | Source-grouped Installed tab |

## Key design decisions

1. **Read-only for non-managed skills** — uninstall only works for managed/community skills. Bundled, extension, and personal skills are display-only.
2. **Backward compatible** — `installedSlugs` still returned for any code that uses it.
3. **No OpenClaw source modification** — we scan the same directories OpenClaw would, but don't import its code.
4. **Precedence matches OpenClaw** — bundled < extension < managed < personal, so override display is correct.
