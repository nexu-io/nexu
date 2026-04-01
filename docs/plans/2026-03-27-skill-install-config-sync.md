# Skill Install → Config Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a skill is installed/uninstalled/imported, immediately recompile the OpenClaw config with explicit per-agent skill assignments and trigger a hot reload — so OpenClaw agents detect new skills within seconds instead of relying on the unreliable `extraDirs` file watcher.

**Architecture:** The config compiler reads installed skill slugs from the SkillDb ledger and writes them into each agent's `skills` field. After any skill mutation (install/uninstall/import), the `onSyncNeeded` callback triggers `syncAll()`, which recompiles the config (now different because agent skills changed), writes it to disk, and OpenClaw hot-reloads. For backward compatibility (upgrade from older versions), when the ledger is empty but skill files exist on disk, the compiler falls back to omitting the `skills` field so OpenClaw auto-discovers all skills from `extraDirs`.

**Tech Stack:** TypeScript, Vitest, Zod, Hono (OpenAPI)

---

## Background

### The Bug

Skill files are installed to disk, but OpenClaw never loads them because:
1. `skillhub-service.ts` `onComplete` only writes the ledger — never triggers `syncAll()`
2. `compileAgentList()` never includes a `skills` field on agents
3. OpenClaw's `extraDirs` file watcher is unreliable (31 min with no detection, ENOENT errors)

### OpenClaw Agent Schema

OpenClaw supports `skills?: string[]` on agent objects:
- **Omit** → agent gets ALL discovered skills (current behavior, legacy fallback)
- **`[]`** → agent gets NO skills
- **`["slug-a", "slug-b"]`** → agent gets only those skills

### Legacy Compatibility Requirement

Users upgrading from older versions have skill files on disk but an empty ledger (the ledger only tracks installs made through SkillHub UI). The compiler must detect this and fall back to `skills: undefined` (omit) so all existing skills continue to work. Once the user installs/uninstalls any skill via SkillHub, the ledger becomes authoritative.

---

## Task 1: Add `skills` field to Nexu's agent schema

**Files:**
- Modify: `packages/shared/src/schemas/openclaw-config.ts` (agentSchema)

**Step 1: Write the failing test**

Create `packages/shared/tests/openclaw-config-schema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { openclawConfigSchema } from "../src/schemas/openclaw-config.js";

describe("openclawConfigSchema agent skills field", () => {
  it("accepts agent with skills array", () => {
    const config = createMinimalConfig({
      agents: {
        defaults: { model: { primary: "test-model" } },
        list: [
          { id: "bot-1", name: "Bot", skills: ["git", "npm"] },
        ],
      },
    });
    const result = openclawConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents.list[0].skills).toEqual(["git", "npm"]);
    }
  });

  it("accepts agent without skills field (legacy)", () => {
    const config = createMinimalConfig({
      agents: {
        defaults: { model: { primary: "test-model" } },
        list: [{ id: "bot-1", name: "Bot" }],
      },
    });
    const result = openclawConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents.list[0]).not.toHaveProperty("skills");
    }
  });

  it("accepts agent with empty skills array", () => {
    const config = createMinimalConfig({
      agents: {
        defaults: { model: { primary: "test-model" } },
        list: [{ id: "bot-1", name: "Bot", skills: [] }],
      },
    });
    const result = openclawConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents.list[0].skills).toEqual([]);
    }
  });
});

// Helper: build a minimal valid config with overrides
function createMinimalConfig(overrides: Record<string, unknown> = {}) {
  return {
    gateway: {
      port: 18789,
      mode: "local",
      bind: "loopback",
      auth: { mode: "token", token: "test" },
      reload: { mode: "hybrid" },
      controlUi: { allowedOrigins: ["http://localhost:5173"] },
      tools: { allow: ["cron"] },
    },
    agents: {
      defaults: { model: { primary: "test-model" } },
      list: [{ id: "bot-1", name: "Bot" }],
    },
    skills: { load: { watch: true } },
    ...overrides,
  };
}
```

**Step 2: Run test to verify it fails**

```bash
pnpm test packages/shared/tests/openclaw-config-schema.test.ts
```

Expected: Tests may pass already due to `.passthrough()`, but the schema doesn't explicitly define `skills`. We need it explicit for type safety.

**Step 3: Add `skills` field to agent schema**

In `packages/shared/src/schemas/openclaw-config.ts`, update the `agentSchema`:

```typescript
const agentSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    default: z.boolean().optional(),
    workspace: z.string().optional(),
    model: agentModelSchema.optional(),
    skills: z.array(z.string()).optional(),
  })
  .passthrough();
```

**Step 4: Run test to verify it passes**

```bash
pnpm test packages/shared/tests/openclaw-config-schema.test.ts
```

Expected: All 3 tests PASS.

**Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS — the new optional field is backward compatible.

**Step 6: Commit**

```bash
git add packages/shared/src/schemas/openclaw-config.ts packages/shared/tests/openclaw-config-schema.test.ts
git commit -m "feat(shared): add optional skills field to agent config schema"
```

---

## Task 2: Compiler reads installed skills and assigns them to agents

**Files:**
- Modify: `apps/controller/src/lib/openclaw-config-compiler.ts` (`compileAgentList`, `compileOpenClawConfig`)
- Modify: `apps/controller/tests/openclaw-config-compiler.test.ts`

### Legacy compatibility logic

The compiler needs a new parameter: the list of installed skill slugs from the SkillDb ledger. The logic:

```
if (installedSlugs is provided AND has length > 0):
  → assign skills: [...installedSlugs] to every agent
else:
  → omit skills field (OpenClaw auto-discovers all from extraDirs)
```

This ensures:
- **Fresh install / upgrade**: Ledger is empty → skills omitted → all existing skills work
- **After first SkillHub action**: Ledger has entries → explicit list → only installed skills active
- **New skill installed**: Ledger updated → syncAll → config changes → hot reload

**Step 1: Write the failing tests**

Add to `apps/controller/tests/openclaw-config-compiler.test.ts`:

```typescript
describe("agent skill assignment", () => {
  it("includes skills on agents when installedSlugs is provided", () => {
    const config = createConfig();
    const env = createEnv();
    const compiled = compileOpenClawConfig(config, env, undefined, ["git", "npm"]);
    expect(compiled.agents.list[0].skills).toEqual(["git", "npm"]);
  });

  it("omits skills field when installedSlugs is empty (legacy fallback)", () => {
    const config = createConfig();
    const env = createEnv();
    const compiled = compileOpenClawConfig(config, env, undefined, []);
    expect(compiled.agents.list[0]).not.toHaveProperty("skills");
  });

  it("omits skills field when installedSlugs is undefined", () => {
    const config = createConfig();
    const env = createEnv();
    const compiled = compileOpenClawConfig(config, env);
    expect(compiled.agents.list[0]).not.toHaveProperty("skills");
  });

  it("assigns same skills to all active agents", () => {
    const now = new Date().toISOString();
    const config = createConfig({
      bots: [
        { id: "bot-1", name: "Bot A", slug: "bot-a", poolId: null, status: "active", modelId: "anthropic/claude-sonnet-4", systemPrompt: null, createdAt: now, updatedAt: now },
        { id: "bot-2", name: "Bot B", slug: "bot-b", poolId: null, status: "active", modelId: "anthropic/claude-sonnet-4", systemPrompt: null, createdAt: now, updatedAt: now },
      ],
    });
    const env = createEnv();
    const compiled = compileOpenClawConfig(config, env, undefined, ["calendar"]);
    expect(compiled.agents.list).toHaveLength(2);
    expect(compiled.agents.list[0].skills).toEqual(["calendar"]);
    expect(compiled.agents.list[1].skills).toEqual(["calendar"]);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm test apps/controller/tests/openclaw-config-compiler.test.ts
```

Expected: FAIL — `compileOpenClawConfig` doesn't accept a 4th parameter yet.

**Step 3: Implement compiler changes**

In `apps/controller/src/lib/openclaw-config-compiler.ts`:

1. Add `installedSkillSlugs` parameter to `compileAgentList`:

```typescript
function compileAgentList(
  config: NexuConfig,
  env: ControllerEnv,
  oauthState: OAuthConnectionState,
  installedSkillSlugs?: readonly string[],
): OpenClawConfig["agents"]["list"] {
  const skills =
    installedSkillSlugs && installedSkillSlugs.length > 0
      ? [...installedSkillSlugs]
      : undefined;

  return config.bots
    .filter((bot) => bot.status === "active")
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .map((bot, index) => ({
      id: bot.id,
      name: bot.name,
      workspace: `${env.openclawStateDir}/agents/${bot.id}`,
      default: index === 0,
      model: bot.modelId
        ? { primary: resolveModelId(config, env, bot.modelId, oauthState) }
        : undefined,
      ...(skills ? { skills } : {}),
    }));
}
```

2. Add `installedSkillSlugs` parameter to `compileOpenClawConfig`:

```typescript
export function compileOpenClawConfig(
  config: NexuConfig,
  env: ControllerEnv,
  oauthState: OAuthConnectionState = EMPTY_OAUTH_CONNECTION_STATE,
  installedSkillSlugs?: readonly string[],
): OpenClawConfig {
  // ... existing code ...
  // Update the agents.list call:
  list: compileAgentList(config, env, oauthState, installedSkillSlugs),
  // ... rest unchanged ...
}
```

**Step 4: Run tests to verify they pass**

```bash
pnpm test apps/controller/tests/openclaw-config-compiler.test.ts
```

Expected: All tests PASS.

**Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/controller/src/lib/openclaw-config-compiler.ts apps/controller/tests/openclaw-config-compiler.test.ts
git commit -m "feat(controller): compiler assigns installed skills to agents"
```

---

## Task 3: Sync service passes installed skills to compiler

**Files:**
- Modify: `apps/controller/src/services/openclaw-sync-service.ts` (`doSync` method)

The sync service already has a reference to the config store. It needs access to the SkillDb to read installed slugs and pass them to `compileOpenClawConfig`.

**Step 1: Write the failing test**

Add to `apps/controller/tests/openclaw-sync.test.ts`:

```typescript
it("includes installed skill slugs in compiled agent config", async () => {
  // Install a skill in the skill DB
  skillDb.recordInstall("my-skill", "managed");

  const { configPushed } = await syncService.syncAllImmediate();

  // Read the written config file
  const written = JSON.parse(
    readFileSync(env.openclawConfigPath, "utf-8"),
  );
  expect(written.agents.list[0].skills).toEqual(["my-skill"]);
  expect(configPushed).toBe(true);
});
```

Note: The existing sync test creates real stores. The SkillDb needs to be created and passed to the sync service. Adjust the test setup accordingly — the SkillDb can be created in the temp dir.

**Step 2: Run test to verify it fails**

```bash
pnpm test apps/controller/tests/openclaw-sync.test.ts
```

Expected: FAIL — sync service doesn't use SkillDb yet.

**Step 3: Wire SkillDb into sync service**

In `apps/controller/src/services/openclaw-sync-service.ts`:

1. Add `SkillDb` import and constructor parameter:

```typescript
import type { SkillDb } from "./skillhub/skill-db.js";

// Add to constructor parameters:
private readonly skillDb: SkillDb | null = null,
```

2. In `doSync()`, read installed slugs and pass to compiler:

```typescript
const installedSlugs = this.skillDb
  ? this.skillDb.getAllInstalled().map((r) => r.slug)
  : undefined;

const compiled = compileOpenClawConfig(config, this.env, oauthState, installedSlugs);
```

**Step 4: Update container.ts to pass SkillDb to sync service**

In `apps/controller/src/app/container.ts`:

The SkillDb is created inside `SkillhubService.create()` and not exposed. We have two options:
- Option A: Expose the SkillDb from SkillhubService
- Option B: Create SkillDb separately and inject it into both

**Use Option A** — add a getter to SkillhubService:

In `apps/controller/src/services/skillhub-service.ts`, add:
```typescript
get skillDb(): SkillDb {
  return this.db;
}
```

In `container.ts`, reorder creation so skillhubService is created before openclawSyncService, then pass the SkillDb:

```typescript
const skillhubService = await SkillhubService.create(env);

const openclawSyncService = new OpenClawSyncService(
  env,
  configStore,
  compiledStore,
  configWriter,
  authProfilesWriter,
  authProfilesStore,
  runtimePluginWriter,
  runtimeModelWriter,
  templateWriter,
  watchTrigger,
  gatewayService,
  skillhubService.skillDb,  // NEW
);
```

Check that `skillhubService` creation (currently line 115) is already before `openclawSyncService` (line 101). If not, reorder.

**Important:** Currently `openclawSyncService` is created at line 101 and `skillhubService` at line 115. This order must be reversed: move `skillhubService` creation above `openclawSyncService`.

**Step 5: Run tests**

```bash
pnpm test apps/controller/tests/openclaw-sync.test.ts
```

Expected: PASS.

**Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

**Step 7: Commit**

```bash
git add apps/controller/src/services/openclaw-sync-service.ts apps/controller/src/services/skillhub-service.ts apps/controller/src/app/container.ts apps/controller/tests/openclaw-sync.test.ts
git commit -m "feat(controller): sync service passes installed skills to compiler"
```

---

## Task 4: Trigger syncAll after skill install/uninstall/import

**Files:**
- Modify: `apps/controller/src/services/skillhub-service.ts` (add `onSyncNeeded` callback)
- Modify: `apps/controller/src/app/container.ts` (wire callback)
- Modify: `apps/controller/src/routes/skillhub-routes.ts` (add syncAll after uninstall/import)
- Modify: `apps/controller/tests/skillhub-service.test.ts`

**Step 1: Write the failing tests**

Add to `apps/controller/tests/skillhub-service.test.ts`:

```typescript
describe("onSyncNeeded callback", () => {
  it("calls onSyncNeeded after install completes", async () => {
    const onSyncNeeded = vi.fn();
    const service = await createService({ onSyncNeeded });

    // Simulate the onComplete callback
    const installQueue = getInstallQueueInstance();
    const onComplete = installQueue.opts.onComplete;
    onComplete("test-skill", "managed");

    expect(onSyncNeeded).toHaveBeenCalledTimes(1);
  });

  it("calls onSyncNeeded after cancel cleanup", async () => {
    const onSyncNeeded = vi.fn();
    const service = await createService({ onSyncNeeded });

    const installQueue = getInstallQueueInstance();
    const onCancelled = installQueue.opts.onCancelled;
    await onCancelled("test-skill", "managed");

    expect(onSyncNeeded).toHaveBeenCalledTimes(1);
  });

  it("does not fail when onSyncNeeded is not provided", async () => {
    const service = await createService();

    const installQueue = getInstallQueueInstance();
    const onComplete = installQueue.opts.onComplete;

    expect(() => onComplete("test-skill", "managed")).not.toThrow();
  });
});
```

Note: Adapt these to match the existing mock patterns in the test file (using `mocks.installQueueInstances` etc).

**Step 2: Run tests to verify they fail**

```bash
pnpm test apps/controller/tests/skillhub-service.test.ts
```

Expected: FAIL — SkillhubService.create doesn't accept options yet (it does if our earlier edit is still there, but let's verify).

**Step 3: Implement changes**

In `apps/controller/src/services/skillhub-service.ts`:

Add `onSyncNeeded` to the `SkillhubServiceOptions` interface and wire it through:

```typescript
export interface SkillhubServiceOptions {
  onSyncNeeded?: () => void;
}
```

(Already partially done from earlier exploration — ensure the constructor stores it and the `onComplete`/`onCancelled` callbacks call it.)

**Step 4: Wire in container.ts**

In `apps/controller/src/app/container.ts`, pass the callback:

```typescript
const skillhubService = await SkillhubService.create(env, {
  onSyncNeeded: () => {
    void openclawSyncService.syncAll().catch(() => {});
  },
});
```

**IMPORTANT ordering consideration:** `openclawSyncService` must be created before `skillhubService` so the closure captures it. But Task 3 requires the reverse (skillhubService.skillDb passed to sync service). Resolution: create SkillDb independently first, pass it to both.

**Alternative approach for container wiring:**

```typescript
// 1. Create SkillDb independently
const skillDb = await SkillDb.create(env.skillDbPath);

// 2. Create sync service with skillDb
const openclawSyncService = new OpenClawSyncService(
  env, configStore, compiledStore, configWriter,
  authProfilesWriter, authProfilesStore, runtimePluginWriter,
  runtimeModelWriter, templateWriter, watchTrigger, gatewayService,
  skillDb,
);

// 3. Create skillhub service with both skillDb and sync callback
const skillhubService = await SkillhubService.create(env, {
  skillDb,        // inject pre-created SkillDb
  onSyncNeeded: () => {
    void openclawSyncService.syncAll().catch(() => {});
  },
});
```

This requires `SkillhubService.create` to accept an optional pre-created `SkillDb`. Update the factory:

```typescript
static async create(
  env: ControllerEnv,
  options?: SkillhubServiceOptions,
): Promise<SkillhubService> {
  const skillDb = options?.skillDb ?? await SkillDb.create(env.skillDbPath);
  // ... rest unchanged, use skillDb instead of creating new one
}
```

And update the options interface:

```typescript
export interface SkillhubServiceOptions {
  skillDb?: SkillDb;
  onSyncNeeded?: () => void;
}
```

**Step 5: Add syncAll to uninstall and import routes**

In `apps/controller/src/routes/skillhub-routes.ts`:

For the uninstall route (POST `/api/v1/skillhub/uninstall`):
```typescript
async (c) => {
  const { slug } = c.req.valid("json");
  container.skillhubService.cancelInstall(slug);
  const result =
    await container.skillhubService.catalog.uninstallSkill(slug);
  await container.openclawSyncService.syncAll();
  return c.json(result, 200);
},
```

For the import route (POST `/api/v1/skillhub/import`):
```typescript
// After successful import:
if (result.ok) {
  await container.openclawSyncService.syncAll();
}
return c.json(result, 200);
```

**Step 6: Run all tests**

```bash
pnpm test apps/controller/tests/skillhub-service.test.ts
pnpm test apps/controller/tests/openclaw-sync.test.ts
```

Expected: All PASS.

**Step 7: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

**Step 8: Commit**

```bash
git add apps/controller/src/services/skillhub-service.ts apps/controller/src/app/container.ts apps/controller/src/routes/skillhub-routes.ts apps/controller/tests/skillhub-service.test.ts
git commit -m "feat(controller): trigger syncAll after skill install/uninstall/import"
```

---

## Task 5: End-to-end integration test

**Files:**
- Create: `apps/controller/tests/skill-install-config-sync.test.ts`

This test validates the full chain: skill install → ledger update → syncAll → config written with skills on agent.

**Step 1: Write the integration test**

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillDb } from "../src/services/skillhub/skill-db.js";
import { compileOpenClawConfig } from "../src/lib/openclaw-config-compiler.js";
import type { ControllerEnv } from "../src/app/env.js";
import type { NexuConfig } from "../src/store/schemas.js";

// Reuse createEnv/createConfig helpers from existing compiler test

describe("skill install → config sync integration", () => {
  let tmpDir: string;
  let skillDb: SkillDb;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "skill-sync-"));
    const dbPath = path.join(tmpDir, "skill-ledger.json");
    skillDb = await SkillDb.create(dbPath);
  });

  afterEach(async () => {
    skillDb.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("new install adds skill to compiled agent config", () => {
    // 1. Record a skill install (simulates onComplete callback)
    skillDb.recordInstall("taobao-native", "managed");

    // 2. Read installed slugs (simulates what sync service does)
    const slugs = skillDb.getAllInstalled().map((r) => r.slug);
    expect(slugs).toEqual(["taobao-native"]);

    // 3. Compile config with installed slugs
    const compiled = compileOpenClawConfig(
      createConfig(),
      createEnv(),
      undefined,
      slugs,
    );

    // 4. Verify agent has the skill
    expect(compiled.agents.list[0].skills).toEqual(["taobao-native"]);
  });

  it("empty ledger omits skills field (legacy upgrade path)", () => {
    const slugs = skillDb.getAllInstalled().map((r) => r.slug);
    expect(slugs).toEqual([]);

    const compiled = compileOpenClawConfig(
      createConfig(),
      createEnv(),
      undefined,
      slugs,
    );

    // Legacy fallback: no skills field → OpenClaw auto-discovers all
    expect(compiled.agents.list[0]).not.toHaveProperty("skills");
  });

  it("uninstall removes skill from compiled agent config", () => {
    skillDb.recordInstall("taobao-native", "managed");
    skillDb.recordInstall("git-helper", "managed");

    // Uninstall one
    skillDb.recordUninstall("git-helper", "managed");

    const slugs = skillDb.getAllInstalled().map((r) => r.slug);
    expect(slugs).toEqual(["taobao-native"]);

    const compiled = compileOpenClawConfig(
      createConfig(),
      createEnv(),
      undefined,
      slugs,
    );

    expect(compiled.agents.list[0].skills).toEqual(["taobao-native"]);
  });

  it("multiple agents all receive the same skills", () => {
    const now = new Date().toISOString();
    skillDb.recordInstall("calendar", "managed");

    const config = createConfig({
      bots: [
        { id: "bot-1", name: "A", slug: "a", poolId: null, status: "active", modelId: "anthropic/claude-sonnet-4", systemPrompt: null, createdAt: now, updatedAt: now },
        { id: "bot-2", name: "B", slug: "b", poolId: null, status: "active", modelId: "anthropic/claude-sonnet-4", systemPrompt: null, createdAt: now, updatedAt: now },
      ],
    });

    const slugs = skillDb.getAllInstalled().map((r) => r.slug);
    const compiled = compileOpenClawConfig(config, createEnv(), undefined, slugs);

    expect(compiled.agents.list).toHaveLength(2);
    for (const agent of compiled.agents.list) {
      expect(agent.skills).toEqual(["calendar"]);
    }
  });
});
```

**Step 2: Run the test**

```bash
pnpm test apps/controller/tests/skill-install-config-sync.test.ts
```

Expected: All PASS (this test exercises the code from Tasks 1-4).

**Step 3: Commit**

```bash
git add apps/controller/tests/skill-install-config-sync.test.ts
git commit -m "test(controller): integration test for skill install → config sync"
```

---

## Task 6: Final verification

**Step 1: Run full test suite**

```bash
pnpm test
```

**Step 2: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

**Step 3: Verify no regressions in existing compiler tests**

```bash
pnpm test apps/controller/tests/openclaw-config-compiler.test.ts
pnpm test tests/desktop/openclaw-config-compiler.test.ts
```

**Step 4: Verify existing skillhub tests still pass**

```bash
pnpm test apps/controller/tests/skillhub-service.test.ts
pnpm test tests/desktop/install-queue.test.ts
pnpm test tests/desktop/skill-db.test.ts
```

**Step 5: Final commit (if any lint/format fixes needed)**

```bash
pnpm format
git add -A
git commit -m "chore: format"
```

---

## Test Plan

### Unit Tests

| Test | File | What it validates |
|------|------|-------------------|
| Schema accepts skills array | `packages/shared/tests/openclaw-config-schema.test.ts` | Zod schema parses agent with `skills: string[]` |
| Schema accepts missing skills | same | Legacy agents without `skills` field still parse |
| Compiler assigns skills to agents | `apps/controller/tests/openclaw-config-compiler.test.ts` | `compileOpenClawConfig` with slugs → agents have `skills` |
| Compiler omits skills when empty | same | Empty slug array → no `skills` field (legacy compat) |
| Compiler omits skills when undefined | same | No slug param → no `skills` field |
| All agents get same skills | same | Multi-bot config → each agent has identical skills list |
| onSyncNeeded called after install | `apps/controller/tests/skillhub-service.test.ts` | `onComplete` triggers the callback |
| onSyncNeeded called after cancel | same | `onCancelled` triggers the callback |
| No crash without callback | same | Missing `onSyncNeeded` doesn't throw |

### Integration Tests

| Test | File | What it validates |
|------|------|-------------------|
| Install → compile includes skill | `apps/controller/tests/skill-install-config-sync.test.ts` | Full chain: DB record → slug read → compile → agent has skill |
| Empty ledger → legacy fallback | same | Upgrade path: no ledger entries → skills omitted |
| Uninstall → skill removed | same | Uninstall flow removes skill from compiled config |
| Multi-agent propagation | same | All agents receive the same skill list |
| Sync writes config with skills | `apps/controller/tests/openclaw-sync.test.ts` | SyncService reads from SkillDb and passes to compiler |

### Manual Smoke Test

1. **Fresh start (legacy compat):**
   - Start Nexu with existing skills on disk but empty ledger
   - Verify all skills are available to agents (skills field omitted in config)

2. **Install via SkillHub UI:**
   - Open SkillHub → Community tab → install a skill
   - Check controller logs for `syncAll` trigger
   - Read `openclaw.json` — verify `agents.list[0].skills` includes the new slug
   - Verify the agent can use the skill in a conversation

3. **Uninstall via SkillHub UI:**
   - Uninstall a skill from Installed tab
   - Verify `openclaw.json` no longer lists the slug in `agents.list[0].skills`

4. **Import custom skill:**
   - Import a `.zip` skill file
   - Verify `openclaw.json` is updated with the new skill slug

5. **Config hot reload timing:**
   - Watch OpenClaw logs during install
   - Verify hot reload happens within ~1-2 seconds (not 31 minutes)

### Regression Checks

- `pnpm test` — full suite passes
- `pnpm typecheck` — no type errors
- `pnpm lint` — no lint errors
- Existing compiler tests unchanged and passing
- Existing skillhub service tests unchanged and passing
- Desktop compiler tests (`tests/desktop/openclaw-config-compiler.test.ts`) still pass
