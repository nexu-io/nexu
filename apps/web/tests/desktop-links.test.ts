import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLocalFolderUrl, pathToFileUrl } from "../src/lib/desktop-links";

describe("desktop-links", () => {
  it("converts an absolute POSIX path to a file URL", () => {
    expect(pathToFileUrl("/Users/qiyuan/.openclaw/agents/main/sessions")).toBe(
      "file:///Users/qiyuan/.openclaw/agents/main/sessions",
    );
  });

  it("converts a Windows path to a file URL", () => {
    expect(pathToFileUrl("C:\\Users\\qiyuan\\.openclaw\\agents\\main")).toBe(
      "file:///C:/Users/qiyuan/.openclaw/agents/main",
    );
  });
});

describe("openLocalFolderUrl – browser fallback", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls controller shell-open API with the decoded path", async () => {
    await openLocalFolderUrl("file:///Users/qiyuan/.openclaw/sessions");

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith("/api/internal/desktop/shell-open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/Users/qiyuan/.openclaw/sessions" }),
    });
  });

  it("does nothing for non-file URLs", async () => {
    await openLocalFolderUrl("https://example.com");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("silently ignores fetch errors", async () => {
    fetchSpy.mockRejectedValue(new Error("network error"));
    await expect(
      openLocalFolderUrl("file:///Users/qiyuan/.openclaw/sessions"),
    ).resolves.toBeUndefined();
  });
});

describe("openLocalFolderUrl – desktop host bridge", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let hostInvokeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    hostInvokeSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("window", {
      nexuHost: {
        invoke: hostInvokeSpy,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses controller shell-open for local file URLs even when the desktop bridge exists", async () => {
    await openLocalFolderUrl("file:///Users/qiyuan/.openclaw/workspace");

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith("/api/internal/desktop/shell-open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/Users/qiyuan/.openclaw/workspace" }),
    });
    expect(hostInvokeSpy).not.toHaveBeenCalled();
  });

  it("falls back to the desktop bridge when controller shell-open fails", async () => {
    fetchSpy.mockRejectedValue(new Error("controller down"));

    await openLocalFolderUrl("file:///Users/qiyuan/.openclaw/workspace");

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(hostInvokeSpy).toHaveBeenCalledOnce();
    expect(hostInvokeSpy).toHaveBeenCalledWith("shell:open-external", {
      url: "file:///Users/qiyuan/.openclaw/workspace",
    });
  });

  it("still uses the desktop bridge for non-file URLs", async () => {
    await openLocalFolderUrl("https://example.com");

    expect(hostInvokeSpy).toHaveBeenCalledOnce();
    expect(hostInvokeSpy).toHaveBeenCalledWith("shell:open-external", {
      url: "https://example.com",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
