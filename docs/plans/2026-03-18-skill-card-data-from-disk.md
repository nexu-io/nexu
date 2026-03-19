# Skill Card Data from Disk

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make installed skill cards and detail pages show real data (name, description, SKILL.md content) by reading SKILL.md frontmatter from disk, instead of relying solely on the ClawHub community catalog.

**Architecture:** The skill scanner already knows which skills are installed and where. Extend it to parse SKILL.md frontmatter (name, description) and return that alongside slug/source. Update the API catalog response to include this metadata so the frontend can render rich cards without a catalog match. Update the detail route to also check the curated skills directory.

**Tech Stack:** TypeScript, YAML frontmatter parsing, Vitest

---

## Root cause

Two issues:

1. **Card data**: `InstalledTab` looks up each installed skill in the ClawHub community catalog (`catalogMap`). Skills not on ClawHub (e.g. `coding-agent`, `gh-issues`, `clawhub`) or skills whose ClawHub slug differs from the installed slug get a barebones placeholder showing only the slug.

2. **Detail page**: `GET /api/v1/skillhub/skills/{slug}` only reads SKILL.md from `OPENCLAW_SKILLS_DIR` (managed dir). It doesn't check `OPENCLAW_CURATED_SKILLS_DIR` (bundled-skills dir), so curated skills return 404.

## Data available in SKILL.md frontmatter

Every installed skill has a `SKILL.md` with YAML frontmatter:

```yaml
---
name: weather
description: Get current weather and forecasts (no API key required).
homepage: https://wttr.in/:help
metadata: {"clawdbot":{"emoji":"🌤️","requires":{"bins":["curl"]}}}
---
```

We can extract `name` and `description` from this frontmatter to populate cards.

---

### Task 1: Add frontmatter parsing to skill scanner

**Files:**
- Modify: `apps/api/src/lib/skill-scanner.ts`
- Modify: `tests/api/lib/skill-scanner.test.ts`

**Step 1: Write the failing test**

Add to the test file:

```typescript
it("extracts name and description from SKILL.md frontmatter", () => {
  const curatedDir = resolve(tempRoot, "curated");
  const skillDir = resolve(curatedDir, "weather");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    resolve(skillDir, "SKILL.md"),
    "---\nname: Weather\ndescription: Get weather forecasts.\n---\n\n# Weather\n",
    "utf8",
  );

  const result = scanInstalledSkills({ curatedDir });
  expect(result).toHaveLength(1);
  expect(result[0]?.name).toBe("Weather");
  expect(result[0]?.description).toBe("Get weather forecasts.");
});

it("uses slug as fallback name when frontmatter is missing", () => {
  const curatedDir = resolve(tempRoot, "curated");
  writeSkill(curatedDir, "plain-skill"); // uses default "# Test Skill" content

  const result = scanInstalledSkills({ curatedDir });
  expect(result[0]?.name).toBe("plain-skill");
  expect(result[0]?.description).toBe("");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/api/lib/skill-scanner.test.ts`
Expected: FAIL — `name` and `description` not on `InstalledSkill` type

**Step 3: Update the types and scanner**

Update `InstalledSkill`:

```typescript
export type InstalledSkill = {
  slug: string;
  source: SkillSource;
  name: string;
  description: string;
};
```

Add a frontmatter parser function:

```typescript
function parseFrontmatter(filePath: string): { name: string; description: string } {
  try {
    const content = readFileSync(filePath, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match?.[1]) return { name: "", description: "" };
    const frontmatter = match[1];

    const nameMatch = frontmatter.match(/^name:\s*['"]?(.+?)['"]?\s*$/m);
    const descMatch = frontmatter.match(/^description:\s*['"]?(.+?)['"]?\s*$/m);

    return {
      name: nameMatch?.[1]?.trim() ?? "",
      description: descMatch?.[1]?.trim() ?? "",
    };
  } catch {
    return { name: "", description: "" };
  }
}
```

Update `scanDir` to return objects with metadata instead of just slugs. Create a helper:

```typescript
function scanDirWithMeta(dir: string, source: SkillSource): InstalledSkill[] {
  if (!dir || !existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(resolve(dir, entry.name, "SKILL.md")),
      )
      .map((entry) => {
        const { name, description } = parseFrontmatter(
          resolve(dir, entry.name, "SKILL.md"),
        );
        return {
          slug: entry.name,
          source,
          name: name || entry.name,
          description: description || "",
        };
      });
  } catch {
    return [];
  }
}
```

Update `scanInstalledSkills`:

```typescript
export function scanInstalledSkills(dirs: ScanDirs): InstalledSkill[] {
  const merged = new Map<string, InstalledSkill>();

  for (const skill of scanDirWithMeta(dirs.curatedDir ?? "", "curated")) {
    merged.set(skill.slug, skill);
  }

  for (const skill of scanDirWithMeta(dirs.managedDir ?? "", "managed")) {
    merged.set(skill.slug, skill);
  }

  return Array.from(merged.values());
}
```

Add `readFileSync` to the imports at the top of the file.

**Step 4: Update existing tests**

Existing tests assert exact objects like `{ slug: "my-skill", source: "managed" }`. These need updating to include `name` and `description`. Use `toMatchObject` or update the expected values:

For tests using `writeSkill` (which writes `"# Test Skill"` content without frontmatter), the expected `name` should be the slug and `description` should be `""`.

Example: change `expect(result).toEqual([{ slug: "my-skill", source: "managed" }])` to:
```typescript
expect(result).toEqual([{ slug: "my-skill", source: "managed", name: "my-skill", description: "" }]);
```

For `toContainEqual` assertions, add `name` and `description` fields.

**Step 5: Run tests**

Run: `pnpm exec vitest run tests/api/lib/skill-scanner.test.ts`
Expected: PASS (8 tests)

**Step 6: Commit**

```
feat(api): extract name and description from SKILL.md frontmatter in scanner
```

---

### Task 2: Update API response schema to include skill metadata

**Files:**
- Modify: `apps/api/src/routes/skillhub-routes.ts`

**Step 1: Update `installedSkillSchema`**

```typescript
const installedSkillSchema = z.object({
  slug: z.string(),
  source: z.enum(["curated", "managed"]),
  name: z.string(),
  description: z.string(),
});
```

**Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS (the scanner already returns the new fields)

**Step 3: Commit**

```
feat(api): include name and description in installed skills response
```

---

### Task 3: Update detail route to check curated dir

The detail route (`GET /api/v1/skillhub/skills/{slug}`) only checks `skillsDir`. It needs to also check `curatedDir`.

**Files:**
- Modify: `apps/api/src/routes/skillhub-routes.ts`

**Step 1: Update the detail route handler**

Find the block that reads SKILL.md (around line 541-559). It currently only checks `skillsDir`. Update to check both dirs:

```typescript
// Read SKILL.md if installed — check managed dir first, then curated dir
let skillContent: string | null = null;
let installed = false;
let files: string[] = [];

const dirsToCheck = [
  getSkillsDir(),
  getCuratedSkillsDir(),
].filter(Boolean) as string[];

for (const dir of dirsToCheck) {
  const skillDir = resolveSkillhubPath(dir, slug);
  const skillMdPath = skillDir ? resolve(skillDir, "SKILL.md") : null;
  if (skillDir && skillMdPath && existsSync(skillMdPath)) {
    installed = true;
    skillContent = readFileSync(skillMdPath, "utf8");
    try {
      files = readdirSync(skillDir, { recursive: true })
        .map(String)
        .filter((f) => !f.startsWith(".clawhub") && f !== "_meta.json");
    } catch {
      // Ignore
    }
    break; // found it, stop searching
  }
}
```

Also update the fallback metadata when no catalog entry exists — use the SKILL.md frontmatter for name and description:

```typescript
// Parse frontmatter for name/description if no catalog entry
let diskName = slug;
let diskDescription = "";
if (skillContent) {
  const fmMatch = skillContent.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch?.[1]) {
    const nameMatch = fmMatch[1].match(/^name:\s*['"]?(.+?)['"]?\s*$/m);
    const descMatch = fmMatch[1].match(/^description:\s*['"]?(.+?)['"]?\s*$/m);
    if (nameMatch?.[1]) diskName = nameMatch[1].trim();
    if (descMatch?.[1]) diskDescription = descMatch[1].trim();
  }
}
```

Then use `diskName` and `diskDescription` as fallbacks in the response:

```typescript
return c.json(
  {
    slug,
    name: String(catalogEntry?.name ?? diskName),
    description: String(catalogEntry?.description ?? diskDescription),
    // ... rest unchanged
  },
  200,
);
```

**Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```
feat(api): check curated dir in skill detail route and use frontmatter fallback
```

---

### Task 4: Update frontend to use installed skill metadata

The `InstalledTab` currently creates a barebones placeholder when a skill isn't in the catalog. Now that `installedSkills` has `name` and `description`, use those instead.

**Files:**
- Modify: `apps/web/src/types/desktop.d.ts`
- Modify: `apps/web/src/pages/skills.tsx`

**Step 1: Update `InstalledSkill` type**

In `desktop.d.ts`, add `name` and `description`:

```typescript
export type InstalledSkill = {
  slug: string;
  source: SkillSource;
  name: string;
  description: string;
};
```

**Step 2: Update the placeholder in InstalledTab**

In `skills.tsx`, update the `displaySkill` construction to prefer installed skill metadata over generic placeholder:

```typescript
const displaySkill: MinimalSkill = catalogEntry ?? {
  slug: skill.slug,
  name: skill.name || skill.slug,
  description: skill.description || `${meta.label} skill`,
  downloads: 0,
  stars: 0,
  tags: [],
  version: "",
  updatedAt: "",
};
```

**Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```
feat(web): use installed skill name and description for card data
```

---

### Task 5: Update desktop CatalogManager scanner

The desktop `CatalogManager.scanAllSources()` also needs to return `name` and `description` from frontmatter.

**Files:**
- Modify: `apps/desktop/shared/skillhub-types.ts`
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts`

**Step 1: Update shared types**

In `skillhub-types.ts`, add fields to `InstalledSkill`:

```typescript
export type InstalledSkill = {
  slug: string;
  source: SkillSource;
  name: string;
  description: string;
};
```

**Step 2: Add frontmatter parsing to CatalogManager**

Add a private method:

```typescript
private parseFrontmatter(filePath: string): { name: string; description: string } {
  try {
    const content = readFileSync(filePath, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match?.[1]) return { name: "", description: "" };
    const frontmatter = match[1];

    const nameMatch = frontmatter.match(/^name:\s*['"]?(.+?)['"]?\s*$/m);
    const descMatch = frontmatter.match(/^description:\s*['"]?(.+?)['"]?\s*$/m);

    return {
      name: nameMatch?.[1]?.trim() ?? "",
      description: descMatch?.[1]?.trim() ?? "",
    };
  } catch {
    return { name: "", description: "" };
  }
}
```

**Step 3: Update `scanDir` to return InstalledSkill with metadata**

Update the private `scanDir` method to return `InstalledSkill[]` instead of `string[]`:

```typescript
private scanDirWithMeta(dir: string, source: SkillSource): InstalledSkill[] {
  if (!dir || !existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(resolve(dir, entry.name, "SKILL.md")),
      )
      .map((entry) => {
        const { name, description } = this.parseFrontmatter(
          resolve(dir, entry.name, "SKILL.md"),
        );
        return {
          slug: entry.name,
          source,
          name: name || entry.name,
          description: description || "",
        };
      });
  } catch {
    return [];
  }
}
```

**Step 4: Update `scanAllSources` to use new method**

```typescript
private scanAllSources(): InstalledSkill[] {
  const merged = new Map<string, InstalledSkill>();

  for (const skill of this.scanDirWithMeta(this.curatedSkillsDir, "curated")) {
    merged.set(skill.slug, skill);
  }

  for (const skill of this.scanDirWithMeta(this.skillsDir, "managed")) {
    merged.set(skill.slug, skill);
  }

  return Array.from(merged.values());
}
```

Remove the old `scanDir(dir: string): string[]` private method if it's no longer used.

**Step 5: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 6: Commit**

```
feat(desktop): extract skill metadata from frontmatter in CatalogManager
```

---

### Task 6: Full verification

**Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 2: Lint**

Run: `pnpm lint`
Expected: PASS (fix with `pnpm format` if needed)

**Step 3: Run tests**

Run: `pnpm exec vitest run tests/api/lib/skill-scanner.test.ts`
Expected: PASS (8 tests)

**Step 4: Manual smoke test**

Run: `pnpm desktop:start`
Verify:
- All 19 curated skill cards show real names (e.g. "Weather", not "weather")
- Cards show real descriptions from frontmatter
- Clicking a curated skill opens the detail page with SKILL.md content rendered
- Clicking a static skill (coding-agent, gh-issues, clawhub) also shows detail page correctly

---

## Summary of changes

| File | Change |
|------|--------|
| `apps/api/src/lib/skill-scanner.ts` | Add frontmatter parsing, return `name`+`description` |
| `tests/api/lib/skill-scanner.test.ts` | Add frontmatter tests, update existing assertions |
| `apps/api/src/routes/skillhub-routes.ts` | Update schema, check curated dir in detail route, use frontmatter fallback |
| `apps/web/src/types/desktop.d.ts` | Add `name`+`description` to `InstalledSkill` |
| `apps/web/src/pages/skills.tsx` | Use skill metadata for card display |
| `apps/desktop/shared/skillhub-types.ts` | Add `name`+`description` to `InstalledSkill` |
| `apps/desktop/main/skillhub/catalog-manager.ts` | Add frontmatter parsing, update scanner |
