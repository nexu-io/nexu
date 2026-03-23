#!/usr/bin/env node
/**
 * Verify that all patch anchors exist in the target files.
 * Run this script before packaging to ensure patches will apply correctly.
 *
 * Usage: node verify-patch-anchors.mjs
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
// Allow override via env var for testing in worktrees without dependencies
const openclawRuntimeRoot = process.env.OPENCLAW_RUNTIME_ROOT
  ? resolve(process.env.OPENCLAW_RUNTIME_ROOT)
  : resolve(repoRoot, "openclaw-runtime");
const openclawRoot = resolve(openclawRuntimeRoot, "node_modules/openclaw");
const larkSdkRoot = resolve(
  openclawRuntimeRoot,
  "node_modules/@larksuiteoapi/node-sdk",
);

// Patch anchors to verify
const anchors = [
  // Lark SDK patches
  {
    file: resolve(larkSdkRoot, "lib/index.js"),
    label: "Lark SDK: WSClient constructor",
    search: `        this.wsConfig = new WSConfig();
        this.isConnecting = false;
        this.reconnectInfo = {`,
    skipIfPatched: "this.onStateChange = null;",
  },
  {
    file: resolve(larkSdkRoot, "lib/index.js"),
    label: "Lark SDK: ws client ready",
    search: `                this.logger.info('[ws]', 'ws client ready');
                return;`,
  },
  {
    file: resolve(larkSdkRoot, "lib/index.js"),
    label: "Lark SDK: reconnect start",
    search: `            this.logger.info('[ws]', 'reconnect');
            if (wsInstance) {`,
  },
  {
    file: resolve(larkSdkRoot, "lib/index.js"),
    label: "Lark SDK: reconnect success",
    search: `                        if (isSuccess) {
                            this.logger.debug('[ws]', 'reconnect success');
                            this.isConnecting = false;
                            return;
                        }`,
  },
  {
    file: resolve(larkSdkRoot, "lib/index.js"),
    label: "Lark SDK: client closed",
    search: `        wsInstance === null || wsInstance === void 0 ? void 0 : wsInstance.on('close', () => {
            this.logger.debug('[ws]', 'client closed');
            this.reConnect();
        });`,
  },

  // Feishu channel patches
  {
    file: resolve(openclawRoot, "extensions/feishu/src/channel.ts"),
    label: "Feishu channel.ts: monitorFeishuProvider call",
    search: `      return monitorFeishuProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });`,
    skipIfPatched: "setStatus: ctx.setStatus",
  },
  {
    file: resolve(openclawRoot, "extensions/feishu/src/monitor.ts"),
    label: "Feishu monitor.ts: MonitorFeishuOpts type",
    search: `export type MonitorFeishuOpts = {
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
};`,
    skipIfPatched: "setStatus?:",
  },
  {
    file: resolve(openclawRoot, "extensions/feishu/src/monitor.ts"),
    label: "Feishu monitor.ts: single account call",
    search: `    return monitorSingleAccount({
      cfg,
      account,
      runtime: opts.runtime,
      abortSignal: opts.abortSignal,
    });`,
    skipIfPatched: "setStatus: opts.setStatus",
  },
  {
    file: resolve(openclawRoot, "extensions/feishu/src/monitor.ts"),
    label: "Feishu monitor.ts: multi account call",
    search: `    monitorPromises.push(
      monitorSingleAccount({
        cfg,
        account,
        runtime: opts.runtime,
        abortSignal: opts.abortSignal,
        botOpenIdSource: { kind: "prefetched", botOpenId, botName },
      }),
    );`,
  },
  {
    file: resolve(openclawRoot, "extensions/feishu/src/monitor.account.ts"),
    label: "Feishu monitor.account.ts: MonitorSingleAccountParams type",
    search: `export type MonitorSingleAccountParams = {
  cfg: ClawdbotConfig;
  account: ResolvedFeishuAccount;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  botOpenIdSource?: BotOpenIdSource;
};`,
    skipIfPatched: "setStatus?:",
  },
  {
    file: resolve(openclawRoot, "extensions/feishu/src/monitor.account.ts"),
    label: "Feishu monitor.account.ts: monitorWebSocket call",
    search: `  if (connectionMode === "webhook") {
    return monitorWebhook({ account, accountId, runtime, abortSignal, eventDispatcher });
  }
  return monitorWebSocket({ account, accountId, runtime, abortSignal, eventDispatcher });`,
    skipIfPatched: "updateStatus",
  },
];

async function verifyAnchors() {
  console.log("Verifying patch anchors...\n");

  const results = { passed: 0, skipped: 0, failed: 0 };
  const failures = [];

  for (const anchor of anchors) {
    try {
      const content = await readFile(anchor.file, "utf8");

      // Check if already patched
      if (anchor.skipIfPatched && content.includes(anchor.skipIfPatched)) {
        console.log(`  [SKIP] ${anchor.label} (already patched)`);
        results.skipped++;
        continue;
      }

      // Check if anchor exists
      if (content.includes(anchor.search)) {
        console.log(`  [PASS] ${anchor.label}`);
        results.passed++;
      } else {
        console.log(`  [FAIL] ${anchor.label}`);
        failures.push({
          label: anchor.label,
          file: anchor.file,
          reason: "Anchor string not found in file",
        });
        results.failed++;
      }
    } catch (error) {
      console.log(`  [FAIL] ${anchor.label}`);
      failures.push({
        label: anchor.label,
        file: anchor.file,
        reason: error.code === "ENOENT" ? "File not found" : error.message,
      });
      results.failed++;
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Passed: ${results.passed}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log(`Failed: ${results.failed}`);

  if (failures.length > 0) {
    console.log("\n--- Failures ---");
    for (const f of failures) {
      console.log(`\n${f.label}:`);
      console.log(`  File: ${f.file}`);
      console.log(`  Reason: ${f.reason}`);
    }
    process.exit(1);
  }

  console.log("\nAll patch anchors verified successfully!");
}

verifyAnchors().catch((error) => {
  console.error("Verification failed:", error);
  process.exit(1);
});
