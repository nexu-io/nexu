import { selectPreferredModel } from "@nexu/shared";
import { describe, expect, it } from "vitest";

describe("selectPreferredModel", () => {
  it("prefers Gemini 3.1 Pro Preview across naming variants", () => {
    const models = [
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      {
        id: "link/gemini-3.1-pro-preview",
        name: "gemini-3.1-pro-preview",
      },
      { id: "openai/gpt-5", name: "GPT-5" },
    ];

    expect(selectPreferredModel(models)?.id).toBe(
      "link/gemini-3.1-pro-preview",
    );
  });

  it("matches provider-prefixed and space-separated Gemini variants", () => {
    const models = [
      { id: "foo/gemini-3-1-pro", name: "Gemini 3 1 Pro" },
      { id: "bar/claude-sonnet-4", name: "Claude Sonnet 4" },
    ];

    expect(selectPreferredModel(models)?.id).toBe("foo/gemini-3-1-pro");
  });

  it("falls back by priority when preferred variants are absent", () => {
    const models = [
      { id: "foo/claude-sonnet-4", name: "Claude Sonnet 4" },
      { id: "bar/gpt-5", name: "GPT 5" },
    ];

    expect(selectPreferredModel(models)?.id).toBe("foo/claude-sonnet-4");
  });
});
