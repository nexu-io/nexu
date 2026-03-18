# SkillHub Desktop Integration — Design

**Date:** 2026-03-17
**Status:** Design approved

## Overview

Integrate Tencent SkillHub (a ClawHub mirror with 12,891 AI skills) into Nexu Desktop as a client-side skill catalog. Users discover, install, and use community skills without leaving the desktop app.

## Skill Lifecycle

```
Discovery ──────► Install ──────► Use

Browse Community   clawhub install   Skill appears in
tab with search,   <slug> via IPC    Nexu Desktop runtime
sort, tag filter   → atomic extract  skills dir
                   to runtime/       → OpenClaw watcher
                   openclaw/state/   detects SKILL.md
                   skills/<slug>/    → session rebuilds
```

## Architecture

### Client-side only — no Nexu API backend

All logic lives in the Electron desktop app. The Nexu API is not involved.

### Desktop skills directory

SkillHub installs must target Nexu Desktop's managed OpenClaw runtime, not
`~/.openclaw/skills` and not project-local `.openclaw/skills`.

Canonical desktop path:

```text
~/Library/Application Support/@nexu/desktop/runtime/openclaw/state/skills
```

In code, always derive this from the desktop runtime manifest's
`openclawStateDir` and append `/skills` rather than hardcoding the absolute
path. This keeps install, uninstall, installed detection, and OpenClaw file
watching aligned.

### Data source

- **Catalog:** SkillHub's bundled `skills_index.local.json` (12,891 skills, 3.5MB)
- **Download:** `latest.tar.gz` from Tencent COS
- **Install:** `clawhub install <slug>` CLI
- **COS URL:** `https://skillhub-1251783334.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz`
- **Version check:** `https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/version.json`

### Skill entry shape (from index)

```typescript
interface CommunitySkill {
  slug: string;
  name: string;
  description: string;
  source: "clawhub";
  zip_url: string;
  homepage: string;
  version: string;
  tags: string[];       // free-form, 4,284 unique (most common: security, automation, ai, productivity, mcp)
  updated_at: number;   // epoch ms
  stats: {
    downloads: number;
    stars: number;
    installs_current: number;
    installs_all_time: number;
    versions: number;
  };
}
```

### Minimal catalog format (stored on disk)

Strip to rendering-essential fields to reduce memory/disk:

```typescript
interface MinimalSkill {
  slug: string;
  name: string;
  desc: string;         // truncated to 150 chars
  dl: number;           // stats.downloads
  stars: number;
  tags: string[];       // excludes "latest" tag
  v: string;            // version
  updatedAt: number;
}
```

- Raw: 3.5MB
- Gzipped: 1.0MB

## UI Design

### Tabs

Two tabs only:

| Tab | Source |
|-----|--------|
| **Installed** | Filesystem scan of Nexu Desktop runtime `.../openclaw/state/skills/` |
| **Community** | SkillHub catalog (12,891 skills) |

### Categories / Tags

Use top ~15 tags as filter chips (from SkillHub's free-form tags):

```
[All] [security 151] [automation 149] [ai 100] [productivity 89]
[mcp 85] [finance 81] [api 76] [memory 75] [crypto 74]
[trading 57] [agents 52] [audit 52] [marketing 48] [chinese 37]
```

### Sort options

- **Downloads** (default, desc)
- **Stars** (desc)
- **Newest** (by `updated_at`, desc)

### Community card

```
┌─────────────────────────────┐
│  skill-name                 │
│  Description text up to     │
│  150 characters shown...    │
│  ⬇ 4,802   ★ 18            │
│  [Install]  or  [Installed ✓]│
└─────────────────────────────┘
```

### Rendering strategy — Intersection Observer lazy load

Start with 50 cards, load 50 more as user scrolls to bottom. No new dependency.

```tsx
const [visibleCount, setVisibleCount] = useState(50);
const sentinelRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  const observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) {
      setVisibleCount(prev => Math.min(prev + 50, skills.length));
    }
  });
  if (sentinelRef.current) observer.observe(sentinelRef.current);
  return () => observer.disconnect();
}, [skills.length]);
```

Search/filter/sort resets `visibleCount` to 50, keeping DOM bounded.

### Performance

| Operation | Time (12,891 items) |
|-----------|-------------------|
| `sort()` by downloads | ~3ms |
| `filter()` by tag | ~1ms |
| `filter()` by search text | ~2ms |
| DOM render (50 cards) | ~5ms |
| Total user-perceived | **<15ms** |

Debounce search input at 150ms. No debounce for sort/tag (instant).

## Background Catalog Update

### Worker thread — atomic, non-blocking

```
Electron Main Process (startup / every 24h)
│
├── Spawn worker (node:worker_threads)
│   ├── 1. Read ~/.nexu/skillhub-meta.json → { version }
│   ├── 2. HEAD version.json from COS → compare
│   │      Same version? Exit early (no work).
│   ├── 3. Download latest.tar.gz → temp dir (streaming, ~2MB)
│   ├── 4. Extract skills_index.local.json from tar
│   ├── 5. Transform to minimal format
│   ├── 6. Write to ~/.nexu/.skillhub-catalog-next.json
│   ├── 7. Atomic swap:
│   │      rename(.skillhub-catalog-next.json → skillhub-catalog.json)
│   │      update skillhub-meta.json with new version
│   ├── 8. Cleanup temp dir
│   └── 9. postMessage({ type: "updated", skillCount: N })
│
└── Main thread → IPC → renderer invalidates cache
```

**Atomic guarantee:** `fs.renameSync` is a single POSIX syscall. Readers see old or new, never partial.

**Lightweight:** Worker thread shares memory with main process (~2MB overhead). No fork.

### Cache layout

```
~/.nexu/
├── skillhub-meta.json           # { version, updatedAt, skillCount }
├── skillhub-catalog.json        # minimal catalog (3.5MB)
└── .skillhub-catalog-next.json  # temp during atomic swap (deleted after)
```

## Install / Uninstall via CLI

### IPC channels (new)

```typescript
// shared/host.ts — add to HostInvokePayloadMap
"skillhub:get-catalog":    undefined
"skillhub:install":        { slug: string }
"skillhub:uninstall":      { slug: string }
"skillhub:refresh-catalog": undefined

// Results
"skillhub:get-catalog":    { skills: MinimalSkill[], meta: CatalogMeta }
"skillhub:install":        { ok: boolean, error?: string }
"skillhub:uninstall":      { ok: boolean, error?: string }
"skillhub:refresh-catalog": { ok: boolean, skillCount: number }
```

### Skills directory

Desktop runtime skills live under the Electron user-data path:

```
~/Library/Application Support/@nexu/desktop/runtime/openclaw/state/skills
```

This is set by `manifests.ts`:
- Creates `openclawStateDir = <userDataPath>/runtime/openclaw/state`
- Ensures `skills/` exists there
- Passes as `OPENCLAW_SKILLS_DIR` to the gateway

**Caveat:** The API's standalone fallback scanner defaults to `~/.openclaw/skills` if `OPENCLAW_SKILLS_DIR` is not set (`skill-scanner.ts:317`). The desktop always sets it.

### Install flow

```typescript
// main process handler
case "skillhub:install": {
  const { slug } = payload;
  const skillsDir = join(app.getPath("userData"), "runtime/openclaw/state/skills");
  const result = execSync(
    `npx clawhub install "${slug}" --force --dir "${skillsDir}"`,
    { timeout: 30_000 }
  );
  return { ok: true };
}
```

### Installed detection

Compare slugs in Nexu Desktop runtime `openclaw/state/skills/` dirs against
catalog slugs:

```typescript
const installedSlugs = new Set(
  readdirSync(skillsDir)
    .filter(name => existsSync(join(skillsDir, name, "SKILL.md")))
);
// In renderer: skill.installed = installedSlugs.has(skill.slug)
```

`skillsDir` here must come from the desktop runtime manifest / shared desktop
runtime path helper, not from a generic `.openclaw/skills` fallback.

## Verification plan

### Runtime path correctness

1. Start Nexu Desktop.
2. Inspect the live runtime directory under:
   `~/Library/Application Support/@nexu/desktop/runtime/openclaw/state/skills`
3. Trigger one install from the Community tab.
4. Confirm the installed skill directory appears under that managed path.
5. Confirm no skill files were written to:
   - `~/.openclaw/skills`
   - `<repo>/.openclaw/skills`

### OpenClaw pickup

1. After install, verify the live OpenClaw config still points at the managed
   runtime state directory.
2. Confirm OpenClaw logs show the skill watcher noticing the new skill.
3. Open a session and invoke the installed skill.

### Uninstall correctness

1. Uninstall the same skill from the Installed tab.
2. Confirm the skill directory is removed from the managed runtime path.
3. Confirm OpenClaw no longer exposes that skill in a new session.

### Failure-path checks

1. Simulate missing `clawhub` binary and confirm UI shows a non-blocking error.
2. Simulate catalog download failure and confirm Installed tab still works.
3. Simulate interrupted install and confirm no partial skill directory remains.

## Implementation plan

### Phase 1 — Catalog worker + IPC

1. `apps/desktop/main/skillhub/catalog-worker.ts` — worker thread
2. `apps/desktop/main/skillhub/catalog-manager.ts` — spawn/manage worker, handle IPC
3. `apps/desktop/shared/host.ts` — add IPC channel types
4. `apps/desktop/main/ipc.ts` — register new handlers

### Phase 2 — Frontend Community tab

5. `apps/web/src/pages/skills.tsx` — replace Official/Custom tabs with Installed/Community
6. `apps/web/src/components/skills/community-skill-card.tsx` — card with download count + install button
7. `apps/web/src/hooks/use-community-catalog.ts` — IPC hook for catalog data
8. Intersection Observer lazy load

### Phase 3 — Install / Uninstall

9. Install button → IPC → `clawhub install` → refresh installed list
10. Uninstall from Installed tab → IPC → `clawhub uninstall --yes`
11. Installed badge on Community cards

### Phase 4 — Polish

12. Skeleton loading states
13. Error handling (network failure, CLI not found)
14. "Last updated: X hours ago" indicator
15. Manual refresh button
