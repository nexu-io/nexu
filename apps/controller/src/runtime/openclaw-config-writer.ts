import { readdirSync, rmSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import { NEXU_INTERNAL_ACCOUNT_PREFIX } from "../lib/channel-binding-compiler.js";
import { logger } from "../lib/logger.js";
import { serializeOpenClawConfig } from "../lib/openclaw-config-serialization.js";

/**
 * Sync weixin account IDs from openclaw.json to the openclaw-weixin plugin's
 * index file. The plugin reads account list from this index file, not from
 * the config, so we need to keep them in sync.
 */
async function syncWeixinAccountIndex(
  openclawStateDir: string,
  config: OpenClawConfig,
): Promise<void> {
  const weixinConfig = config.channels?.["openclaw-weixin"] as
    | { accounts?: Record<string, unknown> }
    | undefined;
  const accountIds = weixinConfig?.accounts
    ? Object.keys(weixinConfig.accounts)
    : [];

  const indexDir = path.join(openclawStateDir, "openclaw-weixin");
  const indexPath = path.join(indexDir, "accounts.json");

  // Read existing index to avoid unnecessary writes
  let existingIds: string[] = [];
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      existingIds = parsed.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // File doesn't exist or is invalid
  }

  // Authoritative: config is the source of truth for which accounts should
  // exist. Filter out internal prewarm IDs that should never be persisted,
  // and only keep existing IDs that are still present in the current config.
  // This prevents "ghost accounts" from accumulating across connect/disconnect
  // cycles and avoids persisting the internal prewarm placeholder.
  const configIdSet = new Set(accountIds);
  const mergedIds = [
    ...new Set([
      ...existingIds.filter((id) => configIdSet.has(id)),
      ...accountIds,
    ]),
  ].filter((id) => !id.startsWith(NEXU_INTERNAL_ACCOUNT_PREFIX));

  // Only write if changed
  if (JSON.stringify(mergedIds) === JSON.stringify(existingIds)) {
    return;
  }

  await mkdir(indexDir, { recursive: true });
  await writeFile(indexPath, JSON.stringify(mergedIds, null, 2), "utf8");

  // Remove orphan credential/sync files for accounts no longer in the
  // authoritative set.  This prevents listStoredWeixinAccountIds() from
  // resurrecting stale accounts that were removed from config.
  const accountsDir = path.join(indexDir, "accounts");
  try {
    const validIds = new Set(mergedIds);
    for (const entry of readdirSync(accountsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.replace(/\.sync\.json$|\.json$/, "");
      if (!validIds.has(id)) {
        rmSync(path.join(accountsDir, entry.name), { force: true });
      }
    }
  } catch {
    // accounts dir may not exist yet — that's fine
  }

  logger.debug(
    { indexPath, accountIds: mergedIds },
    "weixin_account_index_synced",
  );
}

function resolveOpenclawStateDir(env: ControllerEnv): string {
  return env.openclawStateDir ?? path.dirname(env.openclawConfigPath);
}

export class OpenClawConfigWriter {
  /** Last successfully written content — used to skip redundant writes. */
  private lastWrittenContent: string | null = null;

  constructor(private readonly env: ControllerEnv) {}

  async write(config: OpenClawConfig): Promise<boolean> {
    await mkdir(path.dirname(this.env.openclawConfigPath), { recursive: true });
    const content = serializeOpenClawConfig(config);

    // On cold start, seed the cache from the existing file on disk so the
    // first write() after a process restart doesn't trigger an unnecessary
    // OpenClaw reload when the config hasn't actually changed.
    if (this.lastWrittenContent === null) {
      try {
        const existingContent = await readFile(
          this.env.openclawConfigPath,
          "utf8",
        );
        try {
          this.lastWrittenContent = serializeOpenClawConfig(
            JSON.parse(existingContent) as OpenClawConfig,
          );
        } catch {
          this.lastWrittenContent = existingContent;
        }
      } catch {
        // File doesn't exist yet — leave cache empty.
      }
    }

    // Skip writing if the content hasn't changed since the last write.
    // This prevents OpenClaw's file watcher from triggering unnecessary
    // reloads/restarts when syncAll() is called without actual config changes
    // (e.g. on WS reconnect after a restart).
    if (content === this.lastWrittenContent) {
      logger.debug(
        { path: this.env.openclawConfigPath },
        "openclaw_config_write_skipped_unchanged",
      );
      return false;
    }

    const writeStartedAt = Date.now();
    logger.info(
      {
        path: this.env.openclawConfigPath,
        contentLength: content.length,
        startedAt: writeStartedAt,
      },
      "openclaw_config_write_begin",
    );
    await writeFile(this.env.openclawConfigPath, content, "utf8");
    this.lastWrittenContent = content;

    // Sync weixin account index for openclaw-weixin plugin compatibility
    await syncWeixinAccountIndex(resolveOpenclawStateDir(this.env), config);

    const configStat = await stat(this.env.openclawConfigPath);
    logger.info(
      {
        path: this.env.openclawConfigPath,
        contentLength: content.length,
        inode: configStat.ino,
        size: configStat.size,
        mtimeMs: configStat.mtimeMs,
        finishedAt: Date.now(),
        durationMs: Date.now() - writeStartedAt,
      },
      "openclaw_config_write_complete",
    );

    return true;
  }
}
