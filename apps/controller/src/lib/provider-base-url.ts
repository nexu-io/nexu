export function normalizeProviderBaseUrl(
  baseUrl: string | null | undefined,
): string | null {
  if (baseUrl == null) {
    return null;
  }

  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}
