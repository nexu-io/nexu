import "dotenv/config";
import { hostname } from "node:os";
import { homedir } from "node:os";
import { z } from "zod";

const nodeEnv = z
  .enum(["development", "test", "production"])
  .default("development")
  .parse(process.env.NODE_ENV);

const requiredEnvKeys = [
  ...(nodeEnv === "production"
    ? ["INTERNAL_API_TOKEN", "SKILL_API_TOKEN", "RUNTIME_POOL_ID"]
    : []),
] as const;

const missingRequiredEnvKeys = requiredEnvKeys.filter((key) => {
  const value = process.env[key];
  return value === undefined || value.trim().length === 0;
});

if (missingRequiredEnvKeys.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingRequiredEnvKeys.join(", ")}`,
  );
}

const booleanFromEnvSchema = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  RUNTIME_POOL_ID: z.string().min(1).optional(),
  INTERNAL_API_TOKEN: z.string().min(1).default("gw-secret-token"),
  SKILL_API_TOKEN: z.string().min(1).default("skill-secret-token"),
  OPENCLAW_CONFIG_PATH: z.string().min(1).optional(),
  OPENCLAW_STATE_DIR: z.string().min(1).optional(),
  OPENCLAW_SKILLS_DIR: z.string().min(1).optional(),
  RUNTIME_API_BASE_URL: z.string().url().default("http://localhost:3000"),
  RUNTIME_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  RUNTIME_POLL_JITTER_MS: z.coerce.number().int().nonnegative().default(300),
  RUNTIME_MAX_BACKOFF_MS: z.coerce.number().int().positive().default(30000),
  RUNTIME_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  RUNTIME_HEARTBEAT_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5000),
  RUNTIME_POD_IP: z.string().optional(),
  OPENCLAW_BIN: z.string().min(1).default("openclaw"),
  OPENCLAW_PROFILE: z.string().min(1).optional(),
  RUNTIME_MANAGE_OPENCLAW_PROCESS: booleanFromEnvSchema.default("false"),
  RUNTIME_GATEWAY_PROBE_ENABLED: booleanFromEnvSchema.default("true"),
  RUNTIME_GATEWAY_CLI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10000),
  RUNTIME_GATEWAY_LIVENESS_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5000),
  RUNTIME_GATEWAY_DEEP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30000),
  RUNTIME_GATEWAY_FAIL_DEGRADED_THRESHOLD: z.coerce
    .number()
    .int()
    .positive()
    .default(3),
  RUNTIME_GATEWAY_FAIL_UNHEALTHY_THRESHOLD: z.coerce
    .number()
    .int()
    .positive()
    .default(3),
  RUNTIME_GATEWAY_RECOVER_THRESHOLD: z.coerce
    .number()
    .int()
    .positive()
    .default(2),
  RUNTIME_GATEWAY_UNHEALTHY_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60000),
  RUNTIME_GATEWAY_MIN_STATE_HOLD_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(15000),
  RUNTIME_TOKEN_HEALTH_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(300_000),
});

function normalizeConfigPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith("~/")) {
    return `${homedir()}/${trimmed.slice(2)}`;
  }

  return trimmed;
}

function resolveDefaultStateDir(
  profile: string | undefined,
  nodeEnv: string,
): string {
  // In development, write config to project-local .openclaw/ directory
  if (nodeEnv !== "production") {
    const suffix = profile ? `-${profile}` : "";
    return `${process.cwd()}/.openclaw${suffix}`;
  }

  if (!profile) {
    return `${homedir()}/.openclaw`;
  }

  return `${homedir()}/.openclaw-${profile}`;
}

const parsedEnv = envSchema.parse(process.env);
const isProduction = parsedEnv.NODE_ENV === "production";

const openclawStateDir = normalizeConfigPath(
  parsedEnv.OPENCLAW_STATE_DIR ??
    resolveDefaultStateDir(parsedEnv.OPENCLAW_PROFILE, parsedEnv.NODE_ENV),
);

const openclawConfigPath = normalizeConfigPath(
  parsedEnv.OPENCLAW_CONFIG_PATH ?? `${openclawStateDir}/openclaw.json`,
);

const openclawSkillsDir = normalizeConfigPath(
  parsedEnv.OPENCLAW_SKILLS_DIR ?? `${openclawStateDir}/skills`,
);

const runtimePoolId = parsedEnv.RUNTIME_POOL_ID ?? hostname();

export const env = {
  ...parsedEnv,
  OPENCLAW_CONFIG_PATH: openclawConfigPath,
  OPENCLAW_SKILLS_DIR: openclawSkillsDir,
  OPENCLAW_STATE_DIR: openclawStateDir,
  RUNTIME_POOL_ID: runtimePoolId,
};

export const envWarnings = {
  usedHostnameAsRuntimePoolId:
    !isProduction && parsedEnv.RUNTIME_POOL_ID === undefined,
  deprecatedGatewayHttpEnvKeys: [
    "OPENCLAW_GATEWAY_URL",
    "OPENCLAW_GATEWAY_HEALTH_URL",
    "OPENCLAW_GATEWAY_STATUS_URL",
  ].filter((key) => {
    const value = process.env[key];
    return value !== undefined && value.trim().length > 0;
  }),
  openclawConfigPathSource: parsedEnv.OPENCLAW_CONFIG_PATH
    ? ("env" as const)
    : parsedEnv.OPENCLAW_STATE_DIR
      ? ("state_dir_env" as const)
      : parsedEnv.OPENCLAW_PROFILE
        ? ("profile_default" as const)
        : ("default" as const),
  openclawStateDir: openclawStateDir,
  openclawConfigPath: openclawConfigPath,
};
