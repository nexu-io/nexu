import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

type MockSkillDb = {
  close: ReturnType<typeof vi.fn>;
  getAllInstalled: ReturnType<typeof vi.fn>;
  recordInstall: ReturnType<typeof vi.fn>;
  recordUninstall: ReturnType<typeof vi.fn>;
  recordBulkInstall: ReturnType<typeof vi.fn>;
  markUninstalledBySlugs: ReturnType<typeof vi.fn>;
  isRemovedByUser: ReturnType<typeof vi.fn>;
  isInstalled: ReturnType<typeof vi.fn>;
};

const skillhubMocks = vi.hoisted(() => {
  const mockSkillDbCreate = vi.fn();
  const catalogManagerInstances: Array<{
    start: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    getCatalog: ReturnType<typeof vi.fn>;
    installSkill: ReturnType<typeof vi.fn>;
    uninstallSkill: ReturnType<typeof vi.fn>;
    refreshCatalog: ReturnType<typeof vi.fn>;
    installCuratedSkills: ReturnType<typeof vi.fn>;
    reconcileDbWithDisk: ReturnType<typeof vi.fn>;
  }> = [];
  const state: {
    installCuratedSkillsPromise: Promise<{
      installed: string[];
      skipped: string[];
      failed: string[];
    }> | null;
  } = {
    installCuratedSkillsPromise: null,
  };

  class MockCatalogManager {
    public readonly start = vi.fn();
    public readonly dispose: ReturnType<typeof vi.fn>;
    public readonly getCatalog = vi.fn(() => ({
      skills: [],
      installedSlugs: [],
      installedSkills: [],
      meta: null,
    }));
    public readonly installSkill = vi.fn(async () => ({ ok: true }));
    public readonly uninstallSkill = vi.fn(async () => ({ ok: true }));
    public readonly refreshCatalog = vi.fn(async () => ({
      ok: true,
      skillCount: 0,
    }));
    public readonly installCuratedSkills = vi.fn(
      async () =>
        state.installCuratedSkillsPromise ?? {
          installed: [],
          skipped: [],
          failed: [],
        },
    );
    public readonly reconcileDbWithDisk = vi.fn();

    constructor(
      readonly cacheDir: string,
      readonly options: { skillDb?: MockSkillDb } & Record<string, unknown>,
    ) {
      this.dispose = vi.fn(() => {
        this.options.skillDb?.close();
      });
      catalogManagerInstances.push(this);
    }
  }

  return {
    mockSkillDbCreate,
    catalogManagerInstances,
    MockCatalogManager,
    state,
  };
});

vi.mock("../src/services/skillhub/skill-db.js", () => ({
  SkillDb: {
    create: skillhubMocks.mockSkillDbCreate,
  },
}));

vi.mock("../src/services/skillhub/catalog-manager.js", () => ({
  CatalogManager: skillhubMocks.MockCatalogManager,
}));

import { SkillhubService } from "../src/services/skillhub-service.js";

function createMockSkillDb(): MockSkillDb {
  return {
    close: vi.fn(),
    getAllInstalled: vi.fn(() => []),
    recordInstall: vi.fn(),
    recordUninstall: vi.fn(),
    recordBulkInstall: vi.fn(),
    markUninstalledBySlugs: vi.fn(),
    isRemovedByUser: vi.fn(() => false),
    isInstalled: vi.fn(() => false),
  };
}

function createEnv(rootDir: string): ControllerEnv {
  const nexuHomeDir = path.join(rootDir, ".nexu");
  const openclawStateDir = path.join(rootDir, ".openclaw");

  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuCloudUrl: "https://nexu.io",
    nexuLinkUrl: null,
    nexuHomeDir,
    nexuConfigPath: path.join(nexuHomeDir, "config.json"),
    artifactsIndexPath: path.join(nexuHomeDir, "artifacts", "index.json"),
    compiledOpenclawSnapshotPath: path.join(
      nexuHomeDir,
      "compiled-openclaw.json",
    ),
    openclawStateDir,
    openclawConfigPath: path.join(openclawStateDir, "openclaw.json"),
    openclawSkillsDir: path.join(openclawStateDir, "skills"),
    openclawCuratedSkillsDir: path.join(openclawStateDir, "bundled-skills"),
    skillhubCacheDir: path.join(nexuHomeDir, "skillhub-cache"),
    skillDbPath: path.join(nexuHomeDir, "skill-ledger.db"),
    staticSkillsDir: undefined,
    openclawWorkspaceTemplatesDir: path.join(
      openclawStateDir,
      "workspace-templates",
    ),
    openclawBin: "openclaw",
    litellmBaseUrl: null,
    litellmApiKey: null,
    openclawGatewayPort: 18789,
    openclawGatewayToken: undefined,
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "anthropic/claude-sonnet-4",
  };
}

describe("SkillhubService", () => {
  let rootDir = "";

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-skillhub-service-"));
    skillhubMocks.mockSkillDbCreate.mockReset();
    skillhubMocks.catalogManagerInstances.length = 0;
    skillhubMocks.state.installCuratedSkillsPromise = null;
    process.env.CI = undefined;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("serves cached catalog data during cold start before init finishes", async () => {
    const env = createEnv(rootDir);
    await mkdir(env.skillhubCacheDir, { recursive: true });
    await writeFile(
      path.join(env.skillhubCacheDir, "catalog.json"),
      JSON.stringify([
        {
          slug: "hello-world",
          name: "Hello World",
          description: "Cached skill",
          downloads: 42,
          stars: 7,
          tags: ["demo"],
          version: "1.0.0",
          updatedAt: "2026-03-20T00:00:00.000Z",
        },
      ]),
      "utf8",
    );
    await writeFile(
      path.join(env.skillhubCacheDir, "meta.json"),
      JSON.stringify({
        version: "2026-03-20",
        updatedAt: "2026-03-20T00:00:00.000Z",
        skillCount: 1,
      }),
      "utf8",
    );

    const deferredDb = createDeferred<MockSkillDb>();
    skillhubMocks.mockSkillDbCreate.mockReturnValueOnce(deferredDb.promise);

    const service = new SkillhubService(env);
    service.start();

    expect(service.getCatalog()).toEqual({
      skills: [
        {
          slug: "hello-world",
          name: "Hello World",
          description: "Cached skill",
          downloads: 42,
          stars: 7,
          tags: ["demo"],
          version: "1.0.0",
          updatedAt: "2026-03-20T00:00:00.000Z",
        },
      ],
      installedSlugs: [],
      installedSkills: [],
      meta: {
        version: "2026-03-20",
        updatedAt: "2026-03-20T00:00:00.000Z",
        skillCount: 1,
      },
    });

    deferredDb.resolve(createMockSkillDb());
    await service.waitForReady();
  });

  it("closes a late-created db when disposed before init completes", async () => {
    const env = createEnv(rootDir);
    const deferredDb = createDeferred<MockSkillDb>();
    skillhubMocks.mockSkillDbCreate.mockReturnValueOnce(deferredDb.promise);

    const service = new SkillhubService(env);
    service.start();
    service.dispose();

    const db = createMockSkillDb();
    deferredDb.resolve(db);
    await flushAsyncWork();

    expect(db.close).toHaveBeenCalledTimes(1);
    expect(skillhubMocks.catalogManagerInstances).toHaveLength(0);
  });

  it("stops post-init work after dispose while curated installs are in flight", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    const installDeferred = createDeferred<{
      installed: string[];
      skipped: string[];
      failed: string[];
    }>();
    skillhubMocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    skillhubMocks.state.installCuratedSkillsPromise = installDeferred.promise;

    const service = new SkillhubService(env);
    service.start();
    await Promise.resolve();

    expect(skillhubMocks.catalogManagerInstances).toHaveLength(1);
    const manager = skillhubMocks.catalogManagerInstances[0];

    service.dispose();
    installDeferred.resolve({ installed: [], skipped: [], failed: [] });
    await flushAsyncWork();

    expect(manager.start).toHaveBeenCalledTimes(1);
    expect(manager.dispose).toHaveBeenCalledTimes(1);
    expect(manager.reconcileDbWithDisk).not.toHaveBeenCalled();
    expect(db.close).toHaveBeenCalledTimes(1);
  });
});
