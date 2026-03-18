# 技能安装

Nexu 使用基于文件系统的技能机制，运行时默认从 `.openclaw/skills/` 加载技能。

## 核心思路

- 官方技能目录来自 GitHub catalog。
- 已安装技能保存在本地 `.openclaw/skills/`。
- OpenClaw 会监听这个目录并自动热加载变更。

## 安装流程

1. 在 Nexu 技能目录中找到目标技能。
2. 通过 Nexu UI 或 CLI 安装。
3. 确认 `.openclaw/skills/<skill-name>/` 已生成对应目录。
4. 等待 gateway watcher 刷新。
5. 用一条简单提示词测试技能是否生效。

## 目录结构

```text
.openclaw/
  skills/
    feishu-bitable/
      SKILL.md
      references/
```

## 一个技能通常包含

- 带 frontmatter 的 `SKILL.md`
- 可选的参考文档
- frontmatter 中声明的工具或插件依赖

## 运维说明

- 本地运行时和桌面运行时都默认使用 `.openclaw/skills/` 作为安装目标。
- 如有需要，可通过 `OPENCLAW_SKILLS_DIR` 覆盖默认路径。
- 安装写入应尽量原子化，避免 watcher 读取到半成品。
- 本地私有技能可以与公共 catalog 同时存在。

## 安装后检查

- 如果 UI 没刷新，先手动刷新技能目录。
- 如果技能没有出现，检查 gateway 日志。
- 保持 `SKILL.md` 中的 metadata 为单一事实来源。
