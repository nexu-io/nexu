# Skill: X (Twitter) 长文发布到草稿箱

> 将 Markdown 文章自动发布到 X Articles 草稿箱，保留富文本格式、自动插入图片和分割线。

## 触发词

发布推特长文、X 长文、Twitter Article、推特文章、发到 X 草稿箱、publish to X article

---

## 前置条件

- Playwright MCP 已启用（浏览器自动化）
- 用户已在 Chrome 登录 X，且有 Premium Plus 订阅（长文功能）
- Python 3.9+，已安装：`pip install Pillow pyobjc-framework-Cocoa`（macOS）
- 脚本目录：`~/.codex/skills/x-article-publisher/scripts/`

---

## 一、核心流水线

### 策略：先文后图后分割线

所有文章统一按此顺序操作：先粘贴全文文本 → 再插入内容图片 → 最后插入分割线。

### 1.1 解析 Markdown

```bash
# 获取结构化 JSON（标题、封面、内容图片位置、分割线位置、HTML）
python ~/.codex/skills/x-article-publisher/scripts/parse_markdown.py /path/to/article.md

# 单独导出 HTML（用于剪贴板粘贴）
python ~/.codex/skills/x-article-publisher/scripts/parse_markdown.py /path/to/article.md --html-only > /tmp/article_html.html
```

JSON 输出关键字段：

```json
{
  "title": "文章标题",
  "cover_image": "/path/to/cover.png",
  "content_images": [
    {
      "path": "/path/to/img.png",
      "block_index": 5,
      "after_text": "前一段末尾文字..."
    }
  ],
  "dividers": [
    { "block_index": 10 }
  ],
  "total_blocks": 45
}
```

### 1.2 打开编辑器

```
browser_navigate → https://x.com/compose/articles
browser_snapshot → 找到 create 按钮
browser_click → 点击 create 进入编辑器
```

### 1.3 上传封面图

```
browser_click → "添加照片或视频" 按钮
browser_file_upload → 选择 cover_image 路径
```

封面图使用 `browser_file_upload`（有专门上传按钮），不走剪贴板。

### 1.4 填写标题

```
browser_click → "添加标题" 输入框
browser_type → 输入 title
```

### 1.5 粘贴正文（剪贴板富文本）

```bash
python ~/.codex/skills/x-article-publisher/scripts/copy_to_clipboard.py html --file /tmp/article_html.html
```

```
browser_click → 编辑器正文区域
browser_press_key → Meta+v
```

保留所有富文本格式：H2、加粗、链接、列表、引用。

### 1.6 插入内容图片（从大到小）

按 `block_index` **从大到小**逐张插入，避免位置偏移：

```bash
# 1. 复制图片到剪贴板
python ~/.codex/skills/x-article-publisher/scripts/copy_to_clipboard.py image /path/to/img.png --quality 85
```

```
# 2. 定位到目标段落
browser_snapshot → 找到包含 after_text 的段落
browser_click → 点击该段落

# 3. 【关键】按 End 移到行尾（避免误触链接）
browser_press_key → End

# 4. 按 Enter 换行 + 粘贴图片
browser_press_key → Enter
browser_press_key → Meta+v

# 5. 等待上传完成
browser_wait_for textGone="正在上传媒体"
```

### 1.7 插入分割线（从大到小）

分割线无法通过 HTML `<hr>` 粘贴，必须走 X 编辑器菜单：

```
# 1. 点击目标位置的段落
browser_click → block_index 对应的段落

# 2. 打开 Insert 菜单
browser_click → "Insert" / "添加媒体" 按钮

# 3. 选择 Divider
browser_click → "Divider" / "分割线" 菜单项
```

同样按 block_index 从大到小。

### 1.8 保存草稿

草稿自动保存。操作完成后：
- 点击"预览"验证格式
- 报告"Draft saved. Review and publish manually."
- **绝不自动发布**

---

## 二、脚本参考

| 脚本 | 用途 |
|------|------|
| `parse_markdown.py` | 解析 Markdown → JSON + HTML |
| `copy_to_clipboard.py` | 复制图片/HTML 到系统剪贴板 |
| `table_to_image.py` | 将 Markdown 表格转换为 PNG 图片 |

所有脚本位于 `~/.codex/skills/x-article-publisher/scripts/`。

### copy_to_clipboard.py 用法

```bash
# 复制图片（带压缩）
python copy_to_clipboard.py image /path/to/image.jpg --quality 85

# 复制 HTML（富文本粘贴）
python copy_to_clipboard.py html --file /path/to/content.html
```

### table_to_image.py 用法

```bash
# 表格转图片（X Articles 不支持原生表格）
python table_to_image.py input.md output.png --scale 2
```

---

## 三、格式支持表

| Markdown 元素 | X Articles 支持 | 处理方式 |
|---------------|-----------------|----------|
| `##` H2 标题 | 原生 | 直接粘贴 |
| `**加粗**` | 原生 | 直接粘贴 |
| `*斜体*` | 原生 | 直接粘贴 |
| `[链接](url)` | 原生 | 直接粘贴 |
| 有序列表 `1.` | 原生 | 直接粘贴 |
| 无序列表 `-` | 原生 | 直接粘贴 |
| 引用 `>` | 原生 | 直接粘贴 |
| 代码块 | 转换 | → 引用块 |
| 表格 | 转换 | → PNG 图片（`table_to_image.py`） |
| Mermaid | 转换 | → PNG 图片（`mmdc`） |
| 分割线 `---` | 菜单插入 | Insert > Divider |

---

## 四、效率原则

### 避免多余的 browser_snapshot

每次 browser_click / browser_press_key 返回结果中已包含页面状态，直接使用即可。

```
❌ browser_click → browser_snapshot → 分析 → browser_click
✅ browser_click → 从返回结果中获取状态 → browser_click
```

### 准备工作前置

在开始浏览器操作之前，先完成所有准备：
1. 解析 Markdown → JSON
2. 生成 HTML 到 /tmp/
3. 记录 title、cover_image、content_images 列表

浏览器操作阶段连续执行，不中途停下来处理数据。

### 等待策略

Playwright `browser_wait_for` 的行为：先等 `time` 秒 → 再检查条件。

```
✅ 只用 textGone，不设 time → 自动轮询等待条件满足
❌ 同时用 textGone + time → 先傻等 time 秒再检查，浪费时间
```

---

## 五、故障排除

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `Browser is already in use` | Chrome 被锁定 | `browser_close` 后重新 `browser_navigate` |
| 图片位置偏移 | 点击段落时误触链接 | 点击后**必须按 End**移到行尾 |
| `正在上传媒体` 卡住 | 图片文件过大 | 用 `--quality 85` 压缩 |
| 图片路径找不到 | 相对路径解析失败 | `parse_markdown.py` 自动搜索 `~/Downloads` `~/Desktop` |
| Playwright MCP 不可用 | 连接断开 | 执行 `/mcp` → 选 playwright → Restart |
| 粘贴后格式丢失 | 未用 HTML 剪贴板 | 确认用了 `copy_to_clipboard.py html` |

---

## 六、关键规则

1. **绝不自动发布** — 只保存草稿
2. **第一张图 = 封面图** — 用 `browser_file_upload` 上传
3. **内容图用剪贴板** — `copy_to_clipboard.py image` + `Meta+v`，比菜单快
4. **反向插入** — 图片和分割线都按 `block_index` 从大到小
5. **必须按 End** — 点击段落后按 End 避免链接干扰
6. **分割线走菜单** — `<hr>` 标签会被 X 忽略，必须用 Insert > Divider
7. **H1 只做标题** — H1 不进正文，只填入标题栏
