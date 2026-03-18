# 模型配置

Nexu 当前有两类模型接入方式：

- `Nexu Official`：平台托管，不需要用户自己保存供应商密钥
- `自带密钥`：接入 Anthropic、OpenAI、Google AI 或自定义兼容端点

## 常见供应商模式

| 供应商 | 常见 Base URL | 密钥格式 |
| --- | --- | --- |
| Anthropic | `https://api.anthropic.com` | `sk-ant-...` |
| OpenAI | `https://api.openai.com/v1` | `sk-...` |
| Google AI | `https://generativelanguage.googleapis.com/v1beta` | `AIza...` |
| Custom | 你的 OpenAI 兼容端点 | 取决于服务商 |

## 在 Nexu UI 中配置

1. 打开 Models 页面。
2. 选择一个 provider。
3. 填入 API Key。
4. 按需设置自定义 Base URL。
5. 先执行验证。
6. 启用你希望在工作区可见的模型。

## 运维建议

- 使用最小权限的 provider key。
- 不要在截图、工单或 git 历史中暴露密钥。
- 启用前先验证连接，这样 Nexu 可以发现可用模型列表。
- 如果你需要代理、自建网关或兼容推理服务，使用 Custom provider。

## 默认会重点展示的模型家族

- Anthropic：`claude-opus-4`、`claude-sonnet-4`、`claude-haiku`
- OpenAI：`gpt-4o`、`gpt-4o-mini`、`o1`、`o3-mini`
- Google AI：`gemini-2.5-flash`、`gemini-2.5-pro`

## 最佳实践

如果只是快速开始，优先使用 `Nexu Official`；当你需要更细的模型控制、独立计费或自定义路由时，再增加 BYOK provider。
