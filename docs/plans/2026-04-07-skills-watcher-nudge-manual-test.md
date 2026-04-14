# Manual Test Plan — Skills Watcher Nudge Refactor + libtv Frontmatter Fix

**Date**: 2026-04-07
**Branch**: `refactor/openclaw-skills-watcher-nudge`
**Commits**:
- `a5617b14` — `fix: align libtv-video skill name with slug for agent allowlist match`
- `dd120033` — `refactor: converge skills watcher nudge to a single primitive`

## Goal

Run a true from-scratch manual verification using a packaged desktop build and confirm:

1. Bundled static skills are copied into the runtime skills directory on first boot.
2. `nudgeSkillsWatcher("config-pushed")` fires after controller sync.
3. The `.controller-nudge` marker file is written and updated.
4. The marker does not appear as a visible skill.
5. `libtv-video` is present end-to-end and readable by the agent.
6. Existing working skills still behave normally.

This version intentionally assumes **no preserved local state**. It builds a fresh packaged app, launches that app, and verifies the behavior through the packaged desktop path.

## Test environment

- macOS
- Packaged macOS desktop flow:
  - `pnpm dist:mac:unsigned`
  - Launch the built `Nexu.app`
  - Inspect packaged-app logs and repo release output

## Important paths

All paths below are repo-relative from `/Users/alche/Documents/digit-sutando/nexu`.

| Item | Path |
|---|---|
| Release output root | `apps/desktop/release/` |
| Built macOS app bundle | `apps/desktop/release/mac-arm64/Nexu.app/` on Apple Silicon, `apps/desktop/release/mac/Nexu.app/` or similar electron-builder output dir on other targets |
| Persistent `NEXU_HOME` | `~/.nexu/` |
| Skill ledger | `~/.nexu/skill-ledger.json` |
| Compiled OpenClaw config | `~/.nexu/compiled-openclaw.json` |
| Extracted runtime root | `~/.nexu/runtime/` |
| OpenClaw state | `~/Library/Application Support/@nexu/desktop/runtime/openclaw/state/` |
| Runtime skills dir | `~/Library/Application Support/@nexu/desktop/runtime/openclaw/state/skills/` |
| Marker file | `~/Library/Application Support/@nexu/desktop/runtime/openclaw/state/skills/.controller-nudge` |
| Runtime libtv skill | `~/Library/Application Support/@nexu/desktop/runtime/openclaw/state/skills/libtv-video/SKILL.md` |
| Bundled static skills source | `apps/desktop/static/bundled-skills/` |
| Bundled libtv source | `apps/desktop/static/bundled-skills/libtv-video/SKILL.md` |

## What should exist after a fresh boot

Bundled static skills currently shipped from the repo:

- `clawhub`
- `coding-agent`
- `deep-research`
- `gh-issues`
- `libtv-video`
- `medeo-video`
- `nano-banana-one-shop`
- `qiaomu-mondo-poster-design`
- `research-to-diagram`

Those should be copied from `apps/desktop/static/bundled-skills/` into the packaged runtime skills dir under `~/Library/Application Support/@nexu/desktop/runtime/openclaw/state/skills/` during first launch.

## Pre-flight

### Step 0.1 — Confirm branch and commits

```bash
cd /Users/alche/Documents/digit-sutando/nexu
git status
git log --oneline origin/main..HEAD
```

Expected:

- Branch is `refactor/openclaw-skills-watcher-nudge`
- Working tree is in the state you expect for testing
- The two commits above are present

### Step 0.2 — Remove old packaged-app runtime state

This is the from-scratch reset for packaged local verification.

```bash
rm -rf ~/.nexu
rm -rf ~/Library/Application\ Support/@nexu/desktop
```

Expected:

- `~/.nexu` no longer exists
- `~/Library/Application Support/@nexu/desktop` no longer exists

Verification:

```bash
test ! -d ~/.nexu && echo "~/.nexu removed"
test ! -d ~/Library/Application\ Support/@nexu/desktop && echo "userData removed"
```

### Step 0.3 — Verify the bundled source contains the fix

```bash
head -3 apps/desktop/static/bundled-skills/libtv-video/SKILL.md
```

Expected:

- The frontmatter `name:` is exactly `libtv-video`

If it is not, stop here. The branch content is wrong and the rest of the test is not meaningful.

## Cold start

### Step 1 — Build the packaged app

```bash
pnpm dist:mac:unsigned
```

Expected:

- Packaging completes successfully
- `apps/desktop/release/` contains a packaged `Nexu.app`

### Step 2 — Launch the built app

Open the packaged app from the release folder. Example for Apple Silicon:

```bash
open apps/desktop/release/mac-arm64/Nexu.app
```

If your local output directory differs, use the generated app bundle path under `apps/desktop/release/`.

Wait for startup to complete and for the desktop app window to open.

### Step 3 — Verify the packaged app stack is healthy

```bash
ls -la ~/.nexu
ls -la ~/Library/Application\ Support/@nexu/desktop
```

Expected:

- `~/.nexu/` exists
- `~/Library/Application Support/@nexu/desktop/` exists
- The app window is open
- No obvious launch failure is shown in the UI

Do not continue until the app window is open and both directories exist.

## First-boot filesystem verification

### Step 4 — Confirm the runtime directories were created

```bash
ls -la ~/.nexu
ls -la ~/.nexu/runtime
ls -la ~/Library/Application\ Support/@nexu/desktop/runtime/openclaw/state
```

Expected:

- `~/.nexu/` exists
- `~/.nexu/runtime/` exists
- `~/Library/Application Support/@nexu/desktop/runtime/openclaw/state/` exists

### Step 5 — Confirm bundled static skills were copied

```bash
find ~/Library/Application\ Support/@nexu/desktop/runtime/openclaw/state/skills -maxdepth 2 -type f -name 'SKILL.md' | sort
```

Expected:

- The runtime skills dir contains the bundled static skills
- `libtv-video/SKILL.md` is present
- `deep-research/SKILL.md` is present
- `coding-agent/SKILL.md` is present

At minimum, verify these two explicitly:

```bash
test -f ~/Library/Application\ Support/@nexu/desktop/runtime/openclaw/state/skills/libtv-video/SKILL.md && echo "libtv-video copied"
test -f ~/Library/Application\ Support/@nexu/desktop/runtime/openclaw/state/skills/deep-research/SKILL.md && echo "deep-research copied"
```

### Step 6 — Confirm the runtime libtv frontmatter is correct

```bash
head -3 ~/Library/Application\ Support/@nexu/desktop/runtime/openclaw/state/skills/libtv-video/SKILL.md
```

Expected:

- The frontmatter `name:` is exactly `libtv-video`

If it shows `LibTV Video`, the bundled skill was copied incorrectly or stale data somehow survived the reset.

## Watcher nudge verification

### Step 7 — Tail the packaged-app logs

Open a second terminal and run:

```bash
tail -F ~/Library/Application\ Support/@nexu/desktop/logs/runtime-units/controller.log | grep --line-buffered -E "openclaw skills watcher|doSync: complete|copyStaticSkills|copied.*libtv"
```

Leave it running.

### Step 8 — Check for the automatic boot nudge

On a true fresh boot, the controller should copy bundled skills, compile config, and run a sync that nudges the skills watcher.

Expected log line shape:

```json
{"reason":"config-pushed","marker":"/Users/alche/Library/Application Support/@nexu/desktop/runtime/openclaw/state/skills/.controller-nudge","mtime":"2026-04-07T...Z","msg":"openclaw skills watcher nudged"}
```

You should also see a nearby `doSync: complete` log.

Important:

- A cold boot may still produce `configPushed:false` if the generated config is unchanged.
- If that happens, the correct next step is to make a real config change in the app and save it.

Pass:

- The nudge log appears at least once
- `reason` is `config-pushed`

Fail:

- A `openclaw skills watcher nudge failed` line appears
- No nudge line appears after you make and save a real config change in the app

### Step 9 — If needed, trigger a real config push from the app

If the boot logs only show `configPushed:false`, change something in the app that affects compiled OpenClaw config, then save. Good triggers:

- Change a bot name
- Change a bot model
- Add or remove a skill from a bot
- Change a channel/bot setting that affects compiled config

Then re-check the log tail.

### Step 10 — Verify the marker file exists and is fresh

```bash
stat -f "%Sm  %N" ~/Library/Application\ Support/@nexu/desktop/runtime/openclaw/state/skills/.controller-nudge
```

Expected:

- The file exists
- The mtime is recent
- The timestamp roughly matches the `mtime` in the nudge log

## UI verification

### Step 11 — Confirm the marker file is not treated as a skill

Open the app and go to the Skills page.

Expected:

- Real skills are visible
- `.controller-nudge` does not appear anywhere
- No blank or malformed skill entry appears

Fail:

- A phantom skill card appears for `.controller-nudge`

## Agent verification

### Step 12 — Confirm compiled config includes `libtv-video`

```bash
node -e '
const c = JSON.parse(require("fs").readFileSync(process.env.HOME + "/.nexu/compiled-openclaw.json", "utf8")).config;
for (const a of c.agents?.list ?? []) {
  console.log(a.name, "| has libtv-video:", a.skills?.includes("libtv-video") ?? false);
}
'
```

Expected:

- At least one agent that should have the skill reports `has libtv-video: true`

### Step 13 — Ask the agent to list its skills

In the app, open a bot that should have `libtv-video` and ask:

> List all the skills you have access to, one per line.

Expected:

- The response includes `libtv-video`

### Step 14 — Ask for libtv-specific capability details

Send:

> Using the libtv-video skill, tell me what trigger phrases it supports and what models it can call.

Expected:

- The response reflects SKILL.md content
- It mentions trigger phrases such as `seedance`, `generate video`, `make a video`, `libtv`, or `liblib`
- It mentions models such as `Seedance 2.0`, `Kling 3.0`, `Wan 2.6`, or `Midjourney`

Pass:

- The agent can describe the skill content, not just the skill name

Fail:

- The agent says it does not have the skill
- The agent knows the skill name but cannot read its body

### Step 15 — Fallback if the agent still misses `libtv-video`

If Steps 12-13 fail, force a fresh app/runtime session:

```bash
pkill -f "/Nexu.app/Contents/MacOS/Nexu" || true
open apps/desktop/release/mac-arm64/Nexu.app
```

Then repeat Steps 12-14.

## Regression check

### Step 16 — Verify an unrelated skill still works

Ask the same bot:

> Using the coding-agent skill or the github skill, list your capabilities.

Expected:

- The bot responds normally
- Existing known-good skills still load

## Optional error-path test

### Step 17 — Force the nudge to fail

Only do this if you want to verify the warning path.

```bash
chmod 555 ~/Library/Application\ Support/@nexu/desktop/runtime/openclaw/state/skills
```

Then trigger another config push from the app and watch:

```bash
tail -F ~/Library/Application\ Support/@nexu/desktop/logs/runtime-units/controller.log | grep "openclaw skills watcher nudge failed"
```

Restore permissions immediately after:

```bash
chmod 755 ~/Library/Application\ Support/@nexu/desktop/runtime/openclaw/state/skills
```

Expected:

- A warning log appears with the reason and an `EACCES` or `EPERM`-style error

## Pass criteria

The test is successful if all of the following are true:

- The packaged app starts from deleted `~/.nexu` and `~/Library/Application Support/@nexu/desktop` state
- Bundled static skills are copied into `~/Library/Application Support/@nexu/desktop/runtime/openclaw/state/skills`
- Runtime `libtv-video/SKILL.md` uses `name: libtv-video`
- A watcher nudge log appears with `reason:"config-pushed"` after a real config change if boot did not push config
- `.controller-nudge` exists and has a fresh mtime
- `.controller-nudge` is not shown as a visible skill
- The target agent lists `libtv-video`
- The target agent can describe `libtv-video` content
- An unrelated skill still works

## Cleanup

If you want to reset again for another from-scratch run:

Quit the packaged app, then:

```bash
rm -rf ~/.nexu
rm -rf ~/Library/Application\ Support/@nexu/desktop
```

If you only want to clear the marker file:

```bash
rm -f ~/Library/Application\ Support/@nexu/desktop/runtime/openclaw/state/skills/.controller-nudge
```
