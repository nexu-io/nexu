# 飞书多维表格字段 Property 配置详解

本文档详细说明每种字段类型创建或更新时需要的 `property` 参数结构。

> **来源**: 基于飞书开放平台文档 [字段编辑指南](https://go.feishu.cn/s/672BSzVyo03)

## 📋 目录

- [基础字段](#基础字段)
  - [1. 文本 (type=1)](#1-文本-type1)
  - [2. 数字 (type=2)](#2-数字-type2)
  - [5. 日期 (type=5)](#5-日期-type5)
  - [7. 复选框 (type=7)](#7-复选框-type7)
  - [13. 电话号码 (type=13)](#13-电话号码-type13)
- [选择字段](#选择字段)
  - [3. 单选 (type=3)](#3-单选-type3)
  - [4. 多选 (type=4)](#4-多选-type4)
- [特殊显示字段](#特殊显示字段)
  - [进度 (type=2, ui_type="Progress")](#进度-type2-ui_typeprogress)
  - [货币 (type=2, ui_type="Currency")](#货币-type2-ui_typecurrency)
  - [评分 (type=2, ui_type="Rating")](#评分-type2-ui_typerating)
  - [条码 (type=1, ui_type="Barcode")](#条码-type1-ui_typebarcode)
  - [邮箱 (type=1, ui_type="Email")](#邮箱-type1-ui_typeemail)
- [关系字段](#关系字段)
  - [11. 人员 (type=11)](#11-人员-type11)
  - [15. 超链接 (type=15)](#15-超链接-type15)
  - [17. 附件 (type=17)](#17-附件-type17)
  - [18. 单向关联 (type=18)](#18-单向关联-type18)
  - [21. 双向关联 (type=21)](#21-双向关联-type21)
  - [22. 地理位置 (type=22)](#22-地理位置-type22)
  - [23. 群组 (type=23)](#23-群组-type23)
- [高级字段](#高级字段)
  - [20. 公式 (type=20)](#20-公式-type20)
  - [1001. 创建时间 (type=1001)](#1001-创建时间-type1001)
  - [1002. 最后更新时间 (type=1002)](#1002-最后更新时间-type1002)
  - [1005. 自动编号 (type=1005)](#1005-自动编号-type1005)

---

## 基础字段

### 1. 文本 (type=1)

**Property 结构**: 空对象或省略

```json
{
  "type": 1,
  "field_name": "任务描述",
  "property": {}
}
```

**注意**:
- 默认 `ui_type` 为 "Text"
- 单个单元格最多 10 万字符
- 支持富文本格式（提及人、超链接等）

---

### 2. 数字 (type=2)

**Property 结构**:

```json
{
  "formatter": "0"  // 可选，数字显示格式
}
```

**formatter 可选值**:
- `"0"`: 整数（默认）
- `"0.0"`: 一位小数
- `"0.00"`: 两位小数
- `"0,000"`: 千分位
- `"0.00%"`: 百分比

**示例**:

```json
{
  "type": 2,
  "field_name": "工时",
  "property": {
    "formatter": "0.00"
  }
}
```

---

### 5. 日期 (type=5)

**Property 结构**:

```json
{
  "date_formatter": "yyyy/MM/dd",  // 可选，默认 "yyyy/MM/dd"
  "auto_fill": false               // 可选，是否自动填充创建时间
}
```

**date_formatter 可选值**:
- `"yyyy/MM/dd"`: 2021/1/30
- `"yyyy-MM-dd HH:mm"`: 2021/1/30 14:00
- `"MM-dd"`: 1月30日
- `"MM/dd/yyyy"`: 01/30/2021
- `"dd/MM/yyyy"`: 30/01/2021

**示例**:

```json
{
  "type": 5,
  "field_name": "截止日期",
  "property": {
    "date_formatter": "yyyy-MM-dd HH:mm",
    "auto_fill": false
  }
}
```

---

### 7. 复选框 (type=7)

**Property 结构**: 空对象或省略

```json
{
  "type": 7,
  "field_name": "是否完成",
  "property": {}
}
```

---

### 13. 电话号码 (type=13)

**Property 结构**: 空对象或省略

```json
{
  "type": 13,
  "field_name": "联系电话",
  "property": {}
}
```

**注意**:
- 电话号码格式：符合正则 `(\+)?\d*`
- 最大长度 64 字符

---

## 选择字段

### 3. 单选 (type=3)

**Property 结构**:

```json
{
  "options": [
    {
      "name": "进行中",   // 必填，选项名称
      "color": 0         // 可选，颜色编号 (0-54)
    },
    {
      "name": "已完成",
      "color": 10
    }
  ]
}
```

**颜色编号 (color)**:
- 范围: 0-54
- 0: 红色
- 10: 绿色
- 20: 蓝色
- ... (详见飞书官方文档)

**示例**:

```json
{
  "type": 3,
  "field_name": "任务状态",
  "property": {
    "options": [
      {"name": "待开始", "color": 0},
      {"name": "进行中", "color": 20},
      {"name": "已完成", "color": 10}
    ]
  }
}
```

**注意**:
- 选项总数不超过 20,000 个
- 创建时**不能**指定选项 ID（`id` 字段），系统自动生成
- 更新时需保留已有选项的 `id`

---

### 4. 多选 (type=4)

**Property 结构**: 与单选相同

```json
{
  "options": [
    {"name": "紧急", "color": 0},
    {"name": "重要", "color": 10}
  ]
}
```

**注意**:
- 选项总数不超过 20,000 个
- 单个单元格选项数不超过 1,000 个

---

## 特殊显示字段

### 进度 (type=2, ui_type="Progress")

**Property 结构**:

```json
{
  "min": 0,                  // 必填，最小值
  "max": 100,                // 必填，最大值
  "range_customize": false   // 可选，是否允许自定义进度值
}
```

**示例**:

```json
{
  "type": 2,
  "field_name": "完成进度",
  "ui_type": "Progress",
  "property": {
    "min": 0,
    "max": 100,
    "range_customize": true
  }
}
```

**注意**:
- `min` 取值范围: 0-1
- `max` 取值范围: 1-100
- `range_customize` 为 `true` 时用户可输入超出范围的值

---

### 货币 (type=2, ui_type="Currency")

**Property 结构**:

```json
{
  "currency_code": "CNY",  // 必填，货币类型
  "formatter": "0.00"      // 可选，数字格式
}
```

**currency_code 可选值**:
- `"CNY"`: 人民币 (¥)
- `"USD"`: 美元 ($)
- `"EUR"`: 欧元 (€)
- `"GBP"`: 英镑 (£)
- `"JPY"`: 日元 (¥)
- `"HKD"`: 港元 ($)
- ... (支持 20+ 种货币)

**示例**:

```json
{
  "type": 2,
  "field_name": "预算",
  "ui_type": "Currency",
  "property": {
    "currency_code": "USD",
    "formatter": "0,000.00"
  }
}
```

---

### 评分 (type=2, ui_type="Rating")

**Property 结构**:

```json
{
  "min": 1,                 // 必填，最小值
  "max": 5,                 // 必填，最大值
  "rating": {               // 可选，评分样式
    "symbol": "star"        // 图标类型
  }
}
```

**symbol 可选值**:
- `"star"`: ⭐ 星星（默认）
- `"heart"`: ❤️ 爱心
- `"thumbsup"`: 👍 赞
- `"fire"`: 🔥 火焰
- `"smile"`: 😊 笑脸
- `"lightning"`: ⚡ 闪电
- `"flower"`: 🌸 花朵
- `"number"`: 数字

**示例**:

```json
{
  "type": 2,
  "field_name": "优先级",
  "ui_type": "Rating",
  "property": {
    "min": 1,
    "max": 5,
    "rating": {
      "symbol": "fire"
    }
  }
}
```

---

### 条码 (type=1, ui_type="Barcode")

**Property 结构**:

```json
{
  "allowed_edit_modes": {
    "manual": true,   // 是否允许手动录入
    "scan": true      // 是否允许扫描录入
  }
}
```

**示例**:

```json
{
  "type": 1,
  "field_name": "商品条码",
  "ui_type": "Barcode",
  "property": {
    "allowed_edit_modes": {
      "manual": false,
      "scan": true
    }
  }
}
```

---

### 邮箱 (type=1, ui_type="Email")

**Property 结构**: 空对象或省略

```json
{
  "type": 1,
  "field_name": "联系邮箱",
  "ui_type": "Email",
  "property": {}
}
```

---

## 关系字段

### 11. 人员 (type=11)

**Property 结构**:

```json
{
  "multiple": true  // 可选，是否允许多个人员，默认 true
}
```

**示例**:

```json
{
  "type": 11,
  "field_name": "负责人",
  "property": {
    "multiple": false  // 只允许单个人员
  }
}
```

**注意**:
- 单个单元格人员数不超过 1,000
- 记录值只支持传入 `id` 字段（open_id/union_id/user_id）

---

### 15. 超链接 (type=15)

**Property 结构**: **必须省略 `property` 参数，不要传递任何值（包括空对象）**

```json
{
  "type": 15,
  "field_name": "参考链接"
  // 不要传 property 参数，包括空对象 {}
}
```

**⚠️ 重要**: 超链接字段的特殊要求（经实测验证）：
- ✅ **正确**: 完全省略 `property` 参数
- ❌ **错误**: `"property": {}`（会报 URLFieldPropertyError）
- ❌ **错误**: 传递任何 property 值

**注意**: 这是飞书 API 的特殊行为，超链接字段即使传空对象也会报错，必须完全省略该参数。

---

### 17. 附件 (type=17)

**Property 结构**: 空对象或省略

```json
{
  "type": 17,
  "field_name": "附件",
  "property": {}
}
```

**注意**:
- 单个单元格附件数不超过 100
- 写入前需先调用[上传素材接口](https://go.feishu.cn/s/63soQp6O80s)

---

### 18. 单向关联 (type=18)

**Property 结构**:

```json
{
  "table_id": "tblXXXXXXXX",  // 必填，关联的数据表 ID
  "multiple": true             // 可选，是否允许多条记录，默认 true
}
```

**示例**:

```json
{
  "type": 18,
  "field_name": "关联任务",
  "property": {
    "table_id": "tblsRc9GRRXKqhvW",
    "multiple": true
  }
}
```

**注意**:
- 单个单元格关联数不超过 500

---

### 21. 双向关联 (type=21)

**Property 结构**:

```json
{
  "table_id": "tblXXXXXXXX",      // 必填，关联的数据表 ID
  "back_field_name": "反向字段名",  // 必填，对方表的双向关联字段名
  "multiple": true                 // 可选，是否允许多条记录
}
```

**示例**:

```json
{
  "type": 21,
  "field_name": "相关项目",
  "property": {
    "table_id": "tblAnotherTable",
    "back_field_name": "关联的任务",
    "multiple": true
  }
}
```

**注意**:
- 单个单元格关联数不超过 500
- 对方表会自动创建对应的双向关联字段

---

### 22. 地理位置 (type=22)

**Property 结构**:

```json
{
  "location": {
    "input_type": "not_limit"  // 输入限制
  }
}
```

**input_type 可选值**:
- `"only_mobile"`: 仅允许移动端实时定位
- `"not_limit"`: 无限制（默认）

**示例**:

```json
{
  "type": 22,
  "field_name": "办公地址",
  "property": {
    "location": {
      "input_type": "only_mobile"
    }
  }
}
```

---

### 23. 群组 (type=23)

**Property 结构**: 空对象或省略

```json
{
  "type": 23,
  "field_name": "协作群",
  "property": {}
}
```

**注意**:
- 单个单元格群组数不超过 10 个

---

## 高级字段

### 20. 公式 (type=20)

**Property 结构**:

```json
{
  "formula_expression": "bitable::$table[tblXXX].$field[fldYYY]*2"  // 可选
}
```

**示例**:

```json
{
  "type": 20,
  "field_name": "总价",
  "property": {
    "formula_expression": "bitable::$table[tblMain].$field[fldQty] * $field[fldPrice]"
  }
}
```

**注意**:
- 创建字段时**不支持**设置公式表达式
- 参考[飞书帮助中心 - 公式字段](https://www.feishu.cn/hc/zh-CN/articles/360049067853)

**对于某些多维表格，公式字段需要额外设置 `type` 参数**（通过[获取多维表格元数据](https://go.feishu.cn/s/62nuKkQlE03)接口的 `formula_type` 判断）:

```json
{
  "type": 20,
  "field_name": "计算字段",
  "property": {
    "type": {
      "data_type": 2,           // 公式结果的数据类型 (1=文本, 2=数字, 5=日期...)
      "ui_property": {          // UI 展示属性
        "formatter": "0.00",
        "currency_code": "CNY"
      },
      "ui_type": "Currency"     // UI 类型 (Number/Progress/Currency/Rating/DateTime)
    }
  }
}
```

---

### 1001. 创建时间 (type=1001)

**Property 结构**:

```json
{
  "date_formatter": "yyyy/MM/dd"  // 可选，日期格式
}
```

**示例**:

```json
{
  "type": 1001,
  "field_name": "创建于",
  "property": {
    "date_formatter": "yyyy-MM-dd HH:mm"
  }
}
```

---

### 1002. 最后更新时间 (type=1002)

**Property 结构**: 与创建时间相同

```json
{
  "date_formatter": "yyyy-MM-dd HH:mm"
}
```

---

### 1005. 自动编号 (type=1005)

**Property 结构**:

```json
{
  "auto_serial": {
    "type": "auto_increment_number",  // 或 "custom"
    "options": [                      // 自定义编号规则（仅 type="custom" 时需要）
      {
        "type": "fixed_text",
        "value": "TASK-"
      },
      {
        "type": "created_time",
        "value": "yyyyMMdd"
      },
      {
        "type": "system_number",
        "value": "5"
      }
    ]
  }
}
```

**auto_serial.type 可选值**:
- `"auto_increment_number"`: 纯自增数字
- `"custom"`: 自定义编号规则

**options 中的规则类型**:
- `"system_number"`: 自增数字位数（value: 1-9）
- `"fixed_text"`: 固定字符（value: 最多 20 字符）
- `"created_time"`: 创建时间（value: "yyyyMMdd"/"yyyyMM"/"yyyy"/"MMdd"/"MM"/"dd"）

**示例 1: 纯自增**:

```json
{
  "type": 1005,
  "field_name": "编号",
  "property": {
    "auto_serial": {
      "type": "auto_increment_number"
    }
  }
}
```

**示例 2: 自定义编号**:

```json
{
  "type": 1005,
  "field_name": "工单号",
  "property": {
    "auto_serial": {
      "type": "custom",
      "options": [
        {"type": "fixed_text", "value": "WO-"},
        {"type": "created_time", "value": "yyyyMMdd"},
        {"type": "system_number", "value": "4"}
      ]
    }
  }
}
// 生成示例: WO-20240226-0001
```

---

## 🔍 常见错误码

| 错误码 | 字段类型 | 说明 |
|--------|---------|------|
| 1254080 | 文本 | property 结构错误 |
| 1254081 | 数字 | property 结构错误，检查 formatter |
| 1254082 | 单选 | property 结构错误，检查 options 数组 |
| 1254083 | 多选 | property 结构错误，检查 options 数组 |
| 1254084 | 日期 | property 结构错误，检查 date_formatter |
| 1254085 | 复选框 | property 结构错误 |
| 1254086 | 人员 | property 结构错误，检查 multiple |
| 1254087 | 超链接 | **必须省略 property 参数（传空对象也会报错）** |
| 1254088 | 附件 | property 结构错误 |
| 1254089 | 单向关联 | property 结构错误，检查 table_id |
| 1254090 | 查找引用 | property 结构错误 |
| 1254091 | 公式 | property 结构错误 |
| 1254092 | 双向关联 | property 结构错误，检查 table_id 和 back_field_name |
| 1254093 | 创建时间 | property 结构错误 |
| 1254094 | 最后更新时间 | property 结构错误 |

---

## 📌 更新字段时的特殊规则

调用 `update` action 更新字段时：

1. **必须保持字段类型一致**: `type` 和 `ui_type` 不能变更
2. **单选/多选更新选项**:
   - 已有选项必须保留 `id`
   - 新增选项只传 `name` 和 `color`，不传 `id`
3. **如果只改字段名**:
   - 可以只传 `field_name`，工具会自动查询当前 `type` 和 `property`
4. **关联字段的 table_id**: 不能修改为不同的表

---

## 🔗 参考链接

- [飞书开放平台 - 字段编辑指南](https://go.feishu.cn/s/672BSzVyo03)
- [新增字段接口文档](https://go.feishu.cn/s/62nuKkQl403)
- [更新字段接口文档](https://go.feishu.cn/s/62nuKkQlo03)
