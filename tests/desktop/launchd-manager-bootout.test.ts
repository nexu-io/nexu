/**
 * Tests for LaunchdManager.bootoutService error handling.
 *
 * Verifies that bootoutService tolerates "not found" errors from launchctl
 * (indicating the service is already unregistered) and re-throws unexpected errors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecFile = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/Users/testuser"),
  userInfo: vi.fn(() => ({ uid: 501 })),
}));

const originalPlatform = process.platform;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LaunchdManager.bootoutService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, "platform", { value: "darwin" });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("resolves successfully when launchctl bootout succeeds", async () => {
    // Make execFile call the callback with success
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        callback: (err: null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, "", "");
      },
    );

    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const manager = new LaunchdManager({ plistDir: "/tmp/test-plist" });

    await expect(
      manager.bootoutService("io.nexu.test"),
    ).resolves.toBeUndefined();
  });

  it("tolerates 'Could not find specified service' error", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], callback: (err: Error) => void) => {
        const error = new Error(
          "Command failed: launchctl bootout gui/501/io.nexu.test\n" +
            "Could not find specified service",
        );
        callback(error);
      },
    );

    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const manager = new LaunchdManager({ plistDir: "/tmp/test-plist" });

    // Should not throw
    await expect(
      manager.bootoutService("io.nexu.test"),
    ).resolves.toBeUndefined();
  });

  it("tolerates 'No such process' error", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], callback: (err: Error) => void) => {
        const error = new Error("No such process");
        callback(error);
      },
    );

    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const manager = new LaunchdManager({ plistDir: "/tmp/test-plist" });

    await expect(
      manager.bootoutService("io.nexu.test"),
    ).resolves.toBeUndefined();
  });

  it("tolerates 'not bootstrapped' error", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], callback: (err: Error) => void) => {
        const error = new Error("Service is not bootstrapped");
        callback(error);
      },
    );

    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const manager = new LaunchdManager({ plistDir: "/tmp/test-plist" });

    await expect(
      manager.bootoutService("io.nexu.test"),
    ).resolves.toBeUndefined();
  });

  it("re-throws unexpected errors", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], callback: (err: Error) => void) => {
        callback(new Error("Permission denied"));
      },
    );

    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const manager = new LaunchdManager({ plistDir: "/tmp/test-plist" });

    await expect(manager.bootoutService("io.nexu.test")).rejects.toThrow(
      "Permission denied",
    );
  });
});
