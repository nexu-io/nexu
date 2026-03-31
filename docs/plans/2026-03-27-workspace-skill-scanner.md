# Workspace Skill Scanner & Upgrade Compatibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure agent-installed workspace skills (via `clawhub install` in conversation) are detected, included in the config allowlist, tracked in the ledger, and visible in the desktop UI — with safe upgrade compatibility from older versions.

**Architecture:** A new `WorkspaceSkillScanner` scans each agent's `${openclawStateDir}/agents/${botId}/skills/` directory for SKILL.md folders. On startup, the `SkillDirWatcher` reconciles workspace skills into the ledger with a new `"workspace"` source and `agentId` field. The config compiler merges shared (ledger) + workspace (per-agent) slugs into each agent's `skills` allowlist. The API and frontend are extended to show workspace skills grouped by agent in the Installed tab.

**Tech Stack:** TypeScript, Vitest, Zod, Hono (OpenAPI), React, Ant Design

---

## Background

### The Problem

OpenClaw supports three skill installation paths:

| Method | Write location | Nexu tracks? |
|---|---|---|
| SkillHub UI (install/import) | `${stateDir}/skills/` (shared extraDirs) | Yes (ledger) |
| Agent conversation (`clawhub install`) | `${stateDir}/agents/${botId}/skills/` (workspace) | **No** |
| Static/bundled | `${stateDir}/skills/` (shared) | Yes (startup reconciliation) |

After the `skill-install-config-sync` branch introduced explicit `skills` allowlists on agents, workspace skills not in the ledger get silently filtered out — a regression for users who had agent-installed skills before upgrade.

### Key Files Reference

| File | Purpose |
|---|---|
| `apps/controller/src/services/skillhub/skill-db.ts` | Skill ledger (JSON file with SkillRecord[]) |
| `apps/controller/src/services/skillhub/skill-dir-watcher.ts` | Reconciles disk ↔ ledger, watches for changes |
| `apps/controller/src/services/skillhub/types.ts` | SkillSource, InstalledSkill, SkillhubCatalogData types |
| `apps/controller/src/services/skillhub-service.ts` | Orchestrates skill lifecycle |
| `apps/controller/src/lib/openclaw-config-compiler.ts` | Builds OpenClaw config from Nexu state |
| `apps/controller/src/services/openclaw-sync-service.ts` | Compiles + writes config on state changes |
| `apps/controller/src/app/container.ts` | Service wiring / dependency injection |
| `apps/controller/src/routes/skillhub-routes.ts` | SkillHub HTTP API |
| `apps/web/src/pages/skills.tsx` | Skills page UI (Yours / Explore tabs) |

### Current SkillRecord Schema

```typescript
{
  slug: string;
  source: "managed" | "custom";
  status: "installed" | "uninstalled";
  version: string | null;
  installedAt: string | null;
  uninstalledAt: string | null;
}
```

Matched by `slug + source`. No `agentId` field.

---

## Task 1: Extend SkillSource and SkillRecord with `"workspace"` source and `agentId`

**Files:**
- Modify: `apps/controller/src/services/skillhub/types.ts`
- Modify: `apps/controller/src/services/skillhub/skill-db.ts`
- Test: `tests/desktop/skill-db.test.ts`

**Step 1: Read the current files**

Read `apps/controller/src/services/skillhub/types.ts` and `apps/controller/src/services/skillhub/skill-db.ts` to understand current types.

**Step 2: Write the failing tests**

Add to `tests/desktop/skill-db.test.ts`:

```typescript
describe("workspace skills with agentId", () => {
  it("records workspace install with agentId", () => {
    db.recordInstall("my-tool", "workspace", undefined, "bot-abc");
    const installed = db.getAllInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].slug).toBe("my-tool");
    expect(installed[0].source).toBe("workspace");
    expect(installed[0].agentId).toBe("bot-abc");
  });

  it("returns workspace skills filtered by agentId", () => {
    db.recordInstall("tool-a", "workspace", undefined, "bot-1");
    db.recordInstall("tool-b", "workspace", undefined, "bot-2");
    db.recordInstall("shared-skill", "managed");

    const bot1Skills = db.getInstalledByAgent("bot-1");
    expect(bot1Skills).toHaveLength(1);
    expect(bot1Skills[0].slug).toBe("tool-a");

    const bot2Skills = db.getInstalledByAgent("bot-2");
    expect(bot2Skills).toHaveLength(1);
    expect(bot2Skills[0].slug).toBe("tool-b");
  });

  it("getAllInstalled includes workspace skills", () => {
    db.recordInstall("shared", "managed");
    db.recordInstall("ws-tool", "workspace", undefined, "bot-1");
    const all = db.getAllInstalled();
    expect(all).toHaveLength(2);
  });

  it("persists agentId across close/reopen", async () => {
    db.recordInstall("tool", "workspace", undefined, "bot-x");
    db.close();
    const db2 = await SkillDb.create(dbPath);
    const installed = db2.getAllInstalled();
    expect(installed[0].agentId).toBe("bot-x");
    db2.close();
  });

  it("ledger without agentId field loads with null default", async () => {
    // Simulate legacy ledger without agentId
    const legacyData = JSON.stringify({
      skills: [{
        slug: "old-skill",
        source: "managed",
        status: "installed",
        version: null,
        installedAt: "2026-01-01T00:00:00.000Z",
        uninstalledAt: null,
      }],
    });
    writeFileSync(dbPath, legacyData);
    const db2 = await SkillDb.create(dbPath);
    const installed = db2.getAllInstalled();
    expect(installed[0].agentId).toBeNull();
    db2.close();
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
cd apps/controller && npx vitest run tests/skill-db.test.ts
# OR
npx vitest run tests/desktop/skill-db.test.ts
```

Expected: FAIL — `recordInstall` doesn't accept 4th param, `getInstalledByAgent` doesn't exist, `agentId` field missing.

**Step 4: Update types.ts**

In `apps/controller/src/services/skillhub/types.ts`, add `"workspace"` to SkillSource:

```typescript
export type SkillSource = "managed" | "custom" | "workspace";
```

Add `agentId` to `InstalledSkill`:

```typescript
export type InstalledSkill = {
  slug: string;
  source: SkillSource;
  name: string;
  description: string;
  installedAt: string | null;
  agentId: string | null;
};
```

**Step 5: Update skill-db.ts schema and methods**

In `apps/controller/src/services/skillhub/skill-db.ts`:

1. Update the Zod schema (line 14-26) to include `agentId`:

```typescript
const skillRecordSchema = z.object({
  slug: z.string(),
  source: z
    .enum(["curated", "managed", "custom", "workspace"])
    .transform(
      (v) =>
        (v === "curated" ? "managed" : v) as "managed" | "custom" | "workspace",
    ),
  status: z.enum(["installed", "uninstalled"]),
  version: z.string().nullable().default(null),
  installedAt: z.string().nullable().default(null),
  uninstalledAt: z.string().nullable().default(null),
  agentId: z.string().nullable().default(null),
});
```

2. Update `recordInstall` to accept optional `agentId` (line 103):

```typescript
recordInstall(
  slug: string,
  source: SkillSource,
  version?: string,
  agentId?: string | null,
): void {
  const now = new Date().toISOString();
  const current = this.current();
  const existing = current.skills.find(
    (skill) => skill.slug === slug && skill.source === source &&
      (source !== "workspace" || skill.agentId === (agentId ?? null)),
  );
  const nextRecord: SkillRecord = {
    slug,
    source,
    status: "installed",
    version: version ?? existing?.version ?? null,
    installedAt: now,
    uninstalledAt: null,
    agentId: agentId ?? existing?.agentId ?? null,
  };

  this.db.data = {
    skills: this.upsertRecord(current.skills, nextRecord),
  };
  this.persist();
}
```

3. Update `upsertRecord` to match workspace skills by agentId too:

The existing `upsertRecord` matches by `slug + source`. For workspace skills, we also need to match on `agentId`. Update the match logic:

```typescript
private upsertRecord(
  records: SkillRecord[],
  next: SkillRecord,
): SkillRecord[] {
  const idx = records.findIndex(
    (r) =>
      r.slug === next.slug &&
      r.source === next.source &&
      (next.source !== "workspace" || r.agentId === next.agentId),
  );
  if (idx >= 0) {
    return [...records.slice(0, idx), next, ...records.slice(idx + 1)];
  }
  return [...records, next];
}
```

4. Add `getInstalledByAgent` method:

```typescript
getInstalledByAgent(agentId: string): readonly SkillRecord[] {
  return this.current().skills.filter(
    (skill) =>
      skill.status === "installed" &&
      skill.source === "workspace" &&
      skill.agentId === agentId,
  );
}
```

**Step 6: Run tests to verify they pass**

```bash
npx vitest run tests/desktop/skill-db.test.ts
```

Expected: All tests PASS.

**Step 7: Typecheck**

```bash
pnpm typecheck
```

Expected: May fail in other files referencing SkillSource — fix in subsequent tasks.

**Step 8: Commit**

```bash
git add apps/controller/src/services/skillhub/types.ts apps/controller/src/services/skillhub/skill-db.ts tests/desktop/skill-db.test.ts
git commit -m "feat(controller): extend skill ledger with workspace source and agentId"
```

---

## Task 2: Create WorkspaceSkillScanner

**Files:**
- Create: `apps/controller/src/services/skillhub/workspace-skill-scanner.ts`
- Test: `tests/desktop/workspace-skill-scanner.test.ts`

**Step 1: Write the failing tests**

Create `tests/desktop/workspace-skill-scanner.test.ts`:

```typescript
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceSkillScanner } from "#controller/services/skillhub/workspace-skill-scanner.js";

describe("WorkspaceSkillScanner", () => {
  let tmpDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "ws-scan-"));
    stateDir = tmpDir;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function createAgentSkill(botId: string, slug: string): void {
    const dir = path.join(stateDir, "agents", botId, "skills", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: ${slug}\ndescription: Test skill\n---\nInstructions here.`,
    );
  }

  it("returns empty map when no agents dir exists", () => {
    const scanner = new WorkspaceSkillScanner(stateDir);
    const result = scanner.scanAll(["bot-1"]);
    expect(result.size).toBe(0);
  });

  it("detects skills in agent workspace", () => {
    createAgentSkill("bot-1", "my-tool");
    createAgentSkill("bot-1", "web-scraper");

    const scanner = new WorkspaceSkillScanner(stateDir);
    const result = scanner.scanAll(["bot-1"]);

    expect(result.get("bot-1")).toEqual(
      expect.arrayContaining(["my-tool", "web-scraper"]),
    );
  });

  it("scans multiple agents independently", () => {
    createAgentSkill("bot-1", "tool-a");
    createAgentSkill("bot-2", "tool-b");

    const scanner = new WorkspaceSkillScanner(stateDir);
    const result = scanner.scanAll(["bot-1", "bot-2"]);

    expect(result.get("bot-1")).toEqual(["tool-a"]);
    expect(result.get("bot-2")).toEqual(["tool-b"]);
  });

  it("ignores directories without SKILL.md", () => {
    const dir = path.join(stateDir, "agents", "bot-1", "skills", "broken");
    mkdirSync(dir, { recursive: true });
    // No SKILL.md

    const scanner = new WorkspaceSkillScanner(stateDir);
    const result = scanner.scanAll(["bot-1"]);

    expect(result.size).toBe(0);
  });

  it("only scans provided bot IDs", () => {
    createAgentSkill("bot-1", "tool-a");
    createAgentSkill("bot-2", "tool-b");

    const scanner = new WorkspaceSkillScanner(stateDir);
    // Only scan bot-1
    const result = scanner.scanAll(["bot-1"]);

    expect(result.has("bot-1")).toBe(true);
    expect(result.has("bot-2")).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/desktop/workspace-skill-scanner.test.ts
```

Expected: FAIL — module doesn't exist.

**Step 3: Implement WorkspaceSkillScanner**

Create `apps/controller/src/services/skillhub/workspace-skill-scanner.ts`:

```typescript
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export class WorkspaceSkillScanner {
  constructor(private readonly openclawStateDir: string) {}

  /**
   * Scan workspace skill directories for the given bot IDs.
   * Returns a map of botId → slug[].
   * Only includes directories containing a SKILL.md file.
   */
  scanAll(botIds: readonly string[]): ReadonlyMap<string, readonly string[]> {
    const result = new Map<string, string[]>();

    for (const botId of botIds) {
      const workspaceSkillsDir = join(
        this.openclawStateDir,
        "agents",
        botId,
        "skills",
      );
      if (!existsSync(workspaceSkillsDir)) continue;

      const slugs = this.scanDir(workspaceSkillsDir);
      if (slugs.length > 0) {
        result.set(botId, slugs);
      }
    }

    return result;
  }

  private scanDir(dir: string): string[] {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            existsSync(join(dir, entry.name, "SKILL.md")),
        )
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/desktop/workspace-skill-scanner.test.ts
```

Expected: All 5 tests PASS.

**Step 5: Commit**

```bash
git add apps/controller/src/services/skillhub/workspace-skill-scanner.ts tests/desktop/workspace-skill-scanner.test.ts
git commit -m "feat(controller): add WorkspaceSkillScanner for per-agent skill detection"
```

---

## Task 3: SkillDirWatcher reconciles workspace skills on startup

**Files:**
- Modify: `apps/controller/src/services/skillhub/skill-dir-watcher.ts`
- Modify: `apps/controller/src/services/skillhub-service.ts`
- Test: `tests/desktop/skill-dir-watcher-workspace.test.ts` (new)

**Step 1: Write the failing test**

Create `tests/desktop/skill-dir-watcher-workspace.test.ts`:

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillDb } from "#controller/services/skillhub/skill-db.js";
import { SkillDirWatcher } from "#controller/services/skillhub/skill-dir-watcher.js";

describe("SkillDirWatcher workspace reconciliation", () => {
  let tmpDir: string;
  let skillsDir: string;
  let stateDir: string;
  let db: SkillDb;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "watcher-ws-"));
    skillsDir = path.join(tmpDir, "skills");
    stateDir = tmpDir;
    mkdirSync(skillsDir, { recursive: true });
    db = await SkillDb.create(path.join(tmpDir, "ledger.json"));
  });

  afterEach(async () => {
    db.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  function createWorkspaceSkill(botId: string, slug: string): void {
    const dir = path.join(stateDir, "agents", botId, "skills", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${slug}\n---\nTest.`);
  }

  it("records workspace skills with agentId on syncNow", () => {
    createWorkspaceSkill("bot-1", "agent-tool");

    const watcher = new SkillDirWatcher({
      skillsDir,
      skillDb: db,
      openclawStateDir: stateDir,
      botIds: ["bot-1"],
    });

    watcher.syncNow();

    const wsSkills = db.getInstalledByAgent("bot-1");
    expect(wsSkills).toHaveLength(1);
    expect(wsSkills[0].slug).toBe("agent-tool");
    expect(wsSkills[0].source).toBe("workspace");
    expect(wsSkills[0].agentId).toBe("bot-1");
  });

  it("marks workspace skill as uninstalled when removed from disk", () => {
    // Pre-record a workspace skill in the ledger
    db.recordInstall("removed-tool", "workspace", undefined, "bot-1");

    const watcher = new SkillDirWatcher({
      skillsDir,
      skillDb: db,
      openclawStateDir: stateDir,
      botIds: ["bot-1"],
    });

    watcher.syncNow();

    const wsSkills = db.getInstalledByAgent("bot-1");
    expect(wsSkills).toHaveLength(0);
  });

  it("does not duplicate existing workspace records", () => {
    createWorkspaceSkill("bot-1", "my-tool");
    db.recordInstall("my-tool", "workspace", undefined, "bot-1");

    const watcher = new SkillDirWatcher({
      skillsDir,
      skillDb: db,
      openclawStateDir: stateDir,
      botIds: ["bot-1"],
    });

    watcher.syncNow();

    const all = db.getAllInstalled().filter(
      (r) => r.source === "workspace",
    );
    expect(all).toHaveLength(1);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/desktop/skill-dir-watcher-workspace.test.ts
```

Expected: FAIL — `SkillDirWatcher` doesn't accept `openclawStateDir` or `botIds`.

**Step 3: Extend SkillDirWatcher**

In `apps/controller/src/services/skillhub/skill-dir-watcher.ts`:

1. Add optional constructor params:

```typescript
constructor(opts: {
  skillsDir: string;
  skillDb: SkillDb;
  log?: SkillDirWatcherLogFn;
  debounceMs?: number;
  isSlugInFlight?: (slug: string) => boolean;
  openclawStateDir?: string;  // NEW
  botIds?: readonly string[]; // NEW
}) {
  // ...existing assignments...
  this.openclawStateDir = opts.openclawStateDir ?? null;
  this.botIds = opts.botIds ?? [];
}
```

2. Add private fields:

```typescript
private readonly openclawStateDir: string | null;
private botIds: readonly string[];
```

3. Add `setBotIds` method for dynamic updates:

```typescript
setBotIds(botIds: readonly string[]): void {
  this.botIds = botIds;
}
```

4. Extend `syncNow()` to call workspace reconciliation after shared reconciliation:

```typescript
syncNow(): void {
  // ... existing shared dir reconciliation ...

  // Reconcile workspace skills
  this.syncWorkspaceDirs();
}

private syncWorkspaceDirs(): void {
  if (!this.openclawStateDir || this.botIds.length === 0) return;

  for (const botId of this.botIds) {
    const wsSkillsDir = resolve(
      this.openclawStateDir, "agents", botId, "skills",
    );
    if (!existsSync(wsSkillsDir)) continue;

    const diskSlugs = this.scanDirSlugs(wsSkillsDir);
    if (diskSlugs === null) continue;

    const diskSet = new Set(diskSlugs);
    const ledgerWs = this.db.getInstalledByAgent(botId);
    const ledgerSlugs = new Set(ledgerWs.map((r) => r.slug));

    // Disk has it, ledger doesn't → record as workspace
    const added = diskSlugs.filter((slug) => !ledgerSlugs.has(slug));
    for (const slug of added) {
      this.db.recordInstall(slug, "workspace", undefined, botId);
    }
    if (added.length > 0) {
      this.log(
        "info",
        `Agent ${botId}: synced ${added.length} workspace skill(s): ${added.join(", ")}`,
      );
    }

    // Ledger has it, disk doesn't → mark uninstalled
    const missing = ledgerWs.filter((r) => !diskSet.has(r.slug));
    for (const record of missing) {
      this.db.recordUninstall(record.slug, "workspace");
    }
    if (missing.length > 0) {
      this.log(
        "info",
        `Agent ${botId}: marked ${missing.length} workspace skill(s) as uninstalled`,
      );
    }
  }
}
```

5. Rename existing `scanDiskSlugs` to accept a dir parameter:

```typescript
private scanDirSlugs(dir?: string): string[] | null {
  const targetDir = dir ?? this.skillsDir;
  try {
    return readdirSync(targetDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(resolve(targetDir, entry.name, "SKILL.md")),
      )
      .map((entry) => entry.name);
  } catch {
    return null;
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/desktop/skill-dir-watcher-workspace.test.ts
```

Expected: All 3 tests PASS.

**Step 5: Also run existing watcher/db tests for regressions**

```bash
npx vitest run tests/desktop/skill-db.test.ts
```

Expected: All PASS.

**Step 6: Commit**

```bash
git add apps/controller/src/services/skillhub/skill-dir-watcher.ts tests/desktop/skill-dir-watcher-workspace.test.ts
git commit -m "feat(controller): workspace skill reconciliation in SkillDirWatcher"
```

---

## Task 4: Config compiler merges workspace skills per agent

**Files:**
- Modify: `apps/controller/src/lib/openclaw-config-compiler.ts`
- Modify: `apps/controller/tests/openclaw-config-compiler.test.ts`

**Step 1: Write the failing tests**

Add to `apps/controller/tests/openclaw-config-compiler.test.ts`:

```typescript
describe("per-agent workspace skill merge", () => {
  it("merges shared and workspace skills for each agent", () => {
    const now = new Date().toISOString();
    const config = createConfig({
      bots: [
        { id: "bot-1", name: "Bot A", slug: "bot-a", poolId: null, status: "active", modelId: "anthropic/claude-sonnet-4", systemPrompt: null, createdAt: now, updatedAt: now },
        { id: "bot-2", name: "Bot B", slug: "bot-b", poolId: null, status: "active", modelId: "anthropic/claude-sonnet-4", systemPrompt: null, createdAt: now, updatedAt: now },
      ],
    });
    const wsMap = new Map([
      ["bot-1", ["agent-tool"]],
    ]);
    const compiled = compileOpenClawConfig(config, createEnv(), undefined, ["shared-skill"], wsMap);

    // bot-a (sorted first) gets shared + its workspace
    const botA = compiled.agents.list.find((a) => a.id === "bot-1");
    expect(botA?.skills).toEqual(expect.arrayContaining(["shared-skill", "agent-tool"]));
    expect(botA?.skills).toHaveLength(2);

    // bot-b gets only shared (no workspace skills)
    const botB = compiled.agents.list.find((a) => a.id === "bot-2");
    expect(botB?.skills).toEqual(["shared-skill"]);
  });

  it("deduplicates when same slug in shared and workspace", () => {
    const config = createConfig();
    const wsMap = new Map([["bot-1", ["shared-skill"]]]);
    const compiled = compileOpenClawConfig(config, createEnv(), undefined, ["shared-skill"], wsMap);
    expect(compiled.agents.list[0].skills).toEqual(["shared-skill"]);
  });

  it("workspace-only skills still activate allowlist", () => {
    const config = createConfig();
    const wsMap = new Map([["bot-1", ["ws-only"]]]);
    // Empty shared slugs, but workspace has skills
    const compiled = compileOpenClawConfig(config, createEnv(), undefined, [], wsMap);
    expect(compiled.agents.list[0].skills).toEqual(["ws-only"]);
  });

  it("omits skills when both shared and workspace are empty", () => {
    const config = createConfig();
    const wsMap = new Map<string, string[]>();
    const compiled = compileOpenClawConfig(config, createEnv(), undefined, [], wsMap);
    expect(compiled.agents.list[0]).not.toHaveProperty("skills");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd apps/controller && npx vitest run tests/openclaw-config-compiler.test.ts
```

Expected: FAIL — `compileOpenClawConfig` doesn't accept 5th parameter.

**Step 3: Update compiler**

In `apps/controller/src/lib/openclaw-config-compiler.ts`:

1. Add `workspaceSkillsByAgent` parameter to `compileOpenClawConfig`:

```typescript
export function compileOpenClawConfig(
  config: NexuConfig,
  env: ControllerEnv,
  oauthState: OAuthConnectionState = EMPTY_OAUTH_CONNECTION_STATE,
  installedSkillSlugs?: readonly string[],
  workspaceSkillsByAgent?: ReadonlyMap<string, readonly string[]>,
): OpenClawConfig {
```

2. Pass it through to `compileAgentList`:

```typescript
list: compileAgentList(config, env, oauthState, installedSkillSlugs, workspaceSkillsByAgent),
```

3. Update `compileAgentList`:

```typescript
function compileAgentList(
  config: NexuConfig,
  env: ControllerEnv,
  oauthState: OAuthConnectionState,
  installedSkillSlugs?: readonly string[],
  workspaceSkillsByAgent?: ReadonlyMap<string, readonly string[]>,
): OpenClawConfig["agents"]["list"] {
  const sharedSlugs = installedSkillSlugs ?? [];

  return config.bots
    .filter((bot) => bot.status === "active")
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .map((bot, index) => {
      const workspaceSlugs = workspaceSkillsByAgent?.get(bot.id) ?? [];
      const merged = [...new Set([...sharedSlugs, ...workspaceSlugs])];

      return {
        id: bot.id,
        name: bot.name,
        workspace: `${env.openclawStateDir}/agents/${bot.id}`,
        default: index === 0,
        model: bot.modelId
          ? { primary: resolveModelId(config, env, bot.modelId, oauthState) }
          : undefined,
        ...(merged.length > 0 ? { skills: merged } : {}),
      };
    });
}
```

**Step 4: Run tests to verify they pass**

```bash
cd apps/controller && npx vitest run tests/openclaw-config-compiler.test.ts
```

Expected: All tests PASS (existing + new).

**Step 5: Also run desktop compiler tests**

```bash
npx vitest run tests/desktop/openclaw-config-compiler.test.ts
```

Expected: All PASS (no regressions).

**Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: May need to update `doSync()` in sync service — addressed in Task 5.

**Step 7: Commit**

```bash
git add apps/controller/src/lib/openclaw-config-compiler.ts apps/controller/tests/openclaw-config-compiler.test.ts
git commit -m "feat(controller): compiler merges workspace skills per agent"
```

---

## Task 5: Sync service passes workspace skills to compiler

**Files:**
- Modify: `apps/controller/src/services/openclaw-sync-service.ts`
- Modify: `apps/controller/src/services/skillhub-service.ts`
- Modify: `apps/controller/src/app/container.ts`

**Step 1: Read current sync service doSync method**

Read `apps/controller/src/services/openclaw-sync-service.ts` around the `doSync()` method.

**Step 2: Add WorkspaceSkillScanner to sync service**

In `apps/controller/src/services/openclaw-sync-service.ts`:

1. Add import:

```typescript
import type { WorkspaceSkillScanner } from "./skillhub/workspace-skill-scanner.js";
```

2. Add optional constructor parameter:

```typescript
constructor(
  // ... existing params ...,
  private readonly skillDb: SkillDb | null = null,
  private readonly workspaceScanner: WorkspaceSkillScanner | null = null,
) {}
```

3. In `doSync()`, scan workspace skills and pass to compiler:

```typescript
const installedSlugs = this.skillDb
  ? this.skillDb.getAllInstalled()
      .filter((r) => r.source !== "workspace")
      .map((r) => r.slug)
  : undefined;

const workspaceMap = this.workspaceScanner
  ? this.workspaceScanner.scanAll(
      config.bots.filter((b) => b.status === "active").map((b) => b.id),
    )
  : undefined;

const compiled = compileOpenClawConfig(
  config,
  this.env,
  oauthState,
  installedSlugs,
  workspaceMap,
);
```

Note: `installedSlugs` now filters OUT workspace records (those are handled via `workspaceMap`). This avoids double-counting.

**Step 3: Expose WorkspaceSkillScanner from SkillhubService**

In `apps/controller/src/services/skillhub-service.ts`:

1. Import and create scanner:

```typescript
import { WorkspaceSkillScanner } from "./skillhub/workspace-skill-scanner.js";
```

2. Add as private field and create in factory:

```typescript
private readonly workspaceScanner: WorkspaceSkillScanner;

// In create():
const workspaceScanner = new WorkspaceSkillScanner(env.openclawStateDir);
```

3. Add getter:

```typescript
get workspaceSkillScanner(): WorkspaceSkillScanner {
  return this.workspaceScanner;
}
```

**Step 4: Wire in container.ts**

In `apps/controller/src/app/container.ts`, pass the scanner to the sync service:

```typescript
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
  skillhubService.skillDb,
  skillhubService.workspaceSkillScanner,  // NEW
);
```

**Step 5: Pass botIds to SkillDirWatcher on startup**

In `apps/controller/src/services/skillhub-service.ts`, the `start()` method needs to pass bot IDs to the dir watcher. But the service doesn't have access to the config store.

Solution: Accept a `botIds` callback in `SkillhubServiceOptions` and pass to watcher:

```typescript
export interface SkillhubServiceOptions {
  onSyncNeeded?: () => void;
  getBotIds?: () => readonly string[];
}
```

In `start()`:

```typescript
start(): void {
  this.catalogManager.start();
  if (process.env.CI) return;

  // Update bot IDs for workspace reconciliation
  if (this.getBotIds) {
    this.dirWatcher.setBotIds(this.getBotIds());
  }

  this.dirWatcher.syncNow();
  this.initialize();
  this.dirWatcher.start();
}
```

In `container.ts`, wire the callback:

```typescript
const skillhubService = await SkillhubService.create(env, {
  onSyncNeeded: () => {
    void syncService?.syncAll().catch(() => {});
  },
  getBotIds: () => configStore.getConfigSync().bots.map((b) => b.id),
});
```

Note: Check if `configStore` has a synchronous getter. If not, we may need to use a cached value or async startup sequence. The SkillhubService `start()` is called during bootstrap after the config store is initialized, so this should be safe.

**Step 6: Typecheck**

```bash
pnpm typecheck
```

**Step 7: Run all controller tests**

```bash
cd apps/controller && npx vitest run
```

**Step 8: Commit**

```bash
git add apps/controller/src/services/openclaw-sync-service.ts apps/controller/src/services/skillhub-service.ts apps/controller/src/app/container.ts
git commit -m "feat(controller): sync service passes workspace skills to compiler"
```

---

## Task 6: API exposes workspace skills with agentId

**Files:**
- Modify: `apps/controller/src/routes/skillhub-routes.ts`
- Modify: `apps/controller/src/services/skillhub/catalog-manager.ts`

**Step 1: Read CatalogManager.getCatalog()**

Read `apps/controller/src/services/skillhub/catalog-manager.ts` around the `getCatalog()` method.

**Step 2: Update installedSkillSchema in routes**

In `apps/controller/src/routes/skillhub-routes.ts`, add `agentId` and `agentName` to the response schema:

```typescript
const installedSkillSchema = z.object({
  slug: z.string(),
  source: z.enum(["managed", "custom", "workspace"]),
  name: z.string(),
  description: z.string(),
  installedAt: z.string().nullable(),
  agentId: z.string().nullable(),
  agentName: z.string().nullable(),
});
```

**Step 3: Update CatalogManager to include workspace skills**

In `apps/controller/src/services/skillhub/catalog-manager.ts`, modify `getCatalog()` to include workspace skills from the DB:

The `getCatalog()` currently reads `this.db.getAllInstalled()`. After Task 1, workspace records with `agentId` will already be in the ledger (reconciled by `syncNow()`). So `getAllInstalled()` already includes them.

The enrichment step that reads SKILL.md from disk needs to also check workspace directories. Add a helper that resolves the skill directory path based on source and agentId:

```typescript
private resolveSkillDir(record: SkillRecord): string {
  if (record.source === "workspace" && record.agentId) {
    return path.join(
      this.skillsDir, "..", "agents", record.agentId, "skills", record.slug,
    );
  }
  return path.join(this.skillsDir, record.slug);
}
```

Note: `this.skillsDir` is the shared `extraDirs` path. Workspace skills are at `../agents/${agentId}/skills/${slug}` relative to it. Alternatively, pass `openclawStateDir` to CatalogManager. Check the constructor to decide.

**Step 4: Update catalog route handler to resolve agent names**

In the GET `/api/v1/skillhub/catalog` handler, resolve agent names from the config store:

```typescript
async (c) => {
  const catalog = container.skillhubService.catalog.getCatalog();
  const queue = [...container.skillhubService.queue.getQueue()];
  const bots = await container.configStore.listBots();
  const botNameMap = new Map(bots.map((b) => [b.id, b.name]));

  const installedSkills = catalog.installedSkills.map((skill) => ({
    ...skill,
    agentName: skill.agentId ? (botNameMap.get(skill.agentId) ?? null) : null,
  }));

  return c.json({ ...catalog, installedSkills, queue }, 200);
},
```

**Step 5: Regenerate types**

```bash
pnpm generate-types
```

**Step 6: Typecheck**

```bash
pnpm typecheck
```

**Step 7: Commit**

```bash
git add apps/controller/src/routes/skillhub-routes.ts apps/controller/src/services/skillhub/catalog-manager.ts apps/controller/openapi.json apps/web/lib/
git commit -m "feat(controller): API exposes workspace skills with agentId"
```

---

## Task 7: Frontend shows workspace skills grouped by agent

**Files:**
- Modify: `apps/web/src/pages/skills.tsx`

**Step 1: Read current skills page**

Read `apps/web/src/pages/skills.tsx` to understand the tab structure and data flow.

**Step 2: Add "Agent Skills" sub-tab**

In the "Yours" tab section, add a fourth sub-tab for workspace skills:

1. Add `"agent"` to the `yoursSubTab` state options
2. Filter workspace skills: `source === "workspace"`
3. Group by `agentId` and display with agent name headers
4. Each skill card shows a badge "Installed by [Agent Name]"

The exact implementation depends on the current tab component structure — follow the existing patterns in `skills.tsx` for adding sub-tabs.

**Step 3: Test in browser**

1. Start dev server: `pnpm dev`
2. Create a workspace skill on disk for testing:
   ```bash
   mkdir -p .tmp/desktop/openclaw-state/agents/<botId>/skills/test-skill
   echo '---\nname: test-skill\ndescription: Test\n---\nTest.' > \
     .tmp/desktop/openclaw-state/agents/<botId>/skills/test-skill/SKILL.md
   ```
3. Restart controller to trigger reconciliation
4. Open Skills page → Yours → Agent Skills tab
5. Verify the test skill appears under the correct agent name

**Step 4: Commit**

```bash
git add apps/web/src/pages/skills.tsx
git commit -m "feat(web): show workspace skills grouped by agent in Skills page"
```

---

## Task 8: Final verification

**Step 1: Run full test suite**

```bash
pnpm test
cd apps/controller && npx vitest run
```

**Step 2: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

**Step 3: Verify upgrade scenario**

1. Create a skill in agent workspace dir (simulating pre-upgrade state)
2. Start the app
3. Check logs for workspace reconciliation
4. Check ledger has workspace records
5. Check config has merged allowlist
6. Install a skill via SkillHub UI
7. Verify workspace skills are NOT filtered out

**Step 4: Commit any fixes**

```bash
pnpm format
git add -A
git commit -m "chore: format and fix"
```

---

## Test Plan

### Unit Tests

| Test | File | Validates |
|------|------|-----------|
| SkillDb workspace install with agentId | `tests/desktop/skill-db.test.ts` | Records persist with agentId field |
| SkillDb getInstalledByAgent | same | Filters by agentId correctly |
| SkillDb legacy ledger compat | same | Old ledger loads with agentId=null |
| WorkspaceSkillScanner detects skills | `tests/desktop/workspace-skill-scanner.test.ts` | Scans `agents/*/skills/` dirs |
| WorkspaceSkillScanner ignores broken dirs | same | Only dirs with SKILL.md |
| WorkspaceSkillScanner multi-agent | same | Independent per-agent results |
| DirWatcher workspace reconciliation | `tests/desktop/skill-dir-watcher-workspace.test.ts` | Disk→ledger sync for workspace skills |
| DirWatcher workspace uninstall | same | Missing disk→mark uninstalled |
| Compiler per-agent merge | `apps/controller/tests/openclaw-config-compiler.test.ts` | Shared + workspace merged, deduped |
| Compiler workspace-only | same | Workspace skills activate allowlist |
| Compiler both empty | same | No skills field when all empty |

### Integration Tests

| Test | Validates |
|------|-----------|
| Existing `skill-install-config-sync.test.ts` | Shared skill flow still works |
| Existing `openclaw-sync.test.ts` | Sync service still compiles correctly |

### Manual Smoke Tests

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Fresh install, no skills | skills field omitted, all bundled work |
| 2 | Upgrade with workspace skills, empty ledger | syncNow records workspace skills, allowlist includes them |
| 3 | SkillHub install after upgrade | Shared skill added, workspace skills preserved |
| 4 | Agent installs via clawhub, then restart | Reconciliation detects new workspace skill |
| 5 | UI shows workspace skills | Agent Skills tab groups by agent name |
| 6 | Uninstall workspace skill from UI | Removed from workspace dir + ledger |
