# Workspace Skill Visibility & Upgrade Compatibility

## Problem Statement

### Problem 1: Agent-installed skills invisible to UI

When a user asks an agent to install a skill (via `clawhub install` in conversation), the skill is written to the agent's workspace directory:
```
${openclawStateDir}/agents/${botId}/skills/<slug>/SKILL.md
```

This skill is:
- Only visible to that specific agent (workspace scope)
- Not tracked in the Nexu skill ledger
- Not shown in the SkillHub UI
- Not included in the `agents.list[].skills` allowlist

### Problem 2: Upgrade compatibility

When a user upgrades from an older version of Nexu:

| Scenario | Ledger state | Skills on disk | Risk |
|---|---|---|---|
| Pre-SkillHub era | No ledger file | Skills in `extraDirs/` | `syncNow()` reconciles on startup — already handled |
| Pre-allowlist (our current PR) | Ledger has records | Skills in `extraDirs/` | First `syncAll()` writes allowlist correctly — handled |
| Agent-installed skills exist | Not in ledger | Skills in workspace dirs | **NOT handled** — invisible to allowlist |
| Mixed: SkillHub + agent installs | Partial ledger | Skills in both dirs | **Regression** — agent installs filtered out by allowlist |

The critical upgrade scenario:
1. User has old Nexu with skills installed by agent in workspace
2. User upgrades to new Nexu with allowlist feature
3. User installs one skill via SkillHub UI
4. Ledger becomes non-empty → allowlist activates
5. All workspace skills NOT in ledger are **silently filtered out**

## Manual Verification Addendum

Use [2026-03-27-skill-config-sync-manual-test.md](./2026-03-27-skill-config-sync-manual-test.md) as the executable checklist. For this bugfix specifically, the minimum acceptance set is:

1. Live workspace add without restart
   - Create a workspace skill on disk while the app is running.
   - Expected: ledger, config, and Skills UI update within a few seconds.
2. Live workspace remove without restart
   - Delete the workspace skill directory while the app is running.
   - Expected: only that agent loses the skill; no restart required.
3. Agent-scoped uninstall from grouped card
   - Install the same workspace slug for two agents, uninstall from one agent card.
   - Expected: only that agent's workspace record is removed.
4. Agent-scoped uninstall from detail page
   - Open detail from a specific agent card and uninstall.
   - Expected: detail view preserves `agentId`; only the selected install is removed.
5. Ambiguous slug safety
   - Open a slug-only detail view for a workspace skill installed under multiple agents.
   - Expected: UI does not send an uninstall without agent context.

### Pass/Fail Criteria For The Reviewed Bugs

| Reviewed bug | Required evidence |
|---|---|
| Uninstall flow needs agent context | Request payload or observable result proves only one `agentId` is affected |
| Reconcile removals must not affect all agents | After remove/uninstall of Agent A's copy, Agent B still has the same slug in UI, ledger, and config |
| Workspace reconciliation must keep running after startup | Add/remove on disk propagates while the controller remains running |

---

## Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Skill Sources                                │
├───────────────┬───────────────────┬─────────────────────────────┤
│  SkillHub UI  │  Agent (clawhub)  │  Bundled / Static           │
│  shared       │  per-agent        │  shared                     │
├───────────────┼───────────────────┼─────────────────────────────┤
│  extraDirs/   │  workspace/       │  extraDirs/                 │
│  skills/      │  agents/X/skills/ │  skills/                    │
└───────┬───────┴─────────┬─────────┴──────────────┬──────────────┘
        │                 │                        │
        ▼                 ▼                        ▼
   ┌──────────┐    ┌──────────────┐         ┌──────────┐
   │ SkillDb  │    │ Workspace    │         │ SkillDb  │
   │ ledger   │    │ scanner      │         │ ledger   │
   │ (shared) │    │ (per-agent)  │         │ (shared) │
   └────┬─────┘    └──────┬───────┘         └────┬─────┘
        │                 │                      │
        └────────┬────────┘──────────────────────┘
                 │
                 ▼
        ┌────────────────┐
        │ Config compiler │
        │ merges all      │
        │ skill sources   │
        └───────┬────────┘
                │
                ▼
        agents.list[].skills: [shared..., workspace...]
```

### Component Changes

#### 1. SkillDb Schema — Add `agentId` field

```typescript
interface SkillRecord {
  slug: string;
  source: "managed" | "custom" | "workspace";  // NEW: "workspace" source
  status: "installed" | "uninstalled";
  version: string | null;
  installedAt: string | null;
  uninstalledAt: string | null;
  agentId: string | null;  // NEW: null = shared, string = per-agent
}
```

- `agentId: null` → shared skill (SkillHub install, import, static)
- `agentId: "bot-123"` → workspace skill (agent-installed via clawhub)
- `source: "workspace"` distinguishes from "managed" and "custom"

#### 2. Workspace Scanner — New component

New class: `WorkspaceSkillScanner` in `apps/controller/src/services/skillhub/`

```typescript
class WorkspaceSkillScanner {
  constructor(
    private readonly openclawStateDir: string,
    private readonly configStore: NexuConfigStore,
  ) {}

  /**
   * Scan all agent workspace skill directories.
   * Returns a map of agentId → slug[].
   */
  scanAll(): Map<string, string[]> {
    const bots = this.configStore.getBotsSync();
    const result = new Map<string, string[]>();

    for (const bot of bots) {
      const workspaceSkillsDir = path.join(
        this.openclawStateDir, "agents", bot.id, "skills"
      );
      if (!existsSync(workspaceSkillsDir)) continue;

      const slugs = readdirSync(workspaceSkillsDir, { withFileTypes: true })
        .filter(e => e.isDirectory() &&
          existsSync(path.join(workspaceSkillsDir, e.name, "SKILL.md")))
        .map(e => e.name);

      if (slugs.length > 0) {
        result.set(bot.id, slugs);
      }
    }
    return result;
  }
}
```

#### 3. SkillDirWatcher — Watch workspace dirs too

Extend to watch `${openclawStateDir}/agents/*/skills/` in addition to the shared dir:

```typescript
// On startup, also scan workspace dirs
syncNow(): void {
  this.syncSharedDir();           // existing logic
  this.syncWorkspaceDirs();       // NEW
}

private syncWorkspaceDirs(): void {
  const agentsDir = path.join(this.openclawStateDir, "agents");
  if (!existsSync(agentsDir)) return;

  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const agentId = entry.name;
    const wsSkillsDir = path.join(agentsDir, agentId, "skills");
    if (!existsSync(wsSkillsDir)) continue;

    const slugs = this.scanDirSlugs(wsSkillsDir);
    // Record in ledger with agentId
    for (const slug of slugs) {
      if (!this.db.isInstalledForAgent(slug, agentId)) {
        this.db.recordInstall(slug, "workspace", null, agentId);
      }
    }
  }
}
```

#### 4. Config Compiler — Per-agent allowlist with workspace merge

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

#### 5. API Schema — Add agent association

```typescript
// Updated InstalledSkill type
const installedSkillSchema = z.object({
  slug: z.string(),
  source: z.enum(["managed", "custom", "workspace"]),
  name: z.string(),
  description: z.string(),
  installedAt: z.string().nullable(),
  agentId: z.string().nullable(),     // NEW
  agentName: z.string().nullable(),   // NEW (resolved from configStore)
});
```

#### 6. Frontend — Agent Skills section

```
Skills Page
├── "Yours" tab
│   ├── All              → everything
│   ├── Recommended      → source: "managed"
│   ├── Custom           → source: "custom" (shared imports)
│   └── Agent Skills     → source: "workspace" (NEW)
│       ├── [Agent Name]
│       │   ├── skill-a
│       │   └── skill-b
│       └── [Agent Name]
│           └── skill-c
└── "Explore" tab        → community catalog
```

The Agent Skills sub-tab groups workspace skills by agent name. Each skill card shows:
- Skill name + description (from SKILL.md)
- Badge: "Installed by [Agent Name]"
- Agent avatar/icon
- Uninstall action (removes from workspace dir)

---

## Upgrade Compatibility Strategy

### Startup Reconciliation Flow

On every startup, `SkillhubService.start()` runs this sequence:

```
1. syncNow() — reconcile shared dir (existing)
   ├── Disk has it, ledger doesn't → record as "managed"
   └── Ledger has it, disk doesn't → mark uninstalled

2. syncWorkspaceDirs() — reconcile workspace dirs (NEW)
   ├── Workspace has it, ledger doesn't → record as "workspace" with agentId
   └── Ledger has workspace skill, workspace doesn't → mark uninstalled

3. initialize() — copy static + enqueue curated (existing)

4. dirWatcher.start() — watch both dirs (existing + NEW)
```

### Upgrade Scenarios

#### Scenario A: Fresh install (no history)

```
State: No ledger, no skills on disk
Action: Startup creates empty ledger
Result: agents.list[].skills omitted → all bundled skills work
Status: ✅ No change needed
```

#### Scenario B: Upgrade from pre-SkillHub (skills on disk, no ledger)

```
State: No ledger, skills in extraDirs/ from manual placement
Action: syncNow() scans disk → records all as "managed" in ledger
Result: agents.list[].skills = [all disk skills] → same behavior as before
Status: ✅ Handled by existing syncNow()
```

#### Scenario C: Upgrade from pre-allowlist (ledger exists, no workspace skills)

```
State: Ledger has managed/custom records, no workspace skills
Action: Normal startup, ledger already authoritative
Result: agents.list[].skills = [ledger skills] → correct
Status: ✅ Handled by our current PR
```

#### Scenario D: Upgrade with agent-installed workspace skills

```
State: Ledger has some records, workspace dirs have agent-installed skills NOT in ledger
Action: syncWorkspaceDirs() scans workspace → records with source="workspace", agentId=bot.id
Result: agents.list[].skills = [ledger + workspace] → all skills visible
Status: ✅ Handled by new workspace scanner
```

#### Scenario E: Mixed install sources after upgrade

```
State: User installs via SkillHub + agent installs via clawhub
Action: Ledger tracks both (shared via "managed", workspace via "workspace")
         Compiler merges per agent: shared slugs + that agent's workspace slugs
Result: Each agent sees: all shared skills + its own workspace skills
Status: ✅ Handled by per-agent merge in compiler
```

### Reconciliation Safety Rules

1. **Never auto-delete skills** — only mark as "uninstalled" in ledger when disk is missing
2. **Never downgrade source** — if a skill exists as both "managed" (shared) and "workspace" (per-agent), keep both records. Shared takes precedence for the agent that has both.
3. **Idempotent** — running reconciliation multiple times produces the same result
4. **Startup-only for workspace scan** — workspace scan runs on boot, not on every syncAll() (too expensive for hot path). Periodic sync loop can optionally re-scan at longer intervals.
5. **Log all reconciliation changes** — so upgrade issues can be diagnosed from logs

### Migration Log Output (example)

```
[skillhub] Startup reconciliation:
[skillhub]   Shared skills: 12 installed, 2 uninstalled
[skillhub]   Workspace scan:
[skillhub]     agent bot-abc: 3 skills (my-tool, web-scraper, calendar)
[skillhub]     agent bot-xyz: 1 skill (ticket-helper)
[skillhub]   New workspace records: 4 (first-time detection)
[skillhub]   Reconciliation complete
```

---

## Implementation Phases

### Phase 1: Workspace scanner + allowlist merge (Priority: High)

Ensure agent-installed skills are included in the config allowlist so they aren't filtered out after upgrade.

**Files:**
- New: `apps/controller/src/services/skillhub/workspace-skill-scanner.ts`
- Modify: `apps/controller/src/services/skillhub/skill-dir-watcher.ts` (add workspace sync)
- Modify: `apps/controller/src/services/skillhub/skill-db.ts` (add agentId field)
- Modify: `apps/controller/src/lib/openclaw-config-compiler.ts` (per-agent merge)
- Modify: `apps/controller/src/services/openclaw-sync-service.ts` (pass workspace map)
- Modify: `apps/controller/src/services/skillhub-service.ts` (wire scanner)

### Phase 2: API + frontend visibility (Priority: Medium)

Show workspace skills in the UI grouped by agent.

**Files:**
- Modify: `apps/controller/src/routes/skillhub-routes.ts` (include workspace skills in response)
- Modify: `packages/shared/src/schemas/` (InstalledSkill schema update)
- Modify: `apps/web/src/pages/skills.tsx` (Agent Skills sub-tab)
- New: `apps/web/src/components/agent-skills-section.tsx`

### Phase 3: Workspace skill management actions (Priority: Low)

Allow users to uninstall/move workspace skills from the UI.

**Actions:**
- Uninstall workspace skill (remove from agent workspace dir)
- Promote to shared (move from workspace to extraDirs, re-record in ledger)
- Move to different agent

---

## Open Questions

1. **Should workspace scan run on every syncAll() or only on startup?**
   Recommendation: Startup + periodic (every 60s via sync loop), NOT on every syncAll() hot path.

2. **Should we watch workspace dirs with fs.watch too?**
   Recommendation: Yes, but with a separate watcher instance per active agent. Watch `${openclawStateDir}/agents/*/skills/` glob pattern if possible, otherwise iterate on startup.

3. **What happens when an agent is deleted but workspace skills exist?**
   Recommendation: Mark workspace skills as "orphaned" in ledger. Show in UI with warning. Don't auto-delete.

4. **Should SkillHub uninstall also remove from workspace if the same slug exists there?**
   Recommendation: No. Shared and workspace are independent. Uninstalling a shared skill doesn't affect workspace copies. UI should make this clear.
