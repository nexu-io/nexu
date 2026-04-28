import { describe, expect, it, vi } from "vitest";
import { normalizeUpdateErrorMessage } from "../../apps/desktop/src/hooks/use-auto-update";

const withNavigatorLanguage = <T>(language: string, run: () => T): T => {
  const languageSpy = vi
    .spyOn(globalThis.navigator, "language", "get")
    .mockReturnValue(language);

  try {
    return run();
  } finally {
    languageSpy.mockRestore();
  }
};

describe("update error message normalization", () => {
  it("normalizes fetch failures in normal update mode for en-US", () => {
    const result = withNavigatorLanguage("en-US", () =>
      normalizeUpdateErrorMessage("fetch failed", "normal"),
    );
    expect(result).toBe(
      "Network connection failed while checking for updates. Check your connection and try again.",
    );
  });

  it("normalizes fetch failures in normal update mode for zh-CN", () => {
    const result = withNavigatorLanguage("zh-CN", () =>
      normalizeUpdateErrorMessage("fetch failed", "normal"),
    );
    expect(result).toBe("网络连接失败，请检查网络后重试。");
  });

  it("normalizes fetch failures in local test feed mode for en-US", () => {
    const result = withNavigatorLanguage("en-US", () =>
      normalizeUpdateErrorMessage("TypeError: fetch failed", "local-test-feed"),
    );
    expect(result).toBe(
      "Network connection failed while checking for updates. Check your connection and try again.",
    );
  });

  it("normalizes fetch failures in local test feed mode for zh-CN", () => {
    const result = withNavigatorLanguage("zh-CN", () =>
      normalizeUpdateErrorMessage("TypeError: fetch failed", "local-test-feed"),
    );
    expect(result).toBe("网络连接失败，请检查网络后重试。");
  });
});
