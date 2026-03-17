# File-Based Skills System — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a public GitHub skill repo with Feishu skills, add file-based skill scanning to the Nexu API, and update the shared schema to support `installed`/`updatable` fields.

**Architecture:** A standalone `nexu-skills/` directory at the repo root holds skill definitions. A `build-index.ts` script generates `skills.json` from SKILL.md frontmatter. The API scans `.openclaw/skills/` for installed skills and merges with the GitHub catalog. The shared Zod schema adds `installed` and `updatable` fields.

**Tech Stack:** TypeScript, Zod, Hono, pnpm monorepo, GitHub raw content API

---

### Task 1: Create the nexu-skills directory structure

**Files:**
- Create: `nexu-skills/skills.json`
- Create: `nexu-skills/scripts/build-index.ts`
- Create: `nexu-skills/scripts/package.json`

**Step 1: Create the build script package.json**

```json
// nexu-skills/scripts/package.json
{
  "type": "module",
  "dependencies": {
    "gray-matter": "^4.0.3"
  }
}
```

**Step 2: Write the build-index.ts script**

This script scans `nexu-skills/skills/`, reads each `SKILL.md` frontmatter, and writes `skills.json`.

```typescript
// nexu-skills/scripts/build-index.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..", "skills");
const outputPath = path.resolve(__dirname, "..", "skills.json");

interface SkillEntry {
  description: string;
  longDescription?: string;
  tag: string;
  icon: string;
  source: string;
  examples?: string[];
  prompt: string;
  requires?: { tools?: string[]; plugins?: string[] };
  path: string;
}

function scanSkills(): Record<string, SkillEntry> {
  const result: Record<string, SkillEntry> = {};
  const dirs = fs.readdirSync(skillsRoot, { withFileTypes: true });

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const skillMdPath = path.join(skillsRoot, dir.name, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;

    const raw = fs.readFileSync(skillMdPath, "utf-8");
    const { data } = matter(raw);

    if (!data.name || !data.description) {
      console.warn(`Skipping ${dir.name}: missing name or description`);
      continue;
    }

    result[data.name as string] = {
      description: data.description as string,
      longDescription: (data.longDescription as string) ?? undefined,
      tag: (data.tag as string) ?? "office-collab",
      icon: (data.icon as string) ?? "Sparkles",
      source: (data.source as string) ?? "official",
      examples: (data.examples as string[]) ?? undefined,
      prompt: (data.prompt as string) ?? "",
      requires: (data.requires as SkillEntry["requires"]) ?? undefined,
      path: `skills/${dir.name}`,
    };
  }

  return result;
}

const skills = scanSkills();
const index = { version: 1, skills };
fs.writeFileSync(outputPath, JSON.stringify(index, null, 2) + "\n");
console.log(`Generated skills.json with ${Object.keys(skills).length} skills`);
```

**Step 3: Run the script to verify it works (after Task 2 adds skills)**

```bash
cd nexu-skills/scripts && npm install && npx tsx build-index.ts
```

Expected: `Generated skills.json with 0 skills` (no skills yet)

**Step 4: Commit**

```bash
git add nexu-skills/scripts/
git commit -m "feat: add skill repo build-index script"
```

---

### Task 2: Port Feishu skills from openclaw-lark

**Files:**
- Create: `nexu-skills/skills/feishu-bitable/SKILL.md`
- Create: `nexu-skills/skills/feishu-bitable/references/field-properties.md`
- Create: `nexu-skills/skills/feishu-bitable/references/record-values.md`
- Create: `nexu-skills/skills/feishu-bitable/references/examples.md`
- Create: `nexu-skills/skills/feishu-calendar/SKILL.md`
- Create: `nexu-skills/skills/feishu-create-doc/SKILL.md`
- Create: `nexu-skills/skills/feishu-fetch-doc/SKILL.md`
- Create: `nexu-skills/skills/feishu-update-doc/SKILL.md`
- Create: `nexu-skills/skills/feishu-task/SKILL.md`
- Create: `nexu-skills/skills/feishu-im-read/SKILL.md`
- Create: `nexu-skills/skills/feishu-troubleshoot/SKILL.md`

**Step 1: Copy skill files from openclaw-lark and add extended frontmatter**

For each skill in `/Users/alche/Documents/cli/openclaw-lark/skills/`, copy the directory to `nexu-skills/skills/` and prepend extended frontmatter fields to the existing SKILL.md.

The extended frontmatter adds these fields to the existing `name` and `description`:

| Skill | tag | icon | prompt |
|-------|-----|------|--------|
| feishu-bitable | office-collab | Table2 | Help me manage Feishu Bitable databases |
| feishu-calendar | office-collab | Calendar | Help me manage Feishu calendar events |
| feishu-create-doc | file-knowledge | FilePlus | Help me create Feishu documents |
| feishu-fetch-doc | file-knowledge | FileSearch | Help me read Feishu documents |
| feishu-update-doc | file-knowledge | FileEdit | Help me update Feishu documents |
| feishu-task | office-collab | CheckSquare | Help me manage Feishu tasks |
| feishu-im-read | office-collab | MessageSquare | Help me read Feishu chat messages |
| feishu-troubleshoot | dev-tools | Wrench | Help me troubleshoot Feishu plugin issues |

All skills get `source: official` and `requires.plugins: ["@larksuite/openclaw-lark"]`.

Skip `feishu-channel-rules` — it's an always-active channel rule, not a user-installable skill.

**Step 2: Run the build script to generate skills.json**

```bash
cd nexu-skills/scripts && npx tsx build-index.ts
```

Expected: `Generated skills.json with 8 skills`

**Step 3: Verify skills.json contains all 8 skills**

```bash
cat nexu-skills/skills.json | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); console.log(Object.keys(j.skills).sort().join('\n'))"
```

Expected output:
```
feishu-bitable
feishu-calendar
feishu-create-doc
feishu-fetch-doc
feishu-im-read
feishu-task
feishu-troubleshoot
feishu-update-doc
```

**Step 4: Commit**

```bash
git add nexu-skills/skills/ nexu-skills/skills.json
git commit -m "feat: add 8 Feishu skills as first public skills"
```

---

### Task 3: Add skills-dir resolution utility to shared package

**Files:**
- Create: `packages/shared/src/schemas/skill-filesystem.ts`
- Modify: `packages/shared/src/index.ts`

**Step 1: Create the skill filesystem schema and resolver**

```typescript
// packages/shared/src/schemas/skill-filesystem.ts
import { z } from "zod";

export const skillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  longDescription: z.string().optional(),
  tag: z
    .enum([
      "office-collab",
      "file-knowledge",
      "creative-design",
      "biz-analysis",
      "av-generation",
      "info-content",
      "dev-tools",
    ])
    .default("dev-tools"),
  icon: z.string().default("Sparkles"),
  source: z.enum(["official", "community", "custom"]).default("custom"),
  examples: z.array(z.string()).optional(),
  prompt: z.string().default(""),
  requires: z
    .object({
      tools: z.array(z.string()).optional(),
      plugins: z.array(z.string()).optional(),
    })
    .optional(),
});

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;
```

**Step 2: Export from shared index**

Add to `packages/shared/src/index.ts`:

```typescript
export { skillFrontmatterSchema, type SkillFrontmatter } from "./schemas/skill-filesystem.js";
```

**Step 3: Verify typecheck passes**

```bash
pnpm --filter @nexu/shared typecheck
```

Expected: no errors

**Step 4: Commit**

```bash
git add packages/shared/src/schemas/skill-filesystem.ts packages/shared/src/index.ts
git commit -m "feat: add skill frontmatter schema to shared package"
```

---

### Task 4: Update shared skill schemas to support installed/updatable

**Files:**
- Modify: `packages/shared/src/schemas/skill.ts`

**Step 1: Add `installed` and `updatable` fields to skillInfoSchema**

```typescript
// In packages/shared/src/schemas/skill.ts
// Add to skillInfoSchema:
  installed: z.boolean().optional(),
  updatable: z.boolean().optional(),
```

The full `skillInfoSchema` becomes:

```typescript
export const skillInfoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  longDescription: z.string().optional(),
  iconName: z.string(),
  iconUrl: z.string().optional(),
  fallbackIconUrl: z.string().optional(),
  prompt: z.string(),
  examples: z.array(z.string()).optional(),
  tag: skillTagSchema,
  source: skillSourceSchema.or(z.literal("community")),
  tools: z.array(skillToolRefSchema).optional(),
  githubUrl: z.string().optional(),
  installed: z.boolean().optional(),
  updatable: z.boolean().optional(),
});
```

**Step 2: Add `community` to skillSourceSchema**

```typescript
export const skillSourceSchema = z.enum(["official", "custom", "community"]);
```

**Step 3: Verify typecheck**

```bash
pnpm --filter @nexu/shared typecheck
```

Expected: no errors

**Step 4: Regenerate SDK types**

```bash
pnpm generate-types
```

**Step 5: Commit**

```bash
git add packages/shared/src/schemas/skill.ts
git commit -m "feat: add installed/updatable fields to skill schema"
```

---

### Task 5: Add filesystem skill scanner to API

**Files:**
- Create: `apps/api/src/services/runtime/skill-scanner.ts`

**Step 1: Create the skill scanner service**

This service scans a directory for installed skills and parses their SKILL.md frontmatter.

```typescript
// apps/api/src/services/runtime/skill-scanner.ts
import crypto from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export interface InstalledSkill {
  name: string;
  description: string;
  longDescription?: string;
  tag: string;
  icon: string;
  source: string;
  examples?: string[];
  prompt: string;
  requires?: { tools?: string[]; plugins?: string[] };
  contentHash: string;
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yamlText = match[1];
  const result: Record<string, unknown> = {};
  let currentKey = "";
  let currentArray: string[] | null = null;

  for (const line of yamlText.split("\n")) {
    const arrayItem = line.match(/^\s+-\s+"?(.+?)"?\s*$/);
    if (arrayItem && currentKey) {
      if (!currentArray) currentArray = [];
      currentArray.push(arrayItem[1]);
      result[currentKey] = currentArray;
      continue;
    }
    if (currentArray) {
      currentArray = null;
    }
    const kv = line.match(/^(\w[\w.]*?):\s*"?(.+?)"?\s*$/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2];
      if (val === "true") result[currentKey] = true;
      else if (val === "false") result[currentKey] = false;
      else result[currentKey] = val;
    } else if (line.match(/^(\w[\w.]*?):\s*$/)) {
      const keyOnly = line.match(/^(\w[\w.]*?):\s*$/);
      if (keyOnly) {
        currentKey = keyOnly[1];
        currentArray = [];
        result[currentKey] = currentArray;
      }
    }
  }
  return result;
}

async function hashDirectory(dirPath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const entries: string[] = [];

  async function collect(dir: string): Promise<void> {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = join(dir, item.name);
      if (item.isDirectory()) {
        await collect(fullPath);
      } else if (item.isFile()) {
        entries.push(relative(dirPath, fullPath));
      }
    }
  }

  await collect(dirPath);
  entries.sort();

  for (const entry of entries) {
    const content = await readFile(join(dirPath, entry));
    hash.update(entry);
    hash.update(content);
  }

  return hash.digest("hex");
}

export async function scanInstalledSkills(
  skillsDir: string,
): Promise<InstalledSkill[]> {
  const resolved = resolve(skillsDir);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(resolved, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: InstalledSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const skillDir = join(resolved, entry.name);
    const skillMdPath = join(skillDir, "SKILL.md");

    try {
      await stat(skillMdPath);
    } catch {
      continue;
    }

    const content = await readFile(skillMdPath, "utf-8");
    const frontmatter = parseFrontmatter(content);

    if (!frontmatter.name || !frontmatter.description) continue;

    const contentHash = await hashDirectory(skillDir);

    results.push({
      name: frontmatter.name as string,
      description: frontmatter.description as string,
      longDescription: frontmatter.longDescription as string | undefined,
      tag: (frontmatter.tag as string) ?? "dev-tools",
      icon: (frontmatter.icon as string) ?? "Sparkles",
      source: (frontmatter.source as string) ?? "custom",
      examples: frontmatter.examples as string[] | undefined,
      prompt: (frontmatter.prompt as string) ?? "",
      requires: frontmatter.requires as
        | { tools?: string[]; plugins?: string[] }
        | undefined,
      contentHash,
    });
  }

  return results;
}

export function resolveSkillsDir(): string {
  if (process.env.OPENCLAW_SKILLS_DIR) {
    return resolve(process.env.OPENCLAW_SKILLS_DIR);
  }
  const workspaceRoot =
    process.env.NEXU_WORKSPACE_ROOT ?? process.cwd();
  return resolve(workspaceRoot, ".openclaw", "skills");
}
```

**Step 2: Verify typecheck**

```bash
pnpm --filter @nexu/api typecheck
```

Expected: no errors

**Step 3: Commit**

```bash
git add apps/api/src/services/runtime/skill-scanner.ts
git commit -m "feat: add filesystem skill scanner service"
```

---

### Task 6: Add GitHub catalog fetcher to API

**Files:**
- Create: `apps/api/src/services/runtime/skill-catalog.ts`

**Step 1: Create the GitHub catalog service**

```typescript
// apps/api/src/services/runtime/skill-catalog.ts

interface CatalogSkill {
  description: string;
  longDescription?: string;
  tag: string;
  icon: string;
  source: string;
  examples?: string[];
  prompt: string;
  requires?: { tools?: string[]; plugins?: string[] };
  path: string;
}

interface SkillCatalog {
  version: number;
  skills: Record<string, CatalogSkill>;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";

let cachedCatalog: SkillCatalog | null = null;
let cachedAt = 0;

export function getSkillRepoConfig(): { owner: string; repo: string; branch: string } {
  const repoUrl = process.env.NEXU_SKILL_REPO ?? "nexu-app/nexu-skills";
  const [owner, repo] = repoUrl.split("/");
  const branch = process.env.NEXU_SKILL_REPO_BRANCH ?? "main";
  return { owner, repo, branch };
}

export async function fetchSkillCatalog(): Promise<SkillCatalog> {
  const now = Date.now();
  if (cachedCatalog && now - cachedAt < CACHE_TTL_MS) {
    return cachedCatalog;
  }

  const { owner, repo, branch } = getSkillRepoConfig();
  const url = `${GITHUB_RAW_BASE}/${owner}/${repo}/${branch}/skills.json`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`GitHub fetch failed: ${response.status}`);
    }

    const data = (await response.json()) as SkillCatalog;
    cachedCatalog = data;
    cachedAt = now;
    return data;
  } catch (error) {
    if (cachedCatalog) {
      return cachedCatalog;
    }
    throw error;
  }
}

export function invalidateCatalogCache(): void {
  cachedCatalog = null;
  cachedAt = 0;
}

export type { CatalogSkill, SkillCatalog };
```

**Step 2: Verify typecheck**

```bash
pnpm --filter @nexu/api typecheck
```

Expected: no errors

**Step 3: Commit**

```bash
git add apps/api/src/services/runtime/skill-catalog.ts
git commit -m "feat: add GitHub skill catalog fetcher"
```

---

### Task 7: Add merged skill list endpoint to API

**Files:**
- Create: `apps/api/src/routes/skill-filesystem-routes.ts`
- Modify: `apps/api/src/routes/skill-routes.ts` (wire up new routes)

**Step 1: Create the file-based skill routes**

```typescript
// apps/api/src/routes/skill-filesystem-routes.ts
import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { skillListResponseSchema } from "@nexu/shared";
import {
  resolveSkillsDir,
  scanInstalledSkills,
} from "../services/runtime/skill-scanner.js";
import {
  fetchSkillCatalog,
} from "../services/runtime/skill-catalog.js";
import type { AppBindings } from "../types.js";

const TAG_LABELS: Record<string, string> = {
  "office-collab": "Office & Collaboration",
  "file-knowledge": "Files & Knowledge",
  "creative-design": "Creative & Design",
  "biz-analysis": "Business Analysis",
  "av-generation": "Audio & Video",
  "info-content": "Info & Content",
  "dev-tools": "Dev Tools",
};

const listFilesystemSkillsRoute = createRoute({
  method: "get",
  path: "/api/v1/skills/filesystem",
  tags: ["Skills"],
  responses: {
    200: {
      content: {
        "application/json": { schema: skillListResponseSchema },
      },
      description: "Merged skill list from filesystem + GitHub catalog",
    },
  },
});

export function registerFilesystemSkillRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(listFilesystemSkillsRoute, async (c) => {
    const skillsDir = resolveSkillsDir();
    const [installed, catalog] = await Promise.all([
      scanInstalledSkills(skillsDir),
      fetchSkillCatalog().catch(() => ({ version: 0, skills: {} })),
    ]);

    const installedMap = new Map(installed.map((s) => [s.name, s]));
    const tagCounts: Record<string, number> = {};
    const skills: z.infer<typeof skillListResponseSchema>["skills"] = [];

    // Add all catalog skills
    for (const [name, catalogSkill] of Object.entries(catalog.skills)) {
      const local = installedMap.get(name);
      const tag = (catalogSkill.tag ?? "dev-tools") as z.infer<typeof skillListResponseSchema>["skills"][number]["tag"];
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;

      skills.push({
        slug: name,
        name,
        description: catalogSkill.description,
        longDescription: catalogSkill.longDescription,
        iconName: catalogSkill.icon ?? "Sparkles",
        prompt: catalogSkill.prompt ?? "",
        examples: catalogSkill.examples,
        tag,
        source: (catalogSkill.source ?? "official") as "official" | "custom" | "community",
        installed: !!local,
        updatable: false, // TODO: compare hashes when catalog includes them
      });

      installedMap.delete(name);
    }

    // Add local-only skills (not in catalog)
    for (const [name, local] of installedMap) {
      const tag = (local.tag ?? "dev-tools") as z.infer<typeof skillListResponseSchema>["skills"][number]["tag"];
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;

      skills.push({
        slug: name,
        name,
        description: local.description,
        longDescription: local.longDescription,
        iconName: local.icon ?? "Sparkles",
        prompt: local.prompt ?? "",
        examples: local.examples,
        tag,
        source: "custom",
        installed: true,
      });
    }

    const tags = Object.entries(TAG_LABELS).map(([id, label]) => ({
      id: id as z.infer<typeof skillListResponseSchema>["tags"][number]["id"],
      label,
      count: tagCounts[id] ?? 0,
    }));

    return c.json({ skills, tags }, 200);
  });
}
```

**Step 2: Wire up in the main app**

Find where `registerSkillCatalogRoutes` is called in the API app setup and add `registerFilesystemSkillRoutes` alongside it. Check:

```bash
grep -rn "registerSkillCatalogRoutes\|registerSkillRoutes" apps/api/src/
```

Add the import and registration call next to the existing one.

**Step 3: Verify typecheck**

```bash
pnpm --filter @nexu/api typecheck
```

Expected: no errors

**Step 4: Commit**

```bash
git add apps/api/src/routes/skill-filesystem-routes.ts apps/api/src/
git commit -m "feat: add merged filesystem + GitHub skill list endpoint"
```

---

### Task 8: Generate skills.json and verify end-to-end

**Step 1: Run the build script**

```bash
cd nexu-skills/scripts && npx tsx build-index.ts
```

Expected: `Generated skills.json with 8 skills`

**Step 2: Copy a skill to .openclaw/skills/ to test the scanner**

```bash
mkdir -p .openclaw/skills/
cp -r nexu-skills/skills/feishu-bitable .openclaw/skills/
```

**Step 3: Start the API and test the endpoint**

```bash
pnpm --filter @nexu/api dev &
sleep 3
curl -s http://localhost:3000/api/v1/skills/filesystem | node -e "
  const d=require('fs').readFileSync('/dev/stdin','utf8');
  const j=JSON.parse(d);
  const installed = j.skills.filter(s => s.installed);
  console.log('Total:', j.skills.length, 'Installed:', installed.length);
  installed.forEach(s => console.log(' -', s.slug));
"
```

Expected:
```
Total: 8 Installed: 1
 - feishu-bitable
```

**Step 4: Clean up test data**

```bash
rm -rf .openclaw/skills/feishu-bitable
```

**Step 5: Commit skills.json**

```bash
git add nexu-skills/skills.json
git commit -m "chore: generate skills.json index for 8 Feishu skills"
```

---

## Summary

| Task | What | Commit message |
|------|------|---------------|
| 1 | Build-index script | `feat: add skill repo build-index script` |
| 2 | Port 8 Feishu skills | `feat: add 8 Feishu skills as first public skills` |
| 3 | Shared frontmatter schema | `feat: add skill frontmatter schema to shared package` |
| 4 | Schema: installed/updatable | `feat: add installed/updatable fields to skill schema` |
| 5 | Filesystem skill scanner | `feat: add filesystem skill scanner service` |
| 6 | GitHub catalog fetcher | `feat: add GitHub skill catalog fetcher` |
| 7 | Merged skill list endpoint | `feat: add merged filesystem + GitHub skill list endpoint` |
| 8 | End-to-end verification | `chore: generate skills.json index for 8 Feishu skills` |

**Not in scope (Phase 2):** CLI `nexu skill install/uninstall`, web UI changes, install/delete API endpoints, Composio migration.
