import {
  buildCustomProviderKey,
  getDefaultProviderBaseUrls,
  getProviderAliasCandidates,
  getProviderRuntimePolicy,
  getProviderUiMetadata,
  isSupportedByokProviderId,
  listProviderRegistryEntries,
  modelsPageProviderIds,
  normalizeProviderId,
  parseCustomProviderKey,
  supportedByokProviderIds,
} from "@nexu/shared";
import { describe, expect, it } from "vitest";

describe("model provider registry", () => {
  it("derives controller and web provider lists from the registry", () => {
    const entries = listProviderRegistryEntries();
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(supportedByokProviderIds).toEqual(
      entries
        .filter((entry) => entry.controllerConfigurable)
        .map((entry) => entry.id),
    );
    expect(modelsPageProviderIds).toEqual(
      entries
        .filter((entry) => entry.modelsPageVisible)
        .map((entry) => entry.id),
    );
    expect(isSupportedByokProviderId("openai")).toBe(true);
    expect(isSupportedByokProviderId("unknown-provider")).toBe(false);
  });

  it("normalizes aliases and exposes shared UI/runtime metadata", () => {
    expect(normalizeProviderId("Gemini")).toBe("google");
    expect(normalizeProviderId("qwen-portal")).toBe("qwen");
    expect(normalizeProviderId("Doubao")).toBe("volcengine");
    expect(normalizeProviderId("grok")).toBe("xai");
    expect(normalizeProviderId("z.ai")).toBe("zai");
    expect(getProviderAliasCandidates("google")).toContain("gemini");
    expect(getProviderAliasCandidates("volcengine")).toEqual(
      expect.arrayContaining(["volcengine", "bytedance", "doubao"]),
    );
    expect(getProviderUiMetadata("openai")).toMatchObject({
      displayName: "OpenAI",
      defaultProxyUrl: "https://api.openai.com/v1",
    });
    expect(getProviderUiMetadata("mistral")).toMatchObject({
      displayName: "Mistral AI",
      defaultProxyUrl: "https://api.mistral.ai/v1",
    });
    expect(getDefaultProviderBaseUrls("minimax")).toContain(
      "https://api.minimaxi.com/anthropic",
    );
    expect(getDefaultProviderBaseUrls("github-copilot")).toContain(
      "https://api.githubcopilot.com",
    );
    expect(getProviderRuntimePolicy("minimax")).toMatchObject({
      canonicalOpenClawId: "minimax",
      apiKind: "anthropic-messages",
      requiresOauthRegion: true,
    });
    expect(getProviderRuntimePolicy("github-copilot")).toMatchObject({
      canonicalOpenClawId: "github-copilot",
      apiKind: "github-copilot",
      authModes: ["token"],
    });
  });

  it("keeps phase-a providers visible and phase-b providers hidden", () => {
    const entries = listProviderRegistryEntries();
    const entryMap = new Map(entries.map((entry) => [entry.id, entry]));

    for (const providerId of [
      "mistral",
      "xai",
      "together",
      "huggingface",
      "vllm",
      "qwen",
      "volcengine",
      "qianfan",
      "xiaomi",
    ]) {
      expect(entryMap.get(providerId)?.modelsPageVisible).toBe(true);
      expect(entryMap.get(providerId)?.controllerConfigurable).toBe(true);
    }

    for (const providerId of [
      "byteplus",
      "venice",
      "github-copilot",
      "chutes",
    ]) {
      expect(entryMap.get(providerId)?.modelsPageVisible).toBe(false);
      expect(entryMap.get(providerId)?.controllerConfigurable).toBe(true);
    }
  });

  it("builds and parses composite custom provider keys", () => {
    const key = buildCustomProviderKey("custom-openai", "team-gateway");
    expect(key).toBe("custom-openai/team-gateway");
    expect(parseCustomProviderKey("CUSTOM-OPENAI/team-gateway")).toEqual({
      templateId: "custom-openai",
      instanceId: "team-gateway",
    });
    expect(parseCustomProviderKey(key)).toEqual({
      templateId: "custom-openai",
      instanceId: "team-gateway",
    });
    expect(parseCustomProviderKey("openai/team-gateway")).toBeNull();
  });
});
