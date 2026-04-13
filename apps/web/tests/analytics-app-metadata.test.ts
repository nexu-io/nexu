import { afterEach, describe, expect, it, vi } from "vitest";
import { getAnalyticsAppMetadata } from "../src/lib/analytics-app-metadata";

describe("getAnalyticsAppMetadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses desktop metadata when the web app runs inside the desktop shell", () => {
    vi.stubGlobal("window", {
      nexuHost: {
        bootstrap: {
          buildInfo: {
            version: "1.2.3",
          },
        },
      },
    });

    expect(getAnalyticsAppMetadata()).toEqual({
      appName: "nexu-desktop",
      appVersion: "1.2.3",
    });
  });

  it("falls back to web package metadata outside the desktop shell", () => {
    vi.stubGlobal("window", {});

    expect(getAnalyticsAppMetadata()).toEqual({
      appName: "nexu-web",
      appVersion: "0.0.1",
    });
  });

  it("falls back to web package metadata when desktop version is missing", () => {
    vi.stubGlobal("window", {
      nexuHost: {
        bootstrap: {
          buildInfo: {},
        },
      },
    });

    expect(getAnalyticsAppMetadata()).toEqual({
      appName: "nexu-web",
      appVersion: "0.0.1",
    });
  });

  it("falls back to web package metadata during SSR", () => {
    vi.unstubAllGlobals();

    expect(getAnalyticsAppMetadata()).toEqual({
      appName: "nexu-web",
      appVersion: "0.0.1",
    });
  });

  it("falls back when nexuHost is not an object", () => {
    vi.stubGlobal("window", {
      nexuHost: "invalid-host-shape",
    });

    expect(getAnalyticsAppMetadata()).toEqual({
      appName: "nexu-web",
      appVersion: "0.0.1",
    });
  });
});
