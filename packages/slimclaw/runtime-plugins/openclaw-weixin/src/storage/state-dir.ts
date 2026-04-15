import os from "node:os";
import path from "node:path";

/** Resolve the OpenClaw state directory (mirrors core logic in src/infra). */
export function resolveStateDir(): string {
  return (
    process.env.OPENCLAW_STATE_DIR?.trim() ||
    process.env.CLAWDBOT_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".openclaw")
  );
}
