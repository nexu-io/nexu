# Skill Config Sync — Complete Manual Test Plan

## Overview

Verify the full skill management pipeline on a **packaged desktop build** using the inspector script.

## Inspector Script

One script, all diagnostics:

```bash
node scripts/test-skill-sync.mjs              # Show ledger + config + workspace
node scripts/test-skill-sync.mjs ledger        # Ledger only
node scripts/test-skill-sync.mjs config        # Config agent skills only
node scripts/test-skill-sync.mjs workspace     # Workspace skills on disk
node scripts/test-skill-sync.mjs watch         # Watch config for live changes
node scripts/test-skill-sync.mjs create-ws     # Create a test workspace skill
node scripts/test-skill-sync.mjs create-zip    # Create a test custom skill zip
```

## Log Tailing

In a separate terminal:
```bash
tail -f ~/.nexu/logs/*.log 2>/dev/null | grep -E "skillhub|syncAll|config_write|hot.reload"
```

---

## Part A: Shared Skill Sync (SkillHub UI)

### Test A1: Legacy Upgrade Path (Fresh Install / Empty Ledger)

**Goal:** First launch with no ledger → skills field omitted → all skills auto-discovered.

```bash
node scripts/test-skill-sync.mjs
```

**Expected:**
- [ ] Ledger: "No ledger file" or empty
- [ ] Config: skills field `omitted` for all agents (legacy mode)

---

### Test A2: Install Skill via SkillHub UI

1. Terminal 1:
   ```bash
   node scripts/test-skill-sync.mjs watch
   ```

2. Open app → **Skills** → **Explore** → Install a skill

3. After install completes:
   ```bash
   node scripts/test-skill-sync.mjs
   ```

**Expected:**
- [ ] Watch shows config updated within ~5 seconds
- [ ] Ledger: skill with `source: managed`, `status: installed`
- [ ] Config: agent's `skills` array includes the slug
- [ ] Logs: `[skillhub] install complete` → `syncAll` → `config_write_complete`

---

### Test A3: Agent Detects Installed Skill

1. Open a Slack conversation with the bot
2. Ask: **"What skills do you have available?"**

**Expected:**
- [ ] Agent lists the newly installed skill
- [ ] Agent can use the skill

---

### Test A4: Uninstall Skill via SkillHub UI

1. Keep watch running
2. Open app → **Skills** → **Yours** → click **Uninstall**

3. Check:
   ```bash
   node scripts/test-skill-sync.mjs
   ```

**Expected:**
- [ ] Config updated within ~5 seconds
- [ ] Ledger: skill in uninstalled list
- [ ] Config: agent's `skills` no longer includes the slug

---

### Test A5: Agent No Longer Has Uninstalled Skill

1. Ask the agent: **"What skills do you have?"**

**Expected:**
- [ ] Agent does NOT list the uninstalled skill

---

### Test A6: Import Custom Skill (.zip)

1. Create the zip:
   ```bash
   node scripts/test-skill-sync.mjs create-zip
   cd /tmp/test-skill && zip -r my-custom-skill.zip my-custom-skill/
   ```

2. Open app → **Skills** → **Import** → upload the zip

3. Check:
   ```bash
   node scripts/test-skill-sync.mjs
   ```

**Expected:**
- [ ] Ledger: `my-custom-skill` with `source: custom`
- [ ] Config: `skills` includes `"my-custom-skill"`

---

### Test A7: Multiple Agents

```bash
node scripts/test-skill-sync.mjs config
```

**Expected:**
- [ ] All agents have shared skills in their `skills` arrays

---

## Part B: Workspace Skills (Agent-Installed)

### Test B1: Simulate Agent-Installed Workspace Skill Without Restart

1. Create a test workspace skill:
   ```bash
   node scripts/test-skill-sync.mjs create-ws
   ```

2. Keep the app running and keep the watcher/log tail open.

3. Check within ~5 seconds:
   ```bash
   node scripts/test-skill-sync.mjs
   ```

**Expected:**
- [ ] Workspace section shows the skill on disk
- [ ] Ledger: `test-ws-skill` with `source: workspace`, `agentId` set
- [ ] Config: that agent's `skills` includes `"test-ws-skill"` merged with shared skills
- [ ] Logs: `Agent <id>: synced 1 workspace skill(s): test-ws-skill`
- [ ] No app restart is required for ledger/config visibility

---

### Test B2: Workspace Skill Visible in UI

1. Open app → **Skills** → **Yours** → **Agent Skills** tab

**Expected:**
- [ ] "Agent Skills" tab is visible
- [ ] `test-ws-skill` appears under the agent's name

---

### Test B3: Workspace Skill Per-Agent Isolation In Config

If you have 2+ bots:

```bash
node scripts/test-skill-sync.mjs config
```

**Expected:**
- [ ] Only the target agent has the workspace skill in its `skills` array
- [ ] Other agents have only shared skills

---

### Test B4: Workspace Skill Removed From Disk Without Restart

1. Delete the workspace skill:
   ```bash
   node scripts/test-skill-sync.mjs workspace   # note the path
   # Then manually rm -rf the skill directory shown
   ```

2. Keep the app running and wait up to ~5 seconds.

3. Check:
   ```bash
   node scripts/test-skill-sync.mjs
   ```

**Expected:**
- [ ] Ledger: workspace skill marked as `uninstalled`
- [ ] Config: agent's `skills` no longer includes it
- [ ] Workspace skill disappears from the Skills UI without restart
- [ ] Other agents are unaffected

---

### Test B5: Uninstall Workspace Skill From Agent Card

**Goal:** Verify uninstall is scoped to the selected agent install.

Precondition:
- [ ] Two bots exist
- [ ] The same slug is installed under both bots' workspace skill directories

1. Confirm baseline:
   ```bash
   node scripts/test-skill-sync.mjs
   ```

2. Open app → **Skills** → **Yours** → installed workspace skill groups
3. Click **Uninstall** on the card under **Agent A**
4. Re-run:
   ```bash
   node scripts/test-skill-sync.mjs
   ```

**Expected:**
- [ ] Agent A no longer lists the workspace skill in UI
- [ ] Ledger marks only Agent A's workspace record uninstalled
- [ ] Config removes the slug only from Agent A
- [ ] Agent B still shows the same slug in UI, ledger, and config

---

### Test B6: Uninstall Workspace Skill From Detail Page

**Goal:** Verify the detail page preserves agent context and does not uninstall the wrong installation.

1. From **Skills** → **Yours**, click the workspace skill card under **Agent B**
2. Verify the detail page reflects the selected installation context
   Expected:
   - [ ] The page is opened from the Agent B card
   - [ ] Uninstall is enabled for this selected install
3. Click **Uninstall**
4. Re-run:
   ```bash
   node scripts/test-skill-sync.mjs
   ```

**Expected:**
- [ ] Only Agent B loses the skill
- [ ] Agent A's copy remains installed
- [ ] The detail-page uninstall does not silently target a shared skill or another agent's workspace install

---

### Test B7: Ambiguous Multi-Agent Detail View Safety Check

**Goal:** Verify the UI does not guess when the same slug exists in multiple agents.

Precondition:
- [ ] Same workspace skill slug installed for 2+ agents

1. Open the skill detail view directly by slug URL, without navigating from an agent card
   Example:
   ```text
   /workspace/skills/test-ws-skill
   ```

**Expected:**
- [ ] Detail still loads
- [ ] If agent context is ambiguous, uninstall is disabled or otherwise prevented
- [ ] No uninstall request is sent without an `agentId`

---

## Part C: Upgrade Compatibility

### Test C1: Upgrade with Pre-Existing Workspace Skills

**Goal:** Simulate upgrading from old version with workspace skills but no ledger.

1. Quit the app

2. Delete the ledger:
   ```bash
   rm -f ~/.nexu/skill-ledger.json
   ```

3. Create workspace skills (if not already present):
   ```bash
   node scripts/test-skill-sync.mjs create-ws
   ```

4. Launch the app

5. Check:
   ```bash
   node scripts/test-skill-sync.mjs
   ```

**Expected:**
- [ ] Ledger: workspace skills reconciled with `source: workspace` and `agentId`
- [ ] Ledger: shared skills reconciled with `source: managed`
- [ ] Config: agent's `skills` includes both workspace and shared skills
- [ ] Workspace skills appear in the UI before any manual restart after launch stabilization

---

### Test C2: First SkillHub Install After Upgrade Preserves Workspace Skills

1. Continue from C1
2. Install a new skill via SkillHub UI

3. Check:
   ```bash
   node scripts/test-skill-sync.mjs
   ```

**Expected:**
- [ ] Ledger: new shared skill added, workspace skills preserved
- [ ] Config: agent has BOTH shared AND workspace skills
- [ ] No workspace skills lost

---

## Bug-Fix Regression Matrix

Use this matrix to explicitly verify the three bugs fixed in the current change set.

| Bug | Manual coverage | Pass criteria |
|---|---|---|
| Workspace uninstall lacked agent context | B5, B6, B7 | Uninstall only affects the selected `agentId`; ambiguous detail view does not guess |
| Workspace removal marked all agents uninstalled | B3, B4, B5, B6 | Removing/uninstalling one agent's copy leaves other agents' copies intact |
| Workspace reconciliation only ran at startup | B1, B4 | Add/remove on disk updates ledger, config, and UI without restart |

---

## Verification Checklist

| # | Test | Ledger | Config | Agent | UI | Timing |
|---|------|:------:|:------:|:-----:|:--:|:------:|
| A1 | Fresh install | empty | omitted | All work | — | — |
| A2 | Install via UI | managed | slug added | — | — | < 5s |
| A3 | Agent detection | — | — | Has skill | — | — |
| A4 | Uninstall via UI | uninstalled | slug removed | — | — | < 5s |
| A5 | Agent post-uninstall | — | — | Skill gone | — | — |
| A6 | Import zip | custom | slug added | — | — | — |
| A7 | Multi-agent shared | — | All same | — | — | — |
| B1 | Workspace reconcile | workspace | merged | — | — | — |
| B2 | Workspace in UI | — | — | — | Agent tab | — |
| B3 | Per-agent isolation | — | Per-agent | — | — | — |
| B4 | Workspace removed | uninstalled | removed | — | — | — |
| C1 | Upgrade compat | reconciled | merged | — | — | — |
| C2 | Post-upgrade install | preserved | merged | — | — | — |

## Red Flags in Logs

```
[skillhub] install complete: <slug>                       ← expected after install
[skillhub] Agent <id>: synced N workspace skill(s): ...   ← expected on startup
syncAll                                                    ← expected after mutations
openclaw_config_write_complete, size=XXXX                  ← expected (size should change)
config hot reload applied                                  ← expected (OpenClaw picked it up)
```

**Problems:**
- No `config_write_complete` after install → `syncAll` not triggering
- Config size unchanged → compiler not including skills
- No `hot reload applied` → OpenClaw not detecting the change
- Workspace skills missing from ledger → `syncWorkspaceDirs` not running
- Workspace skills disappear after SkillHub install → merge broken
