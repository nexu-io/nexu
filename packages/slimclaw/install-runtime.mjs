import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists } from "./utils.mjs";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, "..", "..");

function resolveDefaultRuntimeDir() {
  return path.resolve(repoRoot, "openclaw-runtime");
}

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

function getPrunedInstallArgs() {
  return ["--omit=peer", "--no-audit", "--no-fund"];
}

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const commandSpec = createCommandSpec(command, args);
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd,
      stdio: "inherit",
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

export async function installRuntimeAt(runtimeDir, mode = "pruned") {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const lockfilePath = path.join(runtimeDir, "package-lock.json");

  if (mode === "full") {
    await run(
      npmCommand,
      ["install", "--no-audit", "--no-fund", "--prefer-offline"],
      runtimeDir,
    );
    return;
  }

  const installArgs = getPrunedInstallArgs();

  if (await exists(lockfilePath)) {
    try {
      await run(npmCommand, ["ci", ...installArgs], runtimeDir);
      return;
    } catch (error) {
      console.warn(
        "openclaw-runtime npm ci failed, falling back to npm install --prefer-offline.",
      );
      console.warn(error instanceof Error ? error.message : String(error));
    }
  }

  await run(
    npmCommand,
    ["install", ...installArgs, "--prefer-offline"],
    runtimeDir,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? "pruned";

  if (mode !== "full" && mode !== "pruned") {
    throw new Error(`Unsupported install mode: ${mode}`);
  }

  await installRuntimeAt(resolveDefaultRuntimeDir(), mode);
}
