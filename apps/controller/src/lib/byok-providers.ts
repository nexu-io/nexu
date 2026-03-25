export const supportedByokProviderIds = [
  "anthropic",
  "openai",
  "google",
  "siliconflow",
  "ppio",
  "openrouter",
  "minimax",
  "kimi",
  "glm",
  "moonshot",
  "zai",
] as const;

export type SupportedByokProviderId = (typeof supportedByokProviderIds)[number];

const supportedByokProviderIdSet = new Set<string>(supportedByokProviderIds);

export function isSupportedByokProviderId(
  providerId: string,
): providerId is SupportedByokProviderId {
  return supportedByokProviderIdSet.has(providerId);
}
