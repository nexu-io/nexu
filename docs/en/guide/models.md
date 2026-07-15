# Model Configuration

Nexu supports two model integration paths: **Nexu Official** (managed models, sign in and go) and **BYOK** (Bring Your Own Key). You can switch between them at any time without affecting existing conversations or channel connections.

## Step 1: Open Settings

Click **Settings** in the left sidebar of the nexu client to open the AI Model Providers configuration page.

![Open the Settings page](/assets/nexu-settings-open.webp)

## Step 2: Choose an Integration Mode

### Option A: Nexu Official

Select **Nexu Official** from the provider list on the left, then click **Sign in to Nexu** to authenticate.

Once signed in, no API key is needed. Managed models become available immediately.

![Nexu Official model configuration](/assets/nexu-models-official.webp)

### Option B: Bring Your Own Key

Select **Anthropic**, **OpenAI**, **Google AI**, or another provider from the list:

1. Paste your key into the **API Key** field.
2. Modify **API Proxy URL** if you need a custom proxy.
3. Click **Save**. nexu will verify the key and load the available model list automatically.

![BYOK model configuration](/assets/nexu-models-byok.webp)

### MiniMax

The built-in MiniMax provider uses the Anthropic-compatible API. Choose the global or China region preset in the MiniMax settings to use the matching Anthropic-compatible base URL. To use the OpenAI-compatible API instead, add a **Custom OpenAI-compatible** provider and enter the matching OpenAI-compatible base URL.

| Region | Anthropic-compatible base URL | OpenAI-compatible base URL |
| --- | --- | --- |
| Global | `https://api.minimax.io/anthropic` | `https://api.minimax.io/v1` |
| China | `https://api.minimaxi.com/anthropic` | `https://api.minimaxi.com/v1` |

Keep the Anthropic-compatible base URL ending in `/anthropic`. Nexu passes this base URL directly to the runtime, which appends `/v1/messages`.

MiniMax model discovery includes `MiniMax-M3` and `MiniMax-M2.7`. The provider reports the following model metadata; input availability in Nexu depends on the selected product surface.

| Model | Context window | Input modalities | Thinking modes |
| --- | ---: | --- | --- |
| `MiniMax-M3` | 1,000,000 tokens | Text, image, video | Adaptive, disabled |
| `MiniMax-M2.7` | 204,800 tokens | Text | Always on |

MiniMax BYOK prices are in USD per one million tokens:

| Model and service tier | Input token range | Input | Output | Cache read | Cache write |
| --- | --- | ---: | ---: | ---: | ---: |
| `MiniMax-M3`, standard | Up to 512,000 | $0.30 | $1.20 | $0.06 | N/A |
| `MiniMax-M3`, standard | Above 512,000 | $0.60 | $2.40 | $0.12 | N/A |
| `MiniMax-M3`, priority | Up to 512,000 | $0.45 | $1.80 | $0.09 | N/A |
| `MiniMax-M3`, priority | Above 512,000 | $0.90 | $3.60 | $0.18 | N/A |
| `MiniMax-M2.7` | All requests | $0.30 | $1.20 | $0.06 | $0.375 |

## Step 3: Select the Active Model

After a successful connection, use the **Nexu Bot Model** dropdown at the top of the Settings page to choose the model your Agent should use.

![Choose the active model](/assets/nexu-model-select.webp)

## Supported Providers

| Provider | Default Base URL | Key Format |
| --- | --- | --- |
| Anthropic | `https://api.anthropic.com` | `sk-ant-...` |
| OpenAI | `https://api.openai.com/v1` | `sk-...` |
| Google AI | `https://generativelanguage.googleapis.com/v1beta` | `AIza...` |
| xAI | `https://api.x.ai/v1` | `xai-...` |
| Custom | Your OpenAI-compatible endpoint | Depends on the provider |

## Best Practices

- Use least-privilege API keys whenever possible.
- Never expose keys in screenshots, tickets, or git history.
- When adding a BYOK provider, verify connectivity before saving.
- Use **Custom** if you need a proxy, self-hosted gateway, or another OpenAI-compatible inference service.

## FAQ

**Q: Which mode should I start with?**

Nexu Official is the easiest place to start: just sign in and begin using managed models.

**Q: Can I configure multiple BYOK providers at the same time?**

Yes. Providers can be configured independently, and you can switch between them through the model selector.

**Q: Are API keys uploaded to nexu servers?**

No. API keys are stored on your local device and are not uploaded to nexu servers.
