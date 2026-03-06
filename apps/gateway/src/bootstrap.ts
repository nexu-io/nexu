import type { Dirent } from "node:fs";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkSlackTokens, registerPool } from "./api.js";
import { fetchInitialConfig } from "./config.js";
import { env, envWarnings } from "./env.js";
import { waitGatewayReady } from "./gateway-health.js";
import { BaseError, GatewayError, logger } from "./log.js";
import {
  enableAutoRestart,
  startManagedOpenclawGateway,
} from "./openclaw-process.js";
import { pollLatestSkills } from "./skills.js";
import type { RuntimeState } from "./state.js";
import { runWithRetry, sleep } from "./utils.js";
import { pollLatestWorkspaceTemplates } from "./workspace-templates.js";

async function registerPoolWithRetry(): Promise<void> {
  return runWithRetry(
    registerPool,
    ({ attempt, retryDelayMs, error }) => {
      const baseError = BaseError.from(error);
      logger.warn(
        GatewayError.from(
          {
            source: "bootstrap/register-pool",
            message: "pool registration failed; retrying",
            code: baseError.code,
          },
          {
            attempt,
            poolId: env.RUNTIME_POOL_ID,
            retryDelayMs,
            reason: baseError.message,
          },
        ).toJSON(),
        "pool registration failed; retrying",
      );
    },
    env.RUNTIME_MAX_BACKOFF_MS,
  );
}

async function fetchInitialConfigWithRetry(): Promise<void> {
  return runWithRetry(
    fetchInitialConfig,
    ({ attempt, retryDelayMs, error }) => {
      const baseError = BaseError.from(error);
      logger.warn(
        GatewayError.from(
          {
            source: "bootstrap/fetch-initial-config",
            message: "initial config sync failed; retrying",
            code: baseError.code,
          },
          {
            attempt,
            poolId: env.RUNTIME_POOL_ID,
            retryDelayMs,
            reason: baseError.message,
          },
        ).toJSON(),
        "initial config sync failed; retrying",
      );
    },
    env.RUNTIME_MAX_BACKOFF_MS,
  );
}

async function syncInitialSkillsWithRetry(state: RuntimeState): Promise<void> {
  return runWithRetry(
    () => pollLatestSkills(state).then(() => undefined),
    ({ attempt, retryDelayMs, error }) => {
      const baseError = BaseError.from(error);
      logger.warn(
        GatewayError.from(
          {
            source: "bootstrap/sync-initial-skills",
            message: "initial skills sync failed; retrying",
            code: baseError.code,
          },
          {
            attempt,
            poolId: env.RUNTIME_POOL_ID,
            retryDelayMs,
            reason: baseError.message,
          },
        ).toJSON(),
        "initial skills sync failed; retrying",
      );
    },
    env.RUNTIME_MAX_BACKOFF_MS,
  );
}

async function syncInitialWorkspaceTemplatesWithRetry(
  state: RuntimeState,
): Promise<void> {
  return runWithRetry(
    () => pollLatestWorkspaceTemplates(state).then(() => undefined),
    ({ attempt, retryDelayMs, error }) => {
      const baseError = BaseError.from(error);
      logger.warn(
        GatewayError.from(
          {
            source: "bootstrap/sync-initial-workspace-templates",
            message: "initial workspace templates sync failed; retrying",
            code: baseError.code,
          },
          {
            attempt,
            poolId: env.RUNTIME_POOL_ID,
            retryDelayMs,
            reason: baseError.message,
          },
        ).toJSON(),
        "initial workspace templates sync failed; retrying",
      );
    },
    env.RUNTIME_MAX_BACKOFF_MS,
  );
}

async function clearStaleSessionLocks(): Promise<void> {
  if (!env.RUNTIME_MANAGE_OPENCLAW_PROCESS) {
    return; // external OpenClaw may have active locks
  }

  const agentsDir = join(env.OPENCLAW_STATE_DIR, "agents");

  let agentEntries: Dirent[];
  try {
    agentEntries = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return; // agents dir doesn't exist yet
  }

  let removed = 0;
  for (const entry of agentEntries) {
    if (!entry.isDirectory()) continue;
    const sessionsDir = join(agentsDir, entry.name, "sessions");
    let files: string[];
    try {
      files = await readdir(sessionsDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".lock")) continue;
      await rm(join(sessionsDir, file), { force: true });
      removed++;
    }
  }

  if (removed > 0) {
    logger.info({ count: removed }, "cleared stale session locks");
  }
}

async function touchConfigFile(): Promise<void> {
  try {
    const content = await readFile(env.OPENCLAW_CONFIG_PATH, "utf8");
    const temp = `${env.OPENCLAW_CONFIG_PATH}.tmp`;
    await writeFile(temp, content, "utf8");
    await rename(temp, env.OPENCLAW_CONFIG_PATH);
    logger.info("rewrote config file to trigger watcher");
  } catch {
    // config file may not exist yet
  }
}

async function rewriteSkillFiles(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(env.OPENCLAW_SKILLS_DIR);
  } catch {
    return; // no skills dir
  }

  let rewritten = 0;
  for (const name of entries) {
    const skillMd = join(env.OPENCLAW_SKILLS_DIR, name, "SKILL.md");
    try {
      const content = await readFile(skillMd, "utf8");
      const temp = `${skillMd}.tmp`;
      await writeFile(temp, content, "utf8");
      await rename(temp, skillMd);
      rewritten++;
    } catch {
      // not a skill dir or no SKILL.md
    }
  }

  if (rewritten > 0) {
    logger.info({ count: rewritten }, "rewrote skill files to trigger watcher");
  }
}

export async function bootstrapGateway(state: RuntimeState): Promise<void> {
  if (envWarnings.usedHostnameAsRuntimePoolId) {
    logger.warn(
      {
        nodeEnv: env.NODE_ENV,
        poolId: env.RUNTIME_POOL_ID,
      },
      "RUNTIME_POOL_ID is unset; using hostname fallback",
    );
  }

  if (envWarnings.deprecatedGatewayHttpEnvKeys.length > 0) {
    logger.warn(
      {
        keys: envWarnings.deprecatedGatewayHttpEnvKeys,
      },
      "deprecated gateway HTTP env vars detected and ignored",
    );
  }

  if (envWarnings.openclawConfigPathSource === "state_dir_env") {
    logger.warn(
      {
        stateDir: envWarnings.openclawStateDir,
        configPath: envWarnings.openclawConfigPath,
      },
      "OPENCLAW_CONFIG_PATH is unset; derived from OPENCLAW_STATE_DIR",
    );
  }

  if (envWarnings.openclawConfigPathSource === "profile_default") {
    logger.warn(
      {
        profile: env.OPENCLAW_PROFILE,
        stateDir: envWarnings.openclawStateDir,
        configPath: envWarnings.openclawConfigPath,
      },
      "OPENCLAW_CONFIG_PATH is unset; derived from profile default",
    );
  }

  if (envWarnings.openclawConfigPathSource === "default") {
    logger.warn(
      {
        stateDir: envWarnings.openclawStateDir,
        configPath: envWarnings.openclawConfigPath,
      },
      "OPENCLAW_CONFIG_PATH is unset; using ~/.openclaw/openclaw.json",
    );
  }

  logger.info(
    {
      poolId: env.RUNTIME_POOL_ID,
      configPath: env.OPENCLAW_CONFIG_PATH,
      manageOpenclawProcess: env.RUNTIME_MANAGE_OPENCLAW_PROCESS,
    },
    "starting gateway",
  );
  await registerPoolWithRetry();
  logger.info({ poolId: env.RUNTIME_POOL_ID }, "pool registered");

  // Validate Slack bot tokens before fetching config so OpenClaw starts
  // with a clean config that excludes any channels with revoked tokens.
  try {
    await checkSlackTokens();
    logger.info("slack token health check passed");
  } catch (error) {
    const baseError = BaseError.from(error);
    logger.warn(
      { reason: baseError.message },
      "slack token health check failed; continuing with startup",
    );
  }

  await fetchInitialConfigWithRetry();
  await syncInitialSkillsWithRetry(state);
  logger.info({ poolId: env.RUNTIME_POOL_ID }, "initial skills synced");

  await syncInitialWorkspaceTemplatesWithRetry(state);
  logger.info(
    { poolId: env.RUNTIME_POOL_ID },
    "initial workspace templates synced",
  );

  await clearStaleSessionLocks();

  if (env.RUNTIME_MANAGE_OPENCLAW_PROCESS) {
    startManagedOpenclawGateway();
    enableAutoRestart();
  }

  await waitGatewayReady();
  await sleep(2000);
  await rewriteSkillFiles();

  // Re-touch the config file so OpenClaw's file watcher picks up the
  // initial config that was written before the watcher was ready.
  await touchConfigFile();
}
