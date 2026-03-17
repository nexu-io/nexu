import { describe, expect, it } from "vitest";
import { maskCredential, validateCredentialFields } from "#api/lib/composio.js";

describe("maskCredential", () => {
  it("masks long strings showing first 4 and last 4", () => {
    expect(maskCredential("shpat_abcdef1234")).toBe("shpa..1234");
  });

  it("masks short strings (<=8) showing stars + last chars", () => {
    expect(maskCredential("sk-abc")).toBe("**-abc");
  });

  it("masks exactly 8 chars showing first 4 and last 4", () => {
    expect(maskCredential("12345678")).toBe("1234..5678");
  });

  it("returns short strings (<=4) as-is", () => {
    expect(maskCredential("abcd")).toBe("abcd");
  });

  it("returns empty string for empty input", () => {
    expect(maskCredential("")).toBe("");
  });
});

describe("validateCredentialFields", () => {
  const authFields = [
    { key: "api_key", label: "API Key", type: "secret" },
    { key: "shop_url", label: "Shop URL", type: "text" },
  ];

  it("accepts valid credentials", () => {
    expect(() =>
      validateCredentialFields(authFields, {
        api_key: "key123",
        shop_url: "store.shopify.com",
      }),
    ).not.toThrow();
  });

  it("throws for missing required field", () => {
    expect(() =>
      validateCredentialFields(authFields, { api_key: "key123" }),
    ).toThrow("Missing required field");
  });

  it("throws for unknown field", () => {
    expect(() =>
      validateCredentialFields(authFields, {
        api_key: "key123",
        shop_url: "x",
        extra: "bad",
      }),
    ).toThrow("Unknown field");
  });

  it("throws for empty value", () => {
    expect(() =>
      validateCredentialFields(authFields, { api_key: "", shop_url: "x" }),
    ).toThrow("Field cannot be empty");
  });
});
