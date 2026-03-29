import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resetDir } from "./lib/sidecar-paths.mjs";
import { resolvePnpmCommand } from "./platforms/filesystem-compat.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");
const repoRoot =
  process.env.NEXU_WORKSPACE_ROOT ?? resolve(electronRoot, "../..");
const releaseRuntimeRoot = resolve(electronRoot, ".dist-runtime");
const isRelease = process.argv.includes("--release");
const pnpmCommand = resolvePnpmCommand({
  env: process.env,
  platform: process.platform,
});

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

function formatDurationMs(durationMs) {
  return `${(durationMs / 1000).toFixed(3)}s`;
}

async function timedStep(stepName, fn) {
  const startedAt = performance.now();
  console.log(`[prepare-runtime-sidecars][timing] start ${stepName}`);
  try {
    return await fn();
  } finally {
    const durationMs = performance.now() - startedAt;
    console.log(
      `[prepare-runtime-sidecars][timing] done ${stepName} duration=${formatDurationMs(durationMs)}`,
    );
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const commandSpec = createCommandSpec(command, args);
    const child = spawn(commandSpec.command, commandSpec.args, {
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
          `${commandSpec.command} ${commandSpec.args.join(" ")} exited with code ${code ?? "null"}.`,
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
    await timedStep("reset release runtime root", async () => {
      await resetDir(releaseRuntimeRoot);
    });
    env.NEXU_DESKTOP_SIDECAR_OUT_DIR = releaseRuntimeRoot;
    env.NEXU_DESKTOP_COPY_RUNTIME_DEPS = "true";
  }

  const scripts = [
    "prepare:controller-sidecar",
    "prepare:openclaw-sidecar",
    "prepare:web-sidecar",
  ];

  for (const script of scripts) {
    await timedStep(script, async () => {
      await run(pnpmCommand, ["run", script], {
        cwd: electronRoot,
        env,
      });
    });
  }
}

await main();
