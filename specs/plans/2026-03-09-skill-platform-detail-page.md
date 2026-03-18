# Skill Platform — Detail Page + OAuth Integration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Skill detail page where users can view skill info, connect required OAuth tools, see example prompts, and explore related skills. Remove the Integrations page from user-facing navigation — the Skill detail page becomes the single surface for tool authorization.

**Architecture:** The skill detail page fetches a new `GET /api/v1/skills/:slug` endpoint that returns full skill metadata plus per-user OAuth tool connection status (by joining `supported_skills` → `supported_toolkits` → `user_integrations`). OAuth connect/disconnect reuses the existing integration API routes (`POST /api/v1/integrations/connect`, `DELETE /api/v1/integrations/:id`). The Integrations sidebar nav link is removed; the Integrations page and API remain as backend infrastructure.

**Tech Stack:** Hono OpenAPI routes, Drizzle ORM, Zod schemas, React + TanStack Query, lucide-react icons, existing Composio OAuth flow.

---

### Task 1: Add Skill Detail Zod Schema

**Files:**
- Modify: `packages/shared/src/schemas/skill.ts`

**Step 1: Add the skill detail response schema**

Add after the existing `skillListResponseSchema` (line 44):

```typescript
export const skillToolWithStatusSchema = z.object({
  slug: z.string(),
  name: z.string(),
  provider: z.string(),
  authScheme: z.string(),
  status: z.enum(["connected", "not_connected", "initiated", "expired"]),
  integrationId: z.string().optional(),
});

export const skillDetailResponseSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  longDescription: z.string().optional(),
  iconName: z.string(),
  prompt: z.string(),
  examples: z.array(z.string()).optional(),
  tag: skillTagSchema,
  source: skillSourceSchema,
  tools: z.array(skillToolWithStatusSchema).optional(),
  githubUrl: z.string().optional(),
  relatedSkills: z.array(skillInfoSchema).optional(),
});
```

**Step 2: Export from shared index**

`packages/shared/src/index.ts` already exports `"./schemas/skill.js"` — no change needed since new schemas are in the same file.

**Step 3: Build shared package**

Run: `pnpm --filter @nexu/shared build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add packages/shared/src/schemas/skill.ts
git commit -m "feat: add skill detail response Zod schema"
```

---

### Task 2: Add Skill Detail API Endpoint

**Files:**
- Modify: `apps/api/src/routes/skill-routes.ts` (append inside `registerSkillCatalogRoutes`, after line 260)

**Step 1: Add the route definition and handler**

Add a new `createRoute` + handler inside `registerSkillCatalogRoutes`, after the existing `listSkillsRoute` handler (before the closing `}`):

```typescript
import { skillDetailResponseSchema } from "@nexu/shared";
import { and, inArray } from "drizzle-orm";
import { userIntegrations } from "../db/schema/index.js";

const skillSlugParam = z.object({
  slug: z.string(),
});

const getSkillDetailRoute = createRoute({
  method: "get",
  path: "/api/v1/skills/{slug}",
  tags: ["Skills"],
  request: {
    params: skillSlugParam,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: skillDetailResponseSchema },
      },
      description: "Skill detail with tool auth status",
    },
    404: {
      content: {
        "application/json": { schema: z.object({ message: z.string() }) },
      },
      description: "Skill not found",
    },
  },
});
```

Handler:

```typescript
app.openapi(getSkillDetailRoute, async (c) => {
  const { slug } = c.req.valid("param");
  const userId = c.get("userId") as string | undefined;

  const [row] = await db
    .select()
    .from(supportedSkills)
    .where(eq(supportedSkills.slug, slug));

  if (!row) {
    return c.json({ message: "Skill not found" }, 404);
  }

  const toolkitSlugs = parseJsonArray(row.toolkitSlugs);

  // Fetch toolkit info for this skill's tools
  let tools: Array<{
    slug: string;
    name: string;
    provider: string;
    authScheme: string;
    status: "connected" | "not_connected" | "initiated" | "expired";
    integrationId?: string;
  }> = [];

  if (toolkitSlugs.length > 0) {
    const toolkits = await db
      .select()
      .from(supportedToolkits)
      .where(inArray(supportedToolkits.slug, toolkitSlugs));

    // Check user's connection status for each toolkit
    let userConnections: Array<{
      toolkitSlug: string;
      status: string;
      id: string;
    }> = [];
    if (userId) {
      const connections = await db
        .select({
          toolkitSlug: userIntegrations.toolkitSlug,
          status: userIntegrations.status,
          id: userIntegrations.id,
        })
        .from(userIntegrations)
        .where(
          and(
            eq(userIntegrations.userId, userId),
            inArray(userIntegrations.toolkitSlug, toolkitSlugs),
          ),
        );
      userConnections = connections;
    }

    const connectionMap = new Map(
      userConnections.map((c) => [c.toolkitSlug, c]),
    );

    tools = toolkits.map((tk) => {
      const conn = connectionMap.get(tk.slug);
      const rawStatus = conn?.status ?? "not_connected";
      const status = (
        ["connected", "not_connected", "initiated", "expired"].includes(
          rawStatus,
        )
          ? rawStatus === "active"
            ? "connected"
            : rawStatus
          : "not_connected"
      ) as "connected" | "not_connected" | "initiated" | "expired";

      return {
        slug: tk.slug,
        name: tk.displayName,
        provider: tk.domain,
        authScheme: tk.authScheme,
        status: conn?.status === "active" ? "connected" : status,
        integrationId: conn?.id,
      };
    });
  }

  // Related skills: same tag, exclude current, limit 6
  const relatedRows = await db
    .select()
    .from(supportedSkills)
    .where(
      and(
        eq(supportedSkills.tag, row.tag),
        eq(supportedSkills.enabled, true),
      ),
    )
    .orderBy(supportedSkills.sortOrder)
    .limit(7);

  const allToolkits = await db
    .select({
      slug: supportedToolkits.slug,
      displayName: supportedToolkits.displayName,
      domain: supportedToolkits.domain,
    })
    .from(supportedToolkits)
    .where(eq(supportedToolkits.enabled, true));
  const allToolkitMap = new Map(allToolkits.map((t) => [t.slug, t]));

  const relatedSkills = relatedRows
    .filter((r) => r.slug !== slug)
    .slice(0, 6)
    .map((r) => {
      const rToolkitSlugs = parseJsonArray(r.toolkitSlugs);
      const rTools = rToolkitSlugs
        .map((s) => {
          const tk = allToolkitMap.get(s);
          return tk ? { slug: s, name: tk.displayName, provider: tk.domain } : null;
        })
        .filter((t): t is { slug: string; name: string; provider: string } => t !== null);
      const rExamples = parseJsonArray(r.examples);
      return {
        slug: r.slug,
        name: r.name,
        description: r.description,
        longDescription: r.longDescription ?? undefined,
        iconName: r.iconName,
        prompt: r.prompt,
        examples: rExamples.length > 0 ? rExamples : undefined,
        tag: r.tag as "office-collab" | "file-knowledge" | "creative-design" | "biz-analysis" | "av-generation" | "info-content" | "dev-tools",
        source: r.source as "official" | "custom",
        tools: rTools.length > 0 ? rTools : undefined,
        githubUrl: r.githubUrl ?? undefined,
      };
    });

  const examples = parseJsonArray(row.examples);

  return c.json(
    {
      slug: row.slug,
      name: row.name,
      description: row.description,
      longDescription: row.longDescription ?? undefined,
      iconName: row.iconName,
      prompt: row.prompt,
      examples: examples.length > 0 ? examples : undefined,
      tag: row.tag as "office-collab" | "file-knowledge" | "creative-design" | "biz-analysis" | "av-generation" | "info-content" | "dev-tools",
      source: row.source as "official" | "custom",
      tools: tools.length > 0 ? tools : undefined,
      githubUrl: row.githubUrl ?? undefined,
      relatedSkills: relatedSkills.length > 0 ? relatedSkills : undefined,
    },
    200,
  );
});
```

**Important notes:**
- Import `skillDetailResponseSchema` from `@nexu/shared` (add to existing import at line 4)
- Import `and, inArray` from `drizzle-orm` (add to existing import at line 8)
- Import `userIntegrations` from `../db/schema/index.js` (add to existing import at line 12)
- The `parseJsonArray` helper already exists at line 159
- The `TAG_LABELS` map already exists at line 149
- `userId` comes from auth middleware via `c.get("userId")` — the catalog routes are registered after auth middleware in `app.ts`
- Integration status `"active"` maps to display `"connected"` for frontend clarity

**Step 2: Regenerate frontend SDK**

Run: `pnpm generate-types`
Expected: New `getApiV1SkillsBySlug` function generated in `apps/web/lib/api/sdk.gen.ts`.

**Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: Zero errors.

**Step 4: Commit**

```bash
git add apps/api/src/routes/skill-routes.ts apps/api/openapi.json apps/web/lib/api/sdk.gen.ts apps/web/lib/api/types.gen.ts
git commit -m "feat: add GET /api/v1/skills/:slug detail endpoint"
```

---

### Task 3: Create Skill Detail Page

**Files:**
- Create: `apps/web/src/pages/skill-detail.tsx`

**Step 1: Create the page component**

The design reference is at `/Users/alche/Documents/digit-sutando/agent-digital-cowork/design-system/src/pages/openclaw/SkillDetailPage.tsx`. Adapt it for Nexu's workspace context (no landing page nav/footer, uses workspace layout).

Key sections to include:
1. **Back link** to `/workspace/skills`
2. **Hero** — skill icon (from ICON_MAP), name, category badge, OAuth badge, long description
3. **Quick Info card** — category, auth type, providers, platforms
4. **Tool Authorization section** (if skill has tools) — each tool shows connect/disconnect status, uses existing integration APIs
5. **Example Prompts section** — numbered list with copy buttons
6. **Related Skills section** — grid of skill cards linking to other detail pages

OAuth connect flow:
- Call `postApiV1IntegrationsConnect({ body: { toolkitSlug, source: "page" } })` from generated SDK
- If response has `connectUrl`, open it in a new tab (Composio OAuth redirect)
- Poll with `postApiV1IntegrationsRefreshByIntegrationId` every 3s until status becomes `active`
- On success, invalidate `["skill", slug]` query to refresh tool statuses

OAuth disconnect flow:
- Call `deleteApiV1IntegrationsByIntegrationId({ path: { integrationId } })` from generated SDK
- On success, invalidate query

Use the same `ICON_MAP` from the skills list page (can extract to shared constant or duplicate — small map, acceptable).

The page must use the generated SDK functions only (never raw `fetch`) per CLAUDE.md rules.

**Step 2: Commit**

```bash
git add apps/web/src/pages/skill-detail.tsx
git commit -m "feat: add Skill detail page with OAuth connect flow"
```

---

### Task 4: Add Route + Remove Integrations from Sidebar

**Files:**
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/layouts/workspace-layout.tsx`

**Step 1: Add skill detail route to app.tsx**

In `apps/web/src/app.tsx`:

1. Import: `import { SkillDetailPage } from "./pages/skill-detail";`
2. Add route after the existing skills route (line 54):
   ```tsx
   <Route path="/workspace/skills/:slug" element={<SkillDetailPage />} />
   ```
3. Add title entry: `"/workspace/skills/": "Skill · Nexu"` — but since this is a dynamic route, handle it in the `DocumentTitleSync` component with a fallback pattern.

**Step 2: Remove Integrations sidebar link from workspace-layout.tsx**

In `apps/web/src/layouts/workspace-layout.tsx`:

1. Remove the `Puzzle` import from lucide-react (line 13)
2. Remove `isIntegrationsPage` variable (line 158)
3. Remove the Integrations `<Link>` in the desktop sidebar (lines 351-365)
4. Remove the Integrations `<Link>` in the mobile drawer (lines 589-604)
5. Remove `!isIntegrationsPage` from `showEmptyState` (line 173)
6. Remove `isIntegrationsPage` branches from `mobileTitle` and `mobileSubtitle` ternaries (lines 182-183, 189-190)

**Do NOT remove** the `/workspace/integrations` route from `app.tsx` — the page and API remain accessible via direct URL, just not in the sidebar.

**Step 3: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: Zero errors. If Biome reports unused imports (like `IntegrationsPage` in app.tsx), leave the route — it's still used, just not navigated to from the sidebar.

**Step 4: Commit**

```bash
git add apps/web/src/app.tsx apps/web/src/layouts/workspace-layout.tsx
git commit -m "feat: add skill detail route, remove Integrations from sidebar nav"
```

---

### Task 5: Make Skill Cards Link to Detail Page

**Files:**
- Modify: `apps/web/src/pages/skills.tsx`

**Step 1: Wrap SkillCard in a Link to detail page**

In `apps/web/src/pages/skills.tsx`, make the `SkillCard` component clickable — wrap the card `<div>` with `<Link to={/workspace/skills/${skill.slug}}>` using React Router.

Keep the existing "Copy prompt" button functional (stopPropagation on click to prevent navigation).

**Step 2: Commit**

```bash
git add apps/web/src/pages/skills.tsx
git commit -m "feat: make skill cards link to detail page"
```

---

### Task 6: Final Verification

**Step 1: Generate types**

Run: `pnpm generate-types`
Expected: SDK regenerated with new endpoint.

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: Zero errors across all packages.

**Step 3: Lint**

Run: `pnpm lint`
Expected: No new errors.

**Step 4: Test**

Run: `pnpm --filter @nexu/api test`
Expected: All existing tests pass (no regressions).

---

## File Summary

| Action | File |
|--------|------|
| Modify | `packages/shared/src/schemas/skill.ts` |
| Modify | `apps/api/src/routes/skill-routes.ts` |
| Create | `apps/web/src/pages/skill-detail.tsx` |
| Modify | `apps/web/src/app.tsx` |
| Modify | `apps/web/src/layouts/workspace-layout.tsx` |
| Modify | `apps/web/src/pages/skills.tsx` |

## Key Design Decisions

1. **Reuse existing integration APIs** for OAuth connect/disconnect — no new backend routes needed for tool auth
2. **Skill detail endpoint** joins `supported_skills` → `supported_toolkits` → `user_integrations` to return per-user tool status
3. **Integrations page stays accessible** via direct URL but is removed from sidebar navigation
4. **Status mapping**: DB `"active"` → frontend `"connected"`, DB `"initiated"` → frontend `"initiated"` (polling state), everything else → `"not_connected"`
