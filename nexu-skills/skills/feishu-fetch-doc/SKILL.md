---
name: feishu-fetch-doc
description: |
  获取飞书云文档内容。返回文档的 Markdown 内容，支持处理文档中的图片、文件和画板（需配合 feishu_doc_media 工具）。
tag: file-knowledge
icon: FileSearch
source: official
prompt: Help me read Feishu documents
examples:
  - 帮我读取这个飞书文档的内容
  - 获取知识库中这篇文档的内容
  - 帮我查看这个文档链接里写了什么
requires:
  plugins:
    - "@larksuite/openclaw-lark"
---

# feishu_mcp_fetch_doc

获取飞书云文档的 Markdown 内容（Lark-flavored 格式）。

## 重要：图片、文件、画板的处理

**文档中的图片、文件、画板需要通过 `feishu_doc_media`（action: download）工具单独获取！**

### 识别格式

返回的 Markdown 中，媒体文件以 HTML 标签形式出现：

- **图片**：
  ```html
  <image token="Z1FjxxxxxxxxxxxxxxxxxxxtnAc" width="1833" height="2491" align="center"/>
  ```

- **文件**：
  ```html
  <view type="1">
    <file token="Z1FjxxxxxxxxxxxxxxxxxxxtnAc" name="skills.zip"/>
  </view>
  ```

- **画板**：
  ```html
  <whiteboard token="Z1FjxxxxxxxxxxxxxxxxxxxtnAc"/>
  ```

### 获取步骤

1. 从 HTML 标签中提取 `token` 属性值
2. 调用 `feishu_doc_media` 下载：
   ```json
   {
     "action": "download",
     "resource_token": "提取的token",
     "resource_type": "media",
     "output_path": "/path/to/save/file"
   }
   ```

## 参数

- **`doc_id`**（必填）：支持直接传文档 URL 或 token
  - 直接传 URL：`https://xxx.feishu.cn/docx/Z1FjxxxxxxxxxxxxxxxxxxxtnAc`（系统自动提取 token）
  - 直接传 token：`Z1FjxxxxxxxxxxxxxxxxxxxtnAc`
  - 知识库 URL/token 也支持：`https://xxx.feishu.cn/wiki/Z1FjxxxxxxxxxxxxxxxxxxxtnAc` 或 `Z1FjxxxxxxxxxxxxxxxxxxxtnAc`

## Wiki URL 处理策略

知识库链接（`/wiki/TOKEN`）背后可能是云文档、电子表格、多维表格等不同类型的文档。当不确定类型时, **不能直接假设是云文档**，必须先查询实际类型。

### 处理流程

1. **先调用 `feishu_wiki_space_node`（action: get）解析 wiki token**：
   ```json
   { "action": "get", "token": "wiki_token_here" }
   ```
2. **从返回的 `node` 中获取 `obj_type`（实际文档类型）和 `obj_token`（实际文档 token）**
3. **根据 `obj_type` 调用对应工具**：

| obj_type | 工具 | 传参 |
|----------|------|------|
| `docx` | `feishu_mcp_fetch_doc` | doc_id = obj_token |
| `sheet` | `feishu_sheet` | spreadsheet_token = obj_token |
| `bitable` | `feishu_bitable_*` 系列 | app_token = obj_token |
| 其他 | 告知用户暂不支持该类型 | — |


### 示例

用户：`帮我看下这个文档 https://xxx.feishu.cn/wiki/ABC123`

1. 调用 `feishu_wiki_space_node`（action: get, token: ABC123）
2. 返回 `obj_type: "docx"`, `obj_token: "doxcnXYZ789"`
3. 调用 `feishu_mcp_fetch_doc`（doc_id: doxcnXYZ789）

## 工具组合

| 需求 | 工具 |
|------|------|
| 获取文档文本 | `feishu_mcp_fetch_doc` |
| 下载图片/文件/画板 | `feishu_doc_media`（action: download） |
| 解析 wiki token 类型 | `feishu_wiki_space_node`（action: get） |
| 读写电子表格 | `feishu_sheet` |
| 操作多维表格 | `feishu_bitable_*` 系列 |
