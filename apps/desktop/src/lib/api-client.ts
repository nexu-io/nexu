import { getControllerBaseUrl } from "./host-api";

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const controllerBaseUrl = await getControllerBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const targetUrl = new URL(normalizedPath, controllerBaseUrl);

  return fetch(targetUrl, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}
