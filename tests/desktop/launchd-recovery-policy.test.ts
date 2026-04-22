import { describe, expect, it } from "vitest";

import {
  decideLaunchdRecovery,
  detectStaleLaunchdSession,
} from "../../apps/desktop/main/lifecycle/launchd-recovery-policy";

describe("launchd recovery policy", () => {
  it("treats old Electron metadata as stale after the threshold", () => {
    const writtenAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const result = detectStaleLaunchdSession({
      metadata: {
        writtenAt,
        electronPid: 123,
        controllerPort: 50800,
        openclawPort: 18790,
        webPort: 50810,
        nexuHome: "/tmp/nexu-home",
        isDev: false,
      },
      isElectronAlive: false,
    });

    expect(result.stale).toBe(true);
    expect(result.reason).toContain("Stale session detected");
  });

  it("tears down packaged services when runtime identity path changes", () => {
    const result = decideLaunchdRecovery({
      recovered: {
        writtenAt: new Date().toISOString(),
        electronPid: 123,
        controllerPort: 50800,
        openclawPort: 18790,
        webPort: 50810,
        nexuHome: "/Users/test/.nexu",
        isDev: false,
        appVersion: "0.1.11",
        openclawStateDir:
          "/Users/test/Library/Application Support/@nexu/desktop/runtime/openclaw/state",
        userDataPath: "/Users/test/Library/Application Support/@nexu/desktop",
        buildSource: "packaged",
        runtimeIdentityPath: "/tmp/build-A/Nexu.app/Contents/Resources",
      },
      env: {
        isDev: false,
        appVersion: "0.1.11",
        nexuHome: "/Users/test/.nexu",
        openclawStateDir:
          "/Users/test/Library/Application Support/@nexu/desktop/runtime/openclaw/state",
        userDataPath: "/Users/test/Library/Application Support/@nexu/desktop",
        buildSource: "packaged",
        runtimeIdentityPath: "/tmp/build-B/Nexu.app/Contents/Resources",
      },
      anyRunning: true,
      runningNexuHome: "/Users/test/.nexu",
      defaultWebPort: 50810,
      previousElectronAlive: true,
    });

    expect(result.action).toBe("teardown-stale-services");
    expect(result.reason).toContain("runtimeIdentityPath");
  });

  it("tears down packaged services when recovered metadata is missing runtime identity path", () => {
    const result = decideLaunchdRecovery({
      recovered: {
        writtenAt: new Date().toISOString(),
        electronPid: 123,
        controllerPort: 50800,
        openclawPort: 18790,
        webPort: 50810,
        nexuHome: "/Users/test/.nexu",
        isDev: false,
        appVersion: "0.1.11",
        openclawStateDir:
          "/Users/test/Library/Application Support/@nexu/desktop/runtime/openclaw/state",
        userDataPath: "/Users/test/Library/Application Support/@nexu/desktop",
        buildSource: "packaged",
      },
      env: {
        isDev: false,
        appVersion: "0.1.11",
        nexuHome: "/Users/test/.nexu",
        openclawStateDir:
          "/Users/test/Library/Application Support/@nexu/desktop/runtime/openclaw/state",
        userDataPath: "/Users/test/Library/Application Support/@nexu/desktop",
        buildSource: "packaged",
        runtimeIdentityPath: "/tmp/build-B/Nexu.app/Contents/Resources",
      },
      anyRunning: true,
      runningNexuHome: "/Users/test/.nexu",
      defaultWebPort: 50810,
      previousElectronAlive: true,
    });

    expect(result.action).toBe("teardown-stale-services");
    expect(result.reason).toContain("runtimeIdentityPath missing");
  });

  it("reuses controller and openclaw ports when only Electron died", () => {
    const result = decideLaunchdRecovery({
      recovered: {
        writtenAt: new Date().toISOString(),
        electronPid: 123,
        controllerPort: 50800,
        openclawPort: 18790,
        webPort: 50810,
        nexuHome: "/Users/test/.nexu",
        isDev: false,
        appVersion: "0.1.11",
        buildSource: "packaged",
        runtimeIdentityPath: "/tmp/build-A/Nexu.app/Contents/Resources",
      },
      env: {
        isDev: false,
        appVersion: "0.1.11",
        nexuHome: "/Users/test/.nexu",
        buildSource: "packaged",
        runtimeIdentityPath: "/tmp/build-A/Nexu.app/Contents/Resources",
      },
      anyRunning: true,
      runningNexuHome: "/Users/test/.nexu",
      defaultWebPort: 50999,
      previousElectronAlive: false,
    });

    expect(result.action).toBe("reuse-ports");
    if (result.action !== "reuse-ports") {
      throw new Error("expected reuse-ports");
    }
    expect(result.effectivePorts.controllerPort).toBe(50800);
    expect(result.effectivePorts.openclawPort).toBe(18790);
    expect(result.effectivePorts.webPort).toBe(50999);
  });
});
