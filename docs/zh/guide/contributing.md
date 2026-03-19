# 参与贡献

这份指南说明如何克隆仓库、选择代码编辑器，以及为文档提交更新。

## 克隆仓库

1. 先确认本地已经安装 `git`、`node` 和 `pnpm`。
2. 克隆仓库。
3. 进入 `docs/` 后安装文档依赖。

```bash
git clone https://github.com/nexu-io/nexu.git
cd nexu/docs
pnpm install
```

## 用编辑器打开项目

推荐使用 [Cursor](https://www.cursor.com/)，它很适合长篇 Markdown 编辑、全仓库搜索，以及配合 AI 完成文档更新。

- 请直接打开仓库根目录，这样 `.vscode/` 里的工作区配置会自动生效。
- 如果你更习惯标准工作流，也可以使用 VS Code。
- Markdown 源文件主要位于 `docs/en/` 和 `docs/zh/`。

## 本地运行文档站点

```bash
cd docs
pnpm dev
```

VitePress 会启动本地预览服务，方便你在提交前检查链接、标题和图片是否正常。

## 编写约定

- 英文文档放在 `docs/en/`。
- 中文文档放在 `docs/zh/`。
- 新增指南或更新贡献者相关说明时，尽量保持中英文版本同步。
- 新页面需要同步加入 `docs/.vitepress/config.ts`，这样侧边栏才会显示。

## 在 Markdown 中粘贴图片

推荐使用 `telesoho.vscode-markdown-paste-image` 扩展，把截图直接粘贴到 Markdown 文件里。

### 安装扩展

- 在 Cursor 或 VS Code 中打开仓库。
- 接受工作区推荐安装的 `telesoho.vscode-markdown-paste-image`，或者在扩展面板中手动安装。

### 默认保存路径

这个仓库已经在 `.vscode/settings.json` 中配置了默认路径：

```json
{
  "MarkdownPaste.path": "${workspaceFolder}/docs/public/assets"
}
```

因此，粘贴的图片默认会保存到 `docs/public/assets/`。

### 使用方法

1. 先把截图复制到剪贴板。
2. 打开目标 Markdown 文件，通常位于 `docs/en/` 或 `docs/zh/`。
3. 执行 `Markdown Paste`，或使用 macOS 的 `Cmd+Option+V` / Windows、Linux 的 `Ctrl+Alt+V`。
4. 将扩展生成的图片链接保留在 Markdown 源文件中。

### 链接写法

由于 VitePress 会把 `docs/public/` 作为站点根目录静态资源目录，Markdown 里请使用这样的路径：

```md
![请描述截图内容](/assets/example-image.png)
```

建议使用清晰的文件名和 alt 文本，方便后续维护。

## 提交前检查

- 如果改动应同时存在于中英文文档，请检查两个版本。
- 启动本地预览，确认页面渲染正常。
- 确认新图片能通过 `/assets/...` 正常加载。
- 保持改动聚焦，方便 reviewer 阅读。
