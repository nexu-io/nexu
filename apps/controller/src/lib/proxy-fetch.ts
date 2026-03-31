import http from "node:http";

export type ProxyFetchOptions = RequestInit & {
  timeoutMs?: number;
};

type ProxyFetchEnv = {
  httpProxy: string | null;
  httpsProxy: string | null;
  allProxy: string | null;
  noProxy: string[];
};

type HttpModuleWithProxySupport = typeof http & {
  setGlobalProxyFromEnv?: (
    proxyEnv?: NodeJS.ProcessEnv,
  ) => (() => void) | undefined;
};

const REQUIRED_LOOPBACK_BYPASS = ["localhost", "127.0.0.1", "::1"];
const NODE_USE_ENV_PROXY = "NODE_USE_ENV_PROXY";

let configuredProxyKey: string | null = null;
let restoreProxyConfig: (() => void) | null = null;

function readEnvValue(
  env: NodeJS.ProcessEnv,
  upperKey: "HTTP_PROXY" | "HTTPS_PROXY" | "ALL_PROXY" | "NO_PROXY",
): string | null {
  const upperValue = env[upperKey];
  if (typeof upperValue === "string" && upperValue.trim().length > 0) {
    return upperValue.trim();
  }

  const lowerValue = env[upperKey.toLowerCase()];
  if (typeof lowerValue === "string" && lowerValue.trim().length > 0) {
    return lowerValue.trim();
  }

  return null;
}

export function mergeNoProxyEntries(
  input: string | string[] | null | undefined,
): string[] {
  const values = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];

  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of [...values, ...REQUIRED_LOOPBACK_BYPASS]) {
    const normalized = value.trim();
    if (normalized.length === 0) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(normalized);
  }

  return merged;
}

export function readProxyFetchEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProxyFetchEnv {
  const allProxy = readEnvValue(env, "ALL_PROXY");

  return {
    httpProxy: readEnvValue(env, "HTTP_PROXY") ?? allProxy,
    httpsProxy: readEnvValue(env, "HTTPS_PROXY") ?? allProxy,
    allProxy,
    noProxy: mergeNoProxyEntries(readEnvValue(env, "NO_PROXY")),
  };
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return REQUIRED_LOOPBACK_BYPASS.includes(normalized);
}

function noProxyEntryMatchesHostname(hostname: string, entry: string): boolean {
  const normalizedHost = normalizeHostname(hostname);
  const normalizedEntry = normalizeHostname(entry.trim());

  if (normalizedEntry === "*") {
    return true;
  }

  if (normalizedEntry.length === 0) {
    return false;
  }

  const bareEntry = normalizedEntry.startsWith(".")
    ? normalizedEntry.slice(1)
    : normalizedEntry;

  return (
    normalizedHost === bareEntry ||
    normalizedHost.endsWith(`.${bareEntry}`) ||
    normalizedHost.endsWith(normalizedEntry)
  );
}

export function shouldBypassProxy(
  input: string | URL,
  noProxyEntries?: string[],
): boolean {
  const url = typeof input === "string" ? new URL(input) : input;

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return true;
  }

  if (isLoopbackHostname(url.hostname)) {
    return true;
  }

  const entries = noProxyEntries ?? readProxyFetchEnv().noProxy;
  return entries.some((entry) =>
    noProxyEntryMatchesHostname(url.hostname, entry),
  );
}

export function redactProxyUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = "***";
      parsed.password = "***";
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "***";
  }
}

function summarizeRequestTarget(input: string | URL): string {
  try {
    const url = typeof input === "string" ? new URL(input) : input;
    return url.origin;
  } catch {
    return "remote target";
  }
}

function sanitizeErrorMessage(
  message: string,
  proxyEnv: ProxyFetchEnv,
): string {
  let sanitized = message;

  for (const value of [
    proxyEnv.httpProxy,
    proxyEnv.httpsProxy,
    proxyEnv.allProxy,
  ]) {
    if (!value) {
      continue;
    }

    sanitized = sanitized.split(value).join(redactProxyUrl(value) ?? "***");
  }

  return sanitized.replace(/([a-z]+:\/\/)([^@\s/]+)@/giu, "$1***:***@");
}

function createAbortSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): {
  signal: AbortSignal | undefined;
  cleanup: () => void;
  timedOut: () => boolean;
  abortedByCaller: () => boolean;
} {
  if (!signal && timeoutMs === undefined) {
    return {
      signal: undefined,
      cleanup: () => {},
      timedOut: () => false,
      abortedByCaller: () => false,
    };
  }

  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | null = null;
  let didTimeout = false;
  let callerAborted = false;

  const abortFromCaller = () => {
    callerAborted = true;
    controller.abort();
  };

  if (signal) {
    if (signal.aborted) {
      abortFromCaller();
    } else {
      signal.addEventListener("abort", abortFromCaller, { once: true });
    }
  }

  if (timeoutMs !== undefined) {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (signal) {
        signal.removeEventListener("abort", abortFromCaller);
      }
    },
    timedOut: () => didTimeout,
    abortedByCaller: () => callerAborted,
  };
}

function ensureGlobalProxySupport(proxyEnv: ProxyFetchEnv): void {
  if (!proxyEnv.httpProxy && !proxyEnv.httpsProxy) {
    return;
  }

  process.env.HTTP_PROXY = proxyEnv.httpProxy ?? "";
  process.env.HTTPS_PROXY = proxyEnv.httpsProxy ?? "";
  process.env.NO_PROXY = proxyEnv.noProxy.join(",");
  process.env[NODE_USE_ENV_PROXY] = "1";

  const key = JSON.stringify(proxyEnv);
  if (configuredProxyKey === key) {
    return;
  }

  restoreProxyConfig?.();
  restoreProxyConfig = null;
  configuredProxyKey = key;

  const httpWithProxySupport = http as HttpModuleWithProxySupport;
  if (typeof httpWithProxySupport.setGlobalProxyFromEnv !== "function") {
    return;
  }

  const restore = httpWithProxySupport.setGlobalProxyFromEnv({
    ...process.env,
    HTTP_PROXY: proxyEnv.httpProxy ?? undefined,
    HTTPS_PROXY: proxyEnv.httpsProxy ?? undefined,
    NO_PROXY: proxyEnv.noProxy.join(","),
  });

  restoreProxyConfig = typeof restore === "function" ? restore : null;
}

function createTimeoutError(input: string | URL, timeoutMs: number): Error {
  const error = new Error(
    `Request to ${summarizeRequestTarget(input)} timed out after ${timeoutMs}ms`,
  );
  error.name = "TimeoutError";
  return error;
}

function createAbortError(input: string | URL): Error {
  const error = new Error(
    `Request to ${summarizeRequestTarget(input)} was aborted`,
  );
  error.name = "AbortError";
  return error;
}

function createProxySafeError(
  error: unknown,
  input: string | URL,
  proxyEnv: ProxyFetchEnv,
): Error {
  if (!(error instanceof Error)) {
    return new Error(`Request to ${summarizeRequestTarget(input)} failed`);
  }

  const safeError = new Error(sanitizeErrorMessage(error.message, proxyEnv));
  safeError.name = error.name;
  return safeError;
}

export async function proxyFetch(
  input: string | URL,
  options: ProxyFetchOptions = {},
): Promise<Response> {
  const { timeoutMs, signal: rawSignal, ...init } = options;
  const signal = rawSignal ?? undefined;
  const proxyEnv = readProxyFetchEnv();
  const requestUrl = typeof input === "string" ? new URL(input) : input;

  ensureGlobalProxySupport(proxyEnv);

  const abortState = createAbortSignal(signal, timeoutMs);

  try {
    return await fetch(requestUrl, {
      ...init,
      signal: abortState.signal,
    });
  } catch (error) {
    if (abortState.timedOut() && timeoutMs !== undefined) {
      throw createTimeoutError(requestUrl, timeoutMs);
    }

    if (abortState.abortedByCaller()) {
      throw createAbortError(requestUrl);
    }

    throw createProxySafeError(error, requestUrl, proxyEnv);
  } finally {
    abortState.cleanup();
  }
}

export async function proxyFetchJson<T>(
  input: string | URL,
  options: ProxyFetchOptions = {},
): Promise<T> {
  const response = await proxyFetch(input, options);
  return (await response.json()) as T;
}
