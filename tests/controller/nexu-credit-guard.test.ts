import { beforeEach, describe, expect, it, vi } from "vitest";

const statSync = vi.fn(() => ({ mtimeMs: 1 }));
const readFileSync = vi.fn(() => JSON.stringify({ locale: "en" }));

vi.mock("node:fs", () => ({
  statSync,
  readFileSync,
}));

type Handler = (event: unknown, ctx: Record<string, unknown>) => unknown;

describe("nexu-credit-guard plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    statSync.mockReturnValue({ mtimeMs: 1 });
    readFileSync.mockReturnValue(JSON.stringify({ locale: "en" }));
  });

  it("replaces only same-channel error replies", async () => {
    const handlers = new Map<string, Handler>();
    const { default: plugin } = await import(
      "../../apps/controller/static/runtime-plugins/nexu-credit-guard/index.js"
    );

    plugin.register({
      logger: { info: vi.fn() },
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
      },
      pluginConfig: {},
    });

    await handlers.get("llm_output")?.(
      {
        lastAssistant:
          '{"error":{"code":"insufficient_credits","message":"insufficient credits"}}',
      },
      { channelId: "channel-a" },
    );

    const otherChannelResult = await handlers.get("message_sending")?.(
      { content: "⚠️ something happened" },
      { channelId: "channel-b" },
    );
    const sameChannelResult = await handlers.get("message_sending")?.(
      { content: "⚠️ upstream error" },
      { channelId: "channel-a" },
    );

    expect(sameChannelResult).toEqual({
      content:
        "⚠️ Insufficient credits. You can purchase a nexu plan to top up, or switch to using your own API key. If the issue persists, see [Contact us](https://nexu.app/contact).",
    });
    expect(otherChannelResult).toBeUndefined();
  });

  it("drops stale channel cache entries after the TTL", async () => {
    vi.useFakeTimers();
    try {
      const handlers = new Map<string, Handler>();
      const { default: plugin } = await import(
        "../../apps/controller/static/runtime-plugins/nexu-credit-guard/index.js"
      );

      plugin.register({
        logger: { info: vi.fn() },
        on(event: string, handler: Handler) {
          handlers.set(event, handler);
        },
        pluginConfig: {},
      });

      await handlers.get("llm_output")?.(
        {
          lastAssistant:
            '{"error":{"code":"invalid_api_key","message":"invalid"}}',
        },
        { channelId: "channel-a" },
      );

      vi.advanceTimersByTime(5_100);

      const result = await handlers.get("message_sending")?.(
        { content: "⚠️ some unrelated error" },
        { channelId: "channel-a" },
      );

      expect(result).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
