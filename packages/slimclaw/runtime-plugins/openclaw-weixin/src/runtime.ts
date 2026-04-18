import type { PluginRuntime } from "openclaw/plugin-sdk";

import { logger } from "./util/logger.js";

let pluginRuntime: PluginRuntime | null = null;

export type PluginChannelRuntime = PluginRuntime["channel"];

/**
 * Sets the global Weixin runtime (called from plugin register).
 */
export function setWeixinRuntime(next: PluginRuntime): void {
  pluginRuntime = next;
  logger.info(`[runtime] setWeixinRuntime called, runtime set successfully`);
}

/**
 * Gets the global Weixin runtime (throws if not initialized).
 */
export function getWeixinRuntime(): PluginRuntime {
  if (!pluginRuntime) {
    throw new Error("Weixin runtime not initialized");
  }
  return pluginRuntime;
}

const WAIT_INTERVAL_MS = 100;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Waits for the Weixin runtime to be initialized (async polling).
 */
export async function waitForWeixinRuntime(
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PluginRuntime> {
  const start = Date.now();
  while (!pluginRuntime) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Weixin runtime initialization timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
  }
  return pluginRuntime;
}

/**
 * Resolves `PluginRuntime["channel"]` for the long-poll monitor.
 *
 * Prefer the gateway-injected `channelRuntime` on `ChannelGatewayContext` when present (avoids
 * races with the module-global from `register()`). Fall back to the global set by `setWeixinRuntime()`,
 * then to a short wait for legacy hosts.
 */
export async function resolveWeixinChannelRuntime(params: {
  channelRuntime?: PluginChannelRuntime;
  waitTimeoutMs?: number;
}): Promise<PluginChannelRuntime> {
  if (params.channelRuntime) {
    logger.debug("[runtime] channelRuntime from gateway context");
    return params.channelRuntime;
  }
  if (pluginRuntime) {
    logger.debug("[runtime] channelRuntime from register() global");
    return pluginRuntime.channel;
  }
  logger.warn(
    "[runtime] no channelRuntime on ctx and no global runtime yet; waiting for register()",
  );
  const pr = await waitForWeixinRuntime(
    params.waitTimeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  return pr.channel;
}
