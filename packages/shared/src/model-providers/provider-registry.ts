import type {
  CustomProviderProtocolFamily,
  ProviderRegistryEntry,
  ProviderUiMetadata,
} from "./provider-types.js";

const bundledProviderModelsById = {
  anthropic: [
    {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
    },
    {
      id: "claude-haiku-4-5",
      name: "Claude Haiku 4.5",
    },
    {
      id: "claude-opus-4-6",
      name: "Claude Opus 4.6",
    },
  ],
  openai: [
    {
      id: "gpt-5.4",
      name: "GPT 5.4",
    },
    {
      id: "gpt-5.4",
      name: "GPT 5.4",
    },
    {
      id: "gpt-4o",
      name: "GPT-4o",
    },
  ],
  google: [
    {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
    },
    {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
    },
    {
      id: "gemini-3-pro-preview",
      name: "Gemini 3 Pro Preview",
    },
  ],
  ollama: [
    {
      id: "llama3.2",
      name: "llama3.2",
    },
    {
      id: "qwen3:8b",
      name: "qwen3:8b",
    },
    {
      id: "gemma3:4b",
      name: "gemma3:4b",
    },
  ],
  siliconflow: [
    {
      id: "deepseek-ai/DeepSeek-V3.2",
      name: "DeepSeek V3.2",
    },
    {
      id: "Qwen/Qwen3-8B",
      name: "Qwen3 8B",
    },
  ],
  ppio: [
    {
      id: "deepseek/deepseek-v3.2",
      name: "DeepSeek V3.2",
    },
    {
      id: "minimax/minimax-m2.7",
      name: "MiniMax M2.7",
    },
    {
      id: "qwen/qwen3-235b-a22b-instruct-2507",
      name: "Qwen3 235B A22B Instruct",
    },
  ],
  nvidia: [
    {
      id: "moonshotai/kimi-k2.5",
      name: "Kimi K2.5",
    },
    {
      id: "minimaxai/minimax-m2.7",
      name: "MiniMax M2.7",
    },
  ],
  stepfun: [
    {
      id: "step-1-flash",
      name: "Step 1 Flash",
    },
    {
      id: "step-1-8k",
      name: "Step 1 8K",
    },
  ],
  "amazon-bedrock": [
    {
      id: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      name: "Claude 3.5 Sonnet v2",
    },
    {
      id: "amazon.nova-pro-v1:0",
      name: "Amazon Nova Pro",
    },
    {
      id: "meta.llama3-1-70b-instruct-v1:0",
      name: "Llama 3.1 70B Instruct",
    },
  ],
  deepseek: [
    {
      id: "deepseek-chat",
      name: "DeepSeek Chat",
    },
    {
      id: "deepseek-reasoner",
      name: "DeepSeek Reasoner",
    },
  ],
  openrouter: [
    {
      id: "google/gemini-2.5-flash-preview-09-2025",
      name: "Google: Gemini 2.5 Flash Preview",
    },
    {
      id: "deepseek/deepseek-chat",
      name: "DeepSeek: V3",
    },
    {
      id: "qwen/qwen-2.5-7b-instruct",
      name: "Qwen 2.5 7B Instruct",
    },
  ],
  mistral: [
    {
      id: "mistral-large-latest",
      name: "Mistral Large",
    },
    {
      id: "mistral-small-latest",
      name: "Mistral Small",
    },
    {
      id: "codestral-latest",
      name: "Codestral",
    },
  ],
  xai: [
    {
      id: "grok-4",
      name: "Grok 4",
    },
    {
      id: "grok-3",
      name: "Grok 3",
    },
    {
      id: "grok-3-mini",
      name: "Grok 3 Mini",
    },
  ],
  together: [
    {
      id: "meta-llama/llama-3.2-11b-vision-instruct",
      name: "Llama 3.2 11B Vision",
    },
    {
      id: "meta-llama/llama-3.2-90b-vision-instruct",
      name: "Llama 3.2 90B Vision",
    },
    {
      id: "google/gemma-2-27b-it",
      name: "Gemma 2 27B Instruct",
    },
  ],
  huggingface: [
    {
      id: "meta-llama/Llama-3.1-8B-Instruct",
      name: "Llama 3.1 8B Instruct",
    },
    {
      id: "Qwen/Qwen2.5-7B-Instruct",
      name: "Qwen 2.5 7B Instruct",
    },
    {
      id: "mistralai/Mistral-7B-Instruct-v0.3",
      name: "Mistral 7B Instruct",
    },
  ],
  qwen: [
    {
      id: "qwen3-max",
      name: "Qwen3 Max",
    },
    {
      id: "qwen3.5-plus",
      name: "Qwen3.5 Plus",
    },
    {
      id: "qwen3.5-flash",
      name: "Qwen3.5 Flash",
    },
  ],
  volcengine: [
    {
      id: "doubao-seed-1-8-251228",
      name: "Doubao Seed 1.8",
    },
    {
      id: "doubao-1-5-pro-32k-250115",
      name: "Doubao 1.5 Pro 32K",
    },
    {
      id: "deepseek-v3.2",
      name: "DeepSeek V3.2",
    },
  ],
  qianfan: [
    {
      id: "deepseek-r1",
      name: "DeepSeek R1",
    },
    {
      id: "deepseek-v3",
      name: "DeepSeek V3",
    },
    {
      id: "ernie-4.0-8k-latest",
      name: "ERNIE 4.0",
    },
  ],
  vllm: [
    {
      id: "meta-llama/Llama-3.1-8B-Instruct",
      name: "Llama 3.1 8B Instruct",
    },
    {
      id: "Qwen/Qwen2.5-7B-Instruct",
      name: "Qwen 2.5 7B Instruct",
    },
    {
      id: "deepseek-r1-distill-qwen-7b",
      name: "DeepSeek R1 Distill Qwen 7B",
    },
  ],
  xiaomi: [
    {
      id: "mimo-v2-flash",
      name: "Xiaomi MiMo V2 Flash",
    },
    {
      id: "mimo-v2-pro",
      name: "Xiaomi MiMo V2 Pro",
    },
    {
      id: "mimo-v2-omni",
      name: "Xiaomi MiMo V2 Omni",
    },
  ],
  minimax: [
    {
      id: "MiniMax-M2.7",
      name: "MiniMax M2.7",
    },
    {
      id: "MiniMax-M2.7",
      name: "MiniMax M2.7",
    },
    {
      id: "MiniMax-M2.7-highspeed",
      name: "MiniMax M2.7 Highspeed",
    },
  ],
  kimi: [
    {
      id: "kimi-k2.5",
      name: "Kimi K2.5",
    },
    {
      id: "kimi-k2-0905-Preview",
      name: "Kimi K2 Preview",
    },
    {
      id: "kimi-k2-thinking",
      name: "Kimi K2 Thinking",
    },
  ],
  glm: [
    {
      id: "glm-5",
      name: "GLM-5",
    },
    {
      id: "glm-4.7",
      name: "GLM-4.7",
    },
    {
      id: "glm-4.5-flash",
      name: "GLM-4.5 Flash",
    },
  ],
} as const;

const providerRegistryEntries = [
  {
    id: "anthropic",
    canonicalOpenClawId: "anthropic",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Anthropic",
    descriptionKey: "models.provider.anthropic.description",
    apiDocsUrl: "https://console.anthropic.com/settings/keys",
    apiKeyPlaceholder: "sk-ant-api03-...",
    defaultProxyUrl: "https://api.anthropic.com",
    authModes: ["api-key"],
    apiKind: "anthropic-messages",
    defaultBaseUrls: ["https://api.anthropic.com/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "openai",
    canonicalOpenClawId: "openai",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "OpenAI",
    descriptionKey: "models.provider.openai.description",
    apiDocsUrl: "https://platform.openai.com/api-keys",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.openai.com/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.openai.com/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "google",
    canonicalOpenClawId: "gemini",
    aliases: ["gemini"],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Google AI Studio",
    descriptionKey: "models.provider.google.description",
    apiDocsUrl: "https://aistudio.google.com/app/apikey",
    apiKeyPlaceholder: "AIza...",
    defaultProxyUrl: "https://generativelanguage.googleapis.com/v1beta",
    authModes: ["api-key"],
    apiKind: "google-generative-ai",
    defaultBaseUrls: ["https://generativelanguage.googleapis.com/v1beta"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "ollama",
    canonicalOpenClawId: "ollama",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Ollama",
    descriptionKey: "models.provider.ollama.description",
    apiDocsUrl: "https://ollama.com/download",
    apiKeyPlaceholder: "ollama-local",
    defaultProxyUrl: "http://127.0.0.1:11434",
    authModes: ["api-key"],
    apiKind: "ollama",
    defaultBaseUrls: ["http://127.0.0.1:11434"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
  },
  {
    id: "siliconflow",
    canonicalOpenClawId: "siliconflow",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "SiliconFlow",
    displayNameKey: "models.provider.siliconflow.name",
    descriptionKey: "models.provider.siliconflow.description",
    apiDocsUrl: "https://cloud.siliconflow.cn/account/ak",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.siliconflow.cn/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: [
      "https://api.siliconflow.cn/v1",
      "https://api.siliconflow.com/v1",
    ],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "ppio",
    canonicalOpenClawId: "ppio",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "PPIO",
    descriptionKey: "models.provider.ppio.description",
    apiDocsUrl: "https://www.ppinfra.com/",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.ppinfra.com/v3/openai",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.ppinfra.com/v3/openai"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "nvidia",
    canonicalOpenClawId: "nvidia",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "NVIDIA",
    descriptionKey: "models.provider.nvidia.description",
    apiDocsUrl: "https://build.nvidia.com/settings/api-keys",
    apiKeyPlaceholder: "nvapi-...",
    defaultProxyUrl: "https://integrate.api.nvidia.com/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://integrate.api.nvidia.com/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "stepfun",
    canonicalOpenClawId: "stepfun",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "StepFun",
    descriptionKey: "models.provider.stepfun.description",
    apiDocsUrl: "https://docs.openclaw.ai/providers/stepfun",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.stepfun.ai/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.stepfun.ai/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "amazon-bedrock",
    canonicalOpenClawId: "amazon-bedrock",
    aliases: ["bedrock", "aws-bedrock"],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "AWS Bedrock",
    descriptionKey: "models.provider.amazonBedrock.description",
    apiDocsUrl: "https://docs.openclaw.ai/providers/bedrock",
    defaultProxyUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    authModes: ["aws-sdk"],
    apiKind: "bedrock-converse-stream",
    defaultBaseUrls: ["https://bedrock-runtime.us-east-1.amazonaws.com"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "deepseek",
    canonicalOpenClawId: "deepseek",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "DeepSeek",
    descriptionKey: "models.provider.deepseek.description",
    apiDocsUrl: "https://docs.openclaw.ai/providers/deepseek",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.deepseek.com",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.deepseek.com"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "openrouter",
    canonicalOpenClawId: "openrouter",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "OpenRouter",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://openrouter.ai/settings/keys",
    apiKeyPlaceholder: "sk-or-...",
    defaultProxyUrl: "https://openrouter.ai/api/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://openrouter.ai/api/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "mistral",
    canonicalOpenClawId: "mistral",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Mistral AI",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://console.mistral.ai/api-keys/",
    apiKeyPlaceholder: "...",
    defaultProxyUrl: "https://api.mistral.ai/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.mistral.ai/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "xai",
    canonicalOpenClawId: "xai",
    aliases: ["grok"],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "xAI",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://docs.x.ai/docs/overview",
    apiKeyPlaceholder: "xai-...",
    defaultProxyUrl: "https://api.x.ai/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.x.ai/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "together",
    canonicalOpenClawId: "together",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Together AI",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://docs.together.ai/docs/openai-api-compatibility",
    apiKeyPlaceholder: "...",
    defaultProxyUrl: "https://api.together.xyz/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.together.xyz/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "huggingface",
    canonicalOpenClawId: "huggingface",
    aliases: ["hf"],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Hugging Face",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl:
      "https://huggingface.co/docs/inference-providers/guides/responses-api",
    apiKeyPlaceholder: "hf_...",
    defaultProxyUrl: "https://router.huggingface.co/v1",
    authModes: ["token"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://router.huggingface.co/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "qwen",
    canonicalOpenClawId: "qwen-portal",
    aliases: ["qwen-portal"],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Qwen",
    displayNameKey: "models.provider.qwen.name",
    descriptionKey: "models.provider.qwen.description",
    apiDocsUrl:
      "https://help.aliyun.com/zh/model-studio/developer-reference/compatibility-of-openai-with-dashscope",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://dashscope.aliyuncs.com/compatible-mode/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "volcengine",
    canonicalOpenClawId: "volcengine",
    aliases: ["bytedance", "doubao"],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Volcengine Ark",
    displayNameKey: "models.provider.volcengine.name",
    descriptionKey: "models.provider.volcengine.description",
    apiDocsUrl: "https://www.volcengine.com/docs/82379/1330626",
    apiKeyPlaceholder: "...",
    defaultProxyUrl: "https://ark.cn-beijing.volces.com/api/v3",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://ark.cn-beijing.volces.com/api/v3"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "qianfan",
    canonicalOpenClawId: "qianfan",
    aliases: ["baidu"],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Baidu Qianfan",
    displayNameKey: "models.provider.qianfan.name",
    descriptionKey: "models.provider.qianfan.description",
    apiDocsUrl: "https://console.bce.baidu.com/qianfan/ais/console/apiKey",
    apiKeyPlaceholder: "...",
    defaultProxyUrl: "https://qianfan.baidubce.com/v2",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://qianfan.baidubce.com/v2"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "vllm",
    canonicalOpenClawId: "vllm",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "vLLM",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl:
      "https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html",
    apiKeyPlaceholder: "token-...",
    defaultProxyUrl: "http://127.0.0.1:8000/v1",
    authModes: ["api-key", "token"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["http://127.0.0.1:8000/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "byteplus",
    canonicalOpenClawId: "byteplus",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: false,
    displayName: "BytePlus ModelArk",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://docs.byteplus.com/en/docs/ModelArk/1298459",
    apiKeyPlaceholder: "...",
    defaultProxyUrl: "https://ark.byteplus.com/api/v3",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://ark.byteplus.com/api/v3"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "venice",
    canonicalOpenClawId: "venice",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: false,
    displayName: "Venice",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://docs.venice.ai/api-reference",
    apiKeyPlaceholder: "...",
    defaultProxyUrl: "https://api.venice.ai/api/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.venice.ai/api/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "github-copilot",
    canonicalOpenClawId: "github-copilot",
    aliases: ["copilot"],
    controllerConfigurable: true,
    modelsPageVisible: false,
    displayName: "GitHub Copilot",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://docs.github.com/en/copilot",
    apiKeyPlaceholder: "github_pat_...",
    defaultProxyUrl: "https://api.githubcopilot.com",
    authModes: ["token"],
    apiKind: "github-copilot",
    defaultBaseUrls: ["https://api.githubcopilot.com"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "xiaomi",
    canonicalOpenClawId: "xiaomi",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Xiaomi MiMo",
    displayNameKey: "models.provider.xiaomi.name",
    descriptionKey: "models.provider.xiaomi.description",
    apiDocsUrl: "https://platform.xiaomimimo.com/#/console/api-keys",
    apiKeyPlaceholder: "...",
    defaultProxyUrl: "https://api.xiaomimimo.com/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.xiaomimimo.com/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "chutes",
    canonicalOpenClawId: "chutes",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: false,
    displayName: "Chutes",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiKeyPlaceholder: "...",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: [],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "minimax",
    canonicalOpenClawId: "minimax",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "MiniMax",
    descriptionKey: "models.provider.minimax.description",
    apiDocsUrl:
      "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.minimax.io/anthropic",
    authModes: ["api-key", "oauth"],
    apiKind: "anthropic-messages",
    defaultBaseUrls: [
      "https://api.minimax.io/anthropic",
      "https://api.minimaxi.com/anthropic",
    ],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
    requiresOauthRegion: true,
    authHeader: true,
    managedByAuthProfiles: true,
  },
  {
    id: "kimi",
    canonicalOpenClawId: "moonshot",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Moonshot",
    descriptionKey: "models.provider.kimi.description",
    apiDocsUrl: "https://platform.moonshot.cn/console/api-keys",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.moonshot.cn/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.moonshot.cn/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "glm",
    canonicalOpenClawId: "zai",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Zhipu",
    displayNameKey: "models.provider.glm.name",
    descriptionKey: "models.provider.glm.description",
    apiDocsUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    apiKeyPlaceholder: "eyJ...",
    defaultProxyUrl: "https://open.bigmodel.cn/api/paas/v4",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://open.bigmodel.cn/api/paas/v4"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "moonshot",
    canonicalOpenClawId: "moonshot",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: false,
    displayName: "Moonshot AI",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://platform.moonshot.cn/console/api-keys",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.moonshot.cn/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.moonshot.cn/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "zai",
    canonicalOpenClawId: "zai",
    aliases: ["z.ai", "z-ai"],
    controllerConfigurable: true,
    modelsPageVisible: false,
    displayName: "Z.ai",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    apiKeyPlaceholder: "eyJ...",
    defaultProxyUrl: "https://open.bigmodel.cn/api/paas/v4",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://open.bigmodel.cn/api/paas/v4"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "custom-openai",
    canonicalOpenClawId: "custom-openai",
    aliases: [],
    controllerConfigurable: false,
    modelsPageVisible: false,
    displayName: "Custom OpenAI-compatible",
    descriptionKey: "models.provider.openaiCompatible.description",
    authModes: ["api-key", "token"],
    apiKind: "openai-completions",
    defaultBaseUrls: [],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
    hidden: true,
  },
  {
    id: "custom-anthropic",
    canonicalOpenClawId: "custom-anthropic",
    aliases: [],
    controllerConfigurable: false,
    modelsPageVisible: false,
    displayName: "Custom Anthropic-compatible",
    descriptionKey: "models.provider.anthropic.description",
    authModes: ["api-key", "token"],
    apiKind: "anthropic-messages",
    defaultBaseUrls: [],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
    hidden: true,
  },
] as const satisfies readonly ProviderRegistryEntry[];

type ProviderRegistryEntryId = (typeof providerRegistryEntries)[number]["id"];
type ProviderRegistryEntryConfigurableId = Extract<
  (typeof providerRegistryEntries)[number],
  { controllerConfigurable: true }
>["id"];
type ProviderRegistryEntryModelsPageId = Extract<
  (typeof providerRegistryEntries)[number],
  { modelsPageVisible: true }
>["id"];

function cloneProviderRegistryEntry(
  entry: ProviderRegistryEntry,
): ProviderRegistryEntry {
  return {
    ...entry,
    aliases: [...entry.aliases],
    authModes: [...entry.authModes],
    defaultBaseUrls: [...entry.defaultBaseUrls],
    defaultHeaders: entry.defaultHeaders
      ? { ...entry.defaultHeaders }
      : undefined,
  };
}

export const supportedByokProviderIds = providerRegistryEntries
  .filter((entry) => entry.controllerConfigurable)
  .map((entry) => entry.id) as [
  ProviderRegistryEntryConfigurableId,
  ...ProviderRegistryEntryConfigurableId[],
];

export type SupportedByokProviderId = (typeof supportedByokProviderIds)[number];

export const modelsPageProviderIds = providerRegistryEntries
  .filter((entry) => entry.modelsPageVisible)
  .map((entry) => entry.id) as [
  ProviderRegistryEntryModelsPageId,
  ...ProviderRegistryEntryModelsPageId[],
];

export type ModelsPageProviderId = (typeof modelsPageProviderIds)[number];

const providerRegistryEntryMap = new Map<string, ProviderRegistryEntry>(
  providerRegistryEntries.map((entry) => [entry.id, entry]),
);

const normalizedProviderIdMap = new Map<string, string>();

for (const entry of providerRegistryEntries) {
  normalizedProviderIdMap.set(entry.id.toLowerCase(), entry.id);
  for (const alias of entry.aliases) {
    normalizedProviderIdMap.set(alias.toLowerCase(), entry.id);
  }
}

const supportedByokProviderIdSet = new Set<string>(supportedByokProviderIds);

export function listProviderRegistryEntries(): ProviderRegistryEntry[] {
  return providerRegistryEntries.map((entry) =>
    cloneProviderRegistryEntry(entry),
  );
}

export function getProviderRegistryEntry(
  providerId: string,
): ProviderRegistryEntry | null {
  const normalizedProviderId = normalizeProviderId(providerId);
  if (!normalizedProviderId) {
    return null;
  }

  const entry = providerRegistryEntryMap.get(normalizedProviderId);
  return entry ? cloneProviderRegistryEntry(entry) : null;
}

export function normalizeProviderId(providerId: string): string | null {
  const normalizedInput = providerId.trim().toLowerCase();
  if (normalizedInput.length === 0) {
    return null;
  }

  return normalizedProviderIdMap.get(normalizedInput) ?? null;
}

export function getProviderAliasCandidates(providerId: string): string[] {
  const entry = getProviderRegistryEntry(providerId);
  if (!entry) {
    return [];
  }

  return Array.from(
    new Set([entry.id, entry.canonicalOpenClawId, ...entry.aliases]),
  );
}

export function isKnownProviderId(providerId: string): boolean {
  return normalizeProviderId(providerId) !== null;
}

export function isSupportedByokProviderId(
  providerId: string,
): providerId is SupportedByokProviderId {
  return supportedByokProviderIdSet.has(providerId as ProviderRegistryEntryId);
}

export function getDefaultProviderBaseUrls(providerId: string): string[] {
  return getProviderRegistryEntry(providerId)?.defaultBaseUrls.slice() ?? [];
}

export function getProviderUiMetadata(
  providerId: string,
): ProviderUiMetadata | null {
  const entry = getProviderRegistryEntry(providerId);
  if (!entry) {
    return null;
  }

  return {
    displayName: entry.displayName,
    displayNameKey: entry.displayNameKey,
    descriptionKey: entry.descriptionKey,
    apiDocsUrl: entry.apiDocsUrl,
    apiKeyPlaceholder: entry.apiKeyPlaceholder,
    defaultProxyUrl: entry.defaultProxyUrl,
    logo: entry.logo,
  };
}

export function getProviderRuntimePolicy(providerId: string): {
  canonicalOpenClawId: string;
  apiKind: ProviderRegistryEntry["apiKind"];
  authModes: ProviderRegistryEntry["authModes"];
  authHeader?: boolean;
  defaultHeaders?: Readonly<Record<string, string>>;
  managedByAuthProfiles?: boolean;
  requiresOauthRegion?: boolean;
  supportsCustomBaseUrl?: boolean;
  supportsModelDiscovery?: boolean;
  supportsProxyMode?: boolean;
} | null {
  const entry = getProviderRegistryEntry(providerId);
  if (!entry) {
    return null;
  }

  return {
    canonicalOpenClawId: entry.canonicalOpenClawId,
    apiKind: entry.apiKind,
    authModes: entry.authModes,
    authHeader: entry.authHeader,
    defaultHeaders: entry.defaultHeaders,
    managedByAuthProfiles: entry.managedByAuthProfiles,
    requiresOauthRegion: entry.requiresOauthRegion,
    supportsCustomBaseUrl: entry.supportsCustomBaseUrl,
    supportsModelDiscovery: entry.supportsModelDiscovery,
    supportsProxyMode: entry.supportsProxyMode,
  };
}

export function getBundledProviderModels(
  providerId: string,
): Array<{ id: string; name: string }> {
  const normalizedProviderId = normalizeProviderId(providerId);
  if (!normalizedProviderId) {
    return [];
  }

  return (
    bundledProviderModelsById[
      normalizedProviderId as keyof typeof bundledProviderModelsById
    ] ?? []
  ).map((model) => ({ ...model }));
}

export function getBundledProviderModelIds(providerId: string): string[] {
  return getBundledProviderModels(providerId).map((model) => model.id);
}

export function getCustomProviderProtocolFamily(
  providerId: string,
): CustomProviderProtocolFamily | null {
  const normalizedProviderId = normalizeProviderId(providerId);
  switch (normalizedProviderId) {
    case "custom-openai":
      return "openai";
    case "custom-anthropic":
      return "anthropic";
    default:
      return null;
  }
}
