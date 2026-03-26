import { describe, expect, it } from "vitest";
import { isModelSelected } from "#web/pages/models";

describe("isModelSelected", () => {
  it("keeps legacy short default ids mapped to their full managed model ids only", () => {
    expect(
      isModelSelected("anthropic/claude-sonnet-4", "claude-sonnet-4"),
    ).toBe(true);
    expect(isModelSelected("anthropic/claude-opus-4", "claude-sonnet-4")).toBe(
      false,
    );
  });

  it("does not treat a short list item as selected when the current id is fully qualified", () => {
    expect(
      isModelSelected("claude-sonnet-4", "anthropic/claude-sonnet-4"),
    ).toBe(false);
  });
});
