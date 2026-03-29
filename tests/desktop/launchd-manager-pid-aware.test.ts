/**
 * LaunchdManager PID-aware shutdown tests
 *
 * Covers the improved waitForExit (with knownPid) and bootoutAndWaitForExit:
 *
 * 1. waitForExit: service stops normally → returns immediately
 * 2. waitForExit: label becomes "unknown" after bootout, knownPid dead → returns
 * 3. waitForExit: label "unknown" but knownPid alive → SIGKILL
 * 4. waitForExit: label "unknown" without knownPid → returns (legacy behavior)
 * 5. waitForExit: timeout → SIGKILL via knownPid
 * 6. waitForExit: timeout → SIGKILL via launchctl PID (no knownPid)
 * 7. bootoutAndWaitForExit: captures PID, bootouts, waits
 * 8. bootoutAndWaitForExit: bootout fails, PID alive → SIGKILL
 * 9. bootoutAndWaitForExit: bootout fails, no PID → returns gracefully
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
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

type ExecFileCallback = (
  error: Error | null,
  result: { stdout: string; stderr: string },
) => void;

function launchctlPrintRunning(pid: number): string {
  return [
    "io.nexu.controller = {",
    `\tpid = ${pid}`,
    "\tstate = running",
    "}",
  ].join("\n");
}

function launchctlPrintStopped(): string {
  return ["io.nexu.controller = {", "\tstate = waiting", "}"].join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LaunchdManager PID-aware shutdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, "platform", { value: "darwin" });
  });

  // -----------------------------------------------------------------------
  // 1. Service stops normally
  // -----------------------------------------------------------------------
  it("waitForExit returns when service status becomes stopped", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], callback: ExecFileCallback) => {
        if (args[0] === "print") {
          callCount++;
          if (callCount <= 1) {
            // First poll: still running
            callback(null, { stdout: launchctlPrintRunning(5555), stderr: "" });
          } else {
            // Second poll: stopped
            callback(null, { stdout: launchctlPrintStopped(), stderr: "" });
          }
        } else {
          callback(null, { stdout: "", stderr: "" });
        }
      },
    );

    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

    // Should resolve without needing SIGKILL
    await mgr.waitForExit("io.nexu.controller", 5000);
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  // -----------------------------------------------------------------------
  // 2. Label "unknown" after bootout, knownPid dead → returns
  // -----------------------------------------------------------------------
  it("waitForExit returns when label is unknown and knownPid is dead", async () => {
    // launchctl print always fails (label unregistered after bootout)
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], callback: ExecFileCallback) => {
        if (args[0] === "print") {
          callback(new Error("Could not find service"), {
            stdout: "",
            stderr: "",
          });
        } else {
          callback(null, { stdout: "", stderr: "" });
        }
      },
    );

    // Mock process.kill(pid, 0) to throw ESRCH (process dead)
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === 99999) {
        const err = new Error("ESRCH") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }
      return true;
    });

    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

    // knownPid=99999 is dead → should return without SIGKILL
    await mgr.waitForExit("io.nexu.controller", 2000, 99999);

    // process.kill(99999, 0) was called for existence check, not SIGKILL
    const sigkillCalls = killSpy.mock.calls.filter(
      (call) => call[1] === "SIGKILL",
    );
    expect(sigkillCalls).toHaveLength(0);

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 3. Label "unknown" but knownPid still alive → SIGKILL
  // -----------------------------------------------------------------------
  it("waitForExit sends SIGKILL when label is unknown but knownPid is alive", async () => {
    // launchctl print always fails
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], callback: ExecFileCallback) => {
        if (args[0] === "print") {
          callback(new Error("Could not find service"), {
            stdout: "",
            stderr: "",
          });
        } else {
          callback(null, { stdout: "", stderr: "" });
        }
      },
    );

    let killCount = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid, sig) => {
      if (pid === 77777 && sig === 0) {
        // Process is alive on first few checks
        if (killCount < 4) {
          killCount++;
          return true;
        }
        // After SIGKILL, process is dead
        const err = new Error("ESRCH") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }
      // SIGKILL succeeds
      return true;
    });

    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

    await mgr.waitForExit("io.nexu.controller", 1500, 77777);

    // Should have sent SIGKILL to the alive process
    const sigkillCalls = killSpy.mock.calls.filter(
      (call) => call[0] === 77777 && call[1] === "SIGKILL",
    );
    expect(sigkillCalls.length).toBeGreaterThanOrEqual(1);

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 4. Label "unknown" without knownPid → returns (legacy compat)
  // -----------------------------------------------------------------------
  it("waitForExit returns after 3 unknowns when no knownPid provided", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], callback: ExecFileCallback) => {
        if (args[0] === "print") {
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

    // No knownPid → should return after 3 consecutive unknowns
    await mgr.waitForExit("io.nexu.controller", 5000);
    // If we got here without timeout, the test passes
  });

  // -----------------------------------------------------------------------
  // 5. Timeout → SIGKILL via knownPid
  // -----------------------------------------------------------------------
  it("waitForExit uses knownPid for SIGKILL when service stays running past timeout", async () => {
    // Service stays running forever
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], callback: ExecFileCallback) => {
        if (args[0] === "print") {
          callback(null, { stdout: launchctlPrintRunning(33333), stderr: "" });
        } else {
          callback(null, { stdout: "", stderr: "" });
        }
      },
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

    // knownPid=11111 — the SIGKILL should use this, not the launchctl PID
    await mgr.waitForExit("io.nexu.controller", 800, 11111);

    const sigkillCalls = killSpy.mock.calls.filter(
      (call) => call[1] === "SIGKILL",
    );
    // Should have used knownPid (11111) for SIGKILL
    expect(sigkillCalls.some((call) => call[0] === 11111)).toBe(true);

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 6. Timeout → SIGKILL via launchctl PID when no knownPid
  // -----------------------------------------------------------------------
  it("waitForExit falls back to launchctl PID for SIGKILL when no knownPid", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], callback: ExecFileCallback) => {
        if (args[0] === "print") {
          callback(null, { stdout: launchctlPrintRunning(44444), stderr: "" });
        } else {
          callback(null, { stdout: "", stderr: "" });
        }
      },
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

    await mgr.waitForExit("io.nexu.controller", 800);

    const sigkillCalls = killSpy.mock.calls.filter(
      (call) => call[1] === "SIGKILL",
    );
    // Should have used launchctl-reported PID (44444)
    expect(sigkillCalls.some((call) => call[0] === 44444)).toBe(true);

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 7. bootoutAndWaitForExit: captures PID, bootouts, waits
  // -----------------------------------------------------------------------
  it("bootoutAndWaitForExit captures PID before bootout", async () => {
    let bootoutCalled = false;
    let printCallCount = 0;

    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], callback: ExecFileCallback) => {
        if (args[0] === "print") {
          printCallCount++;
          if (!bootoutCalled) {
            // Before bootout: service running with known PID
            callback(null, {
              stdout: launchctlPrintRunning(55555),
              stderr: "",
            });
          } else {
            // After bootout: label gone
            callback(new Error("not found"), { stdout: "", stderr: "" });
          }
          return;
        }
        if (args[0] === "bootout") {
          bootoutCalled = true;
          callback(null, { stdout: "", stderr: "" });
          return;
        }
        callback(null, { stdout: "", stderr: "" });
      },
    );

    // Mock process.kill to track calls
    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((_pid, sig) => {
        if (sig === 0) {
          // After bootout, process dies
          if (bootoutCalled) {
            const err = new Error("ESRCH") as NodeJS.ErrnoException;
            err.code = "ESRCH";
            throw err;
          }
          return true;
        }
        return true;
      });

    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

    await mgr.bootoutAndWaitForExit("io.nexu.controller", 3000);

    // Should have called launchctl print BEFORE bootout to get PID
    expect(printCallCount).toBeGreaterThanOrEqual(1);
    // Should have called bootout
    expect(bootoutCalled).toBe(true);

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 8. bootoutAndWaitForExit: bootout fails, PID alive → SIGKILL
  // -----------------------------------------------------------------------
  it("bootoutAndWaitForExit sends SIGKILL when bootout fails and PID is alive", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], callback: ExecFileCallback) => {
        if (args[0] === "print") {
          callback(null, { stdout: launchctlPrintRunning(66666), stderr: "" });
          return;
        }
        if (args[0] === "bootout") {
          callback(new Error("service not registered"), {
            stdout: "",
            stderr: "",
          });
          return;
        }
        callback(null, { stdout: "", stderr: "" });
      },
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid, sig) => {
      if (sig === 0 && pid === 66666) return true; // alive
      return true; // SIGKILL succeeds
    });

    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

    await mgr.bootoutAndWaitForExit("io.nexu.controller", 3000);

    // Should have sent SIGKILL to the surviving process
    const sigkillCalls = killSpy.mock.calls.filter(
      (call) => call[0] === 66666 && call[1] === "SIGKILL",
    );
    expect(sigkillCalls.length).toBeGreaterThanOrEqual(1);

    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // 9. bootoutAndWaitForExit: bootout fails, no PID → returns gracefully
  // -----------------------------------------------------------------------
  it("bootoutAndWaitForExit returns gracefully when bootout fails and no PID", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], callback: ExecFileCallback) => {
        if (args[0] === "print") {
          // Service not registered (no PID available)
          callback(new Error("not found"), { stdout: "", stderr: "" });
          return;
        }
        if (args[0] === "bootout") {
          callback(new Error("not found"), { stdout: "", stderr: "" });
          return;
        }
        callback(null, { stdout: "", stderr: "" });
      },
    );

    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir: "/tmp/test" });

    // Should NOT throw
    await mgr.bootoutAndWaitForExit("io.nexu.controller", 2000);
  });
});
