import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { expandHomeDir } from "../lib/path-utils.js";

dotenv.config();

// Load .env from workspace root when controller runs from a subdirectory
// (e.g. desktop sidecar starts from .tmp/sidecars/controller).
// NEXU_WORKSPACE_ROOT takes precedence; otherwise walk up to find pnpm-workspace.yaml.
const workspaceRoot =
  process.env.NEXU_WORKSPACE_ROOT?.trim() ?? findWorkspaceRoot();
if (workspaceRoot) {
  const workspaceEnvPath = path.resolve(workspaceRoot, ".env");
  const currentEnvPath = path.resolve(process.cwd(), ".env");
  if (workspaceEnvPath !== currentEnvPath) {
    dotenv.config({ path: workspaceEnvPath, override: false });
  }
}

function findWorkspaceRoot(): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const booleanSchema = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3010),
  HOST: z.string().default("127.0.0.1"),
  NEXU_HOME: z.string().default("~/.nexu"),
  OPENCLAW_STATE_DIR: z.string().optional(),
  OPENCLAW_CONFIG_PATH: z.string().optional(),
  OPENCLAW_SKILLS_DIR: z.string().optional(),
  OPENCLAW_EXTENSIONS_DIR: z.string().optional(),
  SKILLHUB_STATIC_SKILLS_DIR: z.string().optional(),
  PLATFORM_TEMPLATES_DIR: z.string().optional(),
  OPENCLAW_GATEWAY_PORT: z.coerce.number().int().positive().default(18789),
  OPENCLAW_GATEWAY_TOKEN: z.string().optional(),
  OPENCLAW_BIN: z.string().default("openclaw"),
  LITELLM_BASE_URL: z.string().optional(),
  LITELLM_API_KEY: z.string().optional(),
  RUNTIME_MANAGE_OPENCLAW_PROCESS: booleanSchema.default("false"),
  RUNTIME_GATEWAY_PROBE_ENABLED: booleanSchema.default("true"),
  RUNTIME_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  RUNTIME_HEALTH_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  DEFAULT_MODEL_ID: z.string().default("link/gemini-3-flash-preview"),
  WEB_URL: z.string().default("http://localhost:5173"),
  AMPLITUDE_API_KEY: z.string().optional(),
  VITE_AMPLITUDE_API_KEY: z.string().optional(),
});

const parsed = envSchema.parse(process.env);

const nexuHomeDir = expandHomeDir(parsed.NEXU_HOME);
const openclawStateDir = expandHomeDir(
  parsed.OPENCLAW_STATE_DIR ??
    path.join(nexuHomeDir, "runtime", "openclaw", "state"),
);

export const env = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  host: parsed.HOST,
  webUrl: parsed.WEB_URL,
  nexuHomeDir,
  nexuConfigPath: path.join(nexuHomeDir, "config.json"),
  artifactsIndexPath: path.join(nexuHomeDir, "artifacts", "index.json"),
  compiledOpenclawSnapshotPath: path.join(
    nexuHomeDir,
    "compiled-openclaw.json",
  ),
  openclawStateDir,
  openclawConfigPath: expandHomeDir(
    parsed.OPENCLAW_CONFIG_PATH ?? path.join(openclawStateDir, "openclaw.json"),
  ),
  openclawSkillsDir: expandHomeDir(
    parsed.OPENCLAW_SKILLS_DIR ?? path.join(openclawStateDir, "skills"),
  ),
  userSkillsDir: path.resolve(os.homedir(), ".agents", "skills"),
  openclawBuiltinExtensionsDir: parsed.OPENCLAW_EXTENSIONS_DIR
    ? expandHomeDir(parsed.OPENCLAW_EXTENSIONS_DIR)
    : null,
  openclawExtensionsDir: path.join(openclawStateDir, "extensions"),
  runtimePluginTemplatesDir: workspaceRoot
    ? path.join(
        workspaceRoot,
        "apps",
        "controller",
        "static",
        "runtime-plugins",
      )
    : path.resolve(process.cwd(), "static", "runtime-plugins"),
  openclawRuntimeModelStatePath: path.join(
    openclawStateDir,
    "nexu-runtime-model.json",
  ),
  skillhubCacheDir: path.join(nexuHomeDir, "skillhub-cache"),
  skillDbPath: path.join(nexuHomeDir, "skill-ledger.json"),
  analyticsStatePath: path.join(nexuHomeDir, "analytics-state.json"),
  staticSkillsDir: parsed.SKILLHUB_STATIC_SKILLS_DIR
    ? expandHomeDir(parsed.SKILLHUB_STATIC_SKILLS_DIR)
    : workspaceRoot
      ? path.join(workspaceRoot, "apps", "desktop", "static", "bundled-skills")
      : undefined,
  platformTemplatesDir: parsed.PLATFORM_TEMPLATES_DIR
    ? expandHomeDir(parsed.PLATFORM_TEMPLATES_DIR)
    : undefined,
  openclawWorkspaceTemplatesDir: path.join(
    openclawStateDir,
    "workspace-templates",
  ),
  openclawBin: parsed.OPENCLAW_BIN,
  litellmBaseUrl: parsed.LITELLM_BASE_URL ?? null,
  litellmApiKey: parsed.LITELLM_API_KEY ?? null,
  openclawGatewayPort: parsed.OPENCLAW_GATEWAY_PORT,
  openclawGatewayToken: parsed.OPENCLAW_GATEWAY_TOKEN,
  manageOpenclawProcess: parsed.RUNTIME_MANAGE_OPENCLAW_PROCESS,
  gatewayProbeEnabled: parsed.RUNTIME_GATEWAY_PROBE_ENABLED,
  runtimeSyncIntervalMs: parsed.RUNTIME_SYNC_INTERVAL_MS,
  runtimeHealthIntervalMs: parsed.RUNTIME_HEALTH_INTERVAL_MS,
  defaultModelId: parsed.DEFAULT_MODEL_ID,
  amplitudeApiKey:
    parsed.AMPLITUDE_API_KEY?.trim() || parsed.VITE_AMPLITUDE_API_KEY,
};

export type ControllerEnv = typeof env;
