import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function isTruthy(value) {
  if (!value) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();
  return normalizedValue === "1" || normalizedValue === "true";
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function run(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
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

async function installOpenClawRuntime() {
  await run(npmCommand, [
    "--prefix",
    "./openclaw-runtime",
    "run",
    "install:cached",
  ]);
}

async function installWeixinRuntimePlugin() {
  const pluginRoot = resolve(
    repoRoot,
    "apps/controller/static/runtime-plugins/openclaw-weixin",
  );
  const pluginLockfilePath = resolve(pluginRoot, "package-lock.json");

  if (await pathExists(pluginLockfilePath)) {
    await run(npmCommand, [
      "--prefix",
      "./apps/controller/static/runtime-plugins/openclaw-weixin",
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
    return;
  }

  await run(npmCommand, [
    "--prefix",
    "./apps/controller/static/runtime-plugins/openclaw-weixin",
    "install",
    "--production",
    "--ignore-scripts",
    "--prefer-offline",
    "--no-audit",
    "--no-fund",
  ]);
}

if (isTruthy(process.env.NEXU_SKIP_RUNTIME_POSTINSTALL)) {
  console.log(
    "Skipping runtime postinstall via NEXU_SKIP_RUNTIME_POSTINSTALL.",
  );
  process.exit(0);
}

await installOpenClawRuntime();
await installWeixinRuntimePlugin();
