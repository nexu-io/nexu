const LOCAL_MODEL_ICON_KEYS = new Set([
  "alibaba",
  "alibabacloud",
  "baichuan",
  "baiducloud",
  "chatglm",
  "claude",
  "claudecode",
  "deepseek",
  "doubao",
  "gemini",
  "glmv",
  "grok",
  "kimi",
  "minimax",
  "mistral",
  "moonshot",
  "ollama",
  "openai",
  "qwen",
  "volcengine",
  "xai",
  "xiaomimimo",
  "zhipu",
]);

const MODEL_ICON_RULES: Array<{ key: string; patterns: string[] }> = [
  { key: "claudecode", patterns: ["claude-code", "claudecode"] },
  { key: "claude", patterns: ["claude"] },
  { key: "gemini", patterns: ["gemini"] },
  { key: "qwen", patterns: ["qwen", "tongyi"] },
  { key: "kimi", patterns: ["kimi"] },
  { key: "deepseek", patterns: ["deepseek"] },
  { key: "doubao", patterns: ["doubao"] },
  { key: "glmv", patterns: ["glmv"] },
  { key: "chatglm", patterns: ["chatglm", "glm-4", "glm4", "glm"] },
  { key: "grok", patterns: ["grok"] },
  { key: "baichuan", patterns: ["baichuan"] },
  { key: "mistral", patterns: ["mistral", "mixtral"] },
  { key: "minimax", patterns: ["minimax", "abab"] },
  { key: "openai", patterns: ["openai", "gpt", "o1", "o3", "o4"] },
  { key: "ollama", patterns: ["ollama"] },
  { key: "moonshot", patterns: ["moonshot"] },
  { key: "zhipu", patterns: ["zhipu", "bigmodel"] },
  { key: "volcengine", patterns: ["volcengine"] },
  { key: "alibabacloud", patterns: ["alibabacloud"] },
  { key: "alibaba", patterns: ["alibaba"] },
  { key: "baiducloud", patterns: ["baiducloud", "qianfan"] },
  { key: "xai", patterns: ["xai"] },
  { key: "xiaomimimo", patterns: ["mimo"] },
];

export function getDisplayModelId(model: string): string {
  const normalized = model.trim();

  if (!normalized) {
    return normalized;
  }

  if (!normalized.includes("/")) {
    return normalized;
  }

  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function resolveModelIconKey(model: string): string | null {
  const displayModelId = getDisplayModelId(model).toLowerCase();
  if (!displayModelId) {
    return null;
  }

  for (const rule of MODEL_ICON_RULES) {
    if (rule.patterns.some((pattern) => displayModelId.includes(pattern))) {
      return rule.key;
    }
  }

  return null;
}

export function getModelIconSrc(modelKey: string): string | null {
  if (modelKey === "xiaomimimo") {
    return "/model-provider-icons/xiaomimimo.svg";
  }

  if (!LOCAL_MODEL_ICON_KEYS.has(modelKey)) {
    return null;
  }

  return `/model-icons/${modelKey}.svg`;
}
