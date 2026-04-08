import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { rewardTasks } from "@nexu/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "#controller/app/env.js";
import { NexuConfigStore } from "#controller/store/nexu-config-store.js";

function createEnv(rootDir: string): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuCloudUrl: "https://cloud.nexu.io",
    nexuLinkUrl: null,
    nexuHomeDir: path.join(rootDir, ".nexu"),
    nexuConfigPath: path.join(rootDir, ".nexu", "config.json"),
    artifactsIndexPath: path.join(rootDir, ".nexu", "artifacts", "index.json"),
    compiledOpenclawSnapshotPath: path.join(
      rootDir,
      ".nexu",
      "compiled-openclaw.json",
    ),
    openclawStateDir: path.join(rootDir, ".openclaw"),
    openclawConfigPath: path.join(rootDir, ".openclaw", "openclaw.json"),
    openclawSkillsDir: path.join(rootDir, ".openclaw", "skills"),
    userSkillsDir: path.join(rootDir, ".agents", "skills"),
    openclawBuiltinExtensionsDir: null,
    openclawExtensionsDir: path.join(rootDir, ".openclaw", "extensions"),
    bundledRuntimePluginsDir: path.join(rootDir, "bundled-runtime-plugins"),
    runtimePluginTemplatesDir: path.join(rootDir, "runtime-plugins"),
    openclawRuntimeModelStatePath: path.join(
      rootDir,
      ".openclaw",
      "nexu-runtime-model.json",
    ),
    skillhubCacheDir: path.join(rootDir, ".nexu", "skillhub-cache"),
    skillDbPath: path.join(rootDir, ".nexu", "skill-ledger.json"),
    analyticsStatePath: path.join(rootDir, ".nexu", "analytics-state.json"),
    staticSkillsDir: undefined,
    platformTemplatesDir: undefined,
    openclawWorkspaceTemplatesDir: path.join(
      rootDir,
      ".openclaw",
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
  } as ControllerEnv;
}

describe("desktop rewards share templates", () => {
  let rootDir = "";
  let env: ControllerEnv;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-rewards-share-"));
    env = createEnv(rootDir);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("prefers local share templates over stale cloud share urls", async () => {
    await mkdir(path.join(rootDir, ".nexu"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".nexu", "config.json"),
      JSON.stringify(
        {
          version: 1,
          desktop: {
            cloud: {
              connected: true,
              polling: false,
              userName: "Cloud User",
              userEmail: "user@nexu.io",
              connectedAt: "2026-04-01T00:00:00.000Z",
              linkUrl: "http://localhost:8080",
              apiKey: "valid-key",
              models: [],
            },
            activeCloudProfileName: "Local",
            cloudSessions: {
              Local: {
                connected: true,
                polling: false,
                userName: "Cloud User",
                userEmail: "user@nexu.io",
                connectedAt: "2026-04-01T00:00:00.000Z",
                linkUrl: "http://localhost:8080",
                apiKey: "valid-key",
                models: [],
              },
            },
          },
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(rootDir, ".nexu", "cloud-profiles.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          profiles: [
            {
              name: "Local",
              cloudUrl: "http://localhost:5173",
              linkUrl: "http://localhost:8080",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              tasks: [
                {
                  id: "x_share",
                  displayName: "Share on X",
                  groupId: "social",
                  rewardPoints: 200,
                  repeatMode: "weekly",
                  shareMode: "tweet",
                  icon: "x",
                  url: "https://x.com/intent/tweet?text=Just%20discovered%20nexu",
                  isClaimed: false,
                  claimCount: 0,
                  lastClaimedAt: null,
                },
                {
                  id: "reddit",
                  displayName: "Post on Reddit",
                  groupId: "social",
                  rewardPoints: 200,
                  repeatMode: "weekly",
                  shareMode: "link",
                  icon: "reddit",
                  url: "https://www.reddit.com/submit?url=https%3A%2F%2Fdev.to%2Fjoey_lee_c96e4ad421791371%2Fwe-built-an-open-source-openclaw-desktop-client-that-fixes-17-pitfalls-gjn",
                  isClaimed: false,
                  claimCount: 0,
                  lastClaimedAt: null,
                },
                {
                  id: "facebook",
                  displayName: "Share to Facebook",
                  groupId: "social",
                  rewardPoints: 200,
                  repeatMode: "weekly",
                  shareMode: "link",
                  icon: "facebook",
                  url: "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fgithub.com%2Fnexu-io%2Fnexu",
                  isClaimed: false,
                  claimCount: 0,
                  lastClaimedAt: null,
                },
                {
                  id: "whatsapp",
                  displayName: "Share to WhatsApp",
                  groupId: "social",
                  rewardPoints: 200,
                  repeatMode: "weekly",
                  shareMode: "link",
                  icon: "whatsapp",
                  url: "https://wa.me/?text=Just%20discovered%20nexu",
                  isClaimed: false,
                  claimCount: 0,
                  lastClaimedAt: null,
                },
              ],
              progress: {
                claimedCount: 0,
                totalCount: 4,
                earnedCredits: 0,
              },
              cloudBalance: null,
            }),
            { status: 200 },
          ),
      ),
    );

    const status = await store.getDesktopRewardsStatus();
    const expectedByTaskId = new Map(
      rewardTasks
        .filter((task) =>
          ["x_share", "reddit", "facebook", "whatsapp"].includes(task.id),
        )
        .map((task) => [task.id, task.actionUrl]),
    );

    expect(status.tasks).toHaveLength(4);
    for (const task of status.tasks) {
      expect(task.actionUrl).toBe(expectedByTaskId.get(task.id));
    }
  });
});
