---
name: feishu-bitable
description: |
  飞书多维表格（Bitable）的创建、查询、编辑和管理工具。包含 27 种字段类型支持、高级筛选、批量操作和视图管理。

  **当以下情况时使用此 Skill**：
  (1) 需要创建或管理飞书多维表格 App
  (2) 需要在多维表格中新增、查询、修改、删除记录（行数据）
  (3) 需要管理字段（列）、视图、数据表
  (4) 用户提到"多维表格"、"bitable"、"数据表"、"记录"、"字段"
  (5) 需要批量导入数据或批量更新多维表格
tag: office-collab
icon: Table2
source: official
prompt: Help me manage Feishu Bitable databases
examples:
  - 帮我创建一个客户管理的多维表格
  - 查询多维表格中状态为"进行中"的记录
  - 批量导入数据到多维表格
requires:
  plugins:
    - "@larksuite/openclaw-lark"
---

# Feishu Bitable (多维表格) SKILL

## 🚨 执行前必读

- ✅ **创建数据表**：支持两种模式 — ① 明确需求时，在 `create` 时通过 `table.fields` 一次性定义字段（减少 API 调用）；② 探索式场景时，使用默认表 + 逐步修改字段（更稳定，易调整）
- ⚠️ **默认表的空行坑**：`app.create` 自带的默认表中会有空记录（空行）！插入数据前建议先调用 `feishu_bitable_app_table_record.list` + `batch_delete` 删除空行，避免数据污染
- ✅ **写记录前**：先调用 `feishu_bitable_app_table_field.list` 获取字段 type/ui_type
- ✅ **人员字段**：默认 open_id（ou_...），值必须是 `[{id:"ou_xxx"}]`（数组对象）
- ✅ **日期字段**：毫秒时间戳（例如 `1674206443000`），不是秒
- ✅ **单选字段**：字符串（例如 `"选项1"`），不是数组
- ✅ **多选字段**：字符串数组（例如 `["选项1", "选项2"]`）
- ✅ **附件字段**：必须先上传到当前多维表格，使用返回的 file_token
- ✅ **批量上限**：单次 ≤ 500 条，超过需分批（批量操作是原子性的）
- ✅ **并发限制**：同一数据表不支持并发写，需串行调用 + 延迟 0.5-1 秒

---

## 📋 快速索引：意图 → 工具 → 必填参数

| 用户意图 | 工具 | action | 必填参数 | 常用可选 |
|---------|------|--------|---------|---------|
| 查表有哪些字段 | feishu_bitable_app_table_field | list | app_token, table_id | - |
| 查记录 | feishu_bitable_app_table_record | list | app_token, table_id | filter, sort, field_names |
| 新增一行 | feishu_bitable_app_table_record | create | app_token, table_id, fields | - |
| 批量导入 | feishu_bitable_app_table_record | batch_create | app_token, table_id, records (≤500) | - |
| 更新一行 | feishu_bitable_app_table_record | update | app_token, table_id, record_id, fields | - |
| 批量更新 | feishu_bitable_app_table_record | batch_update | app_token, table_id, records (≤500) | - |
| 创建多维表格 | feishu_bitable_app | create | name | folder_token |
| 创建数据表 | feishu_bitable_app_table | create | app_token, name | fields |
| 创建字段 | feishu_bitable_app_table_field | create | app_token, table_id, field_name, type | property |
| 创建视图 | feishu_bitable_app_table_view | create | app_token, table_id, view_name, view_type | - |

---

## 🎯 核心约束（Schema 未透露的知识）

### 📚 详细参考文档

**当遇到字段配置、记录值格式问题或需要完整示例时，查阅以下文档**：

- **[字段 Property 配置详解](references/field-properties.md)** - 每种字段类型创建/更新时需要的 `property` 参数结构（单选的 options、进度的 min/max、关联的 table_id 等）
- **[记录值数据结构详解](references/record-values.md)** - 每种字段类型在记录中对应的 `fields` 值格式（人员字段只传 id、日期是毫秒时间戳、附件需先上传等）
- **[使用场景完整示例](references/examples.md)** - 8 个完整场景示例（创建表模式对比、批量导入、筛选查询、附件处理、关联字段等）

**何时查阅**:
- 创建/更新字段时收到 `125408X` 错误码（property 结构错误）→ 查 field-properties.md
- 写入记录时收到 `125406X` 错误码（字段值转换失败）→ 查 record-values.md
- 需要完整的操作流程和参数示例 → 查 examples.md

---

### 1. 字段类型与值格式必须严格匹配

**Bitable 最大的坑**：不同字段类型对 value 的数据结构要求完全不同。

#### 最易错的字段类型（完整列表见 [record-values.md](references/record-values.md)）

| type | ui_type | 字段类型 | 正确格式 | ❌ 常见错误 |
|------|---------|----------|---------|-----------|
| 11 | User | 人员 | `[{id: "ou_xxx"}]` | 传字符串 `"ou_xxx"` 或 `[{name: "张三"}]` |
| 5 | DateTime | 日期 | `1674206443000`（毫秒） | 传秒时间戳或字符串 |
| 3 | SingleSelect | 单选 | `"选项名"` | 传数组 `["选项名"]` |
| 4 | MultiSelect | 多选 | `["选项1", "选项2"]` | 传字符串 `"选项1"` |
| 15 | Url | 超链接 | `{link: "...", text: "..."}` | 只传字符串 URL |
| 17 | Attachment | 附件 | `[{file_token: "..."}]` | 传外部 URL 或本地路径 |

**强制流程**：
1. 先调用 `feishu_bitable_app_table_field.list` 获取字段的 `type` 和 `ui_type`
2. 根据上表或 [record-values.md](references/record-values.md) 构造正确格式
3. 错误码 `125406X` 或 `1254015` → 检查字段值格式

**人员字段特别注意**：
- 默认使用 open_id（ou_...），与 calendar/task 一致
- 格式：`[{id: "ou_xxx"}]`（数组对象）
- **只能传 id 字段**，不能传 name/email 等


## 📌 核心使用场景

> **完整示例**: 查阅 [examples.md](references/examples.md) 了解更多场景（创建表模式对比、空行处理、附件上传、关联字段等）

### 场景 1: 查字段类型（必做第一步）

```json
{
  "action": "list",
  "app_token": "S404b...",
  "table_id": "tbl..."
}
```

**返回**：包含每个字段的 `field_id`、`field_name`、`type`、`ui_type`、`property`

### 场景 2: 批量导入客户数据

```json
{
  "action": "batch_create",
  "app_token": "S404b...",
  "table_id": "tbl...",
  "records": [
    {
      "fields": {
        "客户名称": "Bytedance",
        "负责人": [{"id": "ou_xxx"}],
        "签约日期": 1674206443000,
        "状态": "进行中"
      }
    },
    {
      "fields": {
        "客户名称": "飞书",
        "负责人": [{"id": "ou_yyy"}],
        "签约日期": 1675416243000,
        "状态": "已完成"
      }
    }
  ]
}
```

**字段值格式**：
- 人员：`[{id: "ou_xxx"}]`（数组对象）
- 日期：毫秒时间戳
- 单选：字符串
- 多选：字符串数组

**限制**: 最多 500 条记录

### 场景 3: 筛选查询（高级筛选）

```json
{
  "action": "list",
  "app_token": "S404b...",
  "table_id": "tbl...",
  "filter": {
    "conjunction": "and",
    "conditions": [
      {
        "field_name": "状态",
        "operator": "is",
        "value": ["进行中"]
      },
      {
        "field_name": "截止日期",
        "operator": "isLess",
        "value": ["ExactDate", "1740441600000"]
      }
    ]
  },
  "sort": [
    {
      "field_name": "截止日期",
      "desc": false
    }
  ]
}
```

**filter 说明**：
- 支持 10 种 operator（is/isNot/contains/isEmpty 等，见附录 C）
- ⚠️ **isEmpty/isNotEmpty 必须传 `value: []`**（虽然逻辑上不需要值，但 API 要求必须传空数组）
- 日期筛选可使用 `["Today"]`、`["ExactDate", "时间戳"]` 等
- `sort` 可指定多个排序字段

---

## 🔍 常见错误与排查

| 错误码 | 错误现象 | 根本原因 | 解决方案 |
|--------|---------|---------|---------|
| 1254064 | DatetimeFieldConvFail | 日期字段格式错误 | **必须用毫秒时间戳**（如 `1772121600000`），不能用字符串（`"2026-02-27"`、RFC3339）或秒级时间戳 |
| 1254068 | URLFieldConvFail | 超链接字段格式错误 | **必须用对象** `{text: "显示文本", link: "URL"}`，不能直接传字符串 URL |
| 1254066 | UserFieldConvFail | 人员字段格式错误或 ID 类型不匹配 | 必须传 `[{id: "ou_xxx"}]`，确认 `user_id_type` |
| 1254015 | Field types do not match | 字段值格式与类型不匹配 | 先 list 字段，按类型构造正确格式 |
| 1254104 | RecordAddOnceExceedLimit | 批量创建超过 500 条 | 分批调用，每批 ≤ 500 |
| 1254291 | Write conflict | 并发写冲突 | 串行调用 + 延迟 0.5-1 秒 |
| 1254303 | AttachPermNotAllow | 附件未上传到当前表格 | 先调用上传素材接口 |
| 1254045 | FieldNameNotFound | 字段名不存在 | 检查字段名（包括空格、大小写） |

---

## 📚 附录：背景知识

### A. 资源层级关系

```
App (多维表格应用)
 ├── Table (数据表) ×100
 │    ├── Record (记录/行) ×20,000
 │    ├── Field (字段/列) ×300
 │    └── View (视图) ×200
 └── Dashboard (仪表盘)
```

### B. 筛选条件 operator 列表

| operator | 含义 | 支持字段 | value 要求 |
|----------|------|----------|-----------|
| `is` | 等于 | 所有 | 单个值 |
| `isNot` | 不等于 | 除日期外 | 单个值 |
| `contains` | 包含 | 除日期外 | 可多个值 |
| `doesNotContain` | 不包含 | 除日期外 | 可多个值 |
| `isEmpty` | 为空 | 所有 | 必须为 `[]` |
| `isNotEmpty` | 不为空 | 所有 | 必须为 `[]` |
| `isGreater` | 大于 | 数字、日期 | 单个值 |
| `isGreaterEqual` | 大于等于 | 数字（不支持日期） | 单个值 |
| `isLess` | 小于 | 数字、日期 | 单个值 |
| `isLessEqual` | 小于等于 | 数字（不支持日期） | 单个值 |

**日期字段特殊值**: `["Today"]`, `["Tomorrow"]`, `["ExactDate", "时间戳"]` 等（完整列表见 [examples.md](references/examples.md#场景-3-筛选查询高级筛选)）

### C. 使用限制

| 限制项 | 上限 |
|--------|------|
| 数据表 + 仪表盘 | 100（单个 App） |
| 记录数 | 20,000（单个数据表） |
| 字段数 | 300（单个数据表） |
| 视图数 | 200（单个数据表） |
| 批量创建/更新/删除 | 500（单次 API 调用） |
| 单元格文本 | 10 万字符 |
| 单选/多选选项 | 20,000（单个字段） |
| 单元格附件 | 100 |
| 单元格人员 | 1,000 |



### D. 其他约束

- 从其他数据源同步的数据表，**不支持增删改**记录
- 公式字段、查看引用字段是**只读**的
- 删除操作**无法恢复**
- 视图筛选条件使用 `field_id`，需先调用 field.list 获取
