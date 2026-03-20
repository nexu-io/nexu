import { describe, expect, it } from "vitest";
import { getChannelChatUrl } from "../src/lib/channel-links";

describe("getChannelChatUrl", () => {
  it("prefers a Feishu open chat id when available", () => {
    expect(
      getChannelChatUrl("feishu", "cli_xxx", null, "feishu:cli_xxx", {
        sessionMetadata: {
          openChatId: "oc_41e7bdf4877cfc316136f4ccf6c32613",
          openId: "ou_00c644f271002b17348e992569f0f327",
        },
      }),
    ).toBe(
      "https://applink.feishu.cn/client/chat/open?openChatId=oc_41e7bdf4877cfc316136f4ccf6c32613",
    );
  });

  it("returns no exact Feishu target when only openId is available", () => {
    expect(
      getChannelChatUrl("feishu", "cli_xxx", null, "feishu:cli_xxx", {
        preferExactSessionTarget: true,
        sessionMetadata: {
          openId: "ou_00c644f271002b17348e992569f0f327",
        },
      }),
    ).toBe("");
  });
});
