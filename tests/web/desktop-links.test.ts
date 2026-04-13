import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  openExternalUrl,
  openLocalFolderUrl,
  pathToFileUrl,
} from "../../apps/web/src/lib/desktop-links";

describe("desktop links", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal("window", {
      open: vi.fn(),
    });
  });

  it("uses the desktop host bridge for external links when available", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("window", {
      open: vi.fn(),
      nexuHost: { invoke },
    });

    await openExternalUrl("https://nexu.app/contact");

    expect(invoke).toHaveBeenCalledWith("shell:open-external", {
      url: "https://nexu.app/contact",
    });
  });

  it("falls back to window.open for external links outside desktop", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    await openExternalUrl("https://nexu.app/contact");

    expect(open).toHaveBeenCalledWith(
      "https://nexu.app/contact",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("falls back to the host bridge when opening a local folder and the controller is unavailable", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("window", {
      open: vi.fn(),
      nexuHost: { invoke },
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const url = pathToFileUrl("/tmp/nexu/session-folder");
    await openLocalFolderUrl(url);

    expect(invoke).toHaveBeenCalledWith("shell:open-external", { url });
  });
});
