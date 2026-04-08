import { describe, expect, it, vi } from "vitest";
import { QuotaFallbackService } from "../src/services/quota-fallback-service.js";

describe("QuotaFallbackService", () => {
  it("treats cloud inventory models as managed even without the legacy link prefix", async () => {
    const service = new QuotaFallbackService(
      {
        getConfig: vi.fn().mockResolvedValue({
          runtime: {
            defaultModelId: "gemini-3.1-pro-preview",
          },
          desktop: {
            cloud: {
              models: [
                {
                  id: "gemini-3.1-pro-preview",
                  name: "gemini-3.1-pro-preview",
                  provider: "vertex",
                },
              ],
            },
          },
          providers: [],
        }),
      } as never,
      {
        syncAll: vi.fn(),
      } as never,
    );

    await expect(service.isUsingManagedModel()).resolves.toBe(true);
  });

  it("restores a raw cloud inventory model id as managed", async () => {
    const setDefaultModel = vi.fn().mockResolvedValue(undefined);
    const syncAll = vi.fn().mockResolvedValue(undefined);

    const service = new QuotaFallbackService(
      {
        getConfig: vi.fn().mockResolvedValue({
          runtime: {
            defaultModelId: "openai/gpt-4.1",
          },
          desktop: {
            cloud: {
              models: [
                {
                  id: "gemini-3.1-pro-preview",
                  name: "gemini-3.1-pro-preview",
                  provider: "vertex",
                },
              ],
            },
          },
          providers: [],
          setDefaultModel,
        }),
        setDefaultModel,
      } as never,
      {
        syncAll,
      } as never,
    );

    await expect(
      service.restoreManaged("gemini-3.1-pro-preview"),
    ).resolves.toEqual({
      success: true,
      newModelId: "gemini-3.1-pro-preview",
    });
    expect(setDefaultModel).toHaveBeenCalledWith("gemini-3.1-pro-preview");
    expect(syncAll).toHaveBeenCalledTimes(1);
  });

  it("reads fallback providers from canonical models config", async () => {
    const service = new QuotaFallbackService(
      {
        getConfig: vi.fn().mockResolvedValue({
          runtime: {
            defaultModelId: "nexu-managed/model",
          },
          desktop: {
            cloud: {
              models: [],
            },
          },
          models: {
            providers: {
              openai: {
                enabled: true,
                apiKey: "sk-test",
                baseUrl: "https://api.openai.com/v1",
                models: [{ id: "gpt-4.1" }],
              },
            },
          },
          providers: [],
        }),
      } as never,
      {
        syncAll: vi.fn(),
      } as never,
    );

    await expect(service.getAvailableByokProvider()).resolves.toEqual({
      providerKey: "openai",
      providerId: "openai",
      modelId: "openai/gpt-4.1",
    });
  });
});
