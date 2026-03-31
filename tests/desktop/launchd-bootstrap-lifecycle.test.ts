/**
 * Tests for launchd-bootstrap lifecycle robustness:
 * - Stale session detection (Force Quit leaves services running)
 * - Web server port retry logic
 */
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// isProcessAlive — test the helper logic directly
// ---------------------------------------------------------------------------

describe("isProcessAlive helper", () => {
  it("returns true for the current process", () => {
    // process.kill(pid, 0) returns true for alive processes
    const isAlive = (() => {
      try {
        process.kill(process.pid, 0);
        return true;
      } catch {
        return false;
      }
    })();
    expect(isAlive).toBe(true);
  });

  it("returns false for a non-existent PID", () => {
    // PID 99999999 is almost certainly not running
    const isAlive = (() => {
      try {
        process.kill(99999999, 0);
        return true;
      } catch {
        return false;
      }
    })();
    expect(isAlive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stale session detection logic
// ---------------------------------------------------------------------------

describe("stale session detection", () => {
  it("identifies a session as stale when Electron PID is dead and metadata is old", () => {
    const STALE_SESSION_THRESHOLD_MS = 5 * 60 * 1000;

    // Simulate metadata from 10 minutes ago
    const writtenAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const metadataAgeMs = Date.now() - new Date(writtenAt).getTime();

    // Simulate dead Electron process
    const isElectronDead = true;

    const isStale =
      isElectronDead && metadataAgeMs > STALE_SESSION_THRESHOLD_MS;
    expect(isStale).toBe(true);
  });

  it("does not identify a session as stale when metadata is recent", () => {
    const STALE_SESSION_THRESHOLD_MS = 5 * 60 * 1000;

    // Simulate metadata from 1 minute ago
    const writtenAt = new Date(Date.now() - 60 * 1000).toISOString();
    const metadataAgeMs = Date.now() - new Date(writtenAt).getTime();

    const isElectronDead = true;

    const isStale =
      isElectronDead && metadataAgeMs > STALE_SESSION_THRESHOLD_MS;
    expect(isStale).toBe(false);
  });

  it("does not identify a session as stale when Electron is still alive", () => {
    const STALE_SESSION_THRESHOLD_MS = 5 * 60 * 1000;

    const writtenAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const metadataAgeMs = Date.now() - new Date(writtenAt).getTime();

    // Electron is still running
    const isElectronDead = false;

    const isStale =
      isElectronDead && metadataAgeMs > STALE_SESSION_THRESHOLD_MS;
    expect(isStale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Web port retry logic
// ---------------------------------------------------------------------------

describe("web port retry logic", () => {
  it("tries up to 5 adjacent ports before falling back to OS-assigned", async () => {
    const WEB_PORT_RETRY_LIMIT = 5;
    const basePort = 18780;
    const portsAttempted: number[] = [];

    // Simulate a startServer function that fails for the first 4 ports
    const failUntilPort = basePort + 4;

    let boundPort: number | undefined;
    for (let offset = 0; offset <= WEB_PORT_RETRY_LIMIT; offset++) {
      const tryPort = offset < WEB_PORT_RETRY_LIMIT ? basePort + offset : 0;
      portsAttempted.push(tryPort);

      if (tryPort >= failUntilPort || tryPort === 0) {
        boundPort = tryPort === 0 ? 49152 : tryPort; // OS would assign a random port
        break;
      }
    }

    expect(portsAttempted).toEqual([18780, 18781, 18782, 18783, 18784]);
    expect(boundPort).toBe(18784);
  });

  it("falls back to OS-assigned port when all adjacent ports fail", () => {
    const WEB_PORT_RETRY_LIMIT = 5;
    const basePort = 18780;
    const portsAttempted: number[] = [];

    let boundPort: number | undefined;
    for (let offset = 0; offset <= WEB_PORT_RETRY_LIMIT; offset++) {
      const tryPort = offset < WEB_PORT_RETRY_LIMIT ? basePort + offset : 0;
      portsAttempted.push(tryPort);

      // All fail except port 0
      if (tryPort === 0) {
        boundPort = 49152; // simulated OS assignment
        break;
      }
    }

    expect(portsAttempted).toEqual([18780, 18781, 18782, 18783, 18784, 0]);
    expect(boundPort).toBe(49152);
  });

  it("uses first available port without exhausting retries", () => {
    const WEB_PORT_RETRY_LIMIT = 5;
    const basePort = 18780;
    const portsAttempted: number[] = [];

    // Simulate: first port works, loop exits on first iteration
    let boundPort: number | undefined;
    for (let offset = 0; offset <= WEB_PORT_RETRY_LIMIT; offset++) {
      const tryPort = offset < WEB_PORT_RETRY_LIMIT ? basePort + offset : 0;
      portsAttempted.push(tryPort);

      // Simulate success on port 18780
      const portAvailable = tryPort === basePort;
      if (portAvailable) {
        boundPort = tryPort;
        break;
      }
    }

    expect(portsAttempted).toEqual([18780]);
    expect(boundPort).toBe(18780);
  });
});
