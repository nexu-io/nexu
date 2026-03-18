# Skill Installation

Nexu uses a file-based skill system. The runtime loads skills from `.openclaw/skills/`.

## Core idea

- The GitHub catalog is the source for official skills.
- Installed skills live on disk in `.openclaw/skills/`.
- OpenClaw watches that directory and hot-loads updates.

## Install flow

1. Find the skill in the Nexu catalog.
2. Install it through the Nexu UI or CLI flow.
3. Confirm the skill folder appears under `.openclaw/skills/<skill-name>/`.
4. Wait for the gateway watcher to refresh.
5. Test the skill with a simple prompt.

## Directory layout

```text
.openclaw/
  skills/
    feishu-bitable/
      SKILL.md
      references/
```

## What a skill contains

- `SKILL.md` with frontmatter metadata
- Optional reference documents bundled with the skill
- Required tool or plugin declarations in frontmatter

## Operational notes

- Local and desktop runtimes both use `.openclaw/skills/` as the default install target.
- `OPENCLAW_SKILLS_DIR` can override the default location when needed.
- Skills should be written atomically to avoid the watcher loading half-finished content.
- Local-only skills can coexist with skills synced from the public catalog.

## After installing

- Refresh the skill catalog in the app if the UI is stale.
- Check gateway logs if the skill does not appear.
- Keep skill metadata in `SKILL.md` as the single source of truth.
