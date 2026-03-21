# SkillHub Known Limitations

## Agent-installed skills land in agent workspace, not shared skillsDir

**Status:** Known limitation, not addressed in this release.

**Problem:** When an OpenClaw agent runs `clawhub install <slug>`, the skill is installed into the agent's own workspace (`state/agents/<agent-id>/skills/<slug>/`) instead of the shared `state/skills/` directory. This means:

1. The SkillHub file watcher does not detect the install
2. The skill does not appear in the "Yours" tab of the desktop UI
3. The skill is only available to that specific agent, not globally

**Root cause:** OpenClaw's clawhub CLI defaults `--workdir` to the current agent's workspace directory. The agent has no knowledge of the Nexu controller's shared `skillsDir`.

**Workaround:** The user can manually copy the skill from the agent workspace to the shared skills directory, or use the Nexu UI "Install" button or "+ Import" zip upload instead.

**Potential future fix:**
- Configure the `clawhub` curated skill to use the shared `skillsDir` as `--workdir` via OpenClaw config or environment variable
- Or: add a reconcile scan of agent workspace directories in addition to the shared `skillsDir`
