import type { DevTarget } from "../commands.js";

export function isAlreadyRunningStartError(
  target: DevTarget,
  error: unknown,
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes(
    `${target} dev process is already running; run \`pnpm dev stop ${target}\` first`,
  );
}
