import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists } from "./utils.mjs";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const runtimeSeedRoot = path.resolve(packageRoot, "runtime-seed");

function resolveDefaultRuntimeDir() {
  return path.resolve(packageRoot, ".dist-runtime", "openclaw");
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

async function ensureRuntimeBinWrappers(runtimeDir) {
  const binDir = path.join(runtimeDir, "bin");
  await mkdir(binDir, { recursive: true });

  const cmdWrapperPath = path.join(binDir, "openclaw.cmd");
  await writeFile(
    cmdWrapperPath,
    `@ECHO off\r\nSETLOCAL\r\nIF EXIST "%~dp0..\\node.exe" (\r\n  SET "_prog=%~dp0..\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n"%_prog%" "%~dp0..\\node_modules\\openclaw\\openclaw.mjs" %*\r\n`,
    "utf8",
  );

  const shellWrapperPath = path.join(binDir, "openclaw");
  await writeFile(
    shellWrapperPath,
    `#!/bin/sh
set -eu

case "$0" in
  */*) script_parent="\${0%/*}" ;;
  *) script_parent="." ;;
esac

script_dir="$(CDPATH= cd -- "$script_parent" && pwd)"
runtime_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
entry="$runtime_root/node_modules/openclaw/openclaw.mjs"

if command -v node >/dev/null 2>&1; then
  exec node "$entry" "$@"
fi

if [ -n "\${OPENCLAW_ELECTRON_EXECUTABLE:-}" ] && [ -x "$OPENCLAW_ELECTRON_EXECUTABLE" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$OPENCLAW_ELECTRON_EXECUTABLE" "$entry" "$@"
fi

echo "openclaw wrapper could not find node or OPENCLAW_ELECTRON_EXECUTABLE" >&2
exit 1
`,
    "utf8",
  );
  await chmod(shellWrapperPath, 0o755).catch(() => null);

  const gatewayCmdWrapperPath = path.join(binDir, "openclaw-gateway.cmd");
  await writeFile(
    gatewayCmdWrapperPath,
    `@ECHO off\r\nCALL "%~dp0openclaw.cmd" gateway %*\r\n`,
    "utf8",
  );

  const gatewayShellWrapperPath = path.join(binDir, "openclaw-gateway");
  await writeFile(
    gatewayShellWrapperPath,
    `#!/bin/sh
set -eu

case "$0" in
  */*) script_parent="\${0%/*}" ;;
  *) script_parent="." ;;
esac

script_dir="$(CDPATH= cd -- "$script_parent" && pwd)"
exec "$script_dir/openclaw" gateway "$@"
`,
    "utf8",
  );
  await chmod(gatewayShellWrapperPath, 0o755).catch(() => null);
}

async function syncRuntimeSeedManifests(runtimeDir) {
  await mkdir(runtimeDir, { recursive: true });

  const packageJsonSourcePath = path.join(runtimeSeedRoot, "package.json");
  const packageJsonTargetPath = path.join(runtimeDir, "package.json");
  await copyFile(packageJsonSourcePath, packageJsonTargetPath);

  const packageLockSourcePath = path.join(runtimeSeedRoot, "package-lock.json");
  const packageLockTargetPath = path.join(runtimeDir, "package-lock.json");

  if (await exists(packageLockSourcePath)) {
    await copyFile(packageLockSourcePath, packageLockTargetPath);
    return;
  }

  if (await exists(packageLockTargetPath)) {
    await rm(packageLockTargetPath, { force: true });
  }
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
  await syncRuntimeSeedManifests(runtimeDir);
  const lockfilePath = path.join(runtimeDir, "package-lock.json");

  if (mode === "full") {
    await run(
      npmCommand,
      ["install", "--no-audit", "--no-fund", "--prefer-offline"],
      runtimeDir,
    );
    await ensureRuntimeBinWrappers(runtimeDir);
    return;
  }

  const installArgs = getPrunedInstallArgs();

  if (await exists(lockfilePath)) {
    try {
      await run(npmCommand, ["ci", ...installArgs], runtimeDir);
      await ensureRuntimeBinWrappers(runtimeDir);
      return;
    } catch (error) {
      console.warn(
        "slimclaw runtime npm ci failed, falling back to npm install --prefer-offline.",
      );
      console.warn(error instanceof Error ? error.message : String(error));
    }
  }

  await run(
    npmCommand,
    ["install", ...installArgs, "--prefer-offline"],
    runtimeDir,
  );

  await ensureRuntimeBinWrappers(runtimeDir);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? "pruned";

  if (mode !== "full" && mode !== "pruned") {
    throw new Error(`Unsupported install mode: ${mode}`);
  }

  await installRuntimeAt(resolveDefaultRuntimeDir(), mode);
}
