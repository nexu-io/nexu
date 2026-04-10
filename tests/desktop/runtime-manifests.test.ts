import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsState = vi.hoisted(() => ({
  paths: new Set<string>(),
  stampContents: new Map<string, string>(),
  archiveStamp: "123:456",
}));

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
  execFile: vi.fn(
    (_cmd: unknown, _args: unknown, cb?: (...a: unknown[]) => void) => {
      cb?.(null, "", "");
    },
  ),
}));

vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:util")>();
  return {
    ...actual,
    promisify: () => vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
  };
});

vi.mock("node:fs", () => ({
  createWriteStream: vi.fn(() => ({
    write: (
      _chunk: unknown,
      _encoding: unknown,
      callback?: (error?: Error | null) => void,
    ) => {
      callback?.(null);
      return true;
    },
    end: (callback?: () => void) => {
      callback?.();
    },
  })),
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

import { resolveRuntimeManifestsRoots } from "../../apps/desktop/main/platforms/shared/runtime-roots";
import {
  buildSkillNodePath,
  createRuntimeUnitManifests,
  ensurePackagedOpenclawSidecar,
} from "../../apps/desktop/main/runtime/manifests";
import { readProxyPolicy } from "../../apps/desktop/shared/proxy-config";
import type { DesktopRuntimeConfig } from "../../apps/desktop/shared/runtime-config";

function normalizePathForAssertion(target: string): string {
  return path
    .normalize(target)
    .replace(/^[A-Za-z]:/, "")
    .replace(/\\/g, "/");
}

function runtimePath(...segments: string[]): string {
  return normalizePathForAssertion(path.join(...segments));
}

function absoluteRuntimePath(base: string, ...segments: string[]): string {
  return path.resolve(base, ...segments);
}

function createRuntimeConfig(): DesktopRuntimeConfig {
  return {
    buildInfo: {
      version: "1.0.0",
      source: "local-dev",
      branch: null,
      commit: null,
      builtAt: null,
    },
    proxy: readProxyPolicy({
      HTTP_PROXY: "http://proxy.example.com:8080",
      HTTPS_PROXY: "http://secure-proxy.example.com:8443",
      ALL_PROXY: "socks5://proxy.example.com:1080",
      NO_PROXY: "example.com",
    }),
    updates: {
      autoUpdateEnabled: true,
      channel: "stable",
    },
    ports: {
      controller: 50800,
      web: 50810,
    },
    urls: {
      controllerBase: "http://127.0.0.1:50800",
      web: "http://127.0.0.1:50810",
      openclawBase: "http://127.0.0.1:18789",
      updateFeed: null,
    },
    tokens: {
      gateway: "gw-secret-token",
    },
    paths: {
      nexuHome: "/tmp/nexu-home",
      openclawBin: "openclaw-wrapper",
    },
    desktopAuth: {
      name: "NexU Desktop",
      email: "desktop@nexu.local",
      password: "desktop-local-password",
    },
    sentryDsn: null,
    runtimeMode: "internal",
    posthogApiKey: null,
    posthogHost: null,
    langfusePublicKey: null,
    langfuseSecretKey: null,
    langfuseBaseUrl: null,
  };
}

describe("desktop runtime manifests", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    fsState.paths.clear();
    fsState.stampContents.clear();
    execFileSyncMock.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  describe("buildSkillNodePath", () => {
    it("prefers bundled desktop node_modules in dev", () => {
      const result = buildSkillNodePath("/repo/apps/desktop", false, "");

      expect(normalizePathForAssertion(result)).toBe(
        runtimePath("/repo/apps/desktop", "node_modules"),
      );
    });

    it("prefers packaged bundled-node-modules for desktop dist", () => {
      const result = buildSkillNodePath(
        "/Applications/Nexu.app/Contents/Resources",
        true,
        "",
      );

      expect(normalizePathForAssertion(result)).toBe(
        runtimePath(
          "/Applications/Nexu.app/Contents/Resources",
          "bundled-node-modules",
        ),
      );
    });

    it("preserves inherited NODE_PATH entries without duplication", () => {
      const bundledPath = path.resolve("/repo/apps/desktop", "node_modules");
      const inherited = [
        bundledPath,
        "/usr/local/lib/node_modules",
        "/opt/custom/node_modules",
      ].join(path.delimiter);

      const result = buildSkillNodePath("/repo/apps/desktop", false, inherited);
      expect(normalizePathForAssertion(result)).toBe(
        [
          normalizePathForAssertion(bundledPath),
          "/usr/local/lib/node_modules",
          "/opt/custom/node_modules",
        ].join(path.delimiter),
      );
    });
  });

  describe("ensurePackagedOpenclawSidecar", () => {
    it("reuses existing extracted sidecar when stamp and entry already match", () => {
      const runtimeSidecarBaseRoot =
        "/Applications/Nexu.app/Contents/Resources/runtime";
      const runtimeRoot = "/Users/testuser/.nexu";
      const archivePath = absoluteRuntimePath(
        runtimeSidecarBaseRoot,
        "openclaw",
        "payload.tar.gz",
      );
      const extractedRoot = absoluteRuntimePath(
        runtimeRoot,
        "openclaw-sidecar",
      );
      const stampPath = absoluteRuntimePath(extractedRoot, ".archive-stamp");
      const entryPath = absoluteRuntimePath(
        extractedRoot,
        "node_modules",
        "openclaw",
        "openclaw.mjs",
      );

      fsState.paths.add(archivePath);
      fsState.paths.add(stampPath);
      fsState.paths.add(entryPath);
      fsState.stampContents.set(stampPath, fsState.archiveStamp);

      const expectedRoot = runtimePath(
        "/Users/testuser/.nexu",
        "openclaw-sidecar",
      );

      const result = ensurePackagedOpenclawSidecar(
        runtimeSidecarBaseRoot,
        runtimeRoot,
      );

      expect(normalizePathForAssertion(result)).toBe(expectedRoot);
      expect(execFileSyncMock).not.toHaveBeenCalled();
    });

    it("resolves packaged sidecar roots through archive metadata", () => {
      const runtimeSidecarBaseRoot =
        "/Applications/Nexu.app/Contents/Resources/runtime";
      const runtimeRoot = "/Users/testuser/.nexu";
      const archiveMetadataPath = absoluteRuntimePath(
        runtimeSidecarBaseRoot,
        "openclaw",
        "archive.json",
      );
      const archivePath = absoluteRuntimePath(
        runtimeSidecarBaseRoot,
        "openclaw",
        "payload.zip",
      );
      const extractedRoot = absoluteRuntimePath(
        runtimeRoot,
        "openclaw-sidecar",
      );
      const entryPath = absoluteRuntimePath(
        extractedRoot,
        "node_modules",
        "openclaw",
        "openclaw.mjs",
      );

      fsState.paths.add(archiveMetadataPath);
      fsState.paths.add(archivePath);
      fsState.paths.add(entryPath);
      fsState.stampContents.set(
        archiveMetadataPath,
        JSON.stringify({ format: "zip", path: "payload.zip" }),
      );

      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "tar" && args[3] === `${extractedRoot}.staging`) {
          fsState.paths.add(`${extractedRoot}.staging`);
          fsState.paths.add(
            entryPath.replace(extractedRoot, `${extractedRoot}.staging`),
          );
        }
        if (cmd === "mv") {
          fsState.paths.delete(`${extractedRoot}.staging`);
          fsState.paths.add(extractedRoot);
          fsState.paths.add(entryPath);
        }
      });

      const result = ensurePackagedOpenclawSidecar(
        runtimeSidecarBaseRoot,
        runtimeRoot,
      );

      expect(normalizePathForAssertion(result)).toBe(
        runtimePath("/Users/testuser/.nexu", "openclaw-sidecar"),
      );
    });

    it("extracts through staging, verifies entry, and atomically swaps into place", () => {
      const runtimeSidecarBaseRoot =
        "/Applications/Nexu.app/Contents/Resources/runtime";
      const runtimeRoot = "/Users/testuser/.nexu";
      const archivePath = absoluteRuntimePath(
        runtimeSidecarBaseRoot,
        "openclaw",
        "payload.tar.gz",
      );
      const extractedRoot = absoluteRuntimePath(
        runtimeRoot,
        "openclaw-sidecar",
      );
      const stagingRoot = `${extractedRoot}.staging`;
      const stagingEntry = absoluteRuntimePath(
        stagingRoot,
        "node_modules",
        "openclaw",
        "openclaw.mjs",
      );

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

      const expectedRoot = runtimePath(
        "/Users/testuser/.nexu",
        "openclaw-sidecar",
      );
      const result = ensurePackagedOpenclawSidecar(
        runtimeSidecarBaseRoot,
        runtimeRoot,
      );

      expect(normalizePathForAssertion(result)).toBe(expectedRoot);
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
      expect(
        fsState.stampContents.get(
          absoluteRuntimePath(stagingRoot, ".archive-stamp"),
        ),
      ).toBe(fsState.archiveStamp);
    });

    it("skips extraction when the packaged sidecar is already unpacked", () => {
      const runtimeSidecarBaseRoot =
        "/Applications/Nexu.app/Contents/Resources/runtime";
      const packagedSidecarRoot = absoluteRuntimePath(
        runtimeSidecarBaseRoot,
        "openclaw",
      );
      const entryPath = absoluteRuntimePath(
        packagedSidecarRoot,
        "node_modules",
        "openclaw",
        "openclaw.mjs",
      );

      fsState.paths.add(entryPath);

      const result = ensurePackagedOpenclawSidecar(
        runtimeSidecarBaseRoot,
        "/Users/testuser/.nexu",
      );

      expect(normalizePathForAssertion(result)).toBe(
        runtimePath(
          "/Applications/Nexu.app/Contents/Resources/runtime",
          "openclaw",
        ),
      );
      expect(execFileSyncMock).not.toHaveBeenCalled();
    });

    it("cleans leftover staging directories before a fresh extraction", () => {
      const runtimeSidecarBaseRoot =
        "/Applications/Nexu.app/Contents/Resources/runtime";
      const runtimeRoot = "/Users/testuser/.nexu";
      const archivePath = absoluteRuntimePath(
        runtimeSidecarBaseRoot,
        "openclaw",
        "payload.tar.gz",
      );
      const extractedRoot = absoluteRuntimePath(
        runtimeRoot,
        "openclaw-sidecar",
      );
      const stagingRoot = `${extractedRoot}.staging`;
      const stagingEntry = absoluteRuntimePath(
        stagingRoot,
        "node_modules",
        "openclaw",
        "openclaw.mjs",
      );

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

      ensurePackagedOpenclawSidecar(runtimeSidecarBaseRoot, runtimeRoot);

      expect(execFileSyncMock).toHaveBeenCalledWith("rm", ["-rf", stagingRoot]);
      expect(execFileSyncMock).toHaveBeenCalledWith("tar", [
        "-xzf",
        archivePath,
        "-C",
        stagingRoot,
      ]);
    });

    it("retries extraction after a transient tar failure and succeeds on the next attempt", () => {
      const runtimeSidecarBaseRoot =
        "/Applications/Nexu.app/Contents/Resources/runtime";
      const runtimeRoot = "/Users/testuser/.nexu";
      const archivePath = absoluteRuntimePath(
        runtimeSidecarBaseRoot,
        "openclaw",
        "payload.tar.gz",
      );
      const extractedRoot = absoluteRuntimePath(
        runtimeRoot,
        "openclaw-sidecar",
      );
      const stagingRoot = `${extractedRoot}.staging`;
      const stagingEntry = absoluteRuntimePath(
        stagingRoot,
        "node_modules",
        "openclaw",
        "openclaw.mjs",
      );
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
        runtimeSidecarBaseRoot,
        runtimeRoot,
      );

      expect(normalizePathForAssertion(result)).toBe(
        runtimePath("/Users/testuser/.nexu", "openclaw-sidecar"),
      );
      expect(tarAttempts).toBe(2);
    });

    it("throws after retries when extraction never produces the critical entry", () => {
      const runtimeSidecarBaseRoot =
        "/Applications/Nexu.app/Contents/Resources/runtime";
      const runtimeRoot = "/Users/testuser/.nexu";
      const archivePath = absoluteRuntimePath(
        runtimeSidecarBaseRoot,
        "openclaw",
        "payload.tar.gz",
      );
      const extractedRoot = absoluteRuntimePath(
        runtimeRoot,
        "openclaw-sidecar",
      );
      const stagingRoot = `${extractedRoot}.staging`;

      fsState.paths.add(archivePath);

      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "tar" && args[3] === stagingRoot) {
          fsState.paths.add(stagingRoot);
        }
      });

      expect(() =>
        ensurePackagedOpenclawSidecar(runtimeSidecarBaseRoot, runtimeRoot),
      ).toThrow("Extraction verification failed");

      const tarCalls = execFileSyncMock.mock.calls.filter(
        ([cmd]) => cmd === "tar",
      );
      expect(tarCalls).toHaveLength(3);
    });
  });

  describe("createRuntimeUnitManifests", () => {
    it("resolves runtime roots for manifest assembly", () => {
      const roots = resolveRuntimeManifestsRoots({
        app: {
          getPath: (name: string) =>
            name === "userData"
              ? "/Users/testuser/Library/Application Support/@nexu/desktop"
              : "/Applications/Nexu.app/Contents/Resources",
          isPackaged: true,
        } as never,
        electronRoot: "/Applications/Nexu.app/Contents/Resources",
        runtimeConfig: createRuntimeConfig(),
      });

      expect(normalizePathForAssertion(roots.runtimeRoot)).toBe(
        runtimePath(
          "/Users/testuser/Library/Application Support/@nexu/desktop",
          "runtime",
        ),
      );
      expect(normalizePathForAssertion(roots.openclawSidecarRoot)).toBe(
        runtimePath(
          "/Applications/Nexu.app/Contents/Resources/runtime",
          "openclaw",
        ),
      );
      expect(normalizePathForAssertion(roots.logsDir)).toBe(
        runtimePath(
          "/Users/testuser/Library/Application Support/@nexu/desktop",
          "logs",
          "runtime-units",
        ),
      );
    });

    it("propagates normalized proxy env to dev web and controller manifests", () => {
      const manifests = createRuntimeUnitManifests(
        "/repo/apps/desktop",
        "/tmp/user-data",
        false,
        createRuntimeConfig(),
      );

      const webManifest = manifests.find((manifest) => manifest.id === "web");
      const controllerManifest = manifests.find(
        (manifest) => manifest.id === "controller",
      );

      expect(webManifest?.env).toMatchObject({
        HTTP_PROXY: "http://proxy.example.com:8080",
        HTTPS_PROXY: "http://secure-proxy.example.com:8443",
        ALL_PROXY: "socks5://proxy.example.com:1080",
        NO_PROXY: "example.com,localhost,127.0.0.1,::1",
      });
      expect(controllerManifest?.env).toMatchObject({
        HTTP_PROXY: "http://proxy.example.com:8080",
        HTTPS_PROXY: "http://secure-proxy.example.com:8443",
        ALL_PROXY: "socks5://proxy.example.com:1080",
        NO_PROXY: "example.com,localhost,127.0.0.1,::1",
      });
    });

    it("propagates normalized proxy env to packaged controller manifest", () => {
      fsState.paths.add(
        absoluteRuntimePath(
          "/Applications/Nexu.app/Contents/Resources",
          "runtime",
          "openclaw",
          "bin",
          "openclaw.cmd",
        ),
      );
      fsState.paths.add(
        absoluteRuntimePath(
          "/Applications/Nexu.app/Contents/Resources",
          "runtime",
          "openclaw",
          "node_modules",
          "openclaw",
          "openclaw.mjs",
        ),
      );

      const manifests = createRuntimeUnitManifests(
        "/Applications/Nexu.app/Contents/Resources",
        "/Users/testuser/Library/Application Support/@nexu/desktop",
        true,
        createRuntimeConfig(),
      );

      const controllerManifest = manifests.find(
        (manifest) => manifest.id === "controller",
      );

      expect(controllerManifest?.env).toMatchObject({
        HTTP_PROXY: "http://proxy.example.com:8080",
        HTTPS_PROXY: "http://secure-proxy.example.com:8443",
        ALL_PROXY: "socks5://proxy.example.com:1080",
        NO_PROXY: "example.com,localhost,127.0.0.1,::1",
      });
    });

    it("propagates Langfuse env to controller and openclaw manifests", () => {
      const originalLangfuse = {
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL,
      };
      process.env.LANGFUSE_PUBLIC_KEY = "pk_test";
      process.env.LANGFUSE_SECRET_KEY = "sk_test";
      process.env.LANGFUSE_BASE_URL = "https://langfuse.example.com";

      const manifests = createRuntimeUnitManifests(
        "/repo/apps/desktop",
        "/tmp/user-data",
        false,
        createRuntimeConfig(),
      );

      const controllerManifest = manifests.find(
        (manifest) => manifest.id === "controller",
      );
      const openclawManifest = manifests.find(
        (manifest) => manifest.id === "openclaw",
      );

      expect(controllerManifest?.env).toMatchObject({
        LANGFUSE_PUBLIC_KEY: "pk_test",
        LANGFUSE_SECRET_KEY: "sk_test",
        LANGFUSE_BASE_URL: "https://langfuse.example.com",
      });
      expect(openclawManifest?.env).toMatchObject({
        LANGFUSE_PUBLIC_KEY: "pk_test",
        LANGFUSE_SECRET_KEY: "sk_test",
        LANGFUSE_BASE_URL: "https://langfuse.example.com",
      });

      process.env.LANGFUSE_PUBLIC_KEY = originalLangfuse.publicKey;
      process.env.LANGFUSE_SECRET_KEY = originalLangfuse.secretKey;
      process.env.LANGFUSE_BASE_URL = originalLangfuse.baseUrl;
    });

    it("includes Electron executable for Windows managed controller manifests", () => {
      Object.defineProperty(process, "platform", { value: "win32" });

      fsState.paths.add(
        absoluteRuntimePath(
          "/Applications/Nexu.app/Contents/Resources",
          "runtime",
          "openclaw",
          "bin",
          "openclaw.cmd",
        ),
      );
      fsState.paths.add(
        absoluteRuntimePath(
          "/Applications/Nexu.app/Contents/Resources",
          "runtime",
          "openclaw",
          "node_modules",
          "openclaw",
          "openclaw.mjs",
        ),
      );

      const manifests = createRuntimeUnitManifests(
        "/Applications/Nexu.app/Contents/Resources",
        "/Users/testuser/Library/Application Support/@nexu/desktop",
        true,
        createRuntimeConfig(),
      );

      const controllerManifest = manifests.find(
        (manifest) => manifest.id === "controller",
      );

      expect(controllerManifest).toBeDefined();
      expect(controllerManifest?.env).toBeDefined();

      expect(controllerManifest?.env).toMatchObject({
        OPENCLAW_ELECTRON_EXECUTABLE: controllerManifest?.command,
      });
      expect(controllerManifest?.env?.OPENCLAW_BIN).toContain("openclaw.cmd");
    });

    it("prefers packaged Windows OpenClaw sidecar when no archive is present", () => {
      Object.defineProperty(process, "platform", { value: "win32" });

      const electronRoot =
        "C:\\Users\\testuser\\Downloads\\win-unpacked\\resources";
      const userDataPath =
        "C:\\Users\\testuser\\AppData\\Roaming\\nexu-desktop";
      fsState.paths.add(
        path.resolve(
          electronRoot,
          "runtime",
          "openclaw",
          "bin",
          "openclaw.cmd",
        ),
      );
      fsState.paths.add(
        path.resolve(
          electronRoot,
          "runtime",
          "openclaw",
          "node_modules",
          "openclaw",
          "openclaw.mjs",
        ),
      );

      const manifests = createRuntimeUnitManifests(
        electronRoot,
        userDataPath,
        true,
        createRuntimeConfig(),
      );

      const controllerManifest = manifests.find(
        (manifest) => manifest.id === "controller",
      );

      expect(controllerManifest?.env?.OPENCLAW_BIN).toBe(
        path.resolve(
          electronRoot,
          "runtime",
          "openclaw",
          "bin",
          "openclaw.cmd",
        ),
      );
    });

    it("fails for Windows packaged manifests when exe-relative OpenClaw runtime is missing", () => {
      Object.defineProperty(process, "platform", { value: "win32" });

      expect(() =>
        createRuntimeUnitManifests(
          "C:\\Users\\testuser\\Downloads\\win-unpacked\\resources",
          "C:\\Users\\testuser\\AppData\\Roaming\\nexu-desktop",
          true,
          createRuntimeConfig(),
        ),
      ).toThrow(/Windows packaged OpenClaw runtime/);
    });
  });
});
