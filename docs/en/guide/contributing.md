# Contributing to nexu

This page is the English entry point for contributing to nexu.

## Canonical Source

The canonical English contributing guide lives at the repository root:

- [CONTRIBUTING.md](https://github.com/nexu-io/nexu/blob/main/CONTRIBUTING.md)

If you want to update the English contribution guide itself, edit that file first.

## Related Pages

- Chinese translation: [中文贡献指南](/zh/guide/contributing)
- GitHub Issues: [github.com/nexu-io/nexu/issues](https://github.com/nexu-io/nexu/issues)
- GitHub Discussions: [github.com/nexu-io/nexu/discussions](https://github.com/nexu-io/nexu/discussions)

## Quick Notes

- Search existing issues and discussions before starting a larger change.
- Keep pull requests small and focused.
- Never commit secrets such as API keys or tokens.
- If you update a guide that exists in multiple languages, keep the localized versions aligned when possible.

## Local Docs Workflow

To preview the docs site locally:

```bash
cd docs
pnpm install
pnpm dev
```

When adding a new docs page:

- Put English pages under `docs/en/`
- Put Chinese pages under `docs/zh/`
- Update `docs/.vitepress/config.ts` for sidebar entries
- Verify all images load correctly from `/assets/...`
