---
name: feishu-calendar
description: |
  飞书日历与日程管理工具集。包含日历管理、日程管理、参会人管理、忙闲查询。
tag: office-collab
icon: Calendar
source: official
prompt: Help me manage Feishu calendar events
examples:
  - 帮我创建一个明天下午两点的项目复盘会议
  - 查询我下周的日程安排
  - 帮我查看团队成员的忙闲时间
requires:
  plugins:
    - "@larksuite/openclaw-lark"
---

# 飞书日历管理 (feishu-calendar)

## 🚨 执行前必读

- ✅ **时区固定**：Asia/Shanghai（UTC+8）
- ✅ **时间格式**：ISO 8601 / RFC 3339（带时区），例如 `2026-02-25T14:00:00+08:00`
- ✅ **create 最小必填**：summary, start_time, end_time
- ✅ **user_open_id 强烈建议**：从 SenderId 获取（ou_xxx），确保用户能看到日程
- ✅ **ID 格式约定**：用户 `ou_...`，群 `oc_...`，会议室 `omm_...`，邮箱 `email@...`

---

## 📋 快速索引：意图 → 工具 → 必填参数

| 用户意图 | 工具 | action | 必填参数 | 强烈建议 | 常用可选 |
|---------|------|--------|---------|---------|---------|
| 创建会议 | feishu_calendar_event | create | summary, start_time, end_time | user_open_id | attendees, description, location |
| 查某时间段日程 | feishu_calendar_event | list | start_time, end_time | - | - |
| 改日程时间 | feishu_calendar_event | patch | event_id, start_time/end_time | - | summary, description |
| 搜关键词找会 | feishu_calendar_event | search | query | - | - |
| 回复邀请 | feishu_calendar_event | reply | event_id, rsvp_status | - | - |
| 查重复日程实例 | feishu_calendar_event | instances | event_id, start_time, end_time | - | - |
| 查忙闲 | feishu_calendar_freebusy | list | time_min, time_max, user_ids[] | - | - |
| 邀请参会人 | feishu_calendar_event_attendee | create | calendar_id, event_id, attendees[] | - | - |
| 删除参会人 | feishu_calendar_event_attendee | batch_delete | calendar_id, event_id, user_open_ids[] | - | - |

---

## 🎯 核心约束（Schema 未透露的知识）

### 1. user_open_id 为什么必填？

**工具使用用户身份**：日程创建在用户主日历上，用户本人能看到。

**但为什么还要传 user_open_id**：将发起人也添加为**参会人**，确保：
- ✅ 发起人会收到日程通知
- ✅ 发起人可以回复 RSVP 状态（接受/拒绝/待定）
- ✅ 发起人出现在参会人列表中
- ✅ 其他参会人能看到发起人

**如果不传**：
- ⚠️ 用户能看到日程，但不会作为参会人
- ⚠️ 如果只有其他参会人，发起人不在列表中（不符合常规逻辑）

### 2. 参会人权限（attendee_ability）

工具已默认设置 `attendee_ability: "can_modify_event"`，参会人可以编辑日程和管理参与者。

| 权限值 | 能力 |
|--------|------|
| `none` | 无权限 |
| `can_see_others` | 可查看参与人列表 |
| `can_invite_others` | 可邀请他人 |
| `can_modify_event` | 可编辑日程（推荐） |

### 3. 统一使用 open_id（ou_...格式）

- ✅ 创建日程：`user_open_id = SenderId`
- ✅ 邀请参会人：`attendees[].id = "ou_xxx"`
- ✅ 删除参会人：`user_open_ids = ["ou_xxx"]`（工具已优化，直接传 open_id 即可）

⚠️ **ID 格式区分**：
- `ou_xxx`：用户的 open_id（**你应该使用的**）
- `user_xxx`：日程内部的 attendee_id（list 接口返回，仅用于内部记录）

### 4. 会议室预约是异步流程

添加会议室类型参会人后，会议室进入异步预约流程：
1. API 返回成功 → `rsvp_status: "needs_action"`（预约中）
2. 后台异步处理
3. 最终状态：`accept`（成功）或 `decline`（失败）

**查询预约结果**：使用 `feishu_calendar_event_attendee.list` 查看 `rsvp_status`。

### 5. instances action 仅对重复日程有效

**⚠️ 重要**：`instances` action **仅对重复日程有效**，必须满足：
1. event_id 必须是重复日程的 ID（该日程具有 `recurrence` 字段）
2. 如果对普通日程调用，会返回错误

**如何判断**：
1. 先用 `get` action 获取日程详情
2. 检查返回值中是否有 `recurrence` 字段且不为空
3. 如果有，则可以调用 `instances` 获取实例列表

---

## 📌 使用场景示例

### 场景 1: 创建会议并邀请参会人

```json
{
  "action": "create",
  "summary": "项目复盘会议",
  "description": "讨论 Q1 项目进展",
  "start_time": "2026-02-25 14:00:00",
  "end_time": "2026-02-25 15:30:00",
  "user_open_id": "ou_aaa",
  "attendees": [
    {"type": "user", "id": "ou_bbb"},
    {"type": "user", "id": "ou_ccc"},
    {"type": "resource", "id": "omm_xxx"}
  ]
}
```

### 场景 2: 查询用户未来一周的日程

```json
{
  "action": "list",
  "start_time": "2026-02-25 00:00:00",
  "end_time": "2026-03-03 23:59:00"
}
```

### 场景 3: 查看多个用户的忙闲时间

```json
{
  "action": "list",
  "time_min": "2026-02-25 09:00:00",
  "time_max": "2026-02-25 18:00:00",
  "user_ids": ["ou_aaa", "ou_bbb", "ou_ccc"]
}
```

**注意**：user_ids 是数组，支持 1-10 个用户。当前不支持会议室忙闲查询。

### 场景 4: 修改日程时间

```json
{
  "action": "patch",
  "event_id": "xxx_0",
  "start_time": "2026-02-25 15:00:00",
  "end_time": "2026-02-25 16:00:00"
}
```

### 场景 5: 搜索日程（按关键词）

```json
{
  "action": "search",
  "query": "项目复盘"
}
```

### 场景 6: 回复日程邀请

```json
{
  "action": "reply",
  "event_id": "xxx_0",
  "rsvp_status": "accept"
}
```

---

## 🔍 常见错误与排查

| 错误现象 | 根本原因 | 解决方案 |
|---------|---------|---------|
| **发起人不在参会人列表中** | 未传 `user_open_id` | 强烈建议传 `user_open_id = SenderId` |
| **参会人看不到其他参会人** | `attendee_ability` 权限不足 | 工具已默认设置 `can_modify_event` |
| **时间不对** | 使用了 Unix 时间戳 | 改用 ISO 8601 格式（带时区）：`2024-01-01T00:00:00+08:00` |
| **会议室显示"预约中"** | 会议室预约是异步的 | 等待几秒后用 `list` 查询 `rsvp_status` |
| **修改日程报权限错误** | 当前用户不是组织者，且日程未设置可编辑权限 | 确保日程创建时设置了 `attendee_ability: "can_modify_event"` |
| **无法查看参会人列表** | 当前用户无查看权限 | 确保是组织者或日程设置了 `can_see_others` 以上权限 |

---

## 📚 附录：背景知识

### A. 日历架构模型

飞书日历采用 **三层架构**：
```
日历（Calendar）
  └── 日程（Event）
       └── 参会人（Attendee）
```

**关键理解**：
1. **用户主日历**：日程创建在发起用户的主日历上，用户本人能看到
2. **参会人机制**：通过添加参会人（attendee），让其他人的日历中也显示此日程
3. **权限模型**：日程的 `attendee_ability` 参数控制参会人能否编辑日程、邀请他人、查看参与人列表

### B. 参会人类型

- `type: "user"` + `id: "ou_xxx"` — 飞书用户（使用 open_id）
- `type: "chat"` + `id: "oc_xxx"` — 飞书群组
- `type: "resource"` + `id: "omm_xxx"` — 会议室
- `type: "third_party"` + `id: "email@example.com"` — 外部邮箱

### C. 日程的生命周期

1. **创建**：在用户主日历上创建日程（工具使用用户身份）
2. **邀请参会人**：通过 attendee API 将日程分享给其他参会人
3. **参会人回复**：参会人可以 accept/decline/tentative
4. **修改**：组织者或有权限的参会人可以修改
5. **删除**：删除后状态变为 `cancelled`

### D. 日历类型说明

| 类型 | 说明 | 能否删除 | 能否修改 |
|------|------|---------|---------|
| `primary` | 主日历（每个用户/应用一个） | ❌ 否 | ✅ 是 |
| `shared` | 共享日历（用户创建并共享） | ✅ 是 | ✅ 是 |
| `resource` | 会议室日历 | ❌ 否 | ❌ 否 |
| `google` | 绑定的 Google 日历 | ❌ 否 | ❌ 否 |
| `exchange` | 绑定的 Exchange 日历 | ❌ 否 | ❌ 否 |

### E. 回复状态（rsvp_status）说明

| 状态 | 含义（用户） | 含义（会议室） |
|------|------------|---------------|
| `needs_action` | 未回复 | 预约中 |
| `accept` | 已接受 | 预约成功 |
| `tentative` | 待定 | - |
| `decline` | 拒绝 | 预约失败 |
| `removed` | 已被移除 | 已被移除 |


### F. 使用限制（来自飞书 OAPI 文档）

1. **每个日程最多 3000 名参会人**
2. **单次添加参会人上限**：
   - 用户类参会人：1000 人
   - 会议室：100 个
3. **主日历不可删除**（type 为 primary 的日历）
4. **会议室预约可能失败**：
   - 时间冲突
   - 无预约权限
   - 会议室配置限制
