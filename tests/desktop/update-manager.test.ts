import { afterEach, describe, expect, it } from "vitest";
import { resolveUpdateFeedUrlForTests } from "../../apps/desktop/main/updater/update-manager";

const originalUpdateFeedUrl = process.env.NEXU_UPDATE_FEED_URL;

afterEach(() => {
  if (originalUpdateFeedUrl === undefined) {
    Reflect.deleteProperty(process.env, "NEXU_UPDATE_FEED_URL");
    return;
  }
  process.env.NEXU_UPDATE_FEED_URL = originalUpdateFeedUrl;
});

describe("desktop update feed resolution", () => {
  it("uses the nightly R2 feed for nightly channel builds", () => {
    expect(
      resolveUpdateFeedUrlForTests({
        source: "r2",
        channel: "nightly",
        feedUrl: null,
        arch: "arm64",
      }),
    ).toBe("https://desktop-releases.nexu.io/nightly/arm64");
  });

  it("uses the x64 R2 feed for Intel mac builds", () => {
    expect(
      resolveUpdateFeedUrlForTests({
        source: "r2",
        channel: "stable",
        feedUrl: null,
        arch: "x64",
      }),
    ).toBe("https://desktop-releases.nexu.io/stable/x64");
  });

  it("throws for unsupported mac architectures", () => {
    expect(() =>
      resolveUpdateFeedUrlForTests({
        source: "r2",
        channel: "stable",
        feedUrl: null,
        arch: "x86_64",
      }),
    ).toThrow(
      '[update-manager] Unsupported mac architecture "x86_64". Expected "x64" or "arm64".',
    );
  });

  it("lets explicit feed URLs override the channel mapping", () => {
    expect(
      resolveUpdateFeedUrlForTests({
        source: "r2",
        channel: "nightly",
        feedUrl: "https://cdn.example.com/custom-nightly",
      }),
    ).toBe("https://cdn.example.com/custom-nightly");
  });

  it("lets environment feed URLs override build-config feed URLs", () => {
    process.env.NEXU_UPDATE_FEED_URL =
      "https://override.example.com/signed/latest-mac.yml?token=secret";

    expect(
      resolveUpdateFeedUrlForTests({
        source: "r2",
        channel: "stable",
        feedUrl: "https://cdn.example.com/custom-stable",
      }),
    ).toBe("https://override.example.com/signed/latest-mac.yml?token=secret");
  });

  it("uses the GitHub feed when source is github and no overrides exist", () => {
    expect(
      resolveUpdateFeedUrlForTests({
        source: "github",
        channel: "stable",
        feedUrl: null,
      }),
    ).toBe("github://nexu-io/nexu");
  });
});
