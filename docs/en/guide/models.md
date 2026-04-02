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
