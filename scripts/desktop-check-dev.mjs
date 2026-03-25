import { spawn } from "node:child_process";

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
      env: process.env,
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

async function main() {
  let exitCode = 0;

  const startResult = await run("pnpm", ["start"]);
  if (startResult.code !== 0) {
    exitCode = startResult.code;
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

  const stopResult = await run("pnpm", ["stop"]);
  if (exitCode === 0 && stopResult.code !== 0) {
    exitCode = stopResult.code;
  }

  process.exit(exitCode);
}

await main();
