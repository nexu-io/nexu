import type { Session } from "electron";
import {
  type ElectronProxyConfig,
  type ProxyPolicy,
  buildElectronProxyConfig,
  redactProxyUrl,
} from "../../shared/proxy-config";

export type ProxyResolution = {
  label: string;
  url: string;
  result: string;
};

export type ProxyDiagnosticsSnapshot = {
  source: ProxyPolicy["source"];
  env: ProxyPolicy["diagnostics"];
  bypass: string[];
  electron: {
    mode: ElectronProxyConfig["mode"];
    proxyRulesRedacted: string | null;
    proxyBypassRules: string[];
  };
  resolutions: ProxyResolution[];
};

type ElectronSessionLike = Pick<
  Session,
  "setProxy" | "closeAllConnections" | "resolveProxy"
>;

export class ProxyManager {
  constructor(private readonly session: ElectronSessionLike) {}

  async applyPolicy(policy: ProxyPolicy): Promise<ElectronProxyConfig> {
    const config = buildElectronProxyConfig(policy);
    await this.session.setProxy(config);
    await this.session.closeAllConnections();
    return config;
  }

  async collectDiagnostics(
    policy: ProxyPolicy,
    targets: Array<{ label: string; url: string }>,
  ): Promise<ProxyDiagnosticsSnapshot> {
    const electronConfig = buildElectronProxyConfig(policy);
    const resolutions = await Promise.all(
      targets.map(async (target) => ({
        label: target.label,
        url: target.url,
        result: await this.session.resolveProxy(target.url),
      })),
    );

    return {
      source: policy.source,
      env: { ...policy.diagnostics },
      bypass: [...policy.bypass],
      electron: {
        mode: electronConfig.mode,
        proxyRulesRedacted:
          "proxyRules" in electronConfig
            ? redactProxyRules(electronConfig.proxyRules)
            : null,
        proxyBypassRules:
          "proxyBypassRules" in electronConfig
            ? electronConfig.proxyBypassRules
                .split(";")
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0)
            : [],
      },
      resolutions,
    };
  }
}

function redactProxyRules(proxyRules: string): string {
  return proxyRules
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [scheme, value] = entry.split("=", 2);
      if (!value) {
        return redactProxyUrl(entry) ?? "***";
      }
      return `${scheme}=${redactProxyUrl(value) ?? "***"}`;
    })
    .join(";");
}
