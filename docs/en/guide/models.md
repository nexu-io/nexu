# Model Configuration

Nexu supports two model paths:

- `Nexu Official`: platform-managed access with no provider key stored by the user
- `Bring your own key`: connect a provider such as Anthropic, OpenAI, Google AI, or a custom OpenAI-compatible endpoint

## Supported provider patterns

| Provider | Typical base URL | Key format |
| --- | --- | --- |
| Anthropic | `https://api.anthropic.com` | `sk-ant-...` |
| OpenAI | `https://api.openai.com/v1` | `sk-...` |
| Google AI | `https://generativelanguage.googleapis.com/v1beta` | `AIza...` |
| Custom | your OpenAI-compatible endpoint | provider-specific |

## In the Nexu UI

1. Open the Models page.
2. Choose a provider.
3. Paste the API key.
4. Optionally set a custom base URL.
5. Verify the connection.
6. Enable the models you want available in the workspace.

## Operational guidance

- Prefer least-privilege provider keys.
- Do not share provider keys in screenshots, support tickets, or git history.
- Verify before enabling a provider so Nexu can discover available models.
- Use a custom provider when you need a proxy, self-hosted gateway, or compatible inference service.

## Default examples

Nexu currently highlights these common model families:

- Anthropic: `claude-opus-4`, `claude-sonnet-4`, `claude-haiku`
- OpenAI: `gpt-4o`, `gpt-4o-mini`, `o1`, `o3-mini`
- Google AI: `gemini-2.5-flash`, `gemini-2.5-pro`

## Best practice

Use `Nexu Official` for the fastest onboarding, then add BYOK providers only when you need model control, billing separation, or custom routing.
