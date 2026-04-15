# Skill System Architecture Comparison: Nexu vs OpenClaw vs Claude Code vs Codex

> **Purpose:** Inform the design of Nexu's next-gen skill experience — better lifecycle, less configuration, richer interactivity — potentially via a unified cloud management service.
>
> **Date:** 2026-04-03

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Comparison Matrix](#2-architecture-comparison-matrix)
3. [Deep Dive: How Each Platform Works](#3-deep-dive)
4. [UX Journey Comparison: "I Want This Capability"](#4-ux-journey-comparison)
5. [Credential & Configuration Complexity Analysis](#5-credential--configuration-complexity)
6. [Lifecycle Management Comparison](#6-lifecycle-management-comparison)
7. [Interactivity & Discovery Patterns](#7-interactivity--discovery-patterns)
8. [Plugin Encapsulation: How Skills Become Efficient Agent Tools](#8-plugin-encapsulation)
9. [Marketplace Architecture: How Products Ensure Stable Installation](#9-marketplace-architecture)
10. [Gap Analysis: Where Nexu Stands Today](#10-gap-analysis-where-nexu-stands-today)
11. [Opportunity: Unified Cloud Management Service](#11-opportunity-unified-cloud-management-service)
12. [Recommendations & Roadmap](#12-recommendations--roadmap)

---

## 1. Executive Summary

All four platforms have independently converged on **`SKILL.md` as the universal skill definition format** — a directory containing a Markdown file with YAML frontmatter and natural language instructions. Beyond this convergence, the architectures diverge significantly in execution model, extensibility depth, and user experience.

**Key findings:**

| Dimension | Leader | Why |
|---|---|---|
| Extensibility depth | Claude Code | 17 lifecycle hooks, 4 handler types, subagent-scoped MCP, agent teams |
| Security model | Codex | Kernel-level sandboxing (Seatbelt/bwrap), impossible to bypass from agent |
| Plugin ecosystem | Coze/OpenClaw | OpenAPI-driven plugin model, AES-encrypted credentials, cloud+self-hosted bridge |
| Local catalog | Nexu | 12,891-skill SkillHub catalog with search, install queue, workspace isolation |
| Credential UX | Coze/OpenClaw | Backend-encrypted OAuth, frontend never sees tokens |
| Setup simplicity | Codex (cloud) | `codex --cloud` eliminates all local env concerns |

**The universal pain point:** No platform has solved the **credential management + discovery + lifecycle** trifecta. This is where Nexu's unified cloud service can differentiate.

---

## 2. Architecture Comparison Matrix

### 2.1 Core Architecture

| Aspect | Nexu (SkillHub) | OpenClaw/Coze (Latest) | Claude Code | Codex CLI |
|---|---|---|---|---|
| **Runtime model** | Desktop app + controller daemon | Server-side daemon (Go/Hertz) | CLI per-session | CLI per-session (Rust) |
| **Skill format** | `SKILL.md` (YAML frontmatter + MD) | `plugin_meta.yaml` (OpenAPI-driven) | `SKILL.md` (YAML frontmatter + MD) | `SKILL.md` (YAML frontmatter + MD) |
| **Plugin concept** | Skills = top-level; plugins = OpenClaw runtime extensions | Plugins = containers of tools; each tool = 1 API endpoint | Plugins = package bundles (skills + agents + hooks + MCP) | Skills = authoring format; plugins = distribution bundles |
| **Extension protocol** | File-based (SKILL.md on disk) | OpenAPI 3.0 spec + HTTP | MCP (stdio/HTTP/SSE) | MCP (stdio/HTTP) |
| **State management** | File-based ledger (LowDB JSON) | PostgreSQL + GORM | File-based memory system + git | Conversation-scoped (minimal) |
| **Config format** | JSON (compiled by controller) | YAML (`plugin_meta.yaml`) + Go config | JSON (layered, 5 levels) | TOML (`config.toml`) |

### 2.2 Skill/Plugin Hierarchy

| Priority | Nexu | Coze/OpenClaw | Claude Code | Codex |
|---|---|---|---|---|
| **Highest** | Workspace (per-agent) | Custom (workspace-scoped) | Enterprise managed | Repo local (`.agents/skills/`) |
| **High** | Managed (ClawHub) | Commercial bridge (SaaS) | Personal (`~/.claude/skills/`) | User (`~/.agents/skills/`) |
| **Medium** | User (`~/.agents/skills/`) | Official built-in (15+) | Project (`.claude/skills/`) | Admin (`/etc/codex/skills/`) |
| **Low** | System bundled (52) | — | Plugin-bundled | System built-in |

### 2.3 Key Capabilities

| Capability | Nexu | Coze/OpenClaw | Claude Code | Codex |
|---|---|---|---|---|
| **Hot-reload** | Yes (file watcher, 250ms debounce) | Yes (service restart for config, live for workflow) | Yes (re-read on invocation) | No |
| **Allowlist model** | Explicit per-agent | Explicit per-bot | Implicit (all in scope visible) | Implicit (all in scope visible) |
| **Multi-agent** | Per-bot skill isolation | Per-bot tool assignment | Agent teams + subagents | Subagents (max 6 threads) |
| **Lifecycle hooks** | Install/uninstall callbacks | DDD domain events | 17 event types (Pre/PostToolUse, etc.) | Approval policies only |
| **CLI management** | No CLI | `clawhub` CLI | `claude mcp add/remove` | `codex mcp` |
| **Visual editor** | No (UI shows catalog only) | Coze IDE (web-based code editor) | No | No |
| **Version tracking** | Timestamp only | Semantic versioning required | None | None |
| **Health checks** | No | Backend validation on register | No | No |

---

## 3. Deep Dive

### 3.1 Nexu SkillHub (Current)

**Architecture:**
```
User → Web UI → Controller API → SkillhubService
                                    ├── CatalogManager (downloads from ClawHub)
                                    ├── InstallQueue (FIFO, max 2 concurrent)
                                    ├── SkillDb (LowDB JSON ledger)
                                    ├── SkillDirWatcher (chokidar, 3 directories)
                                    └── WorkspaceSkillScanner (per-agent scan)
                                         ↓
                                  OpenClawSyncService
                                    ├── compileOpenClawConfig() → openclaw.json
                                    └── OpenClaw runtime (hot-reload)
```

**Skill sources:**
- **Managed** — downloaded from SkillHub (Tencent COS-backed npm registry), 12,891 community skills
- **Custom** — user zip upload, extracted to shared dir
- **Workspace** — agent-installed via `clawhub install`, per-agent isolation
- **Static** — 9 skills bundled in app package for offline availability
- **Curated** — 23 skills auto-installed on first launch

**Current pain points:**
- No CLI for skill management (UI-only)
- No version tracking or update detection
- No credential management UI (Phase 2 deferred)
- 52 system bundled skills invisible in UI
- Personal skills (`~/.agents/skills/`) not tracked in UI
- No SKILL.md editor or validation
- No dependency verification (`requires.plugins` not checked)

### 3.2 Coze/OpenClaw (Latest Refactor)

**Architecture:**
```
User → Coze Studio UI → Backend (Go/Hertz/GORM)
                           ├── Plugin Domain (DDD)
                           │   ├── RegisterPluginMeta + validation
                           │   ├── CheckAndLockPluginEdit (concurrent safety)
                           │   └── AES-encrypted credential storage
                           ├── Workflow Engine (Eino, Go-based)
                           │   ├── Graph / Chain / Workflow modes
                           │   └── Type-checked node connections
                           └── MCP Bridge (cloud ↔ self-hosted)
                               └── Access token → SaaS plugin ecosystem
```

**Plugin definition model:**
Each plugin is a container of **tools**, where each tool maps to one HTTP API endpoint defined by an OpenAPI 3.0 spec. This is fundamentally different from the SKILL.md approach — it's API-spec-driven rather than natural-language-driven.

**Five creation methods:**
1. Import existing API (provide URL or OpenAPI spec)
2. Import JSON/YAML definition file
3. Code parser (auto-generate from code)
4. Coze IDE (web-based Python/Node.js, cloud-executed)
5. Add tools to existing plugins

**Three auth types:** None, Service HTTP (API key), OAuth 2.0 (authorization code grant)

**Key innovation: MCP Bridge.** Self-hosted Coze Studio can access the commercial SaaS plugin marketplace via a single access token. This means:
- Self-hosted gets the full cloud plugin catalog
- Usage billed to the token owner
- MCP protocol unifies the two ecosystems

**Key innovation: Credential isolation.** OAuth tokens AES-encrypted before DB storage. Frontend can check authorization status (`GetOAuthStatus`) without ever seeing the token. Sensitive credentials never leave the backend.

### 3.3 Claude Code

**Architecture:**
```
User → CLI / IDE Extension → Claude Code Runtime
                                ├── Skills (.claude/skills/, ~/.claude/skills/)
                                │   └── SKILL.md → injected into conversation context
                                ├── Hooks (17 lifecycle events)
                                │   └── Shell / HTTP / Prompt / Agent handlers
                                ├── MCP Servers (stdio/HTTP/SSE)
                                │   └── External tool integration
                                ├── Subagents (.claude/agents/)
                                │   └── Isolated context + tool restrictions
                                └── Plugins (.claude-plugin/)
                                    └── Bundle: skills + agents + hooks + MCP
```

**Extensibility layers (composable):**
1. **Skills** — structured prompts injected into context, invoked by `/name` or auto-matched
2. **Hooks** — programmable middleware for 17 lifecycle events (can block, modify, inject context)
3. **MCP** — standard protocol for external tool integration
4. **Subagents** — isolated execution contexts with custom tools, model, memory
5. **Plugins** — packaging format bundling all of the above
6. **Agent Teams** — multi-session coordination (Feb 2026)

**Unique features:**
- Dynamic context injection: `` !`command` `` in SKILL.md runs shell at load time
- Subagent-scoped MCP: inline MCP server definitions in agent frontmatter
- Agent memory: persistent across sessions (`user`/`project`/`local` scope)
- Plugin security: plugin agents can't set `hooks`, `mcpServers`, or `permissionMode`

**Configuration complexity:**
- MCP servers require manual JSON editing in `~/.claude/settings.json`
- No encrypted credential store — API keys in plaintext JSON
- No health checks for MCP servers (crash silently)
- No built-in catalog or marketplace

### 3.4 Codex CLI

**Architecture:**
```
User → Full-screen TUI → Agent Loop (Rust)
                            ├── Skills (.agents/skills/)
                            │   └── SKILL.md → injected into conversation
                            ├── MCP Servers (stdio/HTTP, in config.toml)
                            ├── Sandbox (kernel-level)
                            │   ├── macOS: Seatbelt
                            │   ├── Linux: bubblewrap
                            │   └── Windows: Native Sandbox
                            └── App Server (JSON-RPC over JSONL)
                                └── Unified protocol for CLI/VS Code/Web
```

**Unique features:**
- Kernel-level sandboxing — strongest security boundary of any platform
- `codex mcp-server` — exposes Codex itself as an MCP server for orchestration
- `codex --cloud` — fire-and-forget cloud execution, zero local setup
- Named TOML profiles (`--profile`) for switching configs
- `AGENTS.md` is cross-tool (works with Cursor, Windsurf, etc.)
- Auto-filters env vars matching `SECRET`/`TOKEN` patterns

**Configuration approach:**
- TOML-based config (`config.toml`) — more readable than JSON
- `AGENTS.md` as cross-tool instruction file
- MCP configured in TOML with `enabled_tools`/`disabled_tools` filtering

---

## 4. UX Journey Comparison

### "I want the GitHub integration skill"

| Step | Nexu | Coze/OpenClaw | Claude Code | Codex |
|---|---|---|---|---|
| **1. Discover** | Skills → Explore → search "github" | Plugin Store → search | Google/GitHub search for MCP server | Check `github.com/openai/skills` |
| **2. Install** | Click "Install" button | Click "Add to Bot" | `claude mcp add github -- npx @github/mcp` + edit JSON | Copy to `.agents/skills/` |
| **3. Configure credentials** | Not implemented yet (Phase 2) | OAuth flow in UI → backend encrypts | Manually add `GITHUB_TOKEN` to JSON env | Set `GITHUB_TOKEN` env var |
| **4. Verify** | Appears in "Yours" tab | Test in Debug mode | Hope it works, check `/mcp` | Ask agent to use it |
| **5. Use** | Ask agent | Ask agent or wire into workflow | Ask agent or `/github` | Ask agent or `$github` |
| **Total steps** | **2** (no credentials yet) | **3** (with OAuth) | **5-7** (with JSON editing) | **3-4** (manual) |
| **Time to working** | ~5 seconds | ~30 seconds | ~5-10 minutes | ~2-5 minutes |

### "I want a custom skill that calls my internal API"

| Step | Nexu | Coze/OpenClaw | Claude Code | Codex |
|---|---|---|---|---|
| **1. Create** | Write SKILL.md + zip + Import | Choose creation method (5 options) → Coze IDE or OpenAPI import | Write SKILL.md in `~/.claude/skills/` | Write SKILL.md in `~/.agents/skills/` |
| **2. Define API** | Document in SKILL.md (natural language) | OpenAPI 3.0 spec (structured) | Document in SKILL.md (natural language) | Document in SKILL.md (natural language) |
| **3. Auth** | Document env var in SKILL.md | Configure in plugin auth config (3 types) | Document env var in SKILL.md | Document env var in SKILL.md |
| **4. Test** | No built-in test | Coze IDE debugger (call tool, inspect I/O) | Trial and error | Trial and error |
| **5. Share** | No built-in sharing | Publish to Store | Copy dir or share via git | Copy dir or share via git |
| **Total friction** | Medium | **Low** (structured creation, built-in testing) | Medium-High | Medium |

---

## 5. Credential & Configuration Complexity

### The Configuration Burden Spectrum

```
Most burden ─────────────────────────────────────── Least burden

Claude Code     Codex       Nexu         Coze/OpenClaw    (Ideal)
MCP JSON +      env vars    Phase 2      OAuth flow +     One-click
plaintext       + TOML      deferred     AES encryption   OAuth +
API keys                                                  cloud proxy
```

### What Makes a Skill "Unattractive"

Based on the research, skills lose user adoption when they require:

| Configuration Step | Drop-off Impact | Examples |
|---|---|---|
| Get an API key from a 3rd party | **HIGH** — 60%+ users abandon | OpenAI, Anthropic, Cloudflare API keys |
| Edit config files manually | **HIGH** — especially non-developers | Claude Code MCP JSON, Codex TOML |
| Set environment variables | **MEDIUM** — varies by OS familiarity | `export GITHUB_TOKEN=...` |
| OAuth login flow (browser redirect) | **LOW** — familiar UX pattern | GitHub OAuth, Google OAuth |
| No configuration needed | **NONE** — maximum adoption | Built-in skills, pre-authenticated services |

### Current Credential Approaches

| Platform | Storage | Encryption | Frontend Exposure | OAuth Support | Multi-service |
|---|---|---|---|---|---|
| **Nexu** | Env vars + secrets API | Shared `SKILL_API_TOKEN` | Token accessible to model | No | Per-skill scoping via API |
| **Coze/OpenClaw** | PostgreSQL | AES (per-token) | Never exposed | Yes (Authorization Code) | Per-plugin auth config |
| **Claude Code** | JSON config file | None (plaintext) | N/A (local CLI) | No (manual token) | Per-MCP-server env |
| **Codex** | Env vars | None | Auto-filtered (`SECRET`/`TOKEN` patterns) | Via `codex mcp login` | Per-MCP-server env |

---

## 6. Lifecycle Management Comparison

### Lifecycle Stage Coverage

| Stage | Nexu | Coze/OpenClaw | Claude Code | Codex |
|---|---|---|---|---|
| **Create** | SKILL.md + zip import | 5 creation methods + Coze IDE | Write SKILL.md file | Write SKILL.md file |
| **Discover** | Built-in catalog (12,891) | Plugin Store (cloud) | No catalog (search GitHub) | No catalog (GitHub repo) |
| **Install** | One-click UI + queue | One-click UI or API | Manual setup (CLI + JSON) | Manual file copy |
| **Configure** | Deferred (Phase 2) | In-UI auth config | Manual JSON editing | Manual env vars |
| **Validate** | No pre-flight check | Backend validation on register | No validation | No validation |
| **Health check** | No | Concurrent edit locking | No | No |
| **Update** | No detection | Version field, deprecation flags | No detection | No detection |
| **Uninstall** | UI button (partial) | UI button + DB cleanup | Manual file deletion | Manual file deletion |
| **Share** | No mechanism | Publish to Store | Git/copy | Git/copy |
| **Version** | Timestamp only | Semantic (`vX.X.X`) required | None | None |
| **Dependency check** | No (`requires.plugins` ignored) | Plugin-tool structure validates | No | No |

### Lifecycle Maturity Score

| Platform | Create | Discover | Install | Configure | Monitor | Update | Score |
|---|---|---|---|---|---|---|---|
| **Coze/OpenClaw** | 5/5 | 4/5 | 5/5 | 4/5 | 3/5 | 3/5 | **24/30** |
| **Nexu** | 3/5 | 4/5 | 4/5 | 1/5 | 1/5 | 1/5 | **14/30** |
| **Claude Code** | 3/5 | 1/5 | 2/5 | 2/5 | 1/5 | 1/5 | **10/30** |
| **Codex** | 3/5 | 1/5 | 2/5 | 2/5 | 1/5 | 1/5 | **10/30** |

---

## 7. Interactivity & Discovery Patterns

### Discovery Models

| Model | Platform | UX Quality |
|---|---|---|
| **Built-in searchable catalog** | Nexu (12,891 skills), Coze (Store) | Best — users browse and install without leaving the app |
| **Official curated list** | Claude Code (docs page) | Decent — but requires leaving the tool |
| **GitHub repo** | Codex (`openai/skills`) | Developer-friendly, not user-friendly |
| **Community awesome-lists** | All platforms | Unreliable, outdated |
| **No discovery** | Claude Code (MCP), Codex (MCP) | Worst — users must know what exists |

### Interactive Skill Configuration

| Pattern | Platform | Description |
|---|---|---|
| **Visual parameter editor** | Coze IDE | Web-based code editor + parameter schema UI + debugger |
| **Chat-based testing** | Coze Debug | Trigger tools manually, inspect I/O in chat |
| **Queue status** | Nexu | Real-time install progress (queued → downloading → done) |
| **Slash command** | Claude Code | `/mcp` for status, `/skills` for management |
| **Health dashboard** | None | No platform shows skill health status |

### Manual Editing Accessibility

| Platform | Can users find and edit skill files? | How? |
|---|---|---|
| **Nexu** | Partially — files on disk but no path shown in UI | Must know `~/.openclaw/skills/<slug>/SKILL.md` |
| **Coze** | Yes — Coze IDE provides a web editor | Direct editing in browser IDE |
| **Claude Code** | Yes — files in well-known paths | `~/.claude/skills/` or `.claude/skills/` |
| **Codex** | Yes — files in well-known paths | `~/.agents/skills/` or `.agents/skills/` |

---

## 8. Plugin Encapsulation: How Skills Become Efficient Agent Tools

This section explores how Claude Code and Codex package skills into plugins for more accurate invocation, friendlier interaction, and better result delivery.

### 8.1 Claude Code Plugin Architecture

#### The Plugin Manifest (`plugin.json`)

Every Claude Code plugin requires `.claude-plugin/plugin.json`:

```json
{
  "name": "enterprise-devops",
  "version": "2.3.1",
  "description": "Brief explanation (50-200 chars)",
  "author": { "name": "Name", "email": "...", "url": "..." },
  "commands": ["./commands", "./admin-commands"],
  "agents": "./specialized-agents",
  "hooks": "./config/hooks.json",
  "mcpServers": {
    "github": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/servers/github-mcp.js"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

#### Plugin Directory Layout

```
my-plugin/
  .claude-plugin/
    plugin.json              # Manifest (required)
    marketplace.json         # Distribution metadata
  commands/                  # Slash commands (auto-discovered)
    feature-dev.md           # becomes /feature-dev
  agents/                    # Subagent definitions (auto-discovered)
    code-explorer.md
    code-reviewer.md
  skills/                    # Skills (auto-discovered)
    my-skill/
      SKILL.md
      references/            # Loaded on demand
      scripts/               # Executable utilities
  hooks/
    hooks.json               # Lifecycle handlers
  .mcp.json                  # MCP server definitions
```

**Plugins vs standalone skills:** A plugin is a **composition unit** bundling skills + agents + hooks + MCP servers. A standalone skill is just a directory with SKILL.md. Plugins get tracked in `~/.claude/plugins/installed_plugins.json` with version, install path, scope, and timestamps.

#### Three-Level Progressive Disclosure (Accuracy Mechanism)

This is the key architectural pattern that makes skills efficient:

1. **Level 1 — Metadata (always in context, ~100 words per skill):** Only `name` and `description` from frontmatter are loaded into every conversation's system prompt. This is the listing in `<system-reminder>` messages.

2. **Level 2 — SKILL.md body (on trigger):** When description matches the task, Claude invokes the Skill tool to load the full content. Body stays under 5,000 words.

3. **Level 3 — Bundled resources (on demand):** `references/`, `scripts/`, `examples/` loaded only when Claude determines they're needed.

**Why this matters:** Without progressive disclosure, 100 skills × 2,000 words = 200K tokens consumed before the user says anything. With it, the base cost is 100 skills × 100 words = 10K tokens. The 20x reduction enables large skill catalogs without context exhaustion.

#### Description Field — The Critical Accuracy Lever

The description is the **sole signal** for auto-invocation. Official guidance (from the `writing-skills` skill):

```yaml
# BAD: Summarizes workflow — model follows description as shortcut instead of reading skill
description: Use when executing plans - dispatches subagent per task with code review

# GOOD: Just triggering conditions, no workflow summary
description: Use when executing implementation plans with independent tasks in the current session
```

**Rule: Description = WHEN to use, NOT WHAT the skill does.** Including workflow steps in the description causes the model to skip reading the full SKILL.md.

#### Invocation Control Fields

| Field | User invoke | Claude invoke | Use case |
|---|---|---|---|
| (default) | Yes | Yes | General-purpose skills |
| `disable-model-invocation: true` | Yes | No | Dangerous side effects (deploy, delete) |
| `user-invocable: false` | No | Yes | Background knowledge (conventions) |
| `paths: ["**/*.ts"]` | Scoped | Scoped | Only activate for matching file patterns |
| `context: fork` | Isolated | Isolated | Run in separate subagent context |

#### Composition Patterns from Official Plugins

**`feature-dev`** — 1 command orchestrating 3 specialized agents:
```
Phase 2: Dispatch 2-3 code-explorer agents (Sonnet, parallel) → file analysis
Phase 4: Dispatch 2-3 code-architect agents (Sonnet, parallel) → architecture proposals
Phase 6: Dispatch 3 code-reviewer agents (Sonnet, parallel) → quality review
```

**`code-review`** — Confidence-based filtering pipeline:
```
Step 1: 5 parallel Sonnet agents → different review aspects
Step 2: Parallel Haiku agents → confidence score (0-100) per issue
Step 3: Filter to issues >= 80 confidence only
```

**Why composition improves accuracy:**
1. **Multi-perspective analysis** — multiple agents examining from different angles
2. **Confidence scoring** — quantitative filtering eliminates false positives
3. **Model tiering** — Haiku for fast triage, Sonnet for deep analysis
4. **Role separation** — each agent has focused responsibility + restricted tools
5. **Context protection** — subagents don't consume the parent's context window

#### Result Delivery

Skills don't have a structured output protocol. The skill author controls result format through markdown instructions:

```markdown
### Code review

Found 3 issues:

1. <brief description> (CLAUDE.md says "<rule>")
   <link to file:line with full sha1>
```

Subagent results surface as text returned to the parent conversation. The parent synthesizes, filters, and presents.

#### Plugin Marketplace

Marketplaces are GitHub repos registered in `~/.claude/plugins/known_marketplaces.json`:
```json
{
  "claude-plugins-official": {
    "source": { "source": "github", "repo": "anthropics/claude-plugins-official" }
  }
}
```

Plugins enabled/disabled in `~/.claude/settings.json`:
```json
{
  "enabledPlugins": {
    "feature-dev@claude-plugins-official": true,
    "superpowers@superpowers-marketplace": true
  }
}
```

### 8.2 Codex Plugin Architecture

#### Skill Structure

```
skill-name/
  SKILL.md              # Required (frontmatter + instructions)
  agents/
    openai.yaml         # UI/harness metadata (not read by model)
  scripts/              # Executable code
  references/           # Context-loaded docs
  assets/               # Icons, templates
```

#### `agents/openai.yaml` — The Harness Metadata Layer

```yaml
interface:
  display_name: "Human-facing title"
  short_description: "25-64 char UI blurb"
  icon_small: "./assets/small-400px.png"
  brand_color: "#3B82F6"
  default_prompt: "Use $skill-name to do X."

dependencies:
  tools:
    - type: "mcp"
      value: "github"
      description: "GitHub MCP server"
      transport: "streamable_http"
      url: "https://api.githubcopilot.com/mcp/"

policy:
  allow_implicit_invocation: true
```

**Key insight:** `openai.yaml` is for the TUI/app harness (display, deps, policy). SKILL.md frontmatter is for the model. This separation keeps model context clean while providing rich UI metadata.

#### Codex Plugin System (`.codex-plugin/plugin.json`)

Similar to Claude Code, Codex has a full plugin system:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "skills": "./skills",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json",
  "apps": "./.app.json",
  "interface": {
    "displayName": "My Plugin",
    "defaultPrompt": ["Prompt 1", "Prompt 2"],
    "capabilities": ["code-review", "deployment"]
  }
}
```

#### Invocation Patterns

**Explicit:** `$skill-name` (dollar sigil). Resolved only when the name is unambiguous — exactly one enabled skill matches AND no MCP connector has the same slug. Common env vars (`$PATH`, `$HOME`) are excluded from matching.

**Implicit (model-driven):** The system prompt tells the model:
> "If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches a skill's description, you must use that skill for that turn."

**Implicit (script detection):** When the model runs `python3 .codex/skills/babysit-pr/scripts/gh_pr_watch.py`, the system detects this is a skill script and associates the execution with that skill automatically.

**Priority:** Explicit structured (UI picker) > Linked mentions `[$name](path)` > Plain `$name` > Description matching. Higher scopes (repo > user > system > admin) sort first.

#### Codex as MCP Server — The Orchestration Play

`codex mcp-server` exposes two tools:

```json
{
  "name": "codex",
  "inputSchema": {
    "properties": {
      "prompt": { "type": "string" },
      "model": { "type": "string" },
      "sandbox": { "enum": ["read-only", "workspace-write", "danger-full-access"] },
      "approval-policy": { "enum": ["untrusted", "on-request", "never"] }
    },
    "required": ["prompt"]
  },
  "outputSchema": {
    "properties": {
      "threadId": { "type": "string" },
      "content": { "type": "string" }
    }
  }
}

{
  "name": "codex-reply",
  "inputSchema": {
    "properties": {
      "threadId": { "type": "string" },
      "prompt": { "type": "string" }
    }
  }
}
```

This enables OpenAI Agents SDK orchestrators to use Codex sessions as tools — start, continue, and manage multiple concurrent agent sessions. Each session runs with its own sandbox, config, and working directory.

#### The Skill-Creator Meta-Skill Quality Principles

1. **"Concise is Key"** — Context window is a public good. Only add context the model doesn't already have.
2. **"Degrees of Freedom"** — Match specificity to fragility: narrow bridge needs guardrails (scripts), open field allows many routes (text instructions).
3. **"Forward-testing"** — Launch subagents to stress-test skills. The subagent should not know it's testing — it just performs a task.

### 8.3 Comparison: Plugin Encapsulation Patterns

| Dimension | Claude Code | Codex | Nexu (Current) |
|---|---|---|---|
| **Progressive disclosure** | 3 levels (metadata → body → resources) | 3 levels (same pattern) | 1 level (all or nothing) |
| **Description discipline** | "When to use" only, never summarize workflow | Same principle | No guidance |
| **Invocation control** | 4 fields (disable-model, user-invocable, paths, context) | 3 fields (policy.allow_implicit, $sigil, script detection) | Allowlist only |
| **Multi-agent composition** | Parallel subagents with confidence scoring | Subagents (max 6 threads) | None |
| **Result formatting** | Skill-authored markdown templates | Skill-authored | Freeform |
| **Context protection** | `context: fork` isolates in subagent | Subagent spawning | None |
| **Harness/UI metadata** | In plugin.json | Separate `openai.yaml` | In SKILL.md frontmatter |
| **Dependency declaration** | MCP in plugin.json | `dependencies.tools` in openai.yaml | `requires.plugins` (unchecked) |
| **Self-as-server** | No | Yes (`codex mcp-server`) | No |

### 8.4 Key Lessons for Nexu

1. **Adopt progressive disclosure:** Currently Nexu loads all skill content at once. Implement 3-level loading: frontmatter summary → SKILL.md body → references/scripts.

2. **Description discipline:** Publish guidelines for SKILL.md descriptions — "WHEN to use" triggers only, never workflow summaries. This directly improves auto-invocation accuracy.

3. **Separate harness metadata from model context:** Follow Codex's `openai.yaml` pattern — UI display info, icons, dependency declarations should NOT consume model context tokens.

4. **Multi-agent composition layer:** The `feature-dev` pattern (parallel exploration → architecture → review) with confidence-based filtering is the strongest accuracy pattern observed. Nexu should enable skill authors to define multi-step agent pipelines.

5. **Dependency auto-resolution:** Both platforms declare MCP/tool dependencies. Nexu should auto-check `requires.plugins` at install time and warn/block if dependencies are missing.

6. **Forward-testing for quality:** Codex's "launch a subagent that doesn't know it's testing" pattern is a practical quality assurance mechanism for skill authors.

---

## 9. Marketplace Architecture: How Products Ensure Stable Installation

This section examines how LobeHub, Smithery, MCPB, Dify, and others ensure plugins install smoothly and reliably.

### 9.1 LobeHub — The Zero-Install Gateway Proxy

**Core insight:** LobeHub plugins have **zero installation**. No download, no npm install, no file extraction.

#### Architecture

```
User → LobeChat UI → LLM invokes tool → Gateway (Vercel Edge) → Plugin API endpoint
                                              │
                                    ┌─────────┼──────────┐
                                    ▼         ▼          ▼
                              Fetch index  Fetch     Validate
                              from GitHub  manifest   & proxy
                              repo JSON    from URL   request
```

#### Registry: Static JSON Index

The plugin registry (`lobehub/lobe-chat-plugins`) is a GitHub repo containing per-plugin JSON files. A build step generates `index.json` served at `https://chat-plugins.lobehub.com`:

```json
{
  "identifier": "realtime-weather",
  "manifest": "https://realtime-weather.chat-plugin.lobehub.com/manifest.json",
  "meta": {
    "avatar": "...",
    "tags": ["weather", "realtime"],
    "title": "Realtime Weather",
    "description": "Get realtime weather information"
  }
}
```

**Key indirection:** The registry entry points to an external `manifest` URL hosted by the plugin author.

#### Plugin Manifest Format

The manifest (fetched at runtime, Zod-validated) declares the plugin's API:

```typescript
pluginManifestSchema = z.object({
  api: z.array(z.object({
    description: z.string(),
    name: z.string(),
    parameters: JSONSchema,         // Function call params
    url: z.string().url().optional(),
  })),
  identifier: z.string(),
  settings: JSONSchema.optional(),  // Credential/config schema
  openapi: z.string().optional(),   // Alternative: OpenAPI spec URL
  ui: z.object({                    // Optional: iframe UI
    url, height, width,
    mode: z.enum(['iframe', 'module'])
  }).optional(),
});
```

#### Gateway Proxy Pipeline

When the LLM invokes a plugin tool, the gateway (Vercel Edge Function) executes:

1. **Validate** request payload (Zod `pluginRequestPayloadSchema`)
2. **Fetch** market index from `https://chat-plugins.lobehub.com`
3. **Find** plugin metadata by `identifier`
4. **Fetch** the plugin's manifest from external URL
5. **Validate** manifest against schema
6. **Validate** settings — if manifest declares `settings` JSON Schema, check user config
7. **Validate** function arguments against API's `parameters` schema
8. **Route**:
   - If manifest has `openapi`: use SwaggerClient, inject auth from settings
   - Otherwise: POST to API `url`, inject settings as `X-Lobe-Plugin-Settings` headers

#### Credential Handling

Each plugin declares what credentials it needs via `settings` JSON Schema in the manifest. Users fill these in the LobeChat UI. At call time, settings are passed as HTTP headers through the gateway — **never stored on a central server**.

#### Why Zero-Install Works

| Benefit | Mechanism |
|---|---|
| **Nothing to break** | No local code, no npm install, no binary compatibility |
| **Always latest version** | Manifest fetched fresh each call |
| **No cleanup needed** | No files to uninstall |
| **Cross-platform** | No OS-specific concerns |
| **Tradeoff** | Added latency (manifest fetch), requires network |

### 9.2 MCPB — Anthropic's Vendored ZIP Bundle

**Core insight:** Pre-bundle everything into a ZIP so nothing needs to be resolved at install time.

#### Bundle Format

`.mcpb` files are ZIP archives (like `.crx` Chrome extensions):

```
my-extension.mcpb (ZIP)
├── manifest.json          # Metadata + config schema
├── server/index.js        # MCP server code
├── node_modules/          # Dependencies (pre-installed!)
├── icon.png
└── package.json
```

#### Manifest Schema (v0.3)

```json
{
  "manifest_version": "0.3",
  "name": "my-extension",
  "version": "1.0.0",
  "server": {
    "type": "node",
    "entry_point": "server/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/index.js"],
      "env": { "API_KEY": "${user_config.api_key}" }
    }
  },
  "user_config": {
    "api_key": {
      "type": "string",
      "title": "API Key",
      "sensitive": true,
      "required": true
    }
  },
  "compatibility": {
    "platforms": ["darwin", "win32", "linux"],
    "runtimes": { "node": ">=16.0.0" }
  }
}
```

#### Key Design Decisions

- **Dependencies pre-bundled:** `npm install --production` runs before packing, `node_modules/` included in ZIP. No runtime dependency resolution.
- **`user_config` with `sensitive: true`:** Prompts user for credentials at install time. Injected via `${user_config.api_key}` env var substitution.
- **Platform compatibility declared:** `compatibility.platforms` prevents installation on unsupported OS.
- **`${__dirname}` resolution:** Resolved at runtime to the bundle's install directory.

#### Why Vendored Bundles Work for Desktop

| Benefit | Mechanism |
|---|---|
| **Deterministic** | All deps pre-resolved, same on every machine |
| **Offline-capable** | No network needed at install time |
| **No npm/pip issues** | No `node-gyp`, no Python version conflicts |
| **One-click install** | User opens .mcpb → dialog → done |
| **Tradeoff** | Larger download, can't share deps across plugins |

### 9.3 Dify — Permission-Bounded Plugin Isolation

**Core insight:** Declare resource limits and permissions upfront, enforce at runtime.

#### Manifest with Resource Constraints

```yaml
resource:
  memory: 268435456        # 256MB memory limit
  permission:
    tool: { enabled: true }
    endpoint: { enabled: true }
    storage: { enabled: true, size: 1048576 }  # 1MB storage cap
meta:
  arch: [amd64, arm64]
  runner:
    language: python
    version: "3.12"
    entrypoint: main
```

#### Four Runtime Modes

| Runtime | Mechanism | Stability Pattern |
|---|---|---|
| **Local** | Subprocess managed by parent | Resource limits enforced by parent process |
| **SaaS** | AWS Lambda serverless | Auto-scaling, cold start isolation |
| **Enterprise** | Controlled private runtime | Admin-managed, isolated network |
| **Debug** | TCP + Redis state | Development only |

#### Security: Signatures over Sandboxing

Dify explicitly **rejects kernel-level sandboxing** in favor of **cryptographic signatures**. Approved plugins get private-key signatures marking them "certified." Unsigned plugins display "unsafe" warnings. This is a trust-based model rather than a containment model.

### 9.4 Smithery — Hosted MCP with HTTP Transport

**Core insight:** Move MCP servers from local STDIO processes to hosted HTTP endpoints.

#### Two Deployment Models

| Model | Flow | Stability |
|---|---|---|
| **Local** | CLI installs + runs MCP server as local process | User manages process lifecycle |
| **Hosted** | Smithery runs the MCP server, user connects via HTTP | Zero local management, Smithery handles uptime |

#### CLI Commands

```bash
smithery mcp search [term]    # Search 7,300+ tools
smithery mcp add <url>        # Add connection
smithery mcp deploy           # Deploy to hosted platform
```

#### The STDIO → HTTP Migration

Smithery deprecated STDIO transport (September 2025) for **20x concurrency improvement**. This is a significant industry signal: hosted MCP servers as HTTP endpoints eliminate:
- Local process management headaches
- Platform-specific binary compatibility
- Process crash recovery
- Port conflict resolution

### 9.5 n8n Community Nodes — npm with Provenance

**Core insight:** Leverage existing npm infrastructure with additional verification.

#### Installation

- **GUI:** In-app search of npm registry → one-click install
- **CLI:** `npm install n8n-nodes-<name>` in the n8n user directory
- **Naming convention:** Packages must be `n8n-nodes-<name>` or `@scope/n8n-nodes-<name>`

#### Verification (May 2026)

Verified nodes must be published using **GitHub Actions with provenance attestations** — no local machine publishing allowed. This is a supply-chain security measure that prevents compromised developer machines from publishing malicious updates.

#### Scale: 2,000+ community nodes, 8M+ downloads

### 9.6 Cline — AI-Driven Installation

**Core insight:** Let the AI read the README and figure out installation.

When a user clicks "install" in Cline, the AI agent reads the MCP server's `README.md` or `llms-install.md` and **autonomously handles cloning, setup, and configuration**.

**Tradeoff:** Clever but fragile for production. README formats vary wildly, and the AI can misinterpret setup steps.

### 9.7 Cross-Product Stability Comparison

| Product | Install Model | Failure Surface | Offline | Credential UX | Verdict |
|---|---|---|---|---|---|
| **LobeHub** | Zero-install (gateway proxy) | Near-zero (no local code) | No | Settings JSON Schema in UI | Best stability, requires network |
| **MCPB** | Vendored ZIP bundle | Near-zero (deps pre-bundled) | Yes | `user_config` prompt at install | Best for desktop apps |
| **Dify** | Subprocess with declared resources | Low (permission boundaries) | Partial | Platform UI | Good for server environments |
| **Smithery** | Hosted HTTP or local CLI | Low (hosted) / Medium (local) | No | Managed OAuth | Best for cloud MCP |
| **n8n** | npm install | Medium (dep resolution) | No | Built-in encrypted credential store | Mature, npm-dependent |
| **Cline** | AI reads README | High (unpredictable) | No | Manual | Creative but unreliable |
| **Nexu** | ClawHub npm + queue | Medium (npm dep resolution) | Partial (static bundle) | Deferred (Phase 2) | Good base, needs work |

### 9.8 Key Lessons for Nexu

#### Pattern 1: The Gateway Proxy (LobeHub)

**Applicability to Nexu: HIGH** — for the cloud service pillar.

Instead of downloading skill code to the user's machine, proxy API calls through a cloud gateway. Benefits:
- Zero installation failure
- Credentials stay server-side
- Always-latest version
- Cross-platform by default

**Nexu application:** For API-based skills (GitHub, Slack, weather, etc.), the unified cloud service acts as a gateway proxy. The skill's `SKILL.md` lives on disk for agent instructions, but actual API calls route through `cloud.nexu.dev/api/proxy/{service}`.

#### Pattern 2: Vendored Bundles (MCPB)

**Applicability to Nexu: HIGH** — for the desktop-first architecture.

Pre-bundle dependencies into the skill package so nothing needs `npm install` at runtime. Benefits:
- Deterministic installation
- Works offline
- No node-gyp / Python version issues

**Nexu application:** Extend the existing static skill bundling to include `node_modules/` in the package. The 9 static skills already use a copy-on-startup pattern — extend this to vendor dependencies.

#### Pattern 3: Resource Declarations (Dify)

**Applicability to Nexu: MEDIUM** — for resource-constrained desktop.

Declare memory limits, storage caps, and permission boundaries in skill metadata. Benefits:
- Prevents a runaway skill from consuming all system resources
- Makes resource requirements visible before install
- Enables informed installation decisions

**Nexu application:** Add optional `resource` section to SKILL.md frontmatter:
```yaml
resource:
  memory: 256MB
  storage: 10MB
  permissions:
    network: true
    filesystem: read-only
```

#### Pattern 4: Progressive Disclosure (Claude Code + Codex)

**Applicability to Nexu: VERY HIGH** — fundamental accuracy improvement.

Only load skill metadata into context by default. Load full instructions only when triggered. Benefits:
- 20x reduction in base context consumption
- Enables large catalogs without context exhaustion
- Improves invocation accuracy (model sees clean trigger descriptions)

**Nexu application:** Change OpenClaw config compilation to emit skill summaries (name + description) rather than full SKILL.md content. Load full content on-demand when the agent selects a skill.

#### Pattern 5: Credential Prompt at Install (MCPB)

**Applicability to Nexu: HIGH** — solves the Phase 2 credential gap.

The `user_config` with `sensitive: true` pattern prompts users for credentials during installation, validates them, and stores encrypted. Benefits:
- Credentials collected once, at the right moment
- Validation catches typos immediately
- Encrypted storage with env var injection at runtime

**Nexu application:** Add `user_config` to SKILL.md frontmatter:
```yaml
user_config:
  api_key:
    type: string
    title: "API Key"
    sensitive: true
    required: true
    validation_url: "https://api.example.com/verify"
```

The SkillHub UI shows a config form during install. Credentials stored encrypted in the skill ledger and injected as env vars when OpenClaw runs.

---

## 10. Gap Analysis: Where Nexu Stands Today

### Strengths (Keep)

| Strength | Detail |
|---|---|
| **Built-in catalog** | 12,891 searchable skills — larger than any competitor's built-in discovery |
| **Install queue** | FIFO with rate-limit handling, max 2 concurrent — production-grade |
| **Workspace isolation** | Per-agent skill scoping — unique capability |
| **File watcher** | Real-time hot-reload of SKILL.md changes — 250ms debounce |
| **Static bundling** | 9 skills available offline — essential for desktop-first |
| **Ledger architecture** | Persistent install history, source tracking, dedup |

### Gaps (Fix)

| Gap | Impact | Competitive Benchmark |
|---|---|---|
| **No credential management** | Skills requiring API keys are unusable | Coze: AES-encrypted OAuth in backend |
| **No SKILL.md editor** | Users must find files on disk | Coze: web-based IDE editor |
| **No version tracking** | Can't detect or apply updates | Coze: semantic versioning required |
| **No dependency verification** | `requires.plugins` silently ignored | Coze: plugin-tool validation |
| **No CLI management** | Automation impossible, power users frustrated | Claude Code: `claude mcp add/remove` |
| **No health monitoring** | Broken skills fail silently | Industry-wide gap (opportunity) |
| **System skills hidden** | 52 bundled skills invisible in UI | Should at least be browsable |
| **Personal skills untracked** | `~/.agents/skills/` not in UI | Codex: auto-discovers from user dir |
| **No skill editing UI** | SKILL.md location not surfaced | Show file path + "Open in editor" |

### Strategic Gaps (Build)

| Gap | Opportunity |
|---|---|
| **No unified cloud service** | Nexu can own the credential + config layer |
| **No one-click OAuth** | Browser redirect flow for common services |
| **No skill testing** | Coze's debug-mode-in-chat pattern is excellent |
| **No sharing/publishing** | Community skill ecosystem potential |

---

## 11. Opportunity: Unified Cloud Management Service

### The Problem

Every platform today pushes credential and configuration management onto the user. This creates a paradox: **the more powerful a skill, the more setup it requires, the less people use it.**

```
Skill Power ──────────────────────── Adoption
│                                      │
│  "Search Wikipedia"  ●───────────── ●  High (no setup)
│  "Read GitHub issues" ●────────── ●    Medium (needs token)
│  "Deploy to Cloudflare" ●──── ●        Low (API key + account setup)
│  "Manage Kubernetes"  ●── ●            Very Low (kubeconfig + RBAC + ...)
```

### The Solution: Nexu Cloud Skill Service

A cloud service that sits between users and third-party APIs, managing:

```
┌─────────────────────────────────────────────────────────────┐
│                 Nexu Cloud Skill Service                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Credential   │  │ Skill        │  │ Interactive      │  │
│  │ Proxy        │  │ Registry     │  │ Config Portal    │  │
│  │              │  │              │  │                  │  │
│  │ • OAuth flows│  │ • Versioned  │  │ • OAuth connect  │  │
│  │ • API key    │  │   catalog    │  │ • API key entry  │  │
│  │   vault      │  │ • Dependency │  │ • Health status  │  │
│  │ • Token      │  │   resolution │  │ • Usage metrics  │  │
│  │   rotation   │  │ • Update     │  │ • Skill config   │  │
│  │ • Per-skill  │  │   detection  │  │   wizard         │  │
│  │   scoping    │  │ • Rating &   │  │ • Test sandbox   │  │
│  │              │  │   reviews    │  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │             │
│  ───────┴─────────────────┴────────────────────┴──────────  │
│                    Unified API Layer                         │
│         (MCP-compatible, REST, WebSocket)                    │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     Nexu Desktop   Claude Code    Other Agents
     (controller)   (MCP client)   (MCP client)
```

### Three Pillars

#### Pillar 1: Credential Proxy

**What:** A cloud service that holds user credentials and proxies API calls, so the local agent never sees tokens.

**How it works:**
1. User visits `cloud.nexu.dev/connect/github`
2. OAuth redirect flow → GitHub authorizes → token stored encrypted in cloud
3. Local skill calls `cloud.nexu.dev/api/github/repos` with a session token
4. Cloud service attaches the real GitHub token and proxies the request
5. Agent never sees the GitHub token

**Benefits:**
- Skills requiring API keys become one-click (OAuth redirect)
- Token rotation handled server-side
- Audit trail for all API calls
- Per-skill scoping (skill X can only access GitHub, not Slack)
- Revoke access per-service without touching local config

**Credential flow comparison:**

| Today (Nexu) | With Cloud Service |
|---|---|
| 1. Find API key docs for service | 1. Click "Connect to GitHub" |
| 2. Create account / generate key | 2. Authorize in browser |
| 3. Set env var or use secrets API | 3. Done |
| 4. Document in SKILL.md | |
| 5. Hope agent uses it correctly | |

#### Pillar 2: Skill Registry with Lifecycle

**What:** A cloud-hosted skill registry that tracks versions, dependencies, compatibility, and health.

**Features:**
- **Semantic versioning** — skills published with `vX.Y.Z`, users see "Update available"
- **Dependency graph** — `requires.plugins`, `requires.credentials`, `requires.services` resolved automatically
- **Compatibility matrix** — which OpenClaw version, which plugins needed
- **Health reporting** — local controller reports skill execution success/failure rates back to registry
- **Ratings & reviews** — community feedback on skill quality
- **Curated collections** — "Essential for Slack teams", "Developer productivity pack"

**Version lifecycle:**
```
Draft → Published → Deprecated → Archived
  ↑                    ↓
  └── Patch (vX.Y.Z+1) ┘
```

#### Pillar 3: Interactive Configuration Portal

**What:** A web portal where users configure skills visually instead of editing YAML/JSON.

**Features:**
- **Skill configuration wizard** — step-by-step setup with validation
- **OAuth connect buttons** — one-click for each supported service
- **API key entry with validation** — test the key before saving
- **Health dashboard** — see which skills are working, which need attention
- **SKILL.md editor** — web-based editor with preview
- **Test sandbox** — try a skill before installing (like Coze's Debug mode)
- **Usage analytics** — which skills are used most, error rates

**Configuration wizard flow:**
```
1. "Install GitHub skill" → one click
2. Portal: "This skill needs GitHub access"
   → [ Connect with OAuth ] ← one click
3. Portal: "Choose repositories to access"
   → [x] nexu  [x] openclaw  [ ] private-repo
4. Portal: "GitHub skill is ready!"
   → Skill auto-configured in local controller
```

### Why MCP-Compatible

By exposing the cloud service as an MCP server, it becomes usable by:
- **Nexu** — native integration via controller
- **Claude Code** — `claude mcp add nexu-cloud -- ...`
- **Codex** — `[mcp_servers.nexu-cloud]` in config.toml
- **Cursor, Windsurf, etc.** — any MCP-compatible agent

This makes Nexu's cloud service a **platform play**, not just a Nexu feature.

### Revenue Model Considerations

| Tier | Offering | Price |
|---|---|---|
| **Free** | 5 connected services, community skills, basic health | $0 |
| **Pro** | Unlimited services, priority support, team sharing | $X/mo |
| **Enterprise** | Self-hosted cloud service, SSO, audit logs, compliance | Custom |

---

## 12. Recommendations & Roadmap

### Phase 1: Foundation (Reduce Friction)

**Goal:** Make existing skills more accessible without a cloud service.

| Action | Effort | Impact | Reference |
|---|---|---|---|
| Show file path + "Open in Editor" for installed skills | S | High | All platforms lack this |
| Surface system bundled skills (52) as read-only in UI | S | Medium | Nexu-specific gap |
| Track personal skills (`~/.agents/skills/`) in UI | S | Medium | Codex auto-discovers these |
| Add `Open SKILL.md` button on skill detail page | S | High | Improves manual editing access |
| Add uninstall confirmation dialog | XS | Medium | Basic UX safety |
| Show skill dependencies (`requires.plugins`) in UI | S | Medium | Coze validates these |
| CLI: `nexu skill install/uninstall/list` | M | High | Claude Code has `claude mcp add` |

### Phase 2: Smart Lifecycle (Reduce Configuration)

**Goal:** Automate what users currently do manually.

| Action | Effort | Impact | Reference |
|---|---|---|---|
| Semantic version tracking + "Update available" badge | M | High | Coze requires `vX.Y.Z` |
| Dependency verification on install (check plugins available) | M | High | Coze validates on register |
| Pre-flight health check (validate SKILL.md schema) | S | Medium | Industry-wide gap |
| Skill execution health reporting (success/failure rates) | M | High | Industry-wide gap |
| In-app SKILL.md editor (Monaco-based) | L | High | Coze IDE pattern |
| OAuth2 credential flow for popular services | L | Very High | Coze pattern, biggest UX win |

### Phase 3: Cloud Service (Maximum Impact)

**Goal:** Launch the unified cloud management service.

| Action | Effort | Impact | Reference |
|---|---|---|---|
| Credential proxy MVP (GitHub, Slack, Google) | L | Very High | Novel — no competitor has this |
| MCP server interface for cross-platform access | M | High | Makes Nexu a platform |
| Interactive config portal (web-based wizard) | L | Very High | Coze's strongest UX pattern |
| Skill test sandbox (try before install) | L | High | Coze Debug mode pattern |
| Community publishing pipeline | L | Medium | Enable ecosystem growth |
| Usage analytics dashboard | M | Medium | Inform skill quality |

### Priority Matrix

```
                        High Impact
                            │
              Phase 3       │       Phase 2
           Cloud Service    │    OAuth + Versioning
          ┌─────────────────┼─────────────────────┐
          │  Credential     │  Version tracking    │
          │  proxy          │  Health checks       │
High      │  Config portal  │  Dependency verify   │
Effort    │  MCP interface  │  In-app editor       │
          │                 │                      │
          ├─────────────────┼─────────────────────┤
          │                 │  Show file paths     │
          │                 │  Surface system      │
Low       │                 │  skills              │
Effort    │                 │  CLI management      │
          │                 │  Uninstall confirm   │
          │    (skip)       │       Phase 1        │
          └─────────────────┼─────────────────────┘
                            │
                       Low Impact
```

---

## Appendix A: Platform Documentation References

| Platform | Key Sources |
|---|---|
| **Nexu** | `docs/plans/2026-03-28-skill-management-architecture.md`, `apps/controller/src/services/skillhub/` |
| **Coze/OpenClaw** | `github.com/coze-dev/coze-studio`, `docs.coze.com/guides/plugin_tools` |
| **Claude Code** | `code.claude.com/docs/en/skills`, `code.claude.com/docs/en/mcp`, `code.claude.com/docs/en/hooks` |
| **Codex** | `github.com/openai/codex`, `developers.openai.com/codex/skills` |

## Appendix B: SKILL.md Format Comparison

**Nexu / OpenClaw skill:**
```yaml
---
name: feishu-bitable
description: "Manage Feishu Bitable spreadsheets"
tag: office-collab
icon: Table2
source: official
requires:
  plugins: ["@larksuite/openclaw-lark"]
---
## Instructions for the agent...
```

**Claude Code skill:**
```yaml
---
name: code-review
description: "Review code for quality and best practices"
allowed-tools: Read, Grep, Glob
context: fork
agent: Explore
model: sonnet
---
## Instructions for the agent...
```

**Codex skill:**
```yaml
---
name: code-review
description: "Review code for quality and best practices"
---
## Instructions for the agent...
```

**Coze plugin (OpenAPI-driven, not SKILL.md):**
```yaml
plugin_id: 12345
version: "v1.0.0"
openapi_doc_file: openapi.json
manifest:
  name_for_model: "github_tool"
  name_for_human: "GitHub"
  auth:
    location: header
    key: "Authorization"
```

## Appendix C: Industry Trend Signals

1. **SKILL.md as universal standard** — 3 of 4 platforms use it, Coze moving toward MCP compatibility
2. **MCP as universal protocol** — all 4 platforms support it, becoming the TCP/IP of agent tools
3. **Cloud execution rising** — Codex `--cloud`, Replit Agent, GitHub Copilot Workspace all push to cloud
4. **Credential management is the #1 unsolved problem** — whoever solves it captures the ecosystem
5. **AGENTS.md as cross-tool standard** — Codex, Cursor, Windsurf all read it; Claude Code's `CLAUDE.md` is Anthropic-specific
