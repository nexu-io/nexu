# 飞书多维表格使用场景完整示例

本文档提供多维表格操作的完整场景示例，包括参数说明和注意事项。

> **基础参考**: 先查阅 [字段 Property 配置详解](field-properties.md) 和 [记录值数据结构详解](record-values.md)

---

## 📋 目录

1. [场景 0: 创建数据表（两种模式对比）](#场景-0-创建数据表两种模式对比)
2. [场景 1: 查字段类型（必做第一步）](#场景-1-查字段类型必做第一步)
3. [场景 2: 批量导入客户数据](#场景-2-批量导入客户数据)
4. [场景 2.5: 创建表并插入数据（含空行处理）](#场景-25-创建表并插入数据含空行处理)
5. [场景 3: 筛选查询（高级筛选）](#场景-3-筛选查询高级筛选)
6. [场景 4: 更新单条记录](#场景-4-更新单条记录)
7. [场景 5: 创建带选项的单选字段](#场景-5-创建带选项的单选字段)
8. [场景 6: 创建复杂字段（进度、货币、评分）](#场景-6-创建复杂字段进度货币评分)
9. [场景 7: 处理附件字段](#场景-7-处理附件字段)
10. [场景 8: 双向关联字段](#场景-8-双向关联字段)

---

## 场景 0: 创建数据表（两种模式对比）

### 模式 A：一次性定义所有字段

**适用场景**：字段类型、配置都已明确，需要快速创建表结构。

**优势**：一次 API 调用，原子性操作。

**工具**: `feishu_bitable_app_table`

```json
{
  "action": "create",
  "app_token": "S404b...",
  "table": {
    "name": "客户管理表",
    "default_view_name": "所有客户",
    "fields": [
      {
        "field_name": "客户名称",
        "type": 1
      },
      {
        "field_name": "负责人",
        "type": 11,
        "property": {
          "multiple": false
        }
      },
      {
        "field_name": "签约日期",
        "type": 5,
        "property": {
          "date_formatter": "yyyy-MM-dd"
        }
      },
      {
        "field_name": "状态",
        "type": 3,
        "property": {
          "options": [
            {"name": "进行中", "color": 0},
            {"name": "已完成", "color": 10}
          ]
        }
      },
      {
        "field_name": "金额",
        "type": 2,
        "ui_type": "Currency",
        "property": {
          "currency_code": "CNY",
          "formatter": "0.00"
        }
      }
    ]
  }
}
```

**返回示例**:
```json
{
  "table_id": "tblXXXXXXXX",
  "name": "客户管理表",
  "default_view_id": "vewXXXXXXXX"
}
```

---

### 模式 B：使用默认表 + 逐步修改字段

**适用场景**：探索式建表，需要边建边调整，或复杂字段配置需要分步确认。

**优势**：
- `app.create` 自带默认表和默认字段，可在此基础上调整
- 复杂字段（单选 options、URL 格式等）分步确认，减少出错
- 踩坑后容易回退（比如 URL 字段改为文本字段）

**完整流程**：

#### 步骤 1: 创建 App（工具: `feishu_bitable_app`）

```json
{
  "action": "create",
  "name": "客户管理系统",
  "folder_token": "fldXXXXXXXX"
}
```

**返回**: 包含 `app_token` 和默认表的 `default_table_id`

---

#### 步骤 2: 查看默认字段（工具: `feishu_bitable_app_table_field`）

```json
{
  "action": "list",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX"
}
```

**返回示例**:
```json
{
  "fields": [
    {
      "field_id": "fld001",
      "field_name": "文本",
      "type": 1,
      "ui_type": "Text"
    },
    {
      "field_id": "fld002",
      "field_name": "数字",
      "type": 2,
      "ui_type": "Number"
    }
  ]
}
```

---

#### 步骤 3: 修改默认字段名称（工具: `feishu_bitable_app_table_field`）

```json
{
  "action": "update",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
  "field_id": "fld001",
  "field_name": "客户名称"
}
```

---

#### 步骤 4: 补充缺失字段（工具: `feishu_bitable_app_table_field`）

```json
{
  "action": "create",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
  "field_name": "负责人",
  "type": 11,
  "property": {
    "multiple": false
  }
}
```

---

#### 步骤 5: 查看空记录（工具: `feishu_bitable_app_table_record`）

```json
{
  "action": "list",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX"
}
```

**返回**: 可能包含空记录 `[{"record_id": "recxxx", "fields": {}}, ...]`

---

#### 步骤 6: 删除空行（工具: `feishu_bitable_app_table_record`）

```json
{
  "action": "batch_delete",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
  "records": ["recxxx", "recyyy"]
}
```

---

#### 步骤 7: 批量插入数据（工具: `feishu_bitable_app_table_record`）

```json
{
  "action": "batch_create",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
  "records": [
    {
      "fields": {
        "客户名称": "Bytedance",
        "负责人": [{"id": "ou_xxx"}],
        "状态": "进行中"
      }
    }
  ]
}
```

---

**⚠️ 模式 B 的关键注意事项**:
- 默认表中通常已有空记录，**必须先删除**，否则会有数据污染
- 步骤 5-6 是必需的，不能跳过
- 适合不确定字段配置的探索式场景

---

## 场景 1: 查字段类型（必做第一步）

**为什么必做**: 不同字段类型的值格式完全不同，必须先查询再写入。

**工具**: `feishu_bitable_app_table_field`

```json
{
  "action": "list",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX"
}
```

**返回示例**:
```json
{
  "fields": [
    {
      "field_id": "fld001",
      "field_name": "任务名称",
      "type": 1,
      "ui_type": "Text",
      "property": {}
    },
    {
      "field_id": "fld002",
      "field_name": "负责人",
      "type": 11,
      "ui_type": "User",
      "property": {
        "multiple": true
      }
    },
    {
      "field_id": "fld003",
      "field_name": "截止日期",
      "type": 5,
      "ui_type": "DateTime",
      "property": {
        "date_formatter": "yyyy-MM-dd HH:mm"
      }
    },
    {
      "field_id": "fld004",
      "field_name": "状态",
      "type": 3,
      "ui_type": "SingleSelect",
      "property": {
        "options": [
          {"id": "optXXX", "name": "进行中", "color": 0},
          {"id": "optYYY", "name": "已完成", "color": 10}
        ]
      }
    }
  ]
}
```

**关键信息**:
- `type`: 字段基础类型（1=文本, 2=数字, 3=单选...）
- `ui_type`: UI 展示类型（区分进度、货币、评分等）
- `property`: 字段配置（单选的 options、日期的 formatter 等）

---

## 场景 2: 批量导入客户数据

**工具**: `feishu_bitable_app_table_record`

```json
{
  "action": "batch_create",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
  "records": [
    {
      "fields": {
        "客户名称": "某某",
        "负责人": [{"id": "ou_xxx"}],
        "签约日期": 1674206443000,
        "状态": "进行中",
        "金额": 1000000,
        "标签": ["重要客户", "战略合作"],
        "联系电话": "17899870000",
        "官网": {
          "text": "某某官网",
          "link": "https://www.xxxx.com"
        }
      }
    },
    {
      "fields": {
        "客户名称": "飞书",
        "负责人": [{"id": "ou_xxx"}],
        "签约日期": 1675416243000,
        "状态": "已完成",
        "金额": 500000,
        "标签": ["核心产品"],
        "联系电话": "13800138000"
      }
    }
  ]
}
```

**字段值格式说明**:
- **文本**: 字符串 `"客户名称"`
- **人员**: 对象数组 `[{"id": "ou_xxx"}]`（只能传 id）
- **日期**: 毫秒时间戳 `1674206443000`
- **单选**: 字符串 `"进行中"`
- **多选**: 字符串数组 `["重要客户", "战略合作"]`
- **数字**: 数字 `1000000`
- **电话**: 字符串 `"17899870000"`
- **超链接**: 对象 `{"text": "显示文本", "link": "URL"}`

**返回示例**:
```json
{
  "records": [
    {
      "record_id": "rec001",
      "fields": {...}
    },
    {
      "record_id": "rec002",
      "fields": {...}
    }
  ]
}
```

**限制**:
- 单次最多 500 条记录
- 超过需分批调用

---

## 场景 2.5: 创建表并插入数据（含空行处理）

**问题**: `app.create` 创建的默认表中会自带空记录（空行），直接插入数据会导致数据污染。

**正确流程**: 见场景 0 的模式 B

**核心步骤**:
1. 创建 App → 获取 `app_token` 和 `default_table_id`
2. 查看默认表记录 (`list` action)
3. 删除空行 (`batch_delete` action)
4. 批量插入数据 (`batch_create` action)

**错误示例**（跳过步骤 2-3）:
```
表格最终状态：
| 客户名称 | 负责人 | 状态 |
|---------|--------|------|
|         |        |      | ← 空行（原有）
| Bytedance | 张三   | 进行中 | ← 新插入
| 飞书    | 李四   | 已完成 | ← 新插入
```

**正确示例**（执行步骤 2-3）:
```
表格最终状态：
| 客户名称 | 负责人 | 状态 |
|---------|--------|------|
| Bytedance | 张三   | 进行中 |
| 飞书    | 李四   | 已完成 |
```

---

## 场景 3: 筛选查询（高级筛选）

**工具**: `feishu_bitable_app_table_record`

```json
{
  "action": "list",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
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
      },
      {
        "field_name": "优先级",
        "operator": "isGreater",
        "value": ["3"]
      }
    ]
  },
  "sort": [
    {
      "field_name": "截止日期",
      "desc": false
    },
    {
      "field_name": "优先级",
      "desc": true
    }
  ],
  "field_names": ["任务名称", "负责人", "截止日期", "状态"],
  "page_size": 100
}
```

**参数说明**:

### filter 结构
- `conjunction`: 条件组合方式（`"and"` 或 `"or"`）
- `conditions`: 条件数组

### operator 类型（10 种）

| operator | 含义 | 支持字段 | value 格式 |
|----------|------|----------|-----------|
| `is` | 等于 | 所有 | `["值"]` |
| `isNot` | 不等于 | 除日期外 | `["值"]` |
| `contains` | 包含 | 除日期外 | `["值1", "值2"]` |
| `doesNotContain` | 不包含 | 除日期外 | `["值1"]` |
| `isEmpty` | 为空 | 所有 | `[]` |
| `isNotEmpty` | 不为空 | 所有 | `[]` |
| `isGreater` | 大于 | 数字、日期 | `["值"]` |
| `isGreaterEqual` | 大于等于 | 数字 | `["值"]` |
| `isLess` | 小于 | 数字、日期 | `["值"]` |
| `isLessEqual` | 小于等于 | 数字 | `["值"]` |

### 日期字段特殊值

```json
// 具体日期
{"operator": "is", "value": ["ExactDate", "1702449755000"]}

// 相对日期
{"operator": "is", "value": ["Today"]}      // 今天
{"operator": "is", "value": ["Tomorrow"]}   // 明天
{"operator": "is", "value": ["Yesterday"]}  // 昨天
{"operator": "is", "value": ["CurrentWeek"]} // 本周
{"operator": "is", "value": ["LastWeek"]}   // 上周
{"operator": "is", "value": ["TheLastWeek"]} // 过去七天
{"operator": "is", "value": ["TheNextWeek"]} // 未来七天
```

### sort 结构
- `field_name`: 排序字段
- `desc`: `true` 降序，`false` 升序
- 支持多字段排序（按数组顺序）

---

## 场景 4: 更新单条记录

**工具**: `feishu_bitable_app_table_record`

```json
{
  "action": "update",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
  "record_id": "recusyQbB0fVL5",
  "fields": {
    "状态": "已完成",
    "完成时间": 1674206443000,
    "备注": "客户已签约"
  }
}
```

**说明**:
- 只传需要更新的字段
- 不传的字段保持不变
- 支持部分字段更新

**批量更新**（最多 500 条）:

```json
{
  "action": "batch_update",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
  "records": [
    {
      "record_id": "rec001",
      "fields": {
        "状态": "已完成"
      }
    },
    {
      "record_id": "rec002",
      "fields": {
        "状态": "已完成"
      }
    }
  ]
}
```

---

## 场景 5: 创建带选项的单选字段

**工具**: `feishu_bitable_app_table_field`

```json
{
  "action": "create",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
  "field_name": "优先级",
  "type": 3,
  "property": {
    "options": [
      {"name": "高", "color": 0},
      {"name": "中", "color": 1},
      {"name": "低", "color": 2}
    ]
  }
}
```

**颜色编号**（color 范围 0-54）:
- 0: 红色
- 1: 橙色
- 10: 绿色
- 20: 蓝色

**多选字段**（type=4）格式相同:

```json
{
  "action": "create",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
  "field_name": "标签",
  "type": 4,
  "property": {
    "options": [
      {"name": "重要", "color": 0},
      {"name": "紧急", "color": 1},
      {"name": "长期", "color": 10}
    ]
  }
}
```

**注意**:
- 创建时**不能**指定选项 ID（`id` 字段），系统自动生成
- 选项总数不超过 20,000

---

## 场景 6: 创建复杂字段（进度、货币、评分）

### 进度字段 (type=2, ui_type="Progress")

```json
{
  "action": "create",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
  "field_name": "完成进度",
  "type": 2,
  "ui_type": "Progress",
  "property": {
    "min": 0,
    "max": 100,
    "range_customize": true
  }
}
```

**写入值**: `0.75` 表示 75%

---

### 货币字段 (type=2, ui_type="Currency")

```json
{
  "action": "create",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
  "field_name": "预算",
  "type": 2,
  "ui_type": "Currency",
  "property": {
    "currency_code": "CNY",
    "formatter": "0,000.00"
  }
}
```

**currency_code 可选值**:
- `"CNY"`: 人民币 (¥)
- `"USD"`: 美元 ($)
- `"EUR"`: 欧元 (€)
- `"JPY"`: 日元 (¥)

**写入值**: `5000.50`（普通数字）

---

### 评分字段 (type=2, ui_type="Rating")

```json
{
  "action": "create",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
  "field_name": "客户满意度",
  "type": 2,
  "ui_type": "Rating",
  "property": {
    "min": 1,
    "max": 5,
    "rating": {
      "symbol": "star"
    }
  }
}
```

**symbol 可选值**:
- `"star"`: ⭐ 星星
- `"heart"`: ❤️ 爱心
- `"fire"`: 🔥 火焰
- `"thumbsup"`: 👍 赞

**写入值**: `4`（整数）

---

## 场景 7: 处理附件字段

### 步骤 1: 上传附件到多维表格

**工具**: `feishu_drive_media`（上传素材接口）

```json
{
  "action": "upload",
  "file_path": "/path/to/file.pdf",
  "parent_type": "bitable_image",
  "parent_node": "S404b..."  // app_token
}
```

**返回**:
```json
{
  "file_token": "DRiFbwaKsoZaLax4WKZbEGCccoe"
}
```

---

### 步骤 2: 创建附件字段（可选）

```json
{
  "action": "create",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
  "field_name": "合同文件",
  "type": 17
}
```

---

### 步骤 3: 写入附件记录

```json
{
  "action": "create",
  "app_token": "S404b...",
  "table_id": "tblXXXXXXXX",
  "fields": {
    "客户名称": "Bytedance",
    "合同文件": [
      {"file_token": "DRiFxxxxxxxxxxxxxxxxxxCccoe"},
      {"file_token": "BZk3bxxxxxxxxxxxxxxxxeKqcLe"}
    ]
  }
}
```

**限制**:
- 单个单元格附件数不超过 100
- 必须先上传到当前多维表格，不能用外部 file_token

---

## 场景 8: 双向关联字段

### 步骤 1: 创建双向关联字段

**在"任务表"中创建关联到"项目表"的字段**:

```json
{
  "action": "create",
  "app_token": "S404b...",
  "table_id": "tbl_task",
  "field_name": "所属项目",
  "type": 21,
  "property": {
    "table_id": "tbl_project",
    "back_field_name": "关联的任务",
    "multiple": true
  }
}
```

**结果**:
- 在"任务表"中创建字段"所属项目"
- 在"项目表"中**自动创建**字段"关联的任务"

---

### 步骤 2: 写入关联记录

```json
{
  "action": "create",
  "app_token": "S404b...",
  "table_id": "tbl_task",
  "fields": {
    "任务名称": "开发新功能",
    "所属项目": {
      "link_record_ids": ["rec_project_001"]
    }
  }
}
```

**级联更新**:
- 在"任务表"中设置"所属项目"为 `rec_project_001`
- "项目表"的 `rec_project_001` 记录的"关联的任务"字段会**自动添加**当前任务的 record_id

---

### 单向关联 (type=18)

**区别**: 只影响当前表，不会自动更新对方表

```json
{
  "action": "create",
  "app_token": "S404b...",
  "table_id": "tbl_task",
  "field_name": "参考任务",
  "type": 18,
  "property": {
    "table_id": "tbl_task",  // 可以关联自己
    "multiple": true
  }
}
```

---

## 🔗 参考链接

- [字段 Property 配置详解](field-properties.md)
- [记录值数据结构详解](record-values.md)
- [飞书开放平台 - 多维表格文档](https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview)
