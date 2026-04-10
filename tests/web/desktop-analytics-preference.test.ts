import { describe, expect, it, vi } from "vitest";
import { readAnalyticsPreferenceFromStorage } from "#web/lib/desktop-analytics-preference";

describe("readAnalyticsPreferenceFromStorage", () => {
  it("returns null when the preference key is missing", () => {
    expect(
      readAnalyticsPreferenceFromStorage({
        getItem: vi.fn(() => null),
      }),
    ).toBeNull();
  });

  it("returns true for an enabled preference", () => {
    expect(
      readAnalyticsPreferenceFromStorage({
        getItem: vi.fn(() => "1"),
      }),
    ).toBe(true);
  });

  it("returns false for a disabled preference", () => {
    expect(
      readAnalyticsPreferenceFromStorage({
        getItem: vi.fn(() => "0"),
      }),
    ).toBe(false);
  });

  it("returns null when storage access throws", () => {
    expect(
      readAnalyticsPreferenceFromStorage({
        getItem: vi.fn(() => {
          throw new Error("storage unavailable");
        }),
      }),
    ).toBeNull();
  });
});
