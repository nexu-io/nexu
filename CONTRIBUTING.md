# Contributing to nexu

This file is the **canonical English** contributing guide. The docs site embeds it on [docs.nexu.io — Contributing](https://docs.nexu.io/guide/contributing). **简体中文**为独立译本：[仓库内 `docs/zh/guide/contributing.md`](https://github.com/nexu-io/nexu/blob/main/docs/zh/guide/contributing.md)（[线上](https://docs.nexu.io/zh/guide/contributing)）。

Thank you for helping improve nexu. The sections below cover **code**, **documentation**, and **how we review changes**.

## Community standards

- **Code of conduct:** follow [`CODE_OF_CONDUCT.md`](https://github.com/nexu-io/nexu/blob/main/CODE_OF_CONDUCT.md) in all Issues, Discussions, and PRs.
- **Security:** do **not** open public issues for vulnerabilities. See [`SECURITY.md`](https://github.com/nexu-io/nexu/blob/main/SECURITY.md) for how to report them; implementation notes live in [`specs/SECURITY.md`](https://github.com/nexu-io/nexu/blob/main/specs/SECURITY.md).

## Ways to contribute

- **Bug reports** — reproducible steps, version/OS, logs (redact secrets).
- **Feature ideas** — open a Discussion or Issue so maintainers can align before large PRs.
- **Code** — fixes and features that match the project scope.
- **Docs** — fixes, translations, screenshots, and clarity improvements (English + Chinese when both exist).

## Before you write code

1. Search [Issues](https://github.com/nexu-io/nexu/issues) and [Discussions](https://github.com/nexu-io/nexu/discussions) for duplicates.
2. For **non-trivial** changes, open an Issue first (or comment on an existing one) to agree on direction.
3. Fork the repo and work on a **short-lived branch** off `main`.

## Development setup

### Prerequisites

- **Git**
- **Node.js** 22+ (LTS recommended; minimum in `package.json` is 20+)
- **pnpm** 10+ (repo pins `pnpm@10.26.0` via `packageManager`)

### Clone and install

From the **repository root** (not only `docs/`):

```bash
git clone https://github.com/nexu-io/nexu.git
cd nexu
pnpm install
```

`postinstall` runs scripts (including OpenClaw runtime setup). The first install can take a while.

### Repository layout (excerpt)

```text
nexu/
├── apps/
│   ├── api/
│   ├── web/
│   ├── desktop/      # Electron desktop client
│   └── controller/
├── packages/shared/
├── docs/             # VitePress documentation site
├── tests/
└── specs/
```

## Common commands

Run from the repo root unless noted.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Dev stack (controller + web) with hot reload |
| `pnpm dev:desktop` | Desktop client dev |
| `pnpm dev:controller` | Controller only |
| `pnpm build` | Production build (all packages) |
| `pnpm typecheck` | TypeScript checks across the workspace |
| `pnpm lint` | Biome check + `typecheck` (matches CI intent) |
| `pnpm lint:fix` | Auto-fix where safe + typecheck |
| `pnpm format` | Format/write with Biome |
| `pnpm test` | Root Vitest suite (`vitest run`) |
| `pnpm check:esm-imports` | ESM specifier verification (also run in CI) |

Some packages define their own scripts (for example `pnpm --filter @nexu/web test:e2e` for Playwright). Prefer the closest `package.json` to the code you change.

## Code style and formatting

- **Biome** is the source of truth for formatting and many lint rules (`biome.json`).
- **Pre-commit:** `pnpm prepare` installs `scripts/pre-commit` into `.git/hooks` when possible; it runs Biome on staged `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.json` files.
- **Alternative hook path:** `git config core.hooksPath scripts` (then use hooks under `scripts/` as documented in `scripts/pre-commit`).

Run before pushing:

```bash
pnpm lint
pnpm test
```

If you touched production build paths:

```bash
pnpm build
pnpm check:esm-imports
```

## Commits

We recommend **[Conventional Commits](https://www.conventionalcommits.org/)**-style messages so history and changelogs stay readable:

- `feat: …` — new feature
- `fix: …` — bug fix
- `docs: …` — documentation only
- `chore: …` — tooling, deps, no user-facing change
- `refactor: …` — behavior-preserving code change

Use the imperative mood (`add`, `fix`, not `added` / `fixed`). Split unrelated changes into separate commits when practical.

## Pull requests

1. **Branch** from `main`: e.g. `fix/login-validation` or `feat/feishu-webhook`.
2. **Scope** — one logical change per PR; avoid drive-by reformats across the repo.
3. **Title** — clear, concise; match Conventional Commits if you can.
4. **Description** — what/why, how to test, screenshots or screen recordings for UI changes.
5. **Link issues** — use `Fixes #123` or `Closes #123` when applicable.
6. **Secrets** — never commit tokens, API keys, or personal credentials. Use env vars and local-only config.

Maintainers may squash or adjust commit messages on merge; keeping your branch rebased on `main` reduces friction.

## CI expectations

- **Code PRs** — `.github/workflows/ci.yml` runs `typecheck`, `pnpm lint`, `pnpm build`, and `pnpm check:esm-imports`. Pushes that **only** change files under `docs/` skip this workflow (`paths-ignore`).
- **Docs PRs** — `.github/workflows/docs-ci.yml` builds the docs site when `docs/` or `CONTRIBUTING.md` changes.

Green CI is required before merge unless a maintainer says otherwise.

## Documentation contributions

### Run the docs site locally

```bash
cd docs
pnpm install   # first time only
pnpm dev
```

VitePress prints a local URL; use it to verify headings, links, and images.

### Writing workflow

- English narrative in this guide is maintained in **`CONTRIBUTING.md`** at the repo root and included into the English docs page; edit that file for English prose, unless you are only fixing VitePress-only wiring.
- English pages under `docs/en/`: other guides stay in `docs/en/`.
- Chinese pages: `docs/zh/`
- New sidebar entries: update `docs/.vitepress/config.ts`
- When you add or substantially change a guide, **keep English and Chinese in sync** when both locales exist.

### Paste images into Markdown

We recommend the **`telesoho.vscode-markdown-paste-image`** extension.

Workspace default (see `.vscode/settings.json`):

```json
{
  "MarkdownPaste.path": "${workspaceFolder}/docs/public/assets"
}
```

1. Copy a screenshot to the clipboard.
2. Open the target file under `docs/en/` or `docs/zh/`.
3. Run **Markdown Paste** or `Cmd+Option+V` (macOS) / `Ctrl+Alt+V` (Windows/Linux).

Link images from the site root:

```md
![Describe the screenshot](/assets/example-image.png)
```

Use descriptive filenames and alt text.

### Before you submit doc changes

- [ ] Both `en` and `zh` updated if the page exists in both languages  
- [ ] `pnpm dev` preview looks correct  
- [ ] New assets load from `/assets/...`  
- [ ] Sidebar updated when adding a new page  

## Reviews

Reviewers care about **correctness**, **security/privacy**, **maintainability**, and **user-facing clarity**. Smaller PRs are reviewed faster.

---

Again: thank you for contributing — questions are welcome in [Discussions](https://github.com/nexu-io/nexu/discussions).
