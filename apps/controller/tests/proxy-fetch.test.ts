import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergeNoProxyEntries,
  proxyFetch,
  readProxyFetchEnv,
  redactProxyUrl,
  shouldBypassProxy,
} from "../src/lib/proxy-fetch.js";

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "NODE_USE_ENV_PROXY",
];

function resetProxyEnv(): void {
  for (const key of PROXY_ENV_KEYS) {
    delete process.env[key];
    delete process.env[key.toLowerCase()];
  }
}

describe("proxyFetch", () => {
  beforeEach(() => {
    resetProxyEnv();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetProxyEnv();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("merges and deduplicates loopback NO_PROXY entries", () => {
    expect(mergeNoProxyEntries("example.com,localhost,127.0.0.1")).toEqual([
      "example.com",
      "localhost",
      "127.0.0.1",
      "::1",
    ]);
  });

  it("normalizes ALL_PROXY into HTTP and HTTPS proxy config", () => {
    process.env.ALL_PROXY = "http://proxy.example.com:8080";
    process.env.no_proxy = "example.internal";

    expect(readProxyFetchEnv()).toEqual({
      httpProxy: "http://proxy.example.com:8080",
      httpsProxy: "http://proxy.example.com:8080",
      allProxy: "http://proxy.example.com:8080",
      noProxy: ["example.internal", "localhost", "127.0.0.1", "::1"],
    });
  });

  it("bypasses loopback and configured NO_PROXY hosts", () => {
    expect(shouldBypassProxy("http://127.0.0.1:3000")).toBe(true);
    expect(
      shouldBypassProxy("https://api.example.internal", [".example.internal"]),
    ).toBe(true);
    expect(
      shouldBypassProxy("https://api.nexu.io", [".example.internal"]),
    ).toBe(false);
  });

  it("times out hanging requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const abort = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };

          if (signal) {
            if (signal.aborted) {
              abort();
              return;
            }
            signal.addEventListener("abort", abort, { once: true });
          }
        });
      }),
    );

    await expect(
      proxyFetch("https://example.com/resource", { timeoutMs: 5 }),
    ).rejects.toMatchObject({
      name: "TimeoutError",
      message: "Request to https://example.com timed out after 5ms",
    });
  });

  it("redacts proxy credentials from thrown errors", async () => {
    process.env.HTTP_PROXY = "http://user:pass@proxy.example.com:8080";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(
          "connect ECONNREFUSED http://user:pass@proxy.example.com:8080",
        );
      }),
    );

    await expect(proxyFetch("https://example.com")).rejects.toMatchObject({
      message: "connect ECONNREFUSED http://***:***@proxy.example.com:8080/",
    });
    await proxyFetch("https://example.com").catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect("cause" in (error as Error)).toBe(false);
    });
    expect(redactProxyUrl(process.env.HTTP_PROXY ?? null)).toBe(
      "http://***:***@proxy.example.com:8080/",
    );
  });

  it("enables env proxy fallback when proxy env is configured", async () => {
    process.env.HTTP_PROXY = "http://proxy.example.com:8080";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
    );

    await proxyFetch("https://example.com");

    expect(process.env.NODE_USE_ENV_PROXY).toBe("1");
    expect(process.env.NO_PROXY).toBe("localhost,127.0.0.1,::1");
  });
});
