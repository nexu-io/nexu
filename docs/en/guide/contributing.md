# Contributing

This guide helps you clone the repo, pick a code editor, and contribute updates to the docs.

## Clone the repo

1. Make sure `git`, `node`, and `pnpm` are installed.
2. Clone the repository.
3. Install the docs dependencies from inside `docs/`.

```bash
git clone https://github.com/nexu-io/nexu.git
cd nexu/docs
pnpm install
```

## Open the project in an editor

We recommend [Cursor](https://www.cursor.com/) because it works well for long-form markdown editing, repo-wide search, and AI-assisted doc updates.

- Open the repository root so the workspace settings in `.vscode/` are applied.
- You can also use VS Code if you prefer a standard editor workflow.
- Keep your markdown source files under `docs/en/` and `docs/zh/`.

## Run the docs locally

```bash
cd docs
pnpm dev
```

VitePress starts a local preview server so you can verify links, headings, and images before opening a pull request.

## Writing workflow

- English pages live in `docs/en/`.
- Chinese pages live in `docs/zh/`.
- Keep both language versions aligned when you add a new guide or update contributor-facing instructions.
- Add new guide pages to `docs/.vitepress/config.ts` so they show up in the sidebar.

## Paste images into markdown

We recommend the `telesoho.vscode-markdown-paste-image` extension for pasting screenshots directly into markdown files.

### Install the extension

- Open the repo in Cursor or VS Code.
- Accept the workspace recommendation for `telesoho.vscode-markdown-paste-image`, or install it manually from the Extensions view.

### Default image path

This repo already includes a workspace setting in `.vscode/settings.json`:

```json
{
  "MarkdownPaste.path": "${workspaceFolder}/docs/public/assets"
}
```

That means pasted images are saved into `docs/public/assets/` by default.

### How to use it

1. Copy a screenshot to your clipboard.
2. Open the target markdown file in `docs/en/` or `docs/zh/`.
3. Run `Markdown Paste`, or use `Cmd+Option+V` on macOS / `Ctrl+Alt+V` on Windows and Linux.
4. Insert the generated image link into the markdown source.

### Linking convention

Because VitePress serves files from `docs/public/` at the site root, use links like this in markdown:

```md
![Describe the screenshot](/assets/example-image.png)
```

Use clear filenames and alt text so screenshots stay maintainable.

## Before you submit

- Verify both language versions if your change should exist in English and Chinese.
- Run the local docs preview and check the rendered page.
- Confirm new images load correctly from `/assets/...`.
- Keep changes focused so they are easy to review.
