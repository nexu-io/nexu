import { getApiBaseUrl } from "./host-api";

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const apiBaseUrl = await getApiBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const targetUrl = new URL(normalizedPath, apiBaseUrl);

  return fetch(targetUrl, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}
