import { describe, expect, it } from "vitest";
import { getChannelStatusLabel } from "../src/lib/channel-live-status";

describe("getChannelStatusLabel", () => {
  const labels = {
    connected: "Connected",
    connecting: "Connecting...",
    disconnected: "Disconnected",
    error: "Connection error",
    restarting: "Restarting...",
  };

  it("returns the predefined error label instead of any raw backend payload", () => {
    expect(getChannelStatusLabel("error", labels)).toBe("Connection error");
  });

  it("returns the disconnected label for undefined status", () => {
    expect(getChannelStatusLabel(undefined, labels)).toBe("Disconnected");
  });
});
