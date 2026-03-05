import "dotenv/config";

function logInitFail(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(
    JSON.stringify({
      message: "datadog_init_failed",
      scope: "datadog_init",
      error_message: message,
    }),
  );
}

// Ensure gateway uses its own service name even when DD_SERVICE is shared
if (!process.env.DD_SERVICE || process.env.DD_SERVICE === "nexu-api") {
  process.env.DD_SERVICE = "nexu-gateway";
}

if (!process.env.DD_VERSION) {
  const version =
    process.env.COMMIT_HASH ??
    process.env.GIT_COMMIT_SHA ??
    process.env.IMAGE_TAG;
  if (version) {
    process.env.DD_VERSION = version;
  }
}

if (process.env.DD_ENV && process.env.DD_TRACE_PRELOADED !== "true") {
  try {
    // @ts-expect-error dd-trace lacks ESM exports map
    await import("dd-trace/initialize.mjs");
  } catch (err) {
    logInitFail(err);
  }
}
