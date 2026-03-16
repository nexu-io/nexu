export interface ProviderCatalogModel {
  id: string;
  name: string;
  description: string;
}

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  description: string;
  apiDocsUrl: string;
  baseUrlPlaceholder: string;
  apiKeyPlaceholder: string;
  badge: string;
  models: ProviderCatalogModel[];
}

export const OPENCLAW_PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Direct Claude API access for OpenClaw sidecar.",
    apiDocsUrl: "https://console.anthropic.com/settings/keys",
    baseUrlPlaceholder: "https://api.anthropic.com/v1",
    apiKeyPlaceholder: "sk-ant-...",
    badge: "A",
    models: [
      {
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4",
        description: "Balanced default for day-to-day work",
      },
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        description: "Higher-end reasoning and coding",
      },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI responses API models.",
    apiDocsUrl: "https://platform.openai.com/api-keys",
    baseUrlPlaceholder: "https://api.openai.com/v1",
    apiKeyPlaceholder: "sk-...",
    badge: "O",
    models: [
      {
        id: "gpt-4o",
        name: "GPT-4o",
        description: "General multimodal flagship",
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o mini",
        description: "Lower-cost fast path",
      },
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    description: "Google Generative AI provider.",
    apiDocsUrl: "https://aistudio.google.com/app/apikey",
    baseUrlPlaceholder: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyPlaceholder: "AIza...",
    badge: "G",
    models: [
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        description: "Higher-end reasoning",
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        description: "Lower-latency default",
      },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "OpenAI-compatible multi-provider gateway.",
    apiDocsUrl: "https://openrouter.ai/keys",
    baseUrlPlaceholder: "https://openrouter.ai/api/v1",
    apiKeyPlaceholder: "sk-or-...",
    badge: "R",
    models: [
      {
        id: "anthropic/claude-sonnet-4",
        name: "Claude Sonnet 4 via OpenRouter",
        description: "Anthropic through OpenRouter",
      },
      {
        id: "openai/gpt-4o",
        name: "GPT-4o via OpenRouter",
        description: "OpenAI through OpenRouter",
      },
    ],
  },
];
