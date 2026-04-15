import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, "..", "..");
const require = createRequire(import.meta.url);

function createCommandSpec(command, args) {
  if (
    process.platform === "win32" &&
    (command === "npm" || command === "npm.cmd")
  ) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", ["npm", ...args].join(" ")],
    };
  }

  return { command, args };
}

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const commandSpec = createCommandSpec(command, args);
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

async function prepareOpenclawRuntime() {
  await run(
    process.execPath,
    [path.resolve(packageRoot, "prepare-runtime.mjs")],
    repoRoot,
  );
}

async function buildSlimclaw() {
  const tscEntrypoint = require.resolve("typescript/bin/tsc");
  await run(
    process.execPath,
    [tscEntrypoint, "-p", "./tsconfig.json"],
    packageRoot,
  );
}

await prepareOpenclawRuntime();
await buildSlimclaw();
