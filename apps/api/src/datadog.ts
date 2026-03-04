import "dotenv/config";

function toErrorInfo(err: unknown): {
  error_type: string;
  error_message: string;
} {
  if (err instanceof Error) {
    return {
      error_type: err.name,
      error_message: err.message,
    };
  }

  return {
    error_type: typeof err,
    error_message: String(err),
  };
}

function logInitFail(err: unknown): void {
  const errorInfo = toErrorInfo(err);
  console.warn(
    JSON.stringify({
      message: "datadog_init_failed",
      scope: "datadog_init",
      ...errorInfo,
    }),
  );
}

if (!process.env.DD_VERSION && process.env.COMMIT_HASH) {
  process.env.DD_VERSION = process.env.COMMIT_HASH;
}

if (process.env.DD_ENV && process.env.DD_TRACE_PRELOADED !== "true") {
  try {
    // @ts-expect-error dd-trace lacks ESM exports map
    await import("dd-trace/initialize.mjs");
  } catch (err) {
    logInitFail(err);
  }
}
