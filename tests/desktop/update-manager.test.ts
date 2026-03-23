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
      }),
    ).toBe("https://desktop-releases.nexu.io/nightly");
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
