import { chmod, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");
const repoRoot =
  process.env.NEXU_WORKSPACE_ROOT ?? resolve(electronRoot, "../..");
const openclawRoot = resolve(electronRoot, "node_modules/openclaw");
const sidecarRoot = resolve(repoRoot, ".tmp/sidecars/openclaw");
const sidecarBinDir = resolve(sidecarRoot, "bin");

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function prepareOpenclawSidecar() {
  if (!(await pathExists(openclawRoot))) {
    throw new Error(
      `Electron OpenClaw dependency not found at ${openclawRoot}. Install electron dependencies first.`,
    );
  }

  await rm(sidecarRoot, { recursive: true, force: true });
  await mkdir(sidecarBinDir, { recursive: true });

  // Keep the first pass lightweight: the sidecar wrapper delegates into the Electron-installed
  // OpenClaw package instead of copying a very large runtime tree into `.tmp` on every cold start.
  const wrapperPath = resolve(sidecarBinDir, "openclaw");
  await writeFile(
    wrapperPath,
    `#!/usr/bin/env bash
set -euo pipefail
exec node "${resolve(openclawRoot, "openclaw.mjs")}" "$@"
`,
  );
  await chmod(wrapperPath, 0o755);

  await writeFile(
    resolve(sidecarBinDir, "openclaw.cmd"),
    `@echo off\r\nnode "${resolve(openclawRoot, "openclaw.mjs")}" %*\r\n`,
  );

  await writeFile(
    resolve(sidecarRoot, "metadata.json"),
    `${JSON.stringify(
      {
        strategy: "electron-dependency",
        openclawRoot,
      },
      null,
      2,
    )}\n`,
  );
}

await prepareOpenclawSidecar();
