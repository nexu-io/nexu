import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const nodeExecutable = process.execPath;

describe("prepare-openclaw-sidecar Feishu card action patch", () => {
  it("injects immediate toast acknowledgement for card actions", async () => {
    await execFileAsync(
      nodeExecutable,
      ["./apps/desktop/scripts/prepare-openclaw-sidecar.mjs"],
      {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const sidecarRoot = path.join(
      repoRoot,
      ".tmp/sidecars/openclaw/node_modules/openclaw",
    );
    const cardActionSource = await readFile(
      path.join(sidecarRoot, "extensions/feishu/src/card-action.ts"),
      "utf8",
    );
    const monitorAccountSource = await readFile(
      path.join(sidecarRoot, "extensions/feishu/src/monitor.account.ts"),
      "utf8",
    );

    expect(cardActionSource).toContain("Received. Processing...");
    expect(cardActionSource).toContain('content: "已收到，正在处理..."');
    expect(cardActionSource).toContain("fireAndForget?: boolean;");
    expect(monitorAccountSource).toContain(
      "return await handleFeishuCardAction({",
    );
    expect(monitorAccountSource).toContain(
      "Card action failed. Please try again.",
    );
  });
});
