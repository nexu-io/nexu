import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDesktopRuntimeConfig } from "../../apps/desktop/shared/runtime-config";

describe("desktop runtime config", () => {
  it("defaults updates to the stable channel", () => {
    const config = getDesktopRuntimeConfig({}, { useBuildConfig: false });

    expect(config.updates.channel).toBe("stable");
  });

  it("accepts nightly as a packaged update channel", () => {
    const config = getDesktopRuntimeConfig(
      {
        NEXU_DESKTOP_UPDATE_CHANNEL: "nightly",
      },
      { useBuildConfig: false },
    );

    expect(config.updates.channel).toBe("nightly");
  });

  it("reads PostHog env overrides", () => {
    const config = getDesktopRuntimeConfig(
      {
        POSTHOG_API_KEY: "phc_test_key",
        POSTHOG_HOST: "https://us.i.posthog.com",
      },
      { useBuildConfig: false },
    );

    expect(config.posthogApiKey).toBe("phc_test_key");
    expect(config.posthogHost).toBe("https://us.i.posthog.com");
  });

  it("reads Langfuse env overrides", () => {
    const config = getDesktopRuntimeConfig(
      {
        LANGFUSE_PUBLIC_KEY: "pk_test",
        LANGFUSE_SECRET_KEY: "sk_test",
        LANGFUSE_BASE_URL: "https://langfuse.example.com",
      },
      { useBuildConfig: false },
    );

    expect(config.langfusePublicKey).toBe("pk_test");
    expect(config.langfuseSecretKey).toBe("sk_test");
    expect(config.langfuseBaseUrl).toBe("https://langfuse.example.com");
  });

  it("reads Langfuse values from build-config.json", () => {
    const resourcesPath = mkdtempSync(
      join(tmpdir(), "nexu-langfuse-build-config-"),
    );

    try {
      writeFileSync(
        join(resourcesPath, "build-config.json"),
        `${JSON.stringify(
          {
            LANGFUSE_PUBLIC_KEY: "pk_build",
            LANGFUSE_SECRET_KEY: "sk_build",
            LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com",
          },
          null,
          2,
        )}\n`,
      );

      const config = getDesktopRuntimeConfig({}, { resourcesPath });

      expect(config.langfusePublicKey).toBe("pk_build");
      expect(config.langfuseSecretKey).toBe("sk_build");
      expect(config.langfuseBaseUrl).toBe("https://us.cloud.langfuse.com");
    } finally {
      rmSync(resourcesPath, { recursive: true, force: true });
    }
  });
});
