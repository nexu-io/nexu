import { describe, expect, it } from "vitest";
import { buildSlackSessionKey } from "../slack-events.js";

describe("buildSlackSessionKey", () => {
  it("builds canonical channel session keys", () => {
    expect(
      buildSlackSessionKey({
        botId: "Bot-Test-1",
        channelId: "C0AJKG60H6D",
        isIm: false,
      }),
    ).toBe("agent:bot-test-1:slack:channel:c0ajkg60h6d");
  });

  it("builds canonical channel thread session keys", () => {
    expect(
      buildSlackSessionKey({
        botId: "Bot-Test-1",
        channelId: "C0AJKG60H6D",
        threadTs: "1770408518.451689",
        isIm: false,
      }),
    ).toBe(
      "agent:bot-test-1:slack:channel:c0ajkg60h6d:thread:1770408518.451689",
    );
  });

  it("builds per-peer DM session keys when slackUserId is provided", () => {
    expect(
      buildSlackSessionKey({
        botId: "Bot-Test-1",
        channelId: "D0AJKG60H6D",
        isIm: true,
        slackUserId: "U0ABCDEF123",
      }),
    ).toBe("agent:bot-test-1:direct:u0abcdef123");
  });

  it("falls back to 'unknown' peer when slackUserId is omitted", () => {
    expect(
      buildSlackSessionKey({
        botId: "Bot-Test-1",
        channelId: "D0AJKG60H6D",
        isIm: true,
      }),
    ).toBe("agent:bot-test-1:direct:unknown");
  });

  it("appends thread ids to per-peer DM session keys", () => {
    expect(
      buildSlackSessionKey({
        botId: "Bot-Test-1",
        channelId: "D0AJKG60H6D",
        threadTs: "1770408518.451689",
        isIm: true,
        slackUserId: "U0ABCDEF123",
      }),
    ).toBe("agent:bot-test-1:direct:u0abcdef123:thread:1770408518.451689");
  });

  it("normalises whitespace in all key segments", () => {
    expect(
      buildSlackSessionKey({
        botId: "  Bot-Test-1  ",
        channelId: "  C123  ",
        isIm: false,
      }),
    ).toBe("agent:bot-test-1:slack:channel:c123");
  });

  it("different slack users produce different DM keys for the same bot", () => {
    const keyA = buildSlackSessionKey({
      botId: "bot-1",
      channelId: "D111",
      isIm: true,
      slackUserId: "UAAA",
    });
    const keyB = buildSlackSessionKey({
      botId: "bot-1",
      channelId: "D222",
      isIm: true,
      slackUserId: "UBBB",
    });
    expect(keyA).not.toBe(keyB);
    expect(keyA).toBe("agent:bot-1:direct:uaaa");
    expect(keyB).toBe("agent:bot-1:direct:ubbb");
  });

  it("channel keys with null threadTs omit the thread suffix", () => {
    expect(
      buildSlackSessionKey({
        botId: "bot-1",
        channelId: "C123",
        threadTs: null,
        isIm: false,
      }),
    ).toBe("agent:bot-1:slack:channel:c123");
  });
});
