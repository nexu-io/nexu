import { track as ampTrack, init } from "@amplitude/analytics-node";
import { logger } from "./logger.js";

const apiKey = process.env.AMPLITUDE_API_KEY;

if (apiKey) {
  init(apiKey, { logLevel: 0 });
  logger.info("amplitude_initialized");
}

export function track(
  event: string,
  userId: string,
  properties?: Record<string, unknown>,
): void {
  if (!apiKey) return;
  ampTrack(event, properties, { user_id: userId });
}
