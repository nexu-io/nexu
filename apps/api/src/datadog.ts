import "dotenv/config";
import { BaseError } from "./lib/error.js";
import { logger } from "./lib/logger.js";

if (!process.env.DD_VERSION && process.env.COMMIT_HASH) {
  process.env.DD_VERSION = process.env.COMMIT_HASH;
}

if (process.env.DD_ENV) {
  try {
    // @ts-expect-error dd-trace lacks ESM exports map
    await import("dd-trace/initialize.mjs");
  } catch (err) {
    const unknownError = BaseError.from(err);
    logger.warn({
      message: "datadog_init_failed",
      scope: "datadog_init",
      ...unknownError.toJSON(),
    });
  }
}
