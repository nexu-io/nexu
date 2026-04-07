import { takeCoverage } from "node:v8";

function isDesktopE2ECoverageEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.NEXU_DESKTOP_E2E_COVERAGE === "1";
}

export function flushV8CoverageIfEnabled(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isDesktopE2ECoverageEnabled(env)) {
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
