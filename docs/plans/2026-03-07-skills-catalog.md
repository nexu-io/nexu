# Skills Catalog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Skills catalog to Nexu so users can browse available AI capabilities, see which toolkits each skill requires, and discover example prompts.

**Architecture:** New `supported_skills` DB table stores skill metadata (name, description, category, examples, linked toolkits). A read-only API endpoint serves the catalog. The frontend renders a Skills page with search, category filters, source tabs (official/custom), and skill cards. Skills reference toolkits via a `toolkit_slugs` JSON text column (no FK).

**Tech Stack:** Drizzle ORM (PostgreSQL), Zod schemas, Hono OpenAPI routes, React + TanStack Query frontend.

---

### Task 1: DB Schema - Add `supported_skills` table

**Files:**
- Modify: `apps/api/src/db/schema/index.ts` (insert before `e2eTestMigration` table around line 503)

**Step 1: Add the table definition**

Add this before the `// Test-only table` comment at line 503:

```typescript
export const supportedSkills = pgTable("supported_skills", {
  pk: serial("pk").primaryKey(),
  id: text("id").notNull().unique(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  longDescription: text("long_description"),
  iconName: text("icon_name").notNull().default("Sparkles"),
  prompt: text("prompt").notNull(),
  examples: text("examples"),
  tag: text("tag").notNull().default("office-collab"),
  source: text("source").notNull().default("official"),
  toolkitSlugs: text("toolkit_slugs"),
  githubUrl: text("github_url"),
  enabled: boolean("enabled").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
```

Column notes:
- `iconName`: lucide-react icon component name (e.g. "Mail", "Calendar", "Search")
- `examples`: JSON array of strings stored as text (e.g. `'["example 1","example 2"]'`)
- `toolkitSlugs`: JSON array of toolkit slug strings (e.g. `'["gmail","gcal"]'`). References `supported_toolkits.slug` at application level.
- `tag`: category identifier matching `ToolTag` type from reference (office-collab, file-knowledge, creative-design, biz-analysis, av-generation, info-content, dev-tools)
- `source`: "official" or "custom"

**Step 2: Generate migration**

Run: `pnpm db:generate`
Expected: New migration SQL file created under `apps/api/migrations/`

**Step 3: Apply migration to dev and test databases**

Run:
```bash
pnpm --filter @nexu/api db:push
DATABASE_URL="postgresql://nexu:nexu@localhost:5433/nexu_test" pnpm --filter @nexu/api db:push
```
Expected: Tables created successfully in both databases.

**Step 4: Commit**

```bash
git add apps/api/src/db/schema/index.ts apps/api/migrations/
git commit -m "feat: add supported_skills DB table"
```

---

### Task 2: Zod Schemas for Skills

**Files:**
- Create: `packages/shared/src/schemas/skill.ts`
- Modify: `packages/shared/src/index.ts`

**Step 1: Create the skill schemas file**

```typescript
import { z } from "zod";

export const skillTagSchema = z.enum([
  "office-collab",
  "file-knowledge",
  "creative-design",
  "biz-analysis",
  "av-generation",
  "info-content",
  "dev-tools",
]);

export const skillSourceSchema = z.enum(["official", "custom"]);

export const skillToolRefSchema = z.object({
  slug: z.string(),
  name: z.string(),
  provider: z.string(),
});

export const skillInfoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  longDescription: z.string().optional(),
  iconName: z.string(),
  prompt: z.string(),
  examples: z.array(z.string()).optional(),
  tag: skillTagSchema,
  source: skillSourceSchema,
  tools: z.array(skillToolRefSchema).optional(),
  githubUrl: z.string().optional(),
});

export const skillListResponseSchema = z.object({
  skills: z.array(skillInfoSchema),
  tags: z.array(
    z.object({
      id: skillTagSchema,
      label: z.string(),
      count: z.number(),
    }),
  ),
});
```

**Step 2: Export from shared index**

Add to `packages/shared/src/index.ts`:

```typescript
export * from "./schemas/skill.js";
```

**Step 3: Commit**

```bash
git add packages/shared/src/schemas/skill.ts packages/shared/src/index.ts
git commit -m "feat: add Zod schemas for skills catalog"
```

---

### Task 3: API Route - GET /api/v1/skills

**Files:**
- Create: `apps/api/src/routes/skill-routes.ts`
- Modify: `apps/api/src/app.ts`

**Step 1: Create the skill routes file**

```typescript
import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { skillListResponseSchema } from "@nexu/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { supportedSkills, supportedToolkits } from "../db/schema/index.js";
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

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const listSkillsRoute = createRoute({
  method: "get",
  path: "/api/v1/skills",
  tags: ["Skills"],
  responses: {
    200: {
      content: {
        "application/json": { schema: skillListResponseSchema },
      },
      description: "List of available skills",
    },
  },
});

export function registerSkillRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(listSkillsRoute, async (c) => {
    const rows = await db
      .select()
      .from(supportedSkills)
      .where(eq(supportedSkills.enabled, true))
      .orderBy(supportedSkills.sortOrder);

    // Pre-fetch all toolkits for linking
    const toolkits = await db
      .select({ slug: supportedToolkits.slug, displayName: supportedToolkits.displayName, domain: supportedToolkits.domain })
      .from(supportedToolkits)
      .where(eq(supportedToolkits.enabled, true));

    const toolkitMap = new Map(toolkits.map((t) => [t.slug, t]));

    const tagCounts: Record<string, number> = {};

    const skills = rows.map((row) => {
      tagCounts[row.tag] = (tagCounts[row.tag] ?? 0) + 1;

      const toolkitSlugs = parseJsonArray(row.toolkitSlugs);
      const tools = toolkitSlugs
        .map((slug) => {
          const tk = toolkitMap.get(slug);
          return tk ? { slug, name: tk.displayName, provider: tk.domain } : null;
        })
        .filter((t): t is { slug: string; name: string; provider: string } => t !== null);

      return {
        slug: row.slug,
        name: row.name,
        description: row.description,
        longDescription: row.longDescription ?? undefined,
        iconName: row.iconName,
        prompt: row.prompt,
        examples: parseJsonArray(row.examples) || undefined,
        tag: row.tag as "office-collab" | "file-knowledge" | "creative-design" | "biz-analysis" | "av-generation" | "info-content" | "dev-tools",
        source: row.source as "official" | "custom",
        tools: tools.length > 0 ? tools : undefined,
        githubUrl: row.githubUrl ?? undefined,
      };
    });

    const tags = Object.entries(TAG_LABELS).map(([id, label]) => ({
      id: id as "office-collab" | "file-knowledge" | "creative-design" | "biz-analysis" | "av-generation" | "info-content" | "dev-tools",
      label,
      count: tagCounts[id] ?? 0,
    }));

    return c.json({ skills, tags }, 200);
  });
}
```

**Step 2: Register in app.ts**

Add import and registration call in `apps/api/src/app.ts` after the integration routes registration:

```typescript
import { registerSkillRoutes } from "./routes/skill-routes.js";
// ... in createApp():
registerSkillRoutes(app);
```

**Step 3: Generate types**

Run:
```bash
pnpm generate-types && pnpm typecheck
```

**Step 4: Commit**

```bash
git add apps/api/src/routes/skill-routes.ts apps/api/src/app.ts apps/api/openapi.json apps/web/lib/api/sdk.gen.ts apps/web/lib/api/types.gen.ts
git commit -m "feat: add GET /api/v1/skills endpoint"
```

---

### Task 4: Seed Skills Data

**Files:**
- (Database seed via SQL)

**Step 1: Insert all 63 skills into dev database**

Use the MCP database tool or a SQL script to insert all skills from the reference `skillData.ts`. Each skill maps to a row in `supported_skills`:

- `id`: generated cuid2
- `slug`: skill's `id` field from skillData (e.g. "gmail", "gcal", "slack")
- `name`: skill's `name` field
- `description`: skill's `desc` field
- `long_description`: skill's `longDesc` field (nullable)
- `icon_name`: the lucide icon component name as string (e.g. "Mail" for `Mail` import)
- `prompt`: skill's `prompt` field
- `examples`: JSON array string of skill's `examples` array
- `tag`: skill's `tag` field
- `source`: skill's `source` field (all "official" in reference data)
- `toolkit_slugs`: JSON array of tool IDs from skill's `tools` array (map `tool.id` values), or null if no tools
- `github_url`: skill's `github` field (nullable)
- `sort_order`: sequential number for ordering
- `enabled`: true

The icon name mapping from skillData.ts imports:
- `Mail` -> "Mail"
- `Calendar` -> "Calendar"
- `MessageSquare` -> "MessageSquare"
- `Search` -> "Search"
- `BarChart3` -> "BarChart3"
- `Image` -> "Image"
- `Palette` -> "Palette"
- `FileText` -> "FileText"
- `Users` -> "Users"
- `Link2` -> "Link2"
- `Video` -> "Video"
- `Globe` -> "Globe"
- `Map` -> "Map"
- `Table` -> "Table"
- `HardDrive` -> "HardDrive"
- `Mic` -> "Mic"
- `Sparkles` -> "Sparkles"
- `Bot` -> "Bot"
- `DollarSign` -> "DollarSign"
- `UserSearch` -> "UserSearch"
- `Phone` -> "Phone"
- `PenTool` -> "PenTool"
- `Newspaper` -> "Newspaper"
- `Code` -> "Code"

**Step 2: Verify via API**

Run: `curl http://localhost:3000/api/v1/skills | jq '.skills | length'`
Expected: `63`

---

### Task 5: Frontend - Skills Page

**Files:**
- Create: `apps/web/src/pages/skills.tsx`

**Step 1: Create the Skills page**

The page adapts the `OpenClawSkillsPage.tsx` reference from agent-digital-cowork. Key differences from the Integrations page:

- **Read-only catalog** — no connect/disconnect, just browse
- **Source tabs** — "Official" / "Custom" (primary filter)
- **Category tag filter** — 7 category pills with counts (secondary filter, only for official)
- **Skill cards** — icon (from `iconName`), name, description, category badge, toolkit providers
- **No detail page** — cards are non-interactive for now (can add detail route later)

The `iconName` field maps to lucide-react components dynamically. Use a lookup map for the ~24 icon names used in the seed data.

Key patterns:
- Use `getApiV1Skills` from generated SDK
- Use `useQuery` with `["skills"]` key
- Search filters by name, description, slug
- Category filter from `tags` array in API response
- Source filter from `source` field on each skill

---

### Task 6: Frontend - Route + Sidebar Navigation

**Files:**
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/layouts/workspace-layout.tsx`

**Step 1: Add route**

In `apps/web/src/app.tsx`:
- Import `SkillsPage` from `./pages/skills`
- Add route: `<Route path="/workspace/skills" element={<SkillsPage />} />`
- Add to `titleByPathname`: `"/workspace/skills": "Skills · Nexu"`

**Step 2: Add sidebar nav item**

In `apps/web/src/layouts/workspace-layout.tsx`:
- Import `Zap` icon from lucide-react (already imported)
- Add `isSkillsPage` detection: `const isSkillsPage = location.pathname.includes("/skills");`
- Add nav link after Integrations link in both desktop sidebar and mobile drawer
- Update `showEmptyState` to exclude `!isSkillsPage`
- Update `mobileTitle` / `mobileSubtitle` for skills page

**Step 3: Verify**

Run:
```bash
pnpm generate-types && pnpm typecheck && pnpm lint
```

**Step 4: Commit**

```bash
git add apps/web/src/pages/skills.tsx apps/web/src/app.tsx apps/web/src/layouts/workspace-layout.tsx
git commit -m "feat: add Skills catalog page with search and filters"
```

---

### Task 7: Final Verification

**Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: Zero errors across all packages.

**Step 2: Lint**

Run: `pnpm lint` (check our changed files specifically)
Expected: No new errors in our files.

**Step 3: Tests**

Run: `pnpm --filter @nexu/api test`
Expected: All existing tests still pass. (Skills API is read-only, no new tests strictly required for v1 — the endpoint is a simple SELECT.)

---

## File Summary

| Action | File |
|--------|------|
| Modify | `apps/api/src/db/schema/index.ts` |
| Create | `packages/shared/src/schemas/skill.ts` |
| Modify | `packages/shared/src/index.ts` |
| Create | `apps/api/src/routes/skill-routes.ts` |
| Modify | `apps/api/src/app.ts` |
| Create | `apps/web/src/pages/skills.tsx` |
| Modify | `apps/web/src/app.tsx` |
| Modify | `apps/web/src/layouts/workspace-layout.tsx` |
