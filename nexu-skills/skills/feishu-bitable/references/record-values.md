# 飞书多维表格记录值数据结构详解

本文档详细说明每种字段类型在记录中对应的 `fields` 值格式。

> **来源**: 基于飞书开放平台文档 [多维表格记录数据结构](https://go.feishu.cn/s/6lY28723w04)

## 📋 快速索引

| 字段类型 | type | 值类型 | 示例 | 限制 |
|---------|------|--------|------|------|
| [文本](#文本-type1) | 1 | string (写入) / list of object (返回) | `"任务描述"` | 最多 10 万字符 |
| [数字](#数字-type2) | 2 | number | `0.5` | - |
| [单选](#单选-type3) | 3 | string | `"进行中"` | 选项总数≤20,000 |
| [多选](#多选-type4) | 4 | array&lt;string&gt; | `["审批", "办公"]` | 选项总数≤20,000，单元格≤1,000 |
| [日期](#日期-type5) | 5 | number | `1675526400000` | Unix 毫秒时间戳 |
| [复选框](#复选框-type7) | 7 | boolean | `true` | - |
| [人员](#人员-type11) | 11 | list of object | `[{"id": "ou_xxx"}]` | 单元格≤1,000，写入仅支持 `id` |
| [电话](#电话号码-type13) | 13 | string | `"17899870000"` | 最多 64 字符 |
| [超链接](#超链接-type15) | 15 | object | `{"text": "飞书", "link": "..."}` | - |
| [附件](#附件-type17) | 17 | list of object | `[{"file_token": "xxx"}]` | 单元格≤100 |
| [单向关联](#单向关联-type18) | 18 | object | `{"link_record_ids": [...]}` | 单元格≤500 |
| [双向关联](#双向关联-type21) | 21 | object | `{"link_record_ids": [...]}` | 单元格≤500 |
| [地理位置](#地理位置-type22) | 22 | object | `{"location": "116.3,40.0", ...}` | - |
| [群组](#群组-type23) | 23 | list of object | `[{"id": "oc_xxx"}]` | 单元格≤10 |
| [公式/查找引用](#公式查找引用-type20-type19) | 20/19 | object | `{"type": 1, "value": [...]}` | 只读 |

---

## 文本 (type=1)

### 基础文本 (ui_type="Text")

**写入格式**: 字符串

```json
{
  "fields": {
    "任务描述": "维护客户关系"
  }
}
```

**返回格式**: 对象数组

```json
{
  "任务描述": [
    {
      "text": "维护客户关系",
      "type": "text"
    }
  ]
}
```

**富文本格式** (提及人、超链接):

```json
{
  "任务描述": [
    {
      "text": "请 ",
      "type": "text"
    },
    {
      "text": "@张三",
      "type": "mention",
      "token": "ou_user123",
      "mentionType": "User",
      "mentionNotify": true,
      "name": "张三"
    },
    {
      "text": " 查看 ",
      "type": "text"
    },
    {
      "text": "飞书官网",
      "type": "url",
      "link": "https://www.feishu.cn"
    }
  ]
}
```

**富文本元素类型**:

| type | 说明 | 额外字段 |
|------|------|---------|
| `"text"` | 纯文本 | `text` |
| `"mention"` | 提及（人/文档） | `token`, `mentionType`, `mentionNotify`, `name` |
| `"url"` | 超链接 | `text`, `link` |

**mentionType 可选值**:
- `"User"`: 提及用户
- `"Docx"`: 提及文档
- `"Sheet"`: 提及电子表格
- `"Bitable"`: 提及多维表格

---

### 条码 (ui_type="Barcode")

**写入格式**: 字符串

```json
{
  "fields": {
    "商品条码": "FS0001"
  }
}
```

**返回格式**:

```json
{
  "商品条码": [
    {
      "text": "FS0001",
      "type": "text"
    }
  ]
}
```

---

### 邮箱 (ui_type="Email")

**写入格式**: 字符串

```json
{
  "fields": {
    "联系邮箱": "zhangmin@xxxgmail.com"
  }
}
```

**返回格式**:

```json
{
  "联系邮箱": [
    {
      "text": "zhangmin@xxxgmail.com",
      "type": "url",
      "link": "mailto:zhangmin@xxxgmail.com"
    }
  ]
}
```

---

## 数字 (type=2)

**写入/返回格式**: 数字

```json
{
  "fields": {
    "工时": 10,
    "完成率": 0.75,
    "预算": 5000.50
  }
}
```

**注意**:
- 进度 (ui_type="Progress"): 0-1 范围的小数
- 货币 (ui_type="Currency"): 普通数字
- 评分 (ui_type="Rating"): 整数

---

## 单选 (type=3)

**写入格式**: 选项名称字符串

```json
{
  "fields": {
    "任务状态": "进行中"
  }
}
```

**新选项**: 传入不存在的选项名会**自动创建新选项**

```json
{
  "fields": {
    "任务状态": "已暂停"  // 如果不存在，会自动创建
  }
}
```

**返回格式**: 与写入相同

```json
{
  "任务状态": "进行中"
}
```

**限制**:
- 选项总数不超过 20,000

---

## 多选 (type=4)

**写入格式**: 字符串数组

```json
{
  "fields": {
    "标签": ["审批集成", "办公管理", "身份管理"]
  }
}
```

**新选项**: 传入不存在的选项名会**自动创建新选项**

```json
{
  "fields": {
    "标签": ["新标签1", "新标签2"]  // 不存在的会自动创建
  }
}
```

**返回格式**: 与写入相同

```json
{
  "标签": ["审批集成", "办公管理"]
}
```

**限制**:
- 选项总数不超过 20,000
- 单个单元格选项数不超过 1,000

---

## 日期 (type=5)

**写入/返回格式**: Unix 毫秒时间戳

```json
{
  "fields": {
    "截止日期": 1675526400000  // 2023-02-05 00:00:00 (UTC)
  }
}
```

**注意**:
- 必须使用**毫秒级**时间戳（不是秒级）
- 建议使用北京时间 (UTC+8) 转换

**常见错误** (错误码 1254064):

```json
// ❌ 错误：使用 ISO 字符串
{"截止日期": "2026-02-27"}

// ❌ 错误：使用 RFC3339 格式
{"截止日期": "2026-02-27T10:00:00+08:00"}

// ❌ 错误：使用秒级时间戳
{"截止日期": 1772121600}  // 少了 3 位

// ✅ 正确：使用毫秒时间戳
{"截止日期": 1772121600000}
```

---

## 复选框 (type=7)

**写入/返回格式**: 布尔值

```json
{
  "fields": {
    "是否完成": true,
    "是否延期": false
  }
}
```

---

## 人员 (type=11)

**写入格式**: 对象数组，**仅支持 `id` 字段**

```json
{
  "fields": {
    "负责人": [
      {"id": "ou_8240099442cf5da49f04f4bf8f8abcef"}
    ],
    "协作人": [
      {"id": "ou_user1"},
      {"id": "ou_user2"}
    ]
  }
}
```

**返回格式**: 对象数组，包含完整信息

```json
{
  "负责人": [
    {
      "id": "ou_8240099442cf5da49f04f4bf8f8abcef",
      "name": "黄泡泡",
      "en_name": "Amanda Huang",
      "email": "amandahuang@xxxgmail.com",
      "avatar_url": "https://..."
    }
  ]
}
```

**⚠️ 重要**:
- **写入时只支持 `id`**，不能传 `name`、`email` 等字段
- `id` 类型需与 `user_id_type` 参数一致（open_id/union_id/user_id）
- 单个单元格人员数不超过 1,000
- 传空: `null` 或 `[]`

---

## 电话号码 (type=13)

**写入/返回格式**: 字符串

```json
{
  "fields": {
    "联系电话": "17899870000",
    "座机": "+86-010-12345678"
  }
}
```

**格式规则**:
- 符合正则: `(\+)?\d*`
- 最大长度 64 字符

---

## 超链接 (type=15)

**写入/返回格式**: 对象

```json
{
  "fields": {
    "参考链接": {
      "text": "飞书开放平台",
      "link": "https://open.feishu.cn"
    }
  }
}
```

**字段说明**:
- `text`: 显示的文本
- `link`: URL 地址

**常见错误** (错误码 1254068):

```json
// ❌ 错误：直接传字符串 URL
{
  "参考链接": "https://open.feishu.cn"
}

// ✅ 正确：使用对象格式
{
  "参考链接": {
    "text": "飞书开放平台",
    "link": "https://open.feishu.cn"
  }
}

// ✅ text 和 link 可以相同
{
  "参考链接": {
    "text": "https://open.feishu.cn",
    "link": "https://open.feishu.cn"
  }
}
```

---

## 附件 (type=17)

**写入格式**: 对象数组，**仅传 `file_token`**

```json
{
  "fields": {
    "附件": [
      {"file_token": "DRiFbwaKsoZaLax4WKZbEGCccoe"},
      {"file_token": "BZk3bL1Enoy4pzxaPL9bNeKqcLe"}
    ]
  }
}
```

**返回格式**: 对象数组，包含完整信息

```json
{
  "附件": [
    {
      "file_token": "J7GdbgNWWoD1fwx7oWccxdgknIe",
      "name": "58cc930b89.png",
      "type": "image/png",
      "size": 108867,
      "url": "https://open.feishu.cn/open-apis/drive/v1/medias/...",
      "tmp_url": "https://open.feishu.cn/open-apis/drive/v1/medias/batch_get_tmp_download_url?..."
    }
  ]
}
```

**⚠️ 重要**:
- 写入前必须先调用[上传素材接口](https://go.feishu.cn/s/63soQp6O80s)获取 `file_token`
- 单个单元格附件数不超过 100
- 错误码 1254303: 附件未挂载到当前多维表格

---

## 单向关联 (type=18)

**写入格式**: `link_record_ids` 数组

```json
{
  "fields": {
    "关联任务": {
      "link_record_ids": ["recHTLvO7x", "recbS8zb2m"]
    }
  }
}
```

**简化写入** (直接数组):

```json
{
  "fields": {
    "关联任务": ["recHTLvO7x", "recbS8zb2m"]
  }
}
```

**返回格式**:

```json
{
  "关联任务": {
    "link_record_ids": ["recHTLvO7x", "recbS8zb2m"]
  }
}
```

**限制**:
- 单个单元格关联数不超过 500

---

## 双向关联 (type=21)

**写入/返回格式**: 与单向关联相同

```json
{
  "fields": {
    "相关项目": {
      "link_record_ids": ["reclzUoBLn", "rec7bYQoX1"]
    }
  }
}
```

**注意**:
- 更新双向关联会同步更新对方表的对应字段
- 单个单元格关联数不超过 500

---

## 地理位置 (type=22)

**写入格式**: 经纬度字符串

```json
{
  "fields": {
    "办公地址": "116.397755,39.903179"
  }
}
```

**返回格式**: 对象，包含详细信息

```json
{
  "办公地址": {
    "location": "116.352681,40.01437",
    "pname": "北京市",
    "cityname": "北京市",
    "adname": "海淀区",
    "address": "学清路10号院学清嘉创大厦",
    "name": "Bytedance",
    "full_address": "Bytedance，北京市北京市海淀区学清路10号院学清嘉创大厦"
  }
}
```

**字段说明**:
- `location`: 经纬度 (格式: "经度,纬度")
- `pname`: 省
- `cityname`: 市
- `adname`: 区
- `address`: 详细地址
- `name`: 地名
- `full_address`: 完整地址

---

## 群组 (type=23)

**写入格式**: 对象数组，**仅传 `id`**

```json
{
  "fields": {
    "协作群": [
      {"id": "oc_d2a947abb78bbbbb12d4cad55fbabcef"}
    ]
  }
}
```

**返回格式**: 对象数组，包含完整信息

```json
{
  "协作群": [
    {
      "id": "oc_d2a947abb78bbbbb12d4cad55fbabcef",
      "name": "测试部门",
      "avatar_url": "https://..."
    }
  ]
}
```

**限制**:
- 单个单元格群组数不超过 10

---

## 公式/查找引用 (type=20, type=19)

**格式**: 对象，包含 `type`、`ui_type` 和 `value`

```json
{
  "是否延期": {
    "type": 1,                    // 底层数据类型
    "ui_type": "Text",            // UI 展示类型
    "value": [                    // 计算结果
      {
        "text": "✅ 正常",
        "type": "text"
      }
    ]
  }
}
```

**字段说明**:
- `type`: 底层数据类型枚举（1=文本, 2=数字, 5=日期...）
- `ui_type`: UI 展示类型（"Text"/"Number"/"Progress"/...）
- `value`: 计算结果，格式由 `type` 决定

**示例 - 数字类型公式**:

```json
{
  "总价": {
    "type": 2,
    "ui_type": "Currency",
    "value": 1250.50
  }
}
```

**示例 - 日期类型公式**:

```json
{
  "计算日期": {
    "type": 5,
    "ui_type": "DateTime",
    "value": 1675526400000
  }
}
```

**⚠️ 注意**:
- 公式字段为**只读**，不能通过写接口设置
- `value` 的数据结构取决于 `type` 对应的字段类型

---

## 系统字段

### 创建时间 (type=1001)

**返回格式**: Unix 毫秒时间戳

```json
{
  "创建于": 1675526400000
}
```

**⚠️ 只读**: 不能通过写接口设置

---

### 最后更新时间 (type=1002)

**返回格式**: Unix 毫秒时间戳

```json
{
  "更新于": 1675612800000
}
```

**⚠️ 只读**: 不能通过写接口设置

---

### 创建人 / 修改人 (type=1003, type=1004)

**返回格式**: 对象数组（与人员字段相同）

```json
{
  "创建人": [
    {
      "id": "ou_8240099442cf5da49f04f4bf8f8abcef",
      "name": "黄泡泡",
      "en_name": "Amanda Huang",
      "email": "amandahuang@xxxgmail.com",
      "avatar_url": "https://..."
    }
  ]
}
```

**⚠️ 只读**: 不能通过写接口设置

---

### 自动编号 (type=1005)

**返回格式**: 字符串

```json
{
  "工单号": "WO-20240226-0001"
}
```

**⚠️ 只读**: 不能通过写接口设置

---

## 🔍 常见错误与排查

### 字段类型不匹配 (错误码 1254015)

**错误示例**:

```json
// ❌ 错误: 日期字段传字符串
{
  "fields": {
    "截止日期": "2024-02-26"  // 应该传时间戳
  }
}

// ✅ 正确
{
  "fields": {
    "截止日期": 1708905600000
  }
}
```

---

### 人员字段格式错误 (错误码 1254066)

**常见原因**:

1. **传入了不支持的字段**:

```json
// ❌ 错误
{
  "负责人": [
    {"name": "张三"}  // 只能传 id
  ]
}

// ✅ 正确
{
  "负责人": [
    {"id": "ou_xxx"}
  ]
}
```

2. **user_id_type 不匹配**:

```bash
# 请求时指定了 user_id_type=open_id，但传的是 union_id
```

3. **跨应用传 open_id**:

```
不同应用的 open_id 不能交叉使用，建议使用 user_id
```

---

### 附件未挂载 (错误码 1254303)

**原因**: 直接传入外部 file_token

**解决**:

1. 先调用[上传素材接口](https://go.feishu.cn/s/63soQp6O80s)上传到当前多维表格
2. 使用返回的 `file_token` 写入记录

---

### 字段名不存在 (错误码 1254045)

**原因**: 字段名称不完全匹配（可能有空格、换行、特殊字符）

**排查**:

1. 调用[列出字段接口](https://go.feishu.cn/s/62nuKkQlk03)获取准确字段名
2. 检查首尾空格、换行符

---

### 超链接字段转换失败 (错误码 1254068)

**原因**: 缺少 `text` 或 `link` 字段

```json
// ❌ 错误
{
  "参考链接": {
    "link": "https://example.com"  // 缺少 text
  }
}

// ✅ 正确
{
  "参考链接": {
    "text": "示例网站",
    "link": "https://example.com"
  }
}
```

---

## 📌 最佳实践

### 1. 批量写入优化

```json
{
  "fields": {
    "任务名称": "拜访客户",
    "负责人": [{"id": "ou_xxx"}],
    "截止日期": 1708905600000,
    "标签": ["重要", "紧急"],
    "是否完成": false
  }
}
```

**建议**:
- 一次性传入所有字段，避免多次调用
- 只传需要设置的字段，不必包含所有列

---

### 2. 清空字段值

**方法 1**: 传 `null`

```json
{
  "fields": {
    "负责人": null,
    "标签": null
  }
}
```

**方法 2**: 传空数组/空字符串（根据字段类型）

```json
{
  "fields": {
    "负责人": [],
    "任务名称": ""
  }
}
```

---

### 3. 时间戳转换

**JavaScript**:

```javascript
// 北京时间字符串 → Unix 毫秒时间戳
const timestamp = new Date("2024-02-26 14:00").getTime()  // 1708927200000

// Unix 毫秒时间戳 → 日期字符串
const date = new Date(1708927200000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
```

**Python**:

```python
import datetime

# 北京时间字符串 → Unix 毫秒时间戳
dt = datetime.datetime(2024, 2, 26, 14, 0, 0)
timestamp = int(dt.timestamp() * 1000)  # 1708927200000

# Unix 毫秒时间戳 → 日期字符串
dt = datetime.datetime.fromtimestamp(1708927200000 / 1000)
```

---

### 4. 关联字段的级联更新

**双向关联**:

```json
// 更新 Table A 的双向关联字段
{
  "fields": {
    "关联项目": {
      "link_record_ids": ["rec123"]
    }
  }
}
// Table B 的对应双向关联字段会自动更新
```

**单向关联**:

```json
// 只更新当前表，不影响关联表
{
  "fields": {
    "参考任务": {
      "link_record_ids": ["rec456"]
    }
  }
}
```

---

## 🔗 参考链接

- [飞书开放平台 - 多维表格记录数据结构](https://go.feishu.cn/s/6lY28723w04)
- [新增记录接口文档](https://go.feishu.cn/s/61Y-IrQjU02)
- [更新记录接口文档](https://go.feishu.cn/s/6lY28723A04)
- [上传素材接口](https://go.feishu.cn/s/63soQp6O80s)
