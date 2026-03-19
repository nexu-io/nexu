import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { expandHomeDir } from "../lib/path-utils.js";

dotenv.config();

const booleanSchema = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3010),
  HOST: z.string().default("127.0.0.1"),
  NEXU_CLOUD_URL: z.string().default("https://nexu.io"),
  NEXU_HOME: z.string().default("~/.nexu"),
  OPENCLAW_STATE_DIR: z.string().default("~/.openclaw"),
  OPENCLAW_CONFIG_PATH: z.string().optional(),
  OPENCLAW_SKILLS_DIR: z.string().optional(),
  OPENCLAW_GATEWAY_PORT: z.coerce.number().int().positive().default(18789),
  OPENCLAW_GATEWAY_TOKEN: z.string().optional(),
  OPENCLAW_BIN: z.string().default("openclaw"),
  RUNTIME_MANAGE_OPENCLAW_PROCESS: booleanSchema.default("false"),
  RUNTIME_GATEWAY_PROBE_ENABLED: booleanSchema.default("true"),
  RUNTIME_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  RUNTIME_HEALTH_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  DEFAULT_MODEL_ID: z.string().default("anthropic/claude-sonnet-4"),
  WEB_URL: z.string().default("http://localhost:5173"),
});

const parsed = envSchema.parse(process.env);

const nexuHomeDir = expandHomeDir(parsed.NEXU_HOME);
const openclawStateDir = expandHomeDir(parsed.OPENCLAW_STATE_DIR);

export const env = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  host: parsed.HOST,
  webUrl: parsed.WEB_URL,
  nexuCloudUrl: parsed.NEXU_CLOUD_URL,
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
  openclawWorkspaceTemplatesDir: path.join(
    openclawStateDir,
    "workspace-templates",
  ),
  openclawBin: parsed.OPENCLAW_BIN,
  openclawGatewayPort: parsed.OPENCLAW_GATEWAY_PORT,
  openclawGatewayToken: parsed.OPENCLAW_GATEWAY_TOKEN,
  manageOpenclawProcess: parsed.RUNTIME_MANAGE_OPENCLAW_PROCESS,
  gatewayProbeEnabled: parsed.RUNTIME_GATEWAY_PROBE_ENABLED,
  runtimeSyncIntervalMs: parsed.RUNTIME_SYNC_INTERVAL_MS,
  runtimeHealthIntervalMs: parsed.RUNTIME_HEALTH_INTERVAL_MS,
  defaultModelId: parsed.DEFAULT_MODEL_ID,
};

export type ControllerEnv = typeof env;
