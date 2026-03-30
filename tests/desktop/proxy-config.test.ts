import { describe, expect, it } from "vitest";
import {
  buildChildProcessProxyEnv,
  buildElectronProxyConfig,
  mergeNoProxyEntries,
  readProxyPolicy,
  redactProxyUrl,
} from "../../apps/desktop/shared/proxy-config";

describe("proxy-config", () => {
  it("prefers uppercase proxy env vars and normalizes no_proxy", () => {
    const policy = readProxyPolicy({
      HTTP_PROXY: "http://upper.example:8080",
      http_proxy: "http://lower.example:8080",
      no_proxy: "example.com,localhost",
    });

    expect(policy.source).toBe("env");
    expect(policy.env.httpProxy).toBe("http://upper.example:8080");
    expect(policy.bypass).toEqual([
      "example.com",
      "localhost",
      "127.0.0.1",
      "::1",
    ]);
  });

  it("falls back to system mode when no proxy env is present", () => {
    const policy = readProxyPolicy({});

    expect(policy.source).toBe("system");
    expect(policy.bypass).toEqual(["localhost", "127.0.0.1", "::1"]);
  });

  it("can be forced to direct mode", () => {
    const policy = readProxyPolicy({}, { defaultSource: "direct" });

    expect(policy.source).toBe("direct");
  });

  it("redacts proxy credentials safely", () => {
    expect(
      redactProxyUrl(
        "http://user:pass@proxy.example.com:8080?token=secret#frag",
      ),
    ).toBe("http://***:***@proxy.example.com:8080/");
    expect(redactProxyUrl("not a url")).toBe("***");
  });

  it("deduplicates mandatory no_proxy entries", () => {
    expect(mergeNoProxyEntries("localhost,127.0.0.1,localhost")).toEqual([
      "localhost",
      "127.0.0.1",
      "::1",
    ]);
  });

  it("builds child-process env with canonical uppercase keys", () => {
    const policy = readProxyPolicy({
      HTTPS_PROXY: "http://proxy.example.com:8443",
    });

    expect(buildChildProcessProxyEnv(policy)).toEqual({
      HTTPS_PROXY: "http://proxy.example.com:8443",
      NODE_USE_ENV_PROXY: "1",
      NO_PROXY: "localhost,127.0.0.1,::1",
    });
  });

  it("builds fixed Electron proxy config with mandatory local bypass", () => {
    const policy = readProxyPolicy({
      HTTP_PROXY: "http://proxy.example.com:8080",
      NO_PROXY: "example.com",
    });

    expect(buildElectronProxyConfig(policy)).toEqual({
      mode: "fixed_servers",
      proxyRules: "http=http://proxy.example.com:8080",
      proxyBypassRules: "<local>;example.com;localhost;127.0.0.1;::1",
    });
  });
});
