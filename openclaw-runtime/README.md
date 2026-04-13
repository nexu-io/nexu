# OpenClaw Runtime (legacy residue)

`openclaw-runtime/` 不再是 Nexu repo 中的 canonical runtime root，也不再是安装/裁剪/patch 的 source of truth。

当前 authoritative runtime owner 已经迁移到：

- prepared runtime root：`packages/slimclaw/.dist-runtime/openclaw`
- install seed source：`packages/slimclaw/runtime-seed/`
- physical patch source：`packages/slimclaw/runtime-patches/`

## 日常使用

手动准备 runtime：

```bash
pnpm slimclaw:prepare
```

本地运行 OpenClaw CLI：

```bash
OPENCLAW_STATE_DIR="$PWD/.openclaw" \
./openclaw-wrapper gateway run ...
```

`./openclaw-wrapper` 会通过 slimclaw 解析当前 prepared runtime 的入口路径，不需要直接依赖 `openclaw-runtime/`。

## 这个目录现在是什么

这个目录现在只应被视为 legacy residue / 历史兼容痕迹。

- 不要再把这里当作 runtime 安装根目录
- 不要再把这里当作 patch source
- 不要再通过 `npm --prefix ./openclaw-runtime ...` 维护 runtime

如果需要调整 runtime 依赖、裁剪规则或 patch：

- install seed：改 `packages/slimclaw/runtime-seed/`
- prune policy：改 `packages/slimclaw/prune-runtime-paths.mjs`
- patch files：改 `packages/slimclaw/runtime-patches/`

## 后续方向

该目录预计会在后续 legacy cleanup 中进一步收缩或删除；在那之前，新增逻辑不应再依赖这里的内容。
