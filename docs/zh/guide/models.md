# 模型配置

nexu 支持两种模型接入方式：**Nexu Official**（托管模型，登录即用）和 **BYOK**（自带 API Key）。两种方式可随时切换，不影响已有对话和渠道连接。

## 第一步：打开 Settings

在 nexu 客户端左侧导航栏点击 **Settings**，进入 AI Model Providers 配置页面。

![打开 Settings 页面](/assets/nexu-settings-open.webp)

## 第二步：选择接入方式

### 方式 A — Nexu Official（推荐）

在左侧供应商列表中选择 **Nexu Official**，点击 **Sign in to Nexu** 完成账号登录。

登录后无需配置任何 API Key，Claude Sonnet 4.6、Claude Opus 4.6、Claude Haiku 4.5 等模型立即可用。

![Nexu Official 模型配置](/assets/nexu-models-official.webp)

### 方式 B — 自带密钥（BYOK）

在左侧供应商列表中选择 **Anthropic**、**OpenAI**、**Google AI** 或其他供应商：

1. 在 **API Key** 字段粘贴你的密钥。
2. 如需自定义代理，修改 **API Proxy URL**。
3. 点击 **Save**，nexu 会自动验证密钥并加载可用模型列表。

![BYOK 自带密钥配置](/assets/nexu-models-byok.webp)

## 第三步：选择当前模型

连接成功后，在 Settings 页面顶部 **Nexu Bot Model** 下拉菜单中选择 Agent 使用的模型，支持跨供应商随时切换。

![选择当前模型](/assets/nexu-model-select.webp)

## 支持的供应商

| 供应商 | 默认 Base URL | 密钥格式 |
| --- | --- | --- |
| Anthropic | `https://api.anthropic.com` | `sk-ant-...` |
| OpenAI | `https://api.openai.com/v1` | `sk-...` |
| Google AI | `https://generativelanguage.googleapis.com/v1beta` | `AIza...` |
| xAI | `https://api.x.ai/v1` | `xai-...` |
| Custom | 你的 OpenAI 兼容端点 | 取决于服务商 |

## 使用建议

- 使用最小权限的 API Key，避免不必要的访问范围。
- 不要在截图、工单或 Git 提交记录中暴露密钥。
- 添加 BYOK 供应商时，先点击 **Verify Connection** 验证连通性，确认无误后再保存。
- 需要代理、自建网关或 OpenAI 兼容推理服务时，使用 **Custom** 供应商类型。

## 常见问题

**Q: 刚开始用哪种方式比较好？**

推荐 Nexu Official——登录账号后无需任何配置，即可使用高质量模型。

**Q: 可以同时配置多个 BYOK 供应商吗？**

可以。Anthropic、OpenAI、Google AI 等可以独立配置，随时通过顶部 **Nexu Bot Model** 下拉菜单切换。

**Q: API Key 会被上传到 nexu 服务器吗？**

不会。API Key 仅存储在你的本地设备上，不会传输至 nexu 服务器。
