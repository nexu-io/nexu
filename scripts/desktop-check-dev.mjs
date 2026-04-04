import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";

const captureDir =
  process.env.NEXU_DESKTOP_CHECK_CAPTURE_DIR ?? ".tmp/desktop-ci-test";

function createCommandSpec(command, args) {
  if (
    process.platform === "win32" &&
    (command === "pnpm" || command === "pnpm.cmd")
  ) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", ["pnpm", ...args].join(" ")],
    };
  }

  return { command, args };
}

function run(command, args) {
  return new Promise((resolveRun) => {
    const commandSpec = createCommandSpec(command, args);
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENCLAW_DISABLE_BONJOUR: process.env.OPENCLAW_DISABLE_BONJOUR ?? "1",
      },
      stdio: "inherit",
    });

    child.once("error", (error) => {
      resolveRun({ code: 1, error });
    });

    child.once("exit", (code) => {
      resolveRun({ code: code ?? 1, error: null });
    });
  });
}

async function bestEffortCleanup() {
  for (const args of [
    ["dev", "stop", "desktop"],
    ["dev", "stop", "web"],
    ["dev", "stop", "controller"],
    ["dev", "stop", "openclaw"],
  ]) {
    await run("pnpm", args);
  }

  for (const path of [
    ".tmp/dev/desktop.pid",
    ".tmp/dev/web.pid",
    ".tmp/dev/controller.pid",
    ".tmp/dev/openclaw.pid",
  ]) {
    await rm(path, { force: true });
  }
}

async function main() {
  let exitCode = 0;

  await bestEffortCleanup();

  const startCommands = [
    ["dev", "start", "openclaw"],
    ["dev", "start", "controller"],
    ["dev", "start", "web"],
    ["dev", "start", "desktop"],
  ];

  for (const args of startCommands) {
    const startResult = await run("pnpm", args);
    if (startResult.code !== 0) {
      exitCode = startResult.code;
      break;
    }
  }

  if (exitCode === 0) {
    const checkResult = await run("node", [
      "scripts/desktop-ci-check.mjs",
      "dev",
      "--capture-dir",
      captureDir,
    ]);
    exitCode = checkResult.code;
  }

  for (const args of [
    ["dev", "stop", "desktop"],
    ["dev", "stop", "web"],
    ["dev", "stop", "controller"],
    ["dev", "stop", "openclaw"],
  ]) {
    await run("pnpm", args);
  }

  process.exit(exitCode);
}

await main();
