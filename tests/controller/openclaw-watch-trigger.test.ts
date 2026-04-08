import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "../../apps/controller/src/app/env.js";
import { OpenClawWatchTrigger } from "../../apps/controller/src/runtime/openclaw-watch-trigger.js";

describe("OpenClawWatchTrigger", () => {
  let rootDir = "";
  let env: ControllerEnv;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-watch-trigger-"));
    env = {
      nodeEnv: "test",
      port: 3010,
      host: "127.0.0.1",
      webUrl: "http://localhost:5173",
      nexuHomeDir: path.join(rootDir, ".nexu"),
      nexuConfigPath: path.join(rootDir, ".nexu", "config.json"),
      artifactsIndexPath: path.join(
        rootDir,
        ".nexu",
        "artifacts",
        "index.json",
      ),
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
      bundledRuntimePluginsDir: path.join(rootDir, "plugins"),
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
      openclawOwnershipMode: "external",
      openclawBaseUrl: "http://127.0.0.1:18789",
      openclawBin: "openclaw",
      openclawLogDir: path.join(rootDir, ".nexu", "logs", "openclaw"),
      openclawLaunchdLabel: null,
      litellmBaseUrl: null,
      litellmApiKey: null,
      openclawGatewayPort: 18789,
      openclawGatewayToken: undefined,
      manageOpenclawProcess: false,
      gatewayProbeEnabled: false,
      runtimeSyncIntervalMs: 2000,
      runtimeHealthIntervalMs: 5000,
      defaultModelId: "anthropic/claude-sonnet-4",
      amplitudeApiKey: undefined,
    };
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("invalidates cached skills snapshots for existing sessions when nudged", async () => {
    const sessionsDir = path.join(
      env.openclawStateDir,
      "agents",
      "agent-1",
      "sessions",
    );
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      path.join(sessionsDir, "sessions.json"),
      `${JSON.stringify(
        {
          "agent:agent-1:main": {
            sessionId: "session-1",
            updatedAt: 123,
            skillsSnapshot: {
              skills: [{ name: "research-to-diagram" }],
              resolvedSkills: [{ name: "research-to-diagram" }],
            },
            preserved: true,
          },
          "agent:agent-1:second": {
            sessionId: "session-2",
            updatedAt: 456,
            preserved: "untouched",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const trigger = new OpenClawWatchTrigger(env);
    await trigger.nudgeSkillsWatcher("test");

    const nextIndex = JSON.parse(
      await readFile(path.join(sessionsDir, "sessions.json"), "utf8"),
    ) as Record<string, Record<string, unknown>>;

    expect(nextIndex["agent:agent-1:main"]).toEqual({
      sessionId: "session-1",
      updatedAt: 123,
      preserved: true,
    });
    expect(nextIndex["agent:agent-1:second"]).toEqual({
      sessionId: "session-2",
      updatedAt: 456,
      preserved: "untouched",
    });

    const markerPath = path.join(env.openclawSkillsDir, ".controller-nudge");
    const markerContent = await readFile(markerPath, "utf8");
    expect(markerContent).toBe("");
  });
});
