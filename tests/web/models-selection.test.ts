import { describe, expect, it } from "vitest";
import {
  getSettingsProviderSelectionIdForModel,
  isModelSelected,
} from "#web/pages/models";

describe("isModelSelected", () => {
  it("keeps legacy short default ids mapped to their full managed model ids only", () => {
    expect(
      isModelSelected("anthropic/claude-sonnet-4", "claude-sonnet-4"),
    ).toBe(true);
    expect(isModelSelected("anthropic/claude-opus-4", "claude-sonnet-4")).toBe(
      false,
    );
  });

  it("treats qualified current ids as selected for matching short provider rows", () => {
    expect(
      isModelSelected("claude-sonnet-4", "anthropic/claude-sonnet-4"),
    ).toBe(true);
  });

  it("does not cross-match fully qualified ids from different providers", () => {
    expect(isModelSelected("openai/gpt-4.1", "ollama/gpt-4.1")).toBe(false);
  });

  it("normalizes aliased provider ids for the settings details pane", () => {
    expect(
      getSettingsProviderSelectionIdForModel(
        ["kimi"],
        [{ id: "moonshot/kimi-k2", provider: "moonshot", name: "Kimi K2" }],
        "moonshot/kimi-k2",
      ),
    ).toBe("kimi");
  });
});
