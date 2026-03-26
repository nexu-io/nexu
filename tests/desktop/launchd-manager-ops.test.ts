/**
 * LaunchdManager operations tests — covers service lifecycle,
 * status parsing, graceful shutdown, and edge cases.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock child_process.execFile
// ---------------------------------------------------------------------------

const mockExecFile = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/Users/testuser"),
  userInfo: vi.fn(() => ({ uid: 501 })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupExecFile(
  responses: Record<
    string,
    { stdout?: string; stderr?: string; error?: Error }
  >,
): void {
  mockExecFile.mockImplementation(
    (
      cmd: string,
      args: string[],
      callback: (
        error: Error | null,
        result: { stdout: string; stderr: string },
      ) => void,
    ) => {
      const key = `${cmd} ${args.join(" ")}`;
      for (const [pattern, response] of Object.entries(responses)) {
        if (key.includes(pattern)) {
          if (response.error) {
            callback(response.error, { stdout: "", stderr: "" });
          } else {
            callback(null, {
              stdout: response.stdout ?? "",
              stderr: response.stderr ?? "",
            });
          }
          return;
        }
      }
      // Default: success with empty output
      callback(null, { stdout: "", stderr: "" });
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LaunchdManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, "platform", { value: "darwin" });
  });

  describe("getServiceStatus", () => {
    it("parses running service with PID", async () => {
      setupExecFile({
        "launchctl print": {
          stdout: [
            "io.nexu.controller = {",
            "\tpid = 12345",
            "\tstate = running",
            "\tenvironment = {",
            "\t\tPORT => 50800",
            "\t\tNEXU_HOME => /Users/testuser/.nexu",
            "\t}",
            "}",
          ].join("\n"),
        },
      });

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });
      const status = await mgr.getServiceStatus("io.nexu.controller");

      expect(status.status).toBe("running");
      expect(status.pid).toBe(12345);
      expect(status.env).toEqual({
        PORT: "50800",
        NEXU_HOME: "/Users/testuser/.nexu",
      });
    });

    it("parses stopped service", async () => {
      setupExecFile({
        "launchctl print": {
          stdout: ["io.nexu.controller = {", "\tstate = waiting", "}"].join(
            "\n",
          ),
        },
      });

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });
      const status = await mgr.getServiceStatus("io.nexu.controller");

      expect(status.status).toBe("stopped");
      expect(status.pid).toBeUndefined();
      expect(status.env).toBeUndefined();
    });

    it("returns unknown when launchctl print fails", async () => {
      setupExecFile({
        "launchctl print": {
          error: new Error("Could not find service"),
        },
      });

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });
      const status = await mgr.getServiceStatus("io.nexu.controller");

      expect(status.status).toBe("unknown");
    });

    it("does not parse inherited environment block", async () => {
      setupExecFile({
        "launchctl print": {
          stdout: [
            "io.nexu.controller = {",
            "\tpid = 100",
            "\tstate = running",
            "\tinherited environment = {",
            "\t\tINHERITED_KEY => should_not_appear",
            "\t}",
            "\tenvironment = {",
            "\t\tPORT => 50800",
            "\t}",
            "}",
          ].join("\n"),
        },
      });

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });
      const status = await mgr.getServiceStatus("io.nexu.controller");

      expect(status.env).toEqual({ PORT: "50800" });
      expect(status.env?.INHERITED_KEY).toBeUndefined();
    });
  });

  describe("installService", () => {
    it("writes plist and bootstraps when not registered", async () => {
      // First call: launchctl print (isServiceRegistered) → fails (not registered)
      // Second call: launchctl bootstrap → succeeds
      let _callCount = 0;
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          args: string[],
          callback: (
            error: Error | null,
            result: { stdout: string; stderr: string },
          ) => void,
        ) => {
          _callCount++;
          if (args.includes("print")) {
            callback(new Error("not found"), { stdout: "", stderr: "" });
          } else if (args.includes("bootstrap")) {
            callback(null, { stdout: "", stderr: "" });
          } else {
            callback(null, { stdout: "", stderr: "" });
          }
        },
      );

      const fs = await import("node:fs/promises");
      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

      await mgr.installService("io.nexu.controller", "<plist>test</plist>");

      expect(fs.writeFile).toHaveBeenCalledWith(
        "/tmp/test/io.nexu.controller.plist",
        "<plist>test</plist>",
        "utf8",
      );
    });

    it("skips bootstrap if already registered and plist unchanged", async () => {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          args: string[],
          callback: (
            error: Error | null,
            result: { stdout: string; stderr: string },
          ) => void,
        ) => {
          // launchctl print succeeds → service is registered
          if (args.includes("print")) {
            callback(null, { stdout: "registered", stderr: "" });
          } else {
            callback(null, { stdout: "", stderr: "" });
          }
        },
      );

      // Mock readFile to return the same content as what we'll install
      const fs = await import("node:fs/promises");
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        "<plist>test</plist>",
      );

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

      await mgr.installService("io.nexu.controller", "<plist>test</plist>");

      // bootstrap should NOT have been called (plist unchanged)
      const bootstrapCalls = mockExecFile.mock.calls.filter((call: unknown[]) =>
        (call[1] as string[]).includes("bootstrap"),
      );
      expect(bootstrapCalls).toHaveLength(0);
    });

    it("re-bootstraps if already registered but plist content changed", async () => {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          callback: (
            error: Error | null,
            result: { stdout: string; stderr: string },
          ) => void,
        ) => {
          callback(null, { stdout: "registered", stderr: "" });
        },
      );

      // Mock readFile to return OLD content (different from new)
      const fs = await import("node:fs/promises");
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        "<plist>old-content</plist>",
      );

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

      await mgr.installService(
        "io.nexu.controller",
        "<plist>new-content</plist>",
      );

      // Should have called bootout (to unregister old) and bootstrap (to register new)
      const bootoutCalls = mockExecFile.mock.calls.filter((call: unknown[]) =>
        (call[1] as string[]).includes("bootout"),
      );
      const bootstrapCalls = mockExecFile.mock.calls.filter((call: unknown[]) =>
        (call[1] as string[]).includes("bootstrap"),
      );
      expect(bootoutCalls).toHaveLength(1);
      expect(bootstrapCalls).toHaveLength(1);
    });
  });

  describe("isServiceInstalled", () => {
    it("returns true when plist exists and service is registered", async () => {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          callback: (
            error: Error | null,
            result: { stdout: string; stderr: string },
          ) => void,
        ) => {
          callback(null, { stdout: "registered", stderr: "" });
        },
      );

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });
      const result = await mgr.isServiceInstalled("io.nexu.controller");

      expect(result).toBe(true);
    });

    it("returns false when plist exists but not registered", async () => {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          args: string[],
          callback: (
            error: Error | null,
            result: { stdout: string; stderr: string },
          ) => void,
        ) => {
          if (args.includes("print")) {
            callback(new Error("not found"), { stdout: "", stderr: "" });
          } else {
            callback(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });
      const result = await mgr.isServiceInstalled("io.nexu.controller");

      expect(result).toBe(false);
    });
  });
});
