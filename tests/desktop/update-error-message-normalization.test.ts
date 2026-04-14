import { describe, expect, it } from "vitest";
import { normalizeUpdateErrorMessage } from "../../apps/desktop/src/hooks/use-auto-update";

describe("update error message normalization", () => {
  it("normalizes fetch failures in normal update mode", () => {
    const result = normalizeUpdateErrorMessage("fetch failed", "normal");
    expect(result).not.toMatch(/fetch failed/i);
  });

  it("normalizes fetch failures in local test feed mode", () => {
    const result = normalizeUpdateErrorMessage(
      "TypeError: fetch failed",
      "local-test-feed",
    );
    expect(result).not.toMatch(/fetch failed/i);
  });
});
