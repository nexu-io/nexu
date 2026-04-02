import { describe, expect, it, vi } from "vitest";

// Mock proxyFetch before importing the module under test
vi.mock("../src/lib/proxy-fetch.js", () => ({
  proxyFetch: vi.fn(),
}));

import { proxyFetch } from "../src/lib/proxy-fetch.js";
import { RuntimeHealth } from "../src/runtime/runtime-health.js";

const mockedProxyFetch = vi.mocked(proxyFetch);

function createHealth(overrides: { gatewayProbeEnabled?: boolean } = {}) {
  return new RuntimeHealth({
    gatewayProbeEnabled: overrides.gatewayProbeEnabled ?? true,
    openclawGatewayPort: 18789,
  } as Parameters<typeof RuntimeHealth.prototype.probe>[0] extends never
    ? never
    : ConstructorParameters<typeof RuntimeHealth>[0]);
}

describe("RuntimeHealth.probe()", () => {
  it("returns ok with null errorCode on successful probe", async () => {
    mockedProxyFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    const health = createHealth();
    const result = await health.probe();

    expect(result).toEqual({ ok: true, status: 200, errorCode: null });
  });

  it("returns error status with null errorCode when gateway responds with error", async () => {
    mockedProxyFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as Response);

    const health = createHealth();
    const result = await health.probe();

    expect(result).toEqual({ ok: false, status: 503, errorCode: null });
  });

  it("extracts ECONNREFUSED from error message", async () => {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:18789");
    error.name = "TypeError";
    mockedProxyFetch.mockRejectedValueOnce(error);

    const health = createHealth();
    const result = await health.probe();

    expect(result).toEqual({
      ok: false,
      status: null,
      errorCode: "ECONNREFUSED",
    });
  });

  it("extracts ETIMEDOUT from error message", async () => {
    const error = new Error("connect ETIMEDOUT 127.0.0.1:18789");
    error.name = "TypeError";
    mockedProxyFetch.mockRejectedValueOnce(error);

    const health = createHealth();
    const result = await health.probe();

    expect(result).toEqual({
      ok: false,
      status: null,
      errorCode: "ETIMEDOUT",
    });
  });

  it("returns TimeoutError for timeout errors", async () => {
    const error = new Error("Request timed out");
    error.name = "TimeoutError";
    mockedProxyFetch.mockRejectedValueOnce(error);

    const health = createHealth();
    const result = await health.probe();

    expect(result).toEqual({
      ok: false,
      status: null,
      errorCode: "TimeoutError",
    });
  });

  it("returns AbortError for aborted requests", async () => {
    const error = new Error("Request aborted");
    error.name = "AbortError";
    mockedProxyFetch.mockRejectedValueOnce(error);

    const health = createHealth();
    const result = await health.probe();

    expect(result).toEqual({
      ok: false,
      status: null,
      errorCode: "AbortError",
    });
  });

  it("returns error.name for generic errors without connection code", async () => {
    const error = new Error("something went wrong");
    error.name = "TypeError";
    mockedProxyFetch.mockRejectedValueOnce(error);

    const health = createHealth();
    const result = await health.probe();

    expect(result).toEqual({
      ok: false,
      status: null,
      errorCode: "TypeError",
    });
  });

  it("returns 'unknown' for non-Error throws", async () => {
    mockedProxyFetch.mockRejectedValueOnce("string error");

    const health = createHealth();
    const result = await health.probe();

    expect(result).toEqual({
      ok: false,
      status: null,
      errorCode: "unknown",
    });
  });

  it("returns ok when probe is disabled", async () => {
    const health = createHealth({ gatewayProbeEnabled: false });
    const result = await health.probe();

    expect(result).toEqual({ ok: true, status: null, errorCode: null });
    expect(mockedProxyFetch).not.toHaveBeenCalled();
  });
});
