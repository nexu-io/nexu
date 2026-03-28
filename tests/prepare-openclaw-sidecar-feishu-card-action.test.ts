import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const nodeExecutable = process.execPath;
const openclawRuntimeNodeModules = path.join(
  repoRoot,
  "openclaw-runtime",
  "node_modules",
);
const openclawRuntimeRoot = path.join(openclawRuntimeNodeModules, "openclaw");

async function ensureFakeOpenclawRuntime() {
  try {
    await readFile(path.join(openclawRuntimeRoot, "openclaw.mjs"), "utf8");
    return false;
  } catch {
    // Fall through and seed a minimal runtime tree for the patcher test.
  }

  await mkdir(path.join(openclawRuntimeRoot, "extensions", "feishu", "src"), {
    recursive: true,
  });

  await writeFile(
    path.join(openclawRuntimeRoot, "openclaw.mjs"),
    'export const version = "test";\n',
    "utf8",
  );
  await writeFile(
    path.join(
      openclawRuntimeRoot,
      "extensions",
      "feishu",
      "src",
      "card-action.ts",
    ),
    `export async function handleFeishuCardAction(params: {
  cfg: ClawdbotConfig;
  event: FeishuCardActionEvent;
  botOpenId?: string;
  runtime?: RuntimeEnv;
  accountId?: string;
}): Promise<void> {
  const { cfg, event } = params;
  const runtime = params.runtime;
  const accountId = params.accountId;
  const account = { accountId };
  const content = "";
  const messageEvent = {};
  const log = console.log;

  log(
    \`feishu[\${account.accountId}]: handling card action from \${event.operator.open_id}: \${content}\`,
  );

  // Dispatch as normal message
  await handleFeishuMessage({
    cfg,
    event: messageEvent,
    botOpenId: params.botOpenId,
    runtime,
    accountId,
  });
}
`,
    "utf8",
  );
  await writeFile(
    path.join(
      openclawRuntimeRoot,
      "extensions",
      "feishu",
      "src",
      "monitor.account.ts",
    ),
    `const handlers = {
  "card.action.trigger": async (data: unknown) => {
    try {
      const event = data as unknown as FeishuCardActionEvent;
      const promise = handleFeishuCardAction({
        cfg,
        event,
        botOpenId: botOpenIds.get(accountId),
        runtime,
        accountId,
      });
      if (fireAndForget) {
        promise.catch((err) => {
          error(\`feishu[\${accountId}]: error handling card action: \${String(err)}\`);
        });
      } else {
        await promise;
      }
    } catch (err) {
      error(\`feishu[\${accountId}]: error handling card action: \${String(err)}\`);
    }
  },
};
`,
    "utf8",
  );

  return true;
}

describe("prepare-openclaw-sidecar Feishu card action patch", () => {
  it("injects immediate toast acknowledgement for card actions", async () => {
    const seededFakeRuntime = await ensureFakeOpenclawRuntime();

    try {
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
    } finally {
      if (seededFakeRuntime) {
        await rm(openclawRuntimeNodeModules, { recursive: true, force: true });
      }
    }
  }, 20000);
});
