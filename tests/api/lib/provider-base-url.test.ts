import { describe, expect, it } from "vitest";
import {
  buildProviderUrl,
  normalizeProviderBaseUrl,
} from "#api/lib/provider-base-url.js";

describe("provider base URL helpers", () => {
  it("removes trailing slashes from provider base URLs", () => {
    expect(normalizeProviderBaseUrl("https://openrouter.ai/api/v1///")).toBe(
      "https://openrouter.ai/api/v1",
    );
  });

  it("returns null for blank provider base URLs", () => {
    expect(normalizeProviderBaseUrl("   ")).toBeNull();
  });

  it("joins normalized base URLs with request paths", () => {
    expect(buildProviderUrl("https://openrouter.ai/api/v1/", "/models")).toBe(
      "https://openrouter.ai/api/v1/models",
    );
  });
});
