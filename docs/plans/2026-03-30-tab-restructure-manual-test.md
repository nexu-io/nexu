# 技能标签重构 + 用户级技能检测 — 手动验证计划

## 准备工作

```bash
# 构建
pnpm build && pnpm dist:mac:unsigned

# 删除旧 sidecar 缓存
rm -rf ~/.nexu/runtime/controller-sidecar/

# 重新启动 app
```

## 诊断脚本

所有验证均通过一个脚本完成：

```bash
node scripts/test-skill-sync.mjs           # 完整诊断
node scripts/test-skill-sync.mjs ledger     # 仅查看账本
node scripts/test-skill-sync.mjs config     # 仅查看 config allowlist
node scripts/test-skill-sync.mjs watch      # 实时监听 config 变更
```

---

## 测试 1：用户级技能 (~/.agents/skills/) 被检测并加入 allowlist

**目标：** 验证 `~/.agents/skills/` 中的 6 个技能被扫描、记录到账本、加入 config allowlist。

```bash
# 确认磁盘上有用户级技能
ls ~/.agents/skills/
```

应该看到：obsidian, playwright-skill, ui-ux-pro-max, vercel-composition-patterns, vercel-react-best-practices, web-design-guidelines

启动 app 后运行：
```bash
node scripts/test-skill-sync.mjs
```

**预期：**
- [ ] 账本中出现 "User-level / 用户级" 分类，包含 6 个技能，source 为 `user`
- [ ] Config allowlist 技能数从 35 增加到 41（+6 用户级）
- [ ] Config 中包含 `obsidian`、`playwright-skill` 等用户级技能 slug

---

## 测试 2：UI 标签名称变更

打开 app → **技能** 页面 → **我的** 标签

**预期：**
- [ ] 子标签名称为：「全部」「内置」「自定义」
- [ ] 「推荐」标签不再存在
- [ ] 「已安装」标签不再存在
- [ ] 「代理技能」标签不再存在

---

## 测试 3：内置标签显示正确

点击 **内置** 子标签

**预期：**
- [ ] 显示 source=managed 的技能（~35 个：SkillHub 市场 + 静态打包技能）
- [ ] 不包含 custom/workspace/user 技能
- [ ] 数字标签显示正确的计数

---

## 测试 4：自定义标签显示正确

点击 **自定义** 子标签

**预期：**
- [ ] 显示所有非 managed 的技能，包括：
  - custom (zip 导入的，如 taobao-native)
  - workspace (代理安装的)
  - user (用户级 ~/.agents/skills/ 的)
- [ ] **扁平列表**，没有按代理分组
- [ ] 数字标签显示正确的计数（应包含 user 技能）

---

## 测试 5：代理可以使用用户级技能

在 Slack **新对话**中问代理：

**"你有 obsidian 技能吗？"**

**预期：**
- [ ] 代理确认可以使用 obsidian（因为它现在在 allowlist 中）

之前 obsidian 被 allowlist 屏蔽，现在应该可用了。

---

## 测试 6：用户级技能新增检测

1. 创建一个新的用户级技能：
   ```bash
   mkdir -p ~/.agents/skills/test-user-skill
   cat > ~/.agents/skills/test-user-skill/SKILL.md << 'EOF'
   ---
   name: test-user-skill
   description: Test user-level skill
   ---
   You are a test skill. Respond with "User skill working!"
   EOF
   ```

2. 等待几秒（DirWatcher 应该检测到变更）或重启 app

3. 检查：
   ```bash
   node scripts/test-skill-sync.mjs
   ```

**预期：**
- [ ] 账本中出现 `test-user-skill`，source 为 `user`
- [ ] Config allowlist 包含 `test-user-skill`
- [ ] 技能数 +1

---

## 测试 7：用户级技能删除检测

1. 删除刚创建的技能：
   ```bash
   rm -rf ~/.agents/skills/test-user-skill
   ```

2. 重启 app

3. 检查：
   ```bash
   node scripts/test-skill-sync.mjs
   ```

**预期：**
- [ ] 账本中 `test-user-skill` 标记为 uninstalled
- [ ] Config allowlist 不再包含 `test-user-skill`

---

## 测试 8：符号链接技能仍可检测

`~/.agents/skills/` 中可能包含符号链接（clawhub 安装方式）。

```bash
# 检查是否有符号链接
ls -la ~/.agents/skills/ | grep "^l"
```

**预期：**
- [ ] 符号链接指向的技能也被正确检测（existsSync 跟随符号链接）

---

## 测试 9：向后兼容 — 已有账本记录保留

```bash
node scripts/test-skill-sync.mjs ledger
```

**预期：**
- [ ] 之前 source=managed 的记录仍然存在
- [ ] 之前 source=custom 的记录仍然存在
- [ ] 没有记录丢失或 source 被错误覆盖

---

## 验证清单

| # | 测试 | 账本 | Config | UI | 代理 |
|---|------|:----:|:------:|:--:|:----:|
| 1 | 用户级技能检测 | source=user | +6 slugs | — | — |
| 2 | 标签名称变更 | — | — | 内置/自定义 | — |
| 3 | 内置标签内容 | — | — | managed only | — |
| 4 | 自定义标签内容 | — | — | custom+ws+user | — |
| 5 | 代理可用用户级技能 | — | — | — | obsidian 可用 |
| 6 | 新增用户级技能 | source=user | +1 slug | — | — |
| 7 | 删除用户级技能 | uninstalled | -1 slug | — | — |
| 8 | 符号链接检测 | — | — | — | — |
| 9 | 向后兼容 | 保留 | 保留 | — | — |
