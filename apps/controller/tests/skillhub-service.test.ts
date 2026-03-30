import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";

type MockSkillDb = {
  close: ReturnType<typeof vi.fn>;
  getAllInstalled: ReturnType<typeof vi.fn>;
  recordInstall: ReturnType<typeof vi.fn>;
  recordUninstall: ReturnType<typeof vi.fn>;
  recordBulkInstall: ReturnType<typeof vi.fn>;
  markUninstalledBySlugs: ReturnType<typeof vi.fn>;
  isRemovedByUser: ReturnType<typeof vi.fn>;
  isInstalled: ReturnType<typeof vi.fn>;
  removeRecords: ReturnType<typeof vi.fn>;
  getUninstalledCurated: ReturnType<typeof vi.fn>;
};

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
    removeRecords: vi.fn(),
    getUninstalledCurated: vi.fn(() => []),
  };
}

const mocks = vi.hoisted(() => {
  const mockSkillDbCreate = vi.fn();

  const catalogManagerInstances: Array<{
    start: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    getCatalog: ReturnType<typeof vi.fn>;
    installSkill: ReturnType<typeof vi.fn>;
    uninstallSkill: ReturnType<typeof vi.fn>;
    refreshCatalog: ReturnType<typeof vi.fn>;
    executeInstall: ReturnType<typeof vi.fn>;
    getCuratedSlugsToEnqueue: ReturnType<typeof vi.fn>;
    canonicalizeSlug: ReturnType<typeof vi.fn>;
    reconcileDbWithDisk: ReturnType<typeof vi.fn>;
  }> = [];

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
    public readonly executeInstall = vi.fn(async () => {});
    public readonly getCuratedSlugsToEnqueue = vi.fn(() => [] as string[]);
    public readonly canonicalizeSlug = vi.fn((slug: string) => slug);
    public readonly reconcileDbWithDisk = vi.fn();

    constructor(
      readonly cacheDir: string,
      readonly options: Record<string, unknown>,
    ) {
      this.dispose = vi.fn(() => {
        const db = this.options.skillDb as { close: () => void } | undefined;
        db?.close();
      });
      catalogManagerInstances.push(this);
    }
  }

  const installQueueInstances: Array<{
    enqueue: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    getQueue: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    opts: Record<string, unknown>;
  }> = [];

  class MockInstallQueue {
    public readonly enqueue = vi.fn((slug: string, source: string) => ({
      slug,
      source,
      status: "queued" as const,
      position: 0,
      error: null,
      retries: 0,
      enqueuedAt: new Date().toISOString(),
    }));
    public readonly cancel = vi.fn(() => true);
    public readonly getQueue = vi.fn(() => []);
    public readonly dispose = vi.fn();
    public readonly opts: Record<string, unknown>;

    constructor(readonly opts: Record<string, unknown>) {
      this.opts = opts;
      installQueueInstances.push(this);
    }
  }

  const dirWatcherInstances: Array<{
    syncNow: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];

  class MockSkillDirWatcher {
    public readonly syncNow = vi.fn();
    public readonly start = vi.fn();
    public readonly stop = vi.fn();

    constructor(readonly opts: Record<string, unknown>) {
      dirWatcherInstances.push(this);
    }
  }

  const mockCopyStaticSkills = vi.fn(() => ({
    copied: [] as string[],
    skipped: [] as string[],
  }));

  return {
    mockSkillDbCreate,
    catalogManagerInstances,
    MockCatalogManager,
    installQueueInstances,
    MockInstallQueue,
    dirWatcherInstances,
    MockSkillDirWatcher,
    mockCopyStaticSkills,
  };
});

vi.mock("../src/services/skillhub/skill-db.js", () => ({
  SkillDb: {
    create: mocks.mockSkillDbCreate,
  },
}));

vi.mock("../src/services/skillhub/catalog-manager.js", () => ({
  CatalogManager: mocks.MockCatalogManager,
}));

vi.mock("../src/services/skillhub/install-queue.js", () => ({
  InstallQueue: mocks.MockInstallQueue,
}));

vi.mock("../src/services/skillhub/skill-dir-watcher.js", () => ({
  SkillDirWatcher: mocks.MockSkillDirWatcher,
}));

vi.mock("../src/services/skillhub/curated-skills.js", () => ({
  copyStaticSkills: mocks.mockCopyStaticSkills,
}));

import { SkillhubService } from "../src/services/skillhub-service.js";

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
    mocks.mockSkillDbCreate.mockReset();
    mocks.catalogManagerInstances.length = 0;
    mocks.installQueueInstances.length = 0;
    mocks.dirWatcherInstances.length = 0;
    mocks.mockCopyStaticSkills.mockReset();
    mocks.mockCopyStaticSkills.mockReturnValue({
      copied: [],
      skipped: [],
    });
    vi.stubEnv("CI", "");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("create() creates all dependencies", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);

    expect(mocks.mockSkillDbCreate).toHaveBeenCalledWith(env.skillDbPath);
    expect(mocks.catalogManagerInstances).toHaveLength(1);
    expect(mocks.installQueueInstances).toHaveLength(1);
    expect(mocks.dirWatcherInstances).toHaveLength(1);
    expect(service.catalog).toBe(mocks.catalogManagerInstances[0]);
    expect(service.queue).toBe(mocks.installQueueInstances[0]);
  });

  it("create() wires queue completion and cancellation callbacks", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    await SkillhubService.create(env);

    const queue = mocks.installQueueInstances[0];
    const catalog = mocks.catalogManagerInstances[0];
    const onComplete = queue.opts.onComplete as
      | ((slug: string, source: string) => void)
      | undefined;
    const onCancelled = queue.opts.onCancelled as
      | ((slug: string, source: string) => Promise<void>)
      | undefined;

    expect(onComplete).toBeTypeOf("function");
    expect(onCancelled).toBeTypeOf("function");

    onComplete?.("alpha", "managed");
    expect(db.recordInstall).toHaveBeenCalledWith("alpha", "managed");

    await onCancelled?.("beta", "managed");
    expect(catalog.uninstallSkill).toHaveBeenCalledWith("beta");
  });

  it("create() makes onCancelled throw when uninstall cleanup returns ok:false", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    await SkillhubService.create(env);

    const queue = mocks.installQueueInstances[0];
    const catalog = mocks.catalogManagerInstances[0];
    const onCancelled = queue.opts.onCancelled as
      | ((slug: string, source: string) => Promise<void>)
      | undefined;

    catalog.uninstallSkill.mockResolvedValueOnce({
      ok: false,
      error: "cleanup failed",
    });

    await expect(onCancelled?.("beta", "managed")).rejects.toThrow(
      "cleanup failed",
    );
  });

  it("start() calls catalogManager.start()", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    service.start();

    const catalog = mocks.catalogManagerInstances[0];
    expect(catalog.start).toHaveBeenCalledTimes(1);
  });

  it("start() copies static skills when staticSkillsDir is set and exists", async () => {
    const env = createEnv(rootDir);
    const staticDir = path.join(rootDir, "static-skills");
    mkdirSync(staticDir, { recursive: true });
    const envWithStatic = { ...env, staticSkillsDir: staticDir };

    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    mocks.mockCopyStaticSkills.mockReturnValueOnce({
      copied: ["skill-a", "skill-b"],
      skipped: [],
    });

    const service = await SkillhubService.create(envWithStatic);
    service.start();

    expect(mocks.mockCopyStaticSkills).toHaveBeenCalledWith({
      staticDir,
      targetDir: env.openclawSkillsDir,
      skillDb: db,
    });
    expect(db.recordBulkInstall).toHaveBeenCalledWith(
      ["skill-a", "skill-b"],
      "managed",
    );
  });

  it("start() does not copy static skills when staticSkillsDir is undefined", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    service.start();

    expect(mocks.mockCopyStaticSkills).not.toHaveBeenCalled();
  });

  it("start() does not recordBulkInstall when no static skills were copied", async () => {
    const env = createEnv(rootDir);
    const staticDir = path.join(rootDir, "static-skills");
    mkdirSync(staticDir, { recursive: true });
    const envWithStatic = { ...env, staticSkillsDir: staticDir };

    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
    mocks.mockCopyStaticSkills.mockReturnValueOnce({
      copied: [],
      skipped: ["skill-a"],
    });

    const service = await SkillhubService.create(envWithStatic);
    service.start();

    expect(db.recordBulkInstall).not.toHaveBeenCalled();
  });

  it("start() calls dirWatcher.syncNow() before enqueuing", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const callOrder: string[] = [];

    const service = await SkillhubService.create(env);
    const watcher = mocks.dirWatcherInstances[0];
    const catalog = mocks.catalogManagerInstances[0];

    watcher.syncNow.mockImplementation(() => {
      callOrder.push("syncNow");
    });
    catalog.getCuratedSlugsToEnqueue.mockImplementation(() => {
      callOrder.push("getCuratedSlugsToEnqueue");
      return [];
    });

    service.start();

    expect(callOrder).toEqual(["syncNow", "getCuratedSlugsToEnqueue"]);
  });

  it("start() enqueues curated slugs from getCuratedSlugsToEnqueue()", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    const catalog = mocks.catalogManagerInstances[0];
    catalog.getCuratedSlugsToEnqueue.mockReturnValue(["alpha", "beta"]);

    service.start();

    const queue = mocks.installQueueInstances[0];
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue).toHaveBeenCalledWith("alpha", "managed");
    expect(queue.enqueue).toHaveBeenCalledWith("beta", "managed");
  });

  it("start() calls dirWatcher.start() after enqueuing", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const callOrder: string[] = [];

    const service = await SkillhubService.create(env);
    const watcher = mocks.dirWatcherInstances[0];
    const queue = mocks.installQueueInstances[0];
    const catalog = mocks.catalogManagerInstances[0];

    catalog.getCuratedSlugsToEnqueue.mockReturnValue(["x"]);
    queue.enqueue.mockImplementation(() => {
      callOrder.push("enqueue");
      return {
        slug: "x",
        source: "managed",
        status: "queued",
        position: 0,
        error: null,
        retries: 0,
        enqueuedAt: new Date().toISOString(),
      };
    });
    watcher.start.mockImplementation(() => {
      callOrder.push("dirWatcher.start");
    });

    service.start();

    expect(callOrder).toEqual(["enqueue", "dirWatcher.start"]);
  });

  it("start() skips all post-catalog work when CI=true", async () => {
    process.env.CI = "true";
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    service.start();

    const catalog = mocks.catalogManagerInstances[0];
    const watcher = mocks.dirWatcherInstances[0];
    const queue = mocks.installQueueInstances[0];

    expect(catalog.start).toHaveBeenCalledTimes(1);
    expect(mocks.mockCopyStaticSkills).not.toHaveBeenCalled();
    expect(watcher.syncNow).not.toHaveBeenCalled();
    expect(catalog.getCuratedSlugsToEnqueue).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(watcher.start).not.toHaveBeenCalled();
  });

  it("start() enqueues curated skills even when ledger already exists", async () => {
    const env = createEnv(rootDir);
    // Pre-create the ledger so this simulates a second launch
    mkdirSync(path.dirname(env.skillDbPath), { recursive: true });
    writeFileSync(env.skillDbPath, JSON.stringify({ skills: [] }));

    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    const catalog = mocks.catalogManagerInstances[0];
    catalog.getCuratedSlugsToEnqueue.mockReturnValue(["failed-skill"]);

    service.start();

    const queue = mocks.installQueueInstances[0];
    expect(queue.enqueue).toHaveBeenCalledWith("failed-skill", "managed");
  });

  it("enqueueInstall() delegates to queue with source 'managed'", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    const result = service.enqueueInstall("my-skill");

    const queue = mocks.installQueueInstances[0];
    expect(queue.enqueue).toHaveBeenCalledWith("my-skill", "managed");
    expect(result.slug).toBe("my-skill");
  });

  it("cancelInstall() canonicalizes slug before cancelling queue item", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const service = await SkillhubService.create(env);
    const queue = mocks.installQueueInstances[0];
    const catalog = mocks.catalogManagerInstances[0];
    catalog.canonicalizeSlug.mockReturnValue("find-skill");

    const result = service.cancelInstall("find-skills");

    expect(catalog.canonicalizeSlug).toHaveBeenCalledWith("find-skills");
    expect(queue.cancel).toHaveBeenCalledWith("find-skill");
    expect(result).toBe(true);
  });

  describe("onSyncNeeded callback", () => {
    it("calls onSyncNeeded after install completes", async () => {
      const env = createEnv(rootDir);
      const db = createMockSkillDb();
      mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
      const onSyncNeeded = vi.fn();

      await SkillhubService.create(env, { onSyncNeeded });

      const queue = mocks.installQueueInstances[0];
      const onComplete = queue.opts.onComplete as (
        slug: string,
        source: string,
      ) => void;

      onComplete("alpha", "managed");

      expect(db.recordInstall).toHaveBeenCalledWith("alpha", "managed");
      expect(onSyncNeeded).toHaveBeenCalledTimes(1);
    });

    it("calls onSyncNeeded after cancel cleanup completes", async () => {
      const env = createEnv(rootDir);
      const db = createMockSkillDb();
      mocks.mockSkillDbCreate.mockResolvedValueOnce(db);
      const onSyncNeeded = vi.fn();

      await SkillhubService.create(env, { onSyncNeeded });

      const queue = mocks.installQueueInstances[0];
      const onCancelled = queue.opts.onCancelled as (
        slug: string,
      ) => Promise<void>;

      await onCancelled("beta");

      expect(onSyncNeeded).toHaveBeenCalledTimes(1);
    });

    it("does not throw when onSyncNeeded is not provided", async () => {
      const env = createEnv(rootDir);
      const db = createMockSkillDb();
      mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

      await SkillhubService.create(env);

      const queue = mocks.installQueueInstances[0];
      const onComplete = queue.opts.onComplete as (
        slug: string,
        source: string,
      ) => void;
      const onCancelled = queue.opts.onCancelled as (
        slug: string,
      ) => Promise<void>;

      expect(() => onComplete("alpha", "managed")).not.toThrow();
      await expect(onCancelled("beta")).resolves.toBeUndefined();
    });
  });

  it("dispose() stops watcher, disposes queue, disposes catalogManager in order", async () => {
    const env = createEnv(rootDir);
    const db = createMockSkillDb();
    mocks.mockSkillDbCreate.mockResolvedValueOnce(db);

    const callOrder: string[] = [];

    const service = await SkillhubService.create(env);
    const watcher = mocks.dirWatcherInstances[0];
    const queue = mocks.installQueueInstances[0];
    const catalog = mocks.catalogManagerInstances[0];

    watcher.stop.mockImplementation(() => {
      callOrder.push("dirWatcher.stop");
    });
    queue.dispose.mockImplementation(() => {
      callOrder.push("installQueue.dispose");
    });
    catalog.dispose.mockImplementation(() => {
      callOrder.push("catalogManager.dispose");
    });

    service.dispose();

    expect(callOrder).toEqual([
      "dirWatcher.stop",
      "installQueue.dispose",
      "catalogManager.dispose",
    ]);
  });
});
