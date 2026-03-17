import { describe, expect, it } from "vitest";
import { buildClaimCardBlocks } from "#api/lib/slack-blocks.js";

describe("buildClaimCardBlocks", () => {
  it("returns an array of 4 Block Kit blocks", () => {
    const blocks = buildClaimCardBlocks("https://example.com/claim?token=abc");
    expect(blocks).toHaveLength(4);
  });

  it("embeds the claim URL in the button element", () => {
    const url = "https://app.nexu.dev/claim?token=test-token-123";
    const blocks = buildClaimCardBlocks(url) as Array<{
      type: string;
      elements?: Array<{ url?: string }>;
    }>;

    const actionsBlock = blocks.find((b) => b.type === "actions");
    expect(actionsBlock).toBeDefined();
    expect(actionsBlock?.elements?.[0]?.url).toBe(url);
  });

  it("uses the primary button style", () => {
    const blocks = buildClaimCardBlocks("https://x.com") as Array<{
      type: string;
      elements?: Array<{ style?: string }>;
    }>;

    const actionsBlock = blocks.find((b) => b.type === "actions");
    expect(actionsBlock?.elements?.[0]?.style).toBe("primary");
  });

  it("includes a context block with privacy note", () => {
    const blocks = buildClaimCardBlocks("https://x.com") as Array<{
      type: string;
      elements?: Array<{ text?: string }>;
    }>;

    const contextBlock = blocks.find((b) => b.type === "context");
    expect(contextBlock).toBeDefined();
    expect(contextBlock?.elements?.[0]?.text).toContain("unique to you");
  });
});
