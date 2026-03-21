# Nexu Skill Repository — File-Based Skills System

**Date:** 2026-03-15
**Status:** Design approved

## Overview

Migrate Nexu's skill system from database-backed to file-based, with a public GitHub repository as the skill registry. The openclaw-lark Feishu skills are the first public skills.

## Architecture

### Skills Directory Convention

All runtimes use **`.openclaw/skills/`** (relative to the workspace root) as the canonical skills directory. This aligns with the existing `skills.load.extraDirs` config in `.openclaw/openclaw.json`.

- **Local dev / Desktop:** `.openclaw/skills/` in the project or user workspace
- **API filesystem scan:** Reads the same `.openclaw/skills/` directory
- **CLI install target:** Writes to `.openclaw/skills/`
- **OpenClaw watcher:** Already configured via `skills.load.extraDirs: [".openclaw/skills"]`

The `OPENCLAW_SKILLS_DIR` env var can override this for non-standard setups, but the default is always `.openclaw/skills/`. Both the API and CLI resolve this path using the same logic:

```typescript
const skillsDir = process.env.OPENCLAW_SKILLS_DIR ?? resolve(workspaceRoot, ".openclaw/skills");
```

The API must receive `OPENCLAW_SKILLS_DIR` in its environment (or derive it from workspace root) so that its filesystem scan matches what OpenClaw actually loads.

### Data Flow

```
GitHub Repo (nexu-skills)          Local Filesystem
┌─────────────────────┐       ┌──────────────────────────────┐
│ skills.json (index)  │       │ .openclaw/skills/            │
│ skills/              │──────▶│   feishu-bitable/            │
│   feishu-bitable/    │ CLI   │   feishu-calendar/           │
│   feishu-calendar/   │ install│   ...                       │
│   ...                │       │                              │
└─────────────────────┘       └──────────┬───────────────────┘
                                         │ filesystem scan
                              ┌──────────▼───────────────────┐
                              │ Nexu API                      │
                              │ GET /api/v1/skills            │
                              │ (merge: local + GitHub cache) │
                              └──────────┬───────────────────┘
                                         │
                              ┌──────────▼───────────────────┐
                              │ Nexu Web UI                   │
                              │ Skills page                   │
                              │ (Installed / Available)       │
                              └──────────────────────────────┘
```

OpenClaw loads skills from `.openclaw/skills/` via `skills.load.watch: true` and `skills.load.extraDirs`.

## 1. Skill Repo Structure

GitHub repo: `nexu-skills`

```
nexu-skills/
├── skills.json              # Auto-generated index
├── scripts/
│   └── build-index.ts       # Scans skills/, generates skills.json
├── skills/
│   ├── feishu-bitable/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── field-properties.md
│   │       ├── record-values.md
│   │       └── examples.md
│   ├── feishu-calendar/
│   │   └── SKILL.md
│   ├── feishu-create-doc/
│   │   └── SKILL.md
│   ├── feishu-fetch-doc/
│   │   └── SKILL.md
│   ├── feishu-update-doc/
│   │   └── SKILL.md
│   ├── feishu-task/
│   │   └── SKILL.md
│   ├── feishu-im-read/
│   │   └── SKILL.md
│   └── feishu-troubleshoot/
│       └── SKILL.md
└── README.md
```

### Extended SKILL.md Frontmatter

```yaml
---
name: feishu-bitable
description: "Create and manage Feishu Bitable spreadsheet databases"
longDescription: "Full CRUD for Bitable apps, tables, records, fields, and views..."
tag: office-collab
icon: Table2
source: official
examples:
  - "帮我创建一个客户管理多维表格"
  - "查询多维表格里状态为进行中的记录"
prompt: "Help me manage Feishu Bitable databases"
requires:
  tools:
    - feishu_bitable_app_table_record
    - feishu_bitable_app_table_field
  plugins:
    - "@larksuite/openclaw-lark"
---
```

All UI-facing metadata lives in frontmatter. Single source of truth per skill.

### skills.json (Auto-Generated)

```json
{
  "version": 1,
  "repo": "your-org/nexu-skills",
  "skills": {
    "feishu-bitable": {
      "description": "Create and manage Feishu Bitable spreadsheet databases",
      "longDescription": "...",
      "tag": "office-collab",
      "icon": "Table2",
      "source": "official",
      "examples": ["帮我创建一个客户管理多维表格"],
      "prompt": "Help me manage Feishu Bitable databases",
      "requires": { "plugins": ["@larksuite/openclaw-lark"] },
      "path": "skills/feishu-bitable"
    }
  }
}
```

The `path` field tells the CLI where to find the skill directory. The CLI uses GitHub Trees API to discover all files under that path — no explicit file list needed.

## 2. CLI Skill Management

New `nexu skill` command group:

```bash
nexu skill install feishu-bitable          # Download from GitHub → local
nexu skill install feishu-calendar feishu-task  # Multiple at once
nexu skill uninstall feishu-bitable        # Delete from local
nexu skill list                            # Show installed skills
nexu skill search bitable                  # Search GitHub catalog
nexu skill update feishu-bitable           # Re-download latest
nexu skill update --all                    # Update all installed
```

### Install Flow

1. Fetch `skills.json` from GitHub raw URL (cached locally with TTL)
2. Look up skill name → get `path: "skills/feishu-bitable"`
3. Call GitHub Trees API: `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`
4. Filter tree entries under the skill's path
5. Download all files via GitHub raw content API (parallel)
6. Write atomically to `.openclaw/skills/{name}/`:
   - Write all files to a temp directory (`.openclaw/skills/.{name}.tmp/`)
   - After all files are written, rename temp dir to final path
   - This prevents OpenClaw's file watcher from loading a half-installed skill
7. OpenClaw's file watcher picks up the new skill automatically

### Updatable Detection

A skill is marked `updatable: true` when the installed version differs from the GitHub version. The hash is computed over **all files** in the skill directory (sorted by path, SHA-256 of concatenated contents). This covers SKILL.md, reference docs, and any bundled scripts.

## 3. API Changes

### Skills Directory Resolution

The API resolves the skills directory using the same logic as the CLI:

```typescript
const skillsDir = process.env.OPENCLAW_SKILLS_DIR ?? resolve(workspaceRoot, ".openclaw/skills");
```

The desktop app must pass `OPENCLAW_SKILLS_DIR` to the API process (not just the gateway). This ensures the API's filesystem scan matches what OpenClaw actually loads.

### Merged Data Sources

1. **Installed skills** — Scan the resolved skills directory, parse each `SKILL.md` frontmatter
2. **Available skills** — Fetch `skills.json` from GitHub (cached in memory, 5min TTL; falls back to last cached copy when GitHub is unreachable)

### Response Shape

```json
{
  "skills": [
    {
      "slug": "feishu-bitable",
      "name": "feishu-bitable",
      "description": "Create and manage Feishu Bitable...",
      "tag": "office-collab",
      "iconName": "Table2",
      "source": "official",
      "examples": ["..."],
      "installed": true,
      "updatable": false
    }
  ],
  "tags": [...]
}
```

### Merge Logic

- Start with all skills from GitHub `skills.json` (full catalog)
- Scan local skills dir, parse frontmatter, mark matching slugs as `installed: true`
- Local-only skills (not in GitHub repo) appear as `source: "custom"`
- Content hash comparison sets `updatable: true` when versions differ

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/skills` | Merged filesystem + GitHub cache |
| `GET /api/v1/skills/{slug}` | Detail from frontmatter |
| `POST /api/v1/skills/{slug}/install` | Download from GitHub |
| `DELETE /api/v1/skills/{slug}` | Remove from local skills dir |
| `PUT /api/internal/skills/{name}` | Removed after SkillHub became the only supported skill management path |

## 4. Web UI Changes

- Same skills page, no new pages
- Filter bar: "All / Installed / Available" replaces "Official / Custom"
- Skill cards: install state badge (green "Installed" or "Install" button)
- Installed skills: "Uninstall" in context menu
- Updatable skills: "Update available" badge
- Detail page: `requires.plugins` section replaces Composio OAuth buttons
- Tag filtering and search unchanged

## 5. Migration Path

### Phase 1 — Add file-based skill reading (non-breaking)

- Add filesystem scanning to API skill service
- Add GitHub `skills.json` fetch with caching
- New `/api/v1/skills` merges both sources
- Existing gateway snapshot polling continues (Composio skills unaffected)

### Phase 2 — Migrate Composio skills to file-based

- Move 26 Composio skills to GitHub skill repo (SKILL.md + composio-exec.js)
- They become installable like any other skill
- Remove `seed-composio-skills.ts` and gateway snapshot polling

### Phase 3 — Clean up

- Drop `skills`, `skillsSnapshots`, `supportedSkills` DB tables
- Keep `supportedToolkits` and `userIntegrations` (OAuth state needs DB)
- Remove old skill route implementations

**What stays in DB:** User integration state (OAuth tokens, connected accounts).
**What moves to files:** All skill content and catalog metadata.
