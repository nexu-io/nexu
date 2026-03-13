import { describe, expect, it } from "vitest";
import { maskCredential, validateCredentialFields } from "../composio.js";

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
    { key: "api_key", label: "API Key", type: "secret" as const },
    { key: "shop_url", label: "Shop URL", type: "text" as const },
  ];

  it("passes when all required fields are provided", () => {
    expect(() =>
      validateCredentialFields(authFields, {
        api_key: "x",
        shop_url: "y",
      }),
    ).not.toThrow();
  });

  it("throws 400 when a required field is missing", () => {
    expect(() =>
      validateCredentialFields(authFields, { api_key: "x" }),
    ).toThrow(/Missing required field: shop_url/);
  });

  it("throws 400 when an unknown field is provided", () => {
    expect(() =>
      validateCredentialFields(authFields, {
        api_key: "x",
        shop_url: "y",
        extra: "z",
      }),
    ).toThrow(/Unknown field: extra/);
  });

  it("throws 400 when a field value is empty", () => {
    expect(() =>
      validateCredentialFields(authFields, { api_key: "", shop_url: "y" }),
    ).toThrow(/Field cannot be empty: api_key/);
  });

  it("passes when authFields is empty and credentials is empty", () => {
    expect(() => validateCredentialFields([], {})).not.toThrow();
  });
});
