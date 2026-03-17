---
name: feishu-update-doc
description: |
  更新飞书云文档。支持 7 种更新模式：追加、覆盖、定位替换、全文替换、前/后插入、删除。
tag: file-knowledge
icon: FileEdit
source: official
prompt: Help me update Feishu documents
examples:
  - 帮我在文档末尾追加一段内容
  - 把文档中的"张三"全部替换为"李四"
  - 帮我更新文档中"功能说明"章节的内容
requires:
  plugins:
    - "@larksuite/openclaw-lark"
---

# feishu__update_doc

更新飞书云文档内容，支持 7 种更新模式。优先使用局部更新（replace_range/append/insert_before/insert_after），慎用 overwrite（会清空文档重写，可能丢失图片、评论等）。

# 定位方式

定位模式（replace_range/replace_all/insert_before/insert_after/delete_range）支持两种定位方式，二选一：

## selection_with_ellipsis - 内容定位

支持两种格式：

1. **范围匹配**：`开头内容...结尾内容`
   - 匹配从开头到结尾的所有内容（包含中间内容）
   - 建议 10-20 字符确保唯一性

2. **精确匹配**：`完整内容`（不含 `...`）
   - 匹配完整的文本内容
   - 适合替换短文本、关键词等

**转义说明**：如果要匹配的内容本身包含 `...`，使用 `\.\.\.` 表示字面量的三个点。

示例：
- `你好...世界` → 匹配从"你好"到"世界"之间的任意内容
- `你好\.\.\.世界` → 匹配字面量 "你好...世界"

**建议**：如果文档中有多个 `...`，建议使用更长的上下文来精确定位，避免歧义。

## selection_by_title - 标题定位

格式：`## 章节标题`（可带或不带 # 前缀）

自动定位整个章节（从该标题到下一个同级或更高级标题之前）。

**示例**：
- `## 功能说明` → 定位二级标题"功能说明"及其下所有内容
- `功能说明` → 定位任意级别的"功能说明"标题及其内容

# 可选参数

## new_title

更新文档标题。如果提供此参数，将在更新文档内容后同步更新文档标题。

**特性**：
- 仅支持纯文本，不支持富文本格式
- 长度限制：1-800 字符
- 可以与任何 mode 配合使用
- 标题更新在内容更新之后执行


# 返回值

## 成功

```json
{
  "success": true,
  "doc_id": "文档ID",
  "mode": "使用的模式",
  "message": "文档更新成功（xxx模式）",
  "warnings": ["可选警告列表"],
  "log_id": "请求日志ID"
}
```

## 异步模式（大文档超时）

```json
{
  "task_id": "async_task_xxxx",
  "message": "文档更新已提交异步处理，请使用 task_id 查询状态",
  "log_id": "请求日志ID"
}
```

使用返回的 `task_id` 再次调用 update-doc（仅传 task_id 参数）查询状态。

## 错误

```json
{
  "error": "[错误码] 错误消息\n💡 Suggestion: 修复建议\n📍 Context: 上下文信息",
  "log_id": "请求日志ID"
}
```

---

# 使用示例

## append - 追加到末尾

```json
{
  "doc_id": "文档ID或URL",
  "mode": "append",
  "markdown": "## 新章节\n\n追加的内容..."
}
```

## replace_range - 定位替换

使用 `selection_with_ellipsis`：
```json
{
  "doc_id": "文档ID或URL",
  "mode": "replace_range",
  "selection_with_ellipsis": "## 旧章节标题...旧章节结尾。",
  "markdown": "## 新章节标题\n\n新的内容..."
}
```

使用 `selection_by_title`（替换整个章节）：
```json
{
  "doc_id": "文档ID或URL",
  "mode": "replace_range",
  "selection_by_title": "## 功能说明",
  "markdown": "## 功能说明\n\n更新后的功能说明内容..."
}
```

## replace_all - 全文替换

与 replace_range 类似，但支持多处同时替换（replace_range 要求匹配唯一）：
```json
{
  "doc_id": "文档ID或URL",
  "mode": "replace_all",
  "selection_with_ellipsis": "张三",
  "markdown": "李四"
}
```

**返回值**包含 `replace_count` 字段，表示替换的次数：
```json
{
  "success": true,
  "replace_count": 4,
  "message": "文档更新成功（replace_all模式，替换4处）"
}
```

**注意**：
- 与 `replace_range` 不同，`replace_all` 允许多个匹配
- 如果没有找到匹配内容，会返回错误
- `markdown` 可以为空字符串，表示删除所有匹配内容

## insert_before - 前插入

```json
{
  "doc_id": "文档ID或URL",
  "mode": "insert_before",
  "selection_with_ellipsis": "## 危险操作...数据丢失风险。",
  "markdown": "> **警告**：以下操作需谨慎！"
}
```

## insert_after - 后插入

```json
{
  "doc_id": "文档ID或URL",
  "mode": "insert_after",
  "selection_with_ellipsis": "```python...```",
  "markdown": "**输出示例**：\n```\nresult = 42\n```"
}
```

## delete_range - 删除内容

使用 `selection_with_ellipsis`：
```json
{
  "doc_id": "文档ID或URL",
  "mode": "delete_range",
  "selection_with_ellipsis": "## 废弃章节...不再需要的内容。"
}
```

使用 `selection_by_title`（删除整个章节）：
```json
{
  "doc_id": "文档ID或URL",
  "mode": "delete_range",
  "selection_by_title": "## 废弃章节"
}
```

注意：delete_range 模式不需要 markdown 参数。

## 同时更新标题和内容

可以在任何更新模式中添加 `new_title` 参数来同时更新文档标题：

```json
{
  "doc_id": "文档ID或URL",
  "mode": "overwrite",
  "markdown": "# 项目文档 v2.0\n\n全新的内容...",
  "new_title": "项目文档 v2.0"
}
```

```json
{
  "doc_id": "文档ID或URL",
  "mode": "append",
  "markdown": "## 更新日志\n\n2025-12-18: 新增功能...",
  "new_title": "项目文档（已更新）"
}
```

## overwrite - 完全覆盖

⚠️ 会清空文档后重写，可能丢失图片、评论等，仅在需要完全重建文档时使用。

```json
{
  "doc_id": "文档ID或URL",
  "mode": "overwrite",
  "markdown": "# 新文档\n\n全新的内容..."
}
```

---

# 最佳实践

## 小粒度精确替换

修改文档内容时，**定位范围越小越安全**。尤其是表格、分栏等嵌套块，应精确定位到需要修改的文本，避免影响其他内容。

**示例**：表格单元格中有图片和文字，只需修改文字
- ❌ 替换整个表格或整行 → 可能破坏图片引用
- ✅ 只定位需要修改的文本 → 图片等其他内容不受影响


## 保护不可重建的内容

图片、画板、电子表格、多维表格、任务等内容以 token 形式存储，**无法读出后原样写入**。

**保护策略**：
- 替换时避开包含这些内容的区域
- 精确定位到纯文本部分进行修改

## 分步更新优于整体覆盖

修改多处内容时：
- ✅ 多次小范围替换，逐步修改
- ⚠️ 谨慎使用 `overwrite` 重写整个文档, 除非你认为风险完全可控

**原因**：局部更新保留原有媒体、评论、协作历史，更安全可靠。

## insert 模式扩大定位范围时注意插入位置

使用 `insert_before` 或 `insert_after` 时，如果目标内容重复出现，需要扩大 `selection_with_ellipsis` 范围来唯一定位。

**关键**：插入位置基于匹配范围的**边界**：
- `insert_after` → 插入在匹配范围的**结尾**之后
- `insert_before` → 插入在匹配范围的**开头**之前

扩大范围时，确保边界仍然是期望的插入点。

## 修复画板语法错误

当 create-doc 或 update-doc 返回画板写入失败的 warning 时：
1. warning 中包含 whiteboard 标签（如 `<whiteboard token="xxx"/>`）
2. 分析错误信息，修正 Mermaid/PlantUML 语法
3. 用 `replace_range` 替换：`selection_with_ellipsis` 使用 warning 中的 whiteboard 标签，`markdown` 提供修正后的代码块
4. 重新提交验证

---

# 注意事项

- **Markdown 语法**：支持飞书扩展语法，详见 create-doc 工具文档
