import { describe, expect, it } from "vitest";
import { getDesktopSentryBuildMetadata } from "#desktop/shared/sentry-build-metadata";

describe("desktop sentry build metadata", () => {
  it("builds release and dist when commit metadata exists", () => {
    const result = getDesktopSentryBuildMetadata({
      version: "1.2.3",
      source: "local-dist",
      branch: "main",
      commit: "abc123",
      builtAt: "2026-03-19T00:00:00Z",
    });

    expect(result).toEqual({
      release: "nexu-desktop@1.2.3",
      dist: "1.2.3-abc123",
      buildContext: {
        version: "1.2.3",
        source: "local-dist",
        branch: "main",
        commit: "abc123",
        builtAt: "2026-03-19T00:00:00Z",
      },
    });
  });

  it("omits dist when commit metadata is missing or blank", () => {
    const result = getDesktopSentryBuildMetadata({
      version: "1.2.3",
      source: "nightly-test",
      branch: null,
      commit: "   ",
      builtAt: null,
    });

    expect(result).toEqual({
      release: "nexu-desktop@1.2.3",
      buildContext: {
        version: "1.2.3",
        source: "nightly-test",
        branch: null,
        commit: null,
        builtAt: null,
      },
    });
  });
});
