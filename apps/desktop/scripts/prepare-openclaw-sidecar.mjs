import { spawn } from "node:child_process";
import { chmod, mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  electronRoot,
  getSidecarRoot,
  linkOrCopyDirectory,
  pathExists,
  removePathIfExists,
  repoRoot,
  resetDir,
  shouldCopyRuntimeDependencies,
} from "./lib/sidecar-paths.mjs";

const openclawRuntimeRoot = resolve(repoRoot, "openclaw-runtime");
const openclawRuntimeNodeModules = resolve(openclawRuntimeRoot, "node_modules");
const openclawRoot = resolve(openclawRuntimeNodeModules, "openclaw");
const sidecarRoot = getSidecarRoot("openclaw");
const sidecarBinDir = resolve(sidecarRoot, "bin");
const sidecarNodeModules = resolve(sidecarRoot, "node_modules");
const packagedOpenclawEntry = resolve(
  sidecarNodeModules,
  "openclaw/openclaw.mjs",
);
const inheritEntitlementsPath = resolve(
  electronRoot,
  "build/entitlements.mac.inherit.plist",
);

function formatDurationMs(durationMs) {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? electronRoot,
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

async function runAndCapture(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: options.cwd ?? electronRoot,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }

      rejectRun(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "null"}. ${stderr}`,
        ),
      );
    });
  });
}

async function collectFiles(rootPath) {
  const files = [];
  const entries = await readdir(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = resolve(rootPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function resolveCodesignIdentity() {
  const { stdout } = await runAndCapture("security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ]);
  const identityLine = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.includes("Developer ID Application:"));

  if (!identityLine) {
    throw new Error(
      "Unable to locate a Developer ID Application signing identity.",
    );
  }

  const match = identityLine.match(/"([^"]+)"/u);
  if (!match) {
    throw new Error(`Unable to parse signing identity from: ${identityLine}`);
  }

  return match[1];
}

function getSigningCertificatePath() {
  const link = process.env.CSC_LINK;

  if (!link) {
    return null;
  }

  return link.startsWith("file://") ? fileURLToPath(link) : link;
}

async function ensureCodesignIdentity() {
  try {
    return await resolveCodesignIdentity();
  } catch {
    const certificatePath = getSigningCertificatePath();
    const certificatePassword = process.env.CSC_KEY_PASSWORD;

    if (!certificatePath || !certificatePassword) {
      throw new Error(
        "Unable to locate a Developer ID Application signing identity.",
      );
    }

    const keychainPath = resolve(tmpdir(), "nexu-openclaw-signing.keychain-db");
    const keychainPassword = "nexu-openclaw-signing";

    await run("security", [
      "create-keychain",
      "-p",
      keychainPassword,
      keychainPath,
    ]).catch(() => null);
    await run("security", [
      "set-keychain-settings",
      "-lut",
      "21600",
      keychainPath,
    ]);
    await run("security", [
      "unlock-keychain",
      "-p",
      keychainPassword,
      keychainPath,
    ]);
    await run("security", [
      "import",
      certificatePath,
      "-k",
      keychainPath,
      "-P",
      certificatePassword,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
    ]);
    await run("security", [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      keychainPassword,
      keychainPath,
    ]);

    const { stdout: keychainsOutput } = await runAndCapture("security", [
      "list-keychains",
      "-d",
      "user",
    ]);
    const keychains = keychainsOutput
      .split(/\r?\n/u)
      .map((line) => line.trim().replace(/^"|"$/gu, ""))
      .filter(Boolean);
    if (!keychains.includes(keychainPath)) {
      await run("security", [
        "list-keychains",
        "-d",
        "user",
        "-s",
        keychainPath,
        ...keychains,
      ]);
    }

    return await resolveCodesignIdentity();
  }
}

async function signOpenclawNativeBinaries() {
  if (process.platform !== "darwin") {
    return;
  }

  const unsignedMode =
    process.env.NEXU_DESKTOP_MAC_UNSIGNED === "1" ||
    process.env.NEXU_DESKTOP_MAC_UNSIGNED === "true";

  if (unsignedMode || !shouldCopyRuntimeDependencies()) {
    return;
  }

  const startedAt = Date.now();
  const identity = await ensureCodesignIdentity();
  const files = await collectFiles(sidecarRoot);
  let machOCount = 0;

  console.log(
    `[openclaw-sidecar] scanning ${files.length} files for native binaries`,
  );

  for (const filePath of files) {
    const { stdout } = await runAndCapture("file", ["-b", filePath]);
    const description = stdout.trim();
    const isMachO = description.includes("Mach-O");

    if (!isMachO) {
      continue;
    }

    machOCount += 1;

    const isExecutable =
      description.includes("executable") || description.includes("bundle");
    const args = [
      "--force",
      "--sign",
      identity,
      "--timestamp",
      "--entitlements",
      inheritEntitlementsPath,
      ...(isExecutable ? ["--options", "runtime"] : []),
      filePath,
    ];
    await run("codesign", args);
  }

  console.log(
    `[openclaw-sidecar] signed ${machOCount} native binaries in ${formatDurationMs(
      Date.now() - startedAt,
    )}`,
  );
}

async function prepareOpenclawSidecar() {
  if (!(await pathExists(openclawRoot))) {
    throw new Error(
      `OpenClaw runtime dependency not found at ${openclawRoot}. Run pnpm openclaw-runtime:install first.`,
    );
  }

  await resetDir(sidecarRoot);
  await mkdir(sidecarBinDir, { recursive: true });
  await linkOrCopyDirectory(openclawRuntimeNodeModules, sidecarNodeModules);
  await removePathIfExists(resolve(sidecarNodeModules, "electron"));
  await removePathIfExists(resolve(sidecarNodeModules, "electron-builder"));
  await chmod(packagedOpenclawEntry, 0o755).catch(() => null);
  await writeFile(
    resolve(sidecarRoot, "package.json"),
    '{\n  "name": "openclaw-sidecar",\n  "private": true\n}\n',
  );
  await writeFile(
    resolve(sidecarRoot, "metadata.json"),
    `${JSON.stringify(
      {
        strategy: "sidecar-node-modules",
        openclawEntry: packagedOpenclawEntry,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    resolve(sidecarBinDir, "openclaw.cmd"),
    `@echo off\r\nnode "${packagedOpenclawEntry}" %*\r\n`,
  );

  const wrapperPath = resolve(sidecarBinDir, "openclaw");
  await writeFile(
    wrapperPath,
    `#!/bin/sh
set -eu

case "$0" in
  */*) script_parent="\${0%/*}" ;;
  *) script_parent="." ;;
esac

script_dir="$(CDPATH= cd -- "$script_parent" && pwd)"
sidecar_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
entry="$sidecar_root/node_modules/openclaw/openclaw.mjs"

if command -v node >/dev/null 2>&1; then
  exec node "$entry" "$@"
fi

if [ -n "\${OPENCLAW_ELECTRON_EXECUTABLE:-}" ] && [ -x "$OPENCLAW_ELECTRON_EXECUTABLE" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$OPENCLAW_ELECTRON_EXECUTABLE" "$entry" "$@"
fi

contents_dir="$(CDPATH= cd -- "$sidecar_root/../../.." && pwd)"
macos_dir="$contents_dir/MacOS"

if [ -d "$macos_dir" ]; then
  for candidate in "$macos_dir"/*; do
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then
      ELECTRON_RUN_AS_NODE=1 exec "$candidate" "$entry" "$@"
    fi
  done
fi

echo "openclaw launcher could not find node or a bundled Electron executable" >&2
exit 127
`,
  );
  await chmod(wrapperPath, 0o755);
  await signOpenclawNativeBinaries();

  if (shouldCopyRuntimeDependencies()) {
    const archivePath = resolve(
      dirname(sidecarRoot),
      "openclaw-sidecar.tar.gz",
    );
    await removePathIfExists(archivePath);
    await run("tar", ["-czf", archivePath, "-C", sidecarRoot, "."]);
    await resetDir(sidecarRoot);
    await writeFile(
      resolve(sidecarRoot, "archive.json"),
      `${JSON.stringify(
        {
          format: "tar.gz",
          path: "payload.tar.gz",
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      resolve(sidecarRoot, "package.json"),
      '{\n  "name": "openclaw-sidecar",\n  "private": true\n}\n',
    );
    await rename(archivePath, resolve(sidecarRoot, "payload.tar.gz"));
  }
}

await prepareOpenclawSidecar();
