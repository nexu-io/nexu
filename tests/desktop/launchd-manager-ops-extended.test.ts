/**
 * LaunchdManager extended operations tests — covers uncovered methods:
 * 1. uninstallService - bootout + delete plist
 * 2. stopServiceGracefully - SIGTERM -> poll -> SIGKILL escalation
 * 3. restartService - kickstart -k
 * 4. rebootstrapFromPlist - bootstrap from existing plist
 * 5. hasPlistFile - checks file existence
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

describe("LaunchdManager — extended operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, "platform", { value: "darwin" });
  });

  // -------------------------------------------------------------------------
  // 1. uninstallService — bootout + delete plist
  // -------------------------------------------------------------------------
  describe("uninstallService", () => {
    it("bootouts service and deletes plist file", async () => {
      setupExecFile({
        bootout: { stdout: "" },
      });

      const fs = await import("node:fs/promises");
      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

      await mgr.uninstallService("io.nexu.controller");

      // Should have called bootout
      const bootoutCalls = mockExecFile.mock.calls.filter((call: unknown[]) =>
        (call[1] as string[]).includes("bootout"),
      );
      expect(bootoutCalls).toHaveLength(1);
      expect(bootoutCalls[0][1]).toContain("gui/501/io.nexu.controller");

      // Should have deleted the plist file
      expect(fs.unlink).toHaveBeenCalledWith(
        "/tmp/test/io.nexu.controller.plist",
      );
    });

    it("continues to delete plist even if bootout fails", async () => {
      setupExecFile({
        bootout: { error: new Error("service not found") },
      });

      const fs = await import("node:fs/promises");
      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

      // Should not throw
      await mgr.uninstallService("io.nexu.controller");

      // Should still attempt to delete plist
      expect(fs.unlink).toHaveBeenCalledWith(
        "/tmp/test/io.nexu.controller.plist",
      );
    });

    it("does not throw if plist file is missing", async () => {
      setupExecFile({});
      const fs = await import("node:fs/promises");
      (fs.unlink as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("ENOENT"),
      );

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

      await expect(
        mgr.uninstallService("io.nexu.controller"),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. stopServiceGracefully — SIGTERM -> poll -> SIGKILL escalation
  // -------------------------------------------------------------------------
  describe("stopServiceGracefully", () => {
    it("stops when service exits after SIGTERM", async () => {
      let callCount = 0;
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          args: string[],
          callback: (
            error: Error | null,
            result: { stdout: string; stderr: string },
          ) => void,
        ) => {
          if (args.includes("SIGTERM")) {
            // SIGTERM kill succeeds
            callback(null, { stdout: "", stderr: "" });
            return;
          }
          if (args.includes("print")) {
            callCount++;
            if (callCount <= 1) {
              // First poll: still running
              callback(null, {
                stdout: "pid = 123\nstate = running",
                stderr: "",
              });
            } else {
              // Second poll: stopped
              callback(null, {
                stdout: "state = waiting",
                stderr: "",
              });
            }
            return;
          }
          callback(null, { stdout: "", stderr: "" });
        },
      );

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

      await mgr.stopServiceGracefully("io.nexu.controller", 5000);

      // Should have sent SIGTERM
      const sigTermCalls = mockExecFile.mock.calls.filter((call: unknown[]) =>
        (call[1] as string[]).includes("SIGTERM"),
      );
      expect(sigTermCalls).toHaveLength(1);

      // Should NOT have sent SIGKILL
      const sigKillCalls = mockExecFile.mock.calls.filter((call: unknown[]) =>
        (call[1] as string[]).includes("SIGKILL"),
      );
      expect(sigKillCalls).toHaveLength(0);
    });

    it("escalates to SIGKILL after timeout", async () => {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          args: string[],
          callback: (
            error: Error | null,
            result: { stdout: string; stderr: string },
          ) => void,
        ) => {
          if (args.includes("SIGTERM") || args.includes("SIGKILL")) {
            callback(null, { stdout: "", stderr: "" });
            return;
          }
          if (args.includes("print")) {
            // Always running — will force timeout
            callback(null, {
              stdout: "pid = 123\nstate = running",
              stderr: "",
            });
            return;
          }
          callback(null, { stdout: "", stderr: "" });
        },
      );

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

      // Use very short timeout so test doesn't hang
      await mgr.stopServiceGracefully("io.nexu.controller", 100);

      // Should have sent SIGKILL after timeout
      const sigKillCalls = mockExecFile.mock.calls.filter((call: unknown[]) =>
        (call[1] as string[]).includes("SIGKILL"),
      );
      expect(sigKillCalls).toHaveLength(1);
    });

    it("returns immediately if SIGTERM fails (service already stopped)", async () => {
      setupExecFile({
        SIGTERM: { error: new Error("No such process") },
      });

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

      await mgr.stopServiceGracefully("io.nexu.controller");

      // Should not have tried print (no polling needed)
      const printCalls = mockExecFile.mock.calls.filter((call: unknown[]) =>
        (call[1] as string[]).includes("print"),
      );
      expect(printCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. restartService — kickstart -k
  // -------------------------------------------------------------------------
  describe("restartService", () => {
    it("calls launchctl kickstart -k with correct label", async () => {
      setupExecFile({});

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

      await mgr.restartService("io.nexu.controller");

      const kickstartCalls = mockExecFile.mock.calls.filter((call: unknown[]) =>
        (call[1] as string[]).includes("kickstart"),
      );
      expect(kickstartCalls).toHaveLength(1);
      expect(kickstartCalls[0][1]).toEqual([
        "kickstart",
        "-k",
        "gui/501/io.nexu.controller",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // 4. rebootstrapFromPlist — bootstrap from existing plist
  // -------------------------------------------------------------------------
  describe("rebootstrapFromPlist", () => {
    it("calls launchctl bootstrap with correct domain and plist path", async () => {
      setupExecFile({});

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

      await mgr.rebootstrapFromPlist("io.nexu.controller");

      const bootstrapCalls = mockExecFile.mock.calls.filter((call: unknown[]) =>
        (call[1] as string[]).includes("bootstrap"),
      );
      expect(bootstrapCalls).toHaveLength(1);
      expect(bootstrapCalls[0][1]).toEqual([
        "bootstrap",
        "gui/501",
        "/tmp/test/io.nexu.controller.plist",
      ]);
    });

    it("throws on bootstrap failure", async () => {
      setupExecFile({
        bootstrap: { error: new Error("Service already loaded") },
      });

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

      await expect(
        mgr.rebootstrapFromPlist("io.nexu.controller"),
      ).rejects.toThrow("Service already loaded");
    });
  });

  // -------------------------------------------------------------------------
  // 5. hasPlistFile — checks file existence
  // -------------------------------------------------------------------------
  describe("hasPlistFile", () => {
    it("returns true when plist file exists", async () => {
      const fs = await import("node:fs/promises");
      (fs.access as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

      const result = await mgr.hasPlistFile("io.nexu.controller");

      expect(result).toBe(true);
      expect(fs.access).toHaveBeenCalledWith(
        "/tmp/test/io.nexu.controller.plist",
      );
    });

    it("returns false when plist file does not exist", async () => {
      const fs = await import("node:fs/promises");
      (fs.access as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("ENOENT"),
      );

      const { LaunchdManager } = await import(
        "../../apps/desktop/main/services/launchd-manager"
      );
      const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

      const result = await mgr.hasPlistFile("io.nexu.controller");

      expect(result).toBe(false);
    });
  });
});
