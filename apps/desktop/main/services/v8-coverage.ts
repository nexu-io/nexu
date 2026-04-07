import { takeCoverage } from "node:v8";

function isCoverageEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.NEXU_DESKTOP_E2E_COVERAGE === "1";
}

/**
 * Flushes pending V8 coverage data when desktop E2E coverage mode is enabled.
 * This is intentionally best-effort and no-op outside coverage mode.
 */
export function flushV8CoverageIfEnabled(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isCoverageEnabled(env)) {
    return;
  }

  try {
    takeCoverage();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown v8 coverage error";
    console.warn(`[coverage] takeCoverage() failed: ${message}`);
  }
}
