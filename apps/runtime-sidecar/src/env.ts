import { hostname } from "node:os";
import { z } from "zod";

const nodeEnv = z
  .enum(["development", "test", "production"])
  .default("development")
  .parse(process.env.NODE_ENV);

const requiredEnvKeys = [
  "INTERNAL_TRPC_TOKEN",
  "OPENCLAW_CONFIG_PATH",
  ...(nodeEnv === "production" ? ["RUNTIME_POOL_ID"] : []),
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

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  RUNTIME_POOL_ID: z.string().min(1).optional(),
  INTERNAL_TRPC_TOKEN: z.string().min(1),
  OPENCLAW_CONFIG_PATH: z.string().min(1),
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
  OPENCLAW_GATEWAY_READY_URL: z.string().url().optional(),
});

const parsedEnv = envSchema.parse(process.env);
const isProduction = parsedEnv.NODE_ENV === "production";

const runtimePoolId = parsedEnv.RUNTIME_POOL_ID ?? hostname();

export const env = {
  ...parsedEnv,
  RUNTIME_POOL_ID: runtimePoolId,
};

export const envWarnings = {
  usedHostnameAsRuntimePoolId:
    !isProduction && parsedEnv.RUNTIME_POOL_ID === undefined,
};
