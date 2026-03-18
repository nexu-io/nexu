export function normalizeProviderBaseUrl(
  baseUrl: string | null | undefined,
): string | null {
  if (baseUrl == null) return null;

  const trimmed = baseUrl.trim();
  if (!trimmed) return null;

  return trimmed.replace(/\/+$/, "");
}

export function buildProviderUrl(
  baseUrl: string | null | undefined,
  path: string,
): string | null {
  const normalizedBaseUrl = normalizeProviderBaseUrl(baseUrl);
  if (!normalizedBaseUrl) return null;

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}
