import type { Model } from "@nexu/shared";

export const PLATFORM_MODELS: Model[] = [
  {
    id: "link/claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    provider: "nexu",
    isDefault: true,
    description: "Recommended - best balance of speed and capability",
  },
  {
    id: "link/claude-opus-4-5",
    name: "Claude Opus 4.5",
    provider: "nexu",
    description: "Most capable - ideal for complex tasks",
  },
  {
    id: "openai/gpt-5.1",
    name: "GPT-5.1",
    provider: "openai",
    description: "OpenAI flagship model for coding and agentic tasks",
  },
  {
    id: "openai/gpt-5-mini",
    name: "GPT-5 mini",
    provider: "openai",
    description: "Faster, lower-cost GPT-5 model for well-defined tasks",
  },
];

export const PLATFORM_MODEL_CATALOG = Object.fromEntries(
  PLATFORM_MODELS.map((m) => [m.id, { alias: m.name }]),
);
