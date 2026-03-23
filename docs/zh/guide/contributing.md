# 参与贡献

**说明：** 英文权威指南在仓库根目录 [`CONTRIBUTING.md`](https://github.com/nexu-io/nexu/blob/main/CONTRIBUTING.md)（文档站英文页由该文件嵌入）。**本页为中文译本**；若与英文不一致，以 `CONTRIBUTING.md` 为准。

感谢你为 nexu 花时间改进项目。本页说明如何参与 **代码**、**文档** 贡献，以及 **PR 与协作约定**。

## 社区准则

- **行为准则：** 在 Issue、Discussion、PR 中请遵守仓库根目录的 [`CODE_OF_CONDUCT.md`](https://github.com/nexu-io/nexu/blob/main/CODE_OF_CONDUCT.md)。
- **安全漏洞：** **不要**在公开 Issue 中披露安全问题。请按根目录 [`SECURITY.md`](https://github.com/nexu-io/nexu/blob/main/SECURITY.md) 进行负责任披露；实现细节见 [`specs/SECURITY.md`](https://github.com/nexu-io/nexu/blob/main/specs/SECURITY.md)。

## 可以如何贡献

- **报告 Bug** — 提供复现步骤、版本与系统、日志（务必打码密钥与隐私信息）。
- **功能建议** — 可先开 Discussion 或 Issue，与维护者对齐方向后再大改代码。
- **提交代码** — 修复与小功能，需符合项目范围与质量要求。
- **文档** — 修正笔误、补充说明、截图与排版；若页面有中英文两版，尽量同步更新。

## 写代码之前

1. 在 [Issues](https://github.com/nexu-io/nexu/issues) 与 [Discussions](https://github.com/nexu-io/nexu/discussions) 搜索是否已有同类讨论。
2. **较大改动**建议先开 Issue（或在已有 Issue 下留言）对齐设计，避免 PR 与维护者预期不一致。
3. Fork 仓库，从 `main` 拉出**短生命周期**的功能分支进行修改。

## 开发环境

### 前置要求

- **Git**
- **Node.js** 22+（推荐 LTS；`package.json` 中 `engines` 最低为 20+）
- **pnpm** 10+（仓库通过 `packageManager` 固定为 `pnpm@10.26.0`）

### 克隆与安装

请在**仓库根目录**安装依赖（不要只在 `docs/` 里装）：

```bash
git clone https://github.com/nexu-io/nexu.git
cd nexu
pnpm install
```

首次安装会执行 `postinstall`（含 OpenClaw runtime 等），可能耗时较长。

### 仓库结构（节选）

```text
nexu/
├── apps/
│   ├── api/
│   ├── web/
│   ├── desktop/      # Electron 桌面客户端
│   └── controller/
├── packages/shared/
├── docs/             # VitePress 文档站
├── tests/
└── specs/
```

## 常用命令

以下默认在**仓库根目录**执行。

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 开发态（controller + web）热更新 |
| `pnpm dev:desktop` | 桌面客户端开发 |
| `pnpm dev:controller` | 仅启动 controller |
| `pnpm build` | 各包生产构建 |
| `pnpm typecheck` | 全仓库 TypeScript 检查 |
| `pnpm lint` | Biome 检查 + `typecheck`（与 CI 主流程一致） |
| `pnpm lint:fix` | 在可行范围内自动修复并 typecheck |
| `pnpm format` | 使用 Biome 格式化/写入 |
| `pnpm test` | 根目录 Vitest（`vitest run`） |
| `pnpm check:esm-imports` | ESM 路径检查（CI 中也会跑） |

部分子包另有脚本（例如 Web 端 `pnpm --filter @nexu/web test:e2e` 使用 Playwright）。请优先查看你所改代码所在目录的 `package.json`。

## 代码风格与格式化

- **Biome** 为格式化与主要 Lint 规则来源（见仓库根目录 `biome.json`）。
- **Pre-commit：** 执行 `pnpm prepare` 时，会尝试把 `scripts/pre-commit` 安装到 `.git/hooks`，对暂存的 `*.ts`、`*.tsx`、`*.js`、`*.jsx`、`*.json` 跑 Biome。
- **也可**使用 `git config core.hooksPath scripts`（详见 `scripts/pre-commit` 内注释）。

推送前建议本地执行：

```bash
pnpm lint
pnpm test
```

若改动涉及构建产物路径，建议再执行：

```bash
pnpm build
pnpm check:esm-imports
```

## Commit 说明

建议使用 **[Conventional Commits](https://www.conventionalcommits.org/)** 风格，便于阅读历史与整理变更说明：

- `feat:` — 新功能
- `fix:` — 修复
- `docs:` — 仅文档
- `chore:` — 工具链、依赖等，无直接用户可见行为变化
- `refactor:` — 重构，行为不变

使用祈使语气（`add`、`fix`，而非 `added`）。无关改动尽量拆成多个 commit。

## Pull Request

1. **分支** 基于 `main`，命名清晰，例如 `fix/login-validation`、`feat/feishu-webhook`。
2. **粒度** 一个 PR 聚焦一类改动；避免顺手全仓库格式化。
3. **标题** 简洁；若能对应 Conventional Commits 更佳。
4. **描述** 写清动机、实现要点、**如何验证**；UI 变更请附截图或录屏。
5. **关联 Issue** 使用 `Fixes #123` / `Closes #123` 等。
6. **密钥** 切勿提交 Token、API Key、个人配置；用环境变量与本地忽略文件处理。

合并时维护者可能会 squash 或调整说明；分支尽量与 `main` 保持同步以减少冲突。

## CI 说明

- **代码相关 PR：** `.github/workflows/ci.yml` 会跑 `typecheck`、`pnpm lint`、`pnpm build`、`pnpm check:esm-imports`。仅修改 `docs/**` 时不会触发该工作流（`paths-ignore`）。
- **文档 PR：** 修改 `docs/` 时会由 `.github/workflows/docs-ci.yml` 构建文档站。

除非维护者另有说明，合并前应保持 CI 通过。

## 文档贡献

### 本地预览文档站

```bash
cd docs
pnpm install   # 首次
pnpm dev
```

终端会输出本地预览地址，用于检查标题层级、链接与图片。

### 编写约定

- 英文贡献指南正文：根目录 **`CONTRIBUTING.md`**（文档站 `/guide/contributing` 会嵌入该文件）
- 其他英文页面：`docs/en/`
- 中文：`docs/zh/`
- 新增侧边栏条目：修改 `docs/.vitepress/config.ts`
- 新增或大幅修改指南时，若两种语言都有对应页面，请**尽量保持中英文同步**。

### 在 Markdown 中贴图

推荐使用 VS Code / Cursor 扩展 **`telesoho.vscode-markdown-paste-image`**。

工作区已在 `.vscode/settings.json` 中配置默认保存路径：

```json
{
  "MarkdownPaste.path": "${workspaceFolder}/docs/public/assets"
}
```

1. 将截图复制到剪贴板。
2. 打开 `docs/en/` 或 `docs/zh/` 下的目标 Markdown。
3. 执行 **Markdown Paste**，或使用 macOS `Cmd+Option+V` / Windows、Linux `Ctrl+Alt+V`。

正文里使用站点根路径引用静态资源：

```md
![请描述截图内容](/assets/example-image.png)
```

文件名与 alt 文本请清晰可维护。

### 提交文档前自检

- [ ] 若页面有中英文两版，是否都已更新  
- [ ] `pnpm dev` 预览是否正常  
- [ ] 新图片是否可通过 `/assets/...` 访问  
- [ ] 新页面是否已加入侧边栏配置  

## Code Review

评审会关注 **正确性**、**安全与隐私**、**可维护性** 以及 **对用户是否清晰**。PR 越小，通常越快合入。

---

再次感谢你的贡献；有问题欢迎到 [Discussions](https://github.com/nexu-io/nexu/discussions) 交流。
