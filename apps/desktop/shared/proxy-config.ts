export type ProxySource = "env" | "system" | "direct";

export type ProxyEnvConfig = {
  httpProxy: string | null;
  httpsProxy: string | null;
  allProxy: string | null;
  noProxy: string[];
};

export type ProxyPolicy = {
  source: ProxySource;
  env: ProxyEnvConfig;
  bypass: string[];
  diagnostics: {
    httpProxyRedacted: string | null;
    httpsProxyRedacted: string | null;
    allProxyRedacted: string | null;
  };
};

export type ElectronProxyConfig =
  | {
      mode: "fixed_servers";
      proxyRules: string;
      proxyBypassRules: string;
    }
  | {
      mode: "system" | "direct";
    };

const REQUIRED_LOOPBACK_BYPASS = ["localhost", "127.0.0.1", "::1"];

function readEnvValue(
  env: Record<string, string | undefined>,
  upperKey: string,
): string | null {
  const upper = env[upperKey];
  if (typeof upper === "string" && upper.trim().length > 0) {
    return upper.trim();
  }

  const lower = env[upperKey.toLowerCase()];
  if (typeof lower === "string" && lower.trim().length > 0) {
    return lower.trim();
  }

  return null;
}

export function mergeNoProxyEntries(input: string | string[] | null): string[] {
  const values = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];

  const ordered = [...values, ...REQUIRED_LOOPBACK_BYPASS];
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of ordered) {
    const normalized = value.trim();
    if (normalized.length === 0) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }

  return output;
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

export function readProxyPolicy(
  env: Record<string, string | undefined>,
  options?: {
    defaultSource?: Exclude<ProxySource, "env">;
  },
): ProxyPolicy {
  const httpProxy = readEnvValue(env, "HTTP_PROXY");
  const httpsProxy = readEnvValue(env, "HTTPS_PROXY");
  const allProxy = readEnvValue(env, "ALL_PROXY");
  const noProxy = mergeNoProxyEntries(readEnvValue(env, "NO_PROXY"));
  const hasExplicitProxy = [httpProxy, httpsProxy, allProxy].some(Boolean);

  return {
    source: hasExplicitProxy ? "env" : (options?.defaultSource ?? "system"),
    env: {
      httpProxy,
      httpsProxy,
      allProxy,
      noProxy,
    },
    bypass: noProxy,
    diagnostics: {
      httpProxyRedacted: redactProxyUrl(httpProxy),
      httpsProxyRedacted: redactProxyUrl(httpsProxy),
      allProxyRedacted: redactProxyUrl(allProxy),
    },
  };
}

export function buildChildProcessProxyEnv(
  policy: ProxyPolicy,
): Record<string, string> {
  const nextEnv: Record<string, string> = {
    NO_PROXY: policy.bypass.join(","),
  };

  const hasExplicitProxy = [
    policy.env.httpProxy,
    policy.env.httpsProxy,
    policy.env.allProxy,
  ].some(Boolean);

  if (hasExplicitProxy) {
    nextEnv.NODE_USE_ENV_PROXY = "1";
  }

  if (policy.env.httpProxy) {
    nextEnv.HTTP_PROXY = policy.env.httpProxy;
  }

  if (policy.env.httpsProxy) {
    nextEnv.HTTPS_PROXY = policy.env.httpsProxy;
  }

  if (policy.env.allProxy) {
    nextEnv.ALL_PROXY = policy.env.allProxy;
  }

  return nextEnv;
}

export function buildElectronProxyConfig(
  policy: ProxyPolicy,
): ElectronProxyConfig {
  if (policy.source === "system") {
    return { mode: "system" };
  }

  if (policy.source === "direct") {
    return { mode: "direct" };
  }

  const httpProxy = policy.env.httpProxy ?? policy.env.allProxy;
  const httpsProxy = policy.env.httpsProxy ?? policy.env.allProxy;
  const proxyRules = [
    httpProxy ? `http=${httpProxy}` : null,
    httpsProxy ? `https=${httpsProxy}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(";");

  if (proxyRules.length === 0) {
    return { mode: "direct" };
  }

  return {
    mode: "fixed_servers",
    proxyRules,
    proxyBypassRules: mergeNoProxyEntries(["<local>", ...policy.bypass]).join(
      ";",
    ),
  };
}
