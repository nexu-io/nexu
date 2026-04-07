import { describe, expect, it } from "vitest";
import { resolveWebviewPreloadUrl } from "../../apps/desktop/preload/webview-preload-url";

describe("resolveWebviewPreloadUrl", () => {
  it("returns a file URL for the packaged webview preload script", () => {
    const url = resolveWebviewPreloadUrl("/tmp/nexu/dist-electron/preload");

    expect(url).toBe(
      "file:///tmp/nexu/dist-electron/preload/webview-preload.js",
    );
  });
});
