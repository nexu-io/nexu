import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resetDir } from "./lib/sidecar-paths.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");
const repoRoot =
  process.env.NEXU_WORKSPACE_ROOT ?? resolve(electronRoot, "../..");
const releaseRuntimeRoot = resolve(electronRoot, ".dist-runtime");
const isRelease = process.argv.includes("--release");

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
    });

    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "null"}.`,
        ),
      );
    });
  });
}

async function main() {
  const env = {
    ...process.env,
    NEXU_WORKSPACE_ROOT: repoRoot,
  };

  if (isRelease) {
    await resetDir(releaseRuntimeRoot);
    env.NEXU_DESKTOP_SIDECAR_OUT_DIR = releaseRuntimeRoot;
    env.NEXU_DESKTOP_COPY_RUNTIME_DEPS = "true";
  }

  const scripts = [
    "prepare:controller-sidecar",
    "prepare:openclaw-sidecar",
    "prepare:web-sidecar",
  ];

  for (const script of scripts) {
    await run("pnpm", ["run", script], {
      cwd: electronRoot,
      env,
    });
  }
}

await main();
