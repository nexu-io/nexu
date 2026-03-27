import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsState = vi.hoisted(() => ({
  paths: new Set<string>(),
  stampContents: new Map<string, string>(),
  archiveStamp: "123:456",
}));

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn((target: string) => fsState.paths.has(target)),
  mkdirSync: vi.fn((target: string) => {
    fsState.paths.add(target);
  }),
  readFileSync: vi.fn(
    (target: string) => fsState.stampContents.get(target) ?? "",
  ),
  statSync: vi.fn(() => ({ size: 123, mtimeMs: 456 })),
  writeFileSync: vi.fn((target: string, contents: string) => {
    fsState.paths.add(target);
    fsState.stampContents.set(target, contents);
  }),
}));

import {
  buildSkillNodePath,
  ensurePackagedOpenclawSidecar,
} from "../../apps/desktop/main/runtime/manifests";

describe("desktop runtime manifests", () => {
  beforeEach(() => {
    fsState.paths.clear();
    fsState.stampContents.clear();
    execFileSyncMock.mockReset();
  });

  describe("buildSkillNodePath", () => {
    it("prefers bundled desktop node_modules in dev", () => {
      const result = buildSkillNodePath("/repo/apps/desktop", false, "");

      expect(result).toBe("/repo/apps/desktop/node_modules");
    });

    it("prefers packaged bundled-node-modules for desktop dist", () => {
      const result = buildSkillNodePath(
        "/Applications/Nexu.app/Contents/Resources",
        true,
        "",
      );

      expect(result).toBe(
        "/Applications/Nexu.app/Contents/Resources/bundled-node-modules",
      );
    });

    it("preserves inherited NODE_PATH entries without duplication", () => {
      const bundledPath = "/repo/apps/desktop/node_modules";
      const inherited = [
        bundledPath,
        "/usr/local/lib/node_modules",
        "/opt/custom/node_modules",
      ].join(path.delimiter);

      const result = buildSkillNodePath("/repo/apps/desktop", false, inherited);

      expect(result).toBe(
        [
          bundledPath,
          "/usr/local/lib/node_modules",
          "/opt/custom/node_modules",
        ].join(path.delimiter),
      );
    });
  });

  describe("ensurePackagedOpenclawSidecar", () => {
    it("reuses existing extracted sidecar when stamp and entry already match", () => {
      const archivePath =
        "/Applications/Nexu.app/Contents/Resources/runtime/openclaw/payload.tar.gz";
      const extractedRoot = "/Users/testuser/.nexu/openclaw-sidecar";
      const stampPath = `${extractedRoot}/.archive-stamp`;
      const entryPath = `${extractedRoot}/node_modules/openclaw/openclaw.mjs`;

      fsState.paths.add(archivePath);
      fsState.paths.add(stampPath);
      fsState.paths.add(entryPath);
      fsState.stampContents.set(stampPath, fsState.archiveStamp);

      const result = ensurePackagedOpenclawSidecar(
        "/Applications/Nexu.app/Contents/Resources/runtime",
        "/Users/testuser/.nexu",
      );

      expect(result).toBe(extractedRoot);
      expect(execFileSyncMock).not.toHaveBeenCalled();
    });

    it("extracts through staging, verifies entry, and atomically swaps into place", () => {
      const archivePath =
        "/Applications/Nexu.app/Contents/Resources/runtime/openclaw/payload.tar.gz";
      const extractedRoot = "/Users/testuser/.nexu/openclaw-sidecar";
      const stagingRoot = `${extractedRoot}.staging`;
      const stagingEntry = `${stagingRoot}/node_modules/openclaw/openclaw.mjs`;

      fsState.paths.add(archivePath);

      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "tar" && args[3] === stagingRoot) {
          fsState.paths.add(stagingRoot);
          fsState.paths.add(stagingEntry);
        }
        if (cmd === "mv") {
          fsState.paths.delete(stagingRoot);
          fsState.paths.delete(stagingEntry);
          fsState.paths.add(extractedRoot);
          fsState.paths.add(
            `${extractedRoot}/node_modules/openclaw/openclaw.mjs`,
          );
        }
      });

      const result = ensurePackagedOpenclawSidecar(
        "/Applications/Nexu.app/Contents/Resources/runtime",
        "/Users/testuser/.nexu",
      );

      expect(result).toBe(extractedRoot);
      expect(execFileSyncMock).toHaveBeenCalledWith("tar", [
        "-xzf",
        archivePath,
        "-C",
        stagingRoot,
      ]);
      expect(execFileSyncMock).toHaveBeenCalledWith("mv", [
        stagingRoot,
        extractedRoot,
      ]);
      expect(fsState.stampContents.get(`${stagingRoot}/.archive-stamp`)).toBe(
        fsState.archiveStamp,
      );
    });

    it("cleans leftover staging directories before a fresh extraction", () => {
      const archivePath =
        "/Applications/Nexu.app/Contents/Resources/runtime/openclaw/payload.tar.gz";
      const extractedRoot = "/Users/testuser/.nexu/openclaw-sidecar";
      const stagingRoot = `${extractedRoot}.staging`;
      const stagingEntry = `${stagingRoot}/node_modules/openclaw/openclaw.mjs`;

      fsState.paths.add(archivePath);
      fsState.paths.add(stagingRoot);

      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "rm" && args[1] === stagingRoot) {
          fsState.paths.delete(stagingRoot);
        }
        if (cmd === "tar" && args[3] === stagingRoot) {
          fsState.paths.add(stagingRoot);
          fsState.paths.add(stagingEntry);
        }
        if (cmd === "mv") {
          fsState.paths.delete(stagingRoot);
          fsState.paths.delete(stagingEntry);
          fsState.paths.add(extractedRoot);
          fsState.paths.add(
            `${extractedRoot}/node_modules/openclaw/openclaw.mjs`,
          );
        }
      });

      ensurePackagedOpenclawSidecar(
        "/Applications/Nexu.app/Contents/Resources/runtime",
        "/Users/testuser/.nexu",
      );

      expect(execFileSyncMock).toHaveBeenCalledWith("rm", ["-rf", stagingRoot]);
      expect(execFileSyncMock).toHaveBeenCalledWith("tar", [
        "-xzf",
        archivePath,
        "-C",
        stagingRoot,
      ]);
    });

    it("retries extraction after a transient tar failure and succeeds on the next attempt", () => {
      const archivePath =
        "/Applications/Nexu.app/Contents/Resources/runtime/openclaw/payload.tar.gz";
      const extractedRoot = "/Users/testuser/.nexu/openclaw-sidecar";
      const stagingRoot = `${extractedRoot}.staging`;
      const stagingEntry = `${stagingRoot}/node_modules/openclaw/openclaw.mjs`;
      let tarAttempts = 0;

      fsState.paths.add(archivePath);

      execFileSyncMock.mockImplementation((cmd: string, _args: string[]) => {
        if (cmd === "tar") {
          tarAttempts++;
          if (tarAttempts === 1) {
            throw new Error("tar exploded");
          }
          fsState.paths.add(stagingRoot);
          fsState.paths.add(stagingEntry);
        }
        if (cmd === "mv") {
          fsState.paths.delete(stagingRoot);
          fsState.paths.delete(stagingEntry);
          fsState.paths.add(extractedRoot);
          fsState.paths.add(
            `${extractedRoot}/node_modules/openclaw/openclaw.mjs`,
          );
        }
      });

      const result = ensurePackagedOpenclawSidecar(
        "/Applications/Nexu.app/Contents/Resources/runtime",
        "/Users/testuser/.nexu",
      );

      expect(result).toBe(extractedRoot);
      expect(tarAttempts).toBe(2);
      expect(execFileSyncMock).toHaveBeenCalledWith("sleep", ["1"]);
    });

    it("throws after retries when extraction never produces the critical entry", () => {
      const archivePath =
        "/Applications/Nexu.app/Contents/Resources/runtime/openclaw/payload.tar.gz";
      const extractedRoot = "/Users/testuser/.nexu/openclaw-sidecar";
      const stagingRoot = `${extractedRoot}.staging`;

      fsState.paths.add(archivePath);

      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "tar" && args[3] === stagingRoot) {
          fsState.paths.add(stagingRoot);
        }
      });

      expect(() =>
        ensurePackagedOpenclawSidecar(
          "/Applications/Nexu.app/Contents/Resources/runtime",
          "/Users/testuser/.nexu",
        ),
      ).toThrow("Extraction verification failed");

      const tarCalls = execFileSyncMock.mock.calls.filter(
        ([cmd]) => cmd === "tar",
      );
      const sleepCalls = execFileSyncMock.mock.calls.filter(
        ([cmd]) => cmd === "sleep",
      );
      expect(tarCalls).toHaveLength(3);
      expect(sleepCalls).toHaveLength(2);
    });
  });
});
