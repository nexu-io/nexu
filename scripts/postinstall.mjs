import { spawn } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = process.cwd();

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

function isTruthy(value) {
  if (!value) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();
  return normalizedValue === "1" || normalizedValue === "true";
}

async function run(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const commandSpec = createCommandSpec(command, args);
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

async function buildDevUtils() {
  await run(process.execPath, [
    resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    "./packages/dev-utils/tsconfig.json",
  ]);
}

async function buildSlimclaw() {
  await run(process.execPath, [
    resolve(repoRoot, "packages", "slimclaw", "build.mjs"),
  ]);
}

if (isTruthy(process.env.NEXU_SKIP_RUNTIME_POSTINSTALL)) {
  console.log(
    "Skipping runtime postinstall via NEXU_SKIP_RUNTIME_POSTINSTALL.",
  );
  process.exit(0);
}

await buildDevUtils();
await buildSlimclaw();
