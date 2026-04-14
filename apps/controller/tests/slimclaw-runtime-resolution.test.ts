import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ControllerEnv } from "../src/app/env.js";

import {
  getOpenClawCommandSpec,
  requireArtifactBackedOpenClawRuntime,
  resolveControllerOpenClawRuntime,
} from "../src/runtime/slimclaw-runtime-resolution.js";

function createEnv(overrides: Partial<ControllerEnv> = {}): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuHomeDir: "/tmp/.nexu",
    nexuConfigPath: "/tmp/.nexu/config.json",
    artifactsIndexPath: "/tmp/.nexu/artifacts/index.json",
    compiledOpenclawSnapshotPath: "/tmp/.nexu/compiled-openclaw.json",
    openclawStateDir: "/tmp/.openclaw",
    openclawConfigPath: "/tmp/.openclaw/openclaw.json",
    openclawSkillsDir: "/tmp/.openclaw/skills",
    userSkillsDir: "/tmp/.agents/skills",
    openclawBuiltinExtensionsDir: null,
    openclawExtensionsDir: "/tmp/.openclaw/extensions",
    bundledRuntimePluginsDir: "/tmp/controller/plugins",
    runtimePluginTemplatesDir: "/tmp/runtime-plugins",
    openclawRuntimeModelStatePath: "/tmp/.openclaw/nexu-runtime-model.json",
    creditGuardStatePath: "/tmp/.openclaw/nexu-credit-guard-state.json",
    skillhubCacheDir: "/tmp/.nexu/skillhub-cache",
    skillDbPath: "/tmp/.nexu/skill-ledger.json",
    analyticsStatePath: "/tmp/.nexu/analytics-state.json",
    staticSkillsDir: undefined,
    platformTemplatesDir: undefined,
    openclawWorkspaceTemplatesDir: "/tmp/.openclaw/workspace-templates",
    openclawOwnershipMode: "external",
    openclawBaseUrl: "http://127.0.0.1:18789",
    openclawBin: "openclaw",
    openclawLogDir: "/tmp/.nexu/logs/openclaw",
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
    posthogApiKey: undefined,
    posthogHost: undefined,
    ...overrides,
  };
}

describe("openclaw runtime resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses explicit artifact env for managed controller runtime", () => {
    const env = createEnv({
      manageOpenclawProcess: true,
      openclawOwnershipMode: "internal",
      openclawBin: "/runtime/bin/openclaw",
      openclawBuiltinExtensionsDir: "/runtime/node_modules/openclaw/extensions",
    });

    const runtime = resolveControllerOpenClawRuntime(env);

    expect(runtime).toEqual({
      mode: "explicit-env",
      binPath: "/runtime/bin/openclaw",
      entryPath: path.resolve("/runtime/node_modules/openclaw/openclaw.mjs"),
      builtinExtensionsDir: "/runtime/node_modules/openclaw/extensions",
      packageDir: "/runtime/node_modules/openclaw",
    });
  });

  it("requires launcher-provided runtime paths for managed controller runtime", () => {
    const env = createEnv({
      manageOpenclawProcess: true,
      openclawOwnershipMode: "internal",
    });

    expect(() => resolveControllerOpenClawRuntime(env)).toThrow(
      /OPENCLAW_BIN and OPENCLAW_EXTENSIONS_DIR from the launcher/,
    );
    expect(() => getOpenClawCommandSpec(env)).toThrow(
      /OPENCLAW_BIN and OPENCLAW_EXTENSIONS_DIR from the launcher/,
    );
  });

  it("returns external bin only mode when controller does not manage openclaw", () => {
    const env = createEnv({
      openclawBin: "/usr/local/bin/openclaw",
    });

    const runtime = resolveControllerOpenClawRuntime(env);

    expect(runtime).toEqual({
      mode: "external-bin-only",
      binPath: "/usr/local/bin/openclaw",
      entryPath: null,
      builtinExtensionsDir: null,
      packageDir: null,
    });
    expect(() => requireArtifactBackedOpenClawRuntime(env)).toThrow(
      /artifact-backed OpenClaw runtime/,
    );
  });

  it("uses electron runner with artifact-backed entry path", () => {
    vi.stubEnv("OPENCLAW_ELECTRON_EXECUTABLE", "/Applications/Nexu.app/runner");
    const env = createEnv({
      manageOpenclawProcess: true,
      openclawOwnershipMode: "internal",
      openclawBin: "/runtime/bin/openclaw",
      openclawBuiltinExtensionsDir: "/runtime/node_modules/openclaw/extensions",
    });

    const spec = getOpenClawCommandSpec(env);

    expect(spec).toMatchObject({
      command: "/Applications/Nexu.app/runner",
      argsPrefix: [path.resolve("/runtime/node_modules/openclaw/openclaw.mjs")],
      extraEnv: { ELECTRON_RUN_AS_NODE: "1" },
    });
  });
});
