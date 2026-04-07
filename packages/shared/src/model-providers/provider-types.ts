export const modelProviderAuthModes = [
  "api-key",
  "aws-sdk",
  "oauth",
  "token",
] as const;

export type ModelProviderAuthMode = (typeof modelProviderAuthModes)[number];

export const modelApis = [
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "google-generative-ai",
  "github-copilot",
  "bedrock-converse-stream",
  "ollama",
] as const;

export type ModelApi = (typeof modelApis)[number];

export const providerRegistryRegions = ["global", "china", "local"] as const;

export type ProviderRegistryRegion = (typeof providerRegistryRegions)[number];

export const customProviderTemplateIds = [
  "custom-openai",
  "custom-anthropic",
] as const;

export type CustomProviderTemplateId =
  (typeof customProviderTemplateIds)[number];

export type CustomProviderProtocolFamily = "openai" | "anthropic";

export type ProviderUiMetadata = {
  displayName: string;
  displayNameKey?: string;
  descriptionKey?: string;
  apiDocsUrl?: string;
  apiKeyPlaceholder?: string;
  defaultProxyUrl?: string;
  logo?: string;
};

export interface ProviderRegistryEntry extends ProviderUiMetadata {
  id: string;
  canonicalOpenClawId: string;
  aliases: readonly string[];
  authModes: readonly ModelProviderAuthMode[];
  apiKind: ModelApi;
  defaultBaseUrls: readonly string[];
  controllerConfigurable?: boolean;
  modelsPageVisible?: boolean;
  region?: ProviderRegistryRegion;
  signupUrl?: string;
  supportsCustomBaseUrl?: boolean;
  supportsModelDiscovery?: boolean;
  supportsProxyMode?: boolean;
  managedByAuthProfiles?: boolean;
  requiresOauthRegion?: boolean;
  authHeader?: boolean;
  defaultHeaders?: Readonly<Record<string, string>>;
  experimental?: boolean;
  hidden?: boolean;
}
