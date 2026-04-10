import { describe, expect, it } from "vitest";
import {
  getDesktopUpdateTestingGuideUrl,
  resolveDesktopUpdateExperience,
  shouldEnableDesktopUpdateManager,
  shouldStartDesktopPeriodicUpdateChecks,
} from "../../apps/desktop/shared/update-policy";

describe("desktop update policy", () => {
  it("treats local-dist without a feed as local validation", () => {
    expect(
      resolveDesktopUpdateExperience({
        buildSource: "local-dist",
        updateFeed: null,
      }),
    ).toBe("local-validation");
    expect(
      shouldEnableDesktopUpdateManager({
        buildSource: "local-dist",
        updateFeed: null,
      }),
    ).toBe(false);
    expect(
      shouldStartDesktopPeriodicUpdateChecks({
        buildSource: "local-dist",
        updateFeed: null,
      }),
    ).toBe(false);
  });

  it("treats local-dist with an explicit feed as update test mode", () => {
    expect(
      resolveDesktopUpdateExperience({
        buildSource: "local-dist",
        updateFeed: "https://example.test/latest-win.json",
      }),
    ).toBe("local-test-feed");
    expect(
      shouldEnableDesktopUpdateManager({
        buildSource: "local-dist",
        updateFeed: "https://example.test/latest-win.json",
      }),
    ).toBe(true);
    expect(
      shouldStartDesktopPeriodicUpdateChecks({
        buildSource: "local-dist",
        updateFeed: "https://example.test/latest-win.json",
      }),
    ).toBe(true);
  });

  it("keeps non-local builds on the normal update path", () => {
    expect(
      resolveDesktopUpdateExperience({
        buildSource: "nightly-prod",
        updateFeed: null,
      }),
    ).toBe("normal");
    expect(
      shouldEnableDesktopUpdateManager({
        buildSource: "nightly-prod",
        updateFeed: null,
      }),
    ).toBe(true);
    expect(
      shouldStartDesktopPeriodicUpdateChecks({
        buildSource: "nightly-prod",
        updateFeed: null,
      }),
    ).toBe(true);
  });

  it("builds a guide URL pinned to the packaged commit", () => {
    expect(
      getDesktopUpdateTestingGuideUrl({
        commit: "c9868035ee367c385e1162c6ef4065c78b4ce74d",
      }),
    ).toBe(
      "https://github.com/nexu-io/nexu/blob/c9868035ee367c385e1162c6ef4065c78b4ce74d/specs/guides/desktop-update-testing.md",
    );
  });
});
