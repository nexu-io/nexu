import { chmod, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");
const repoRoot =
  process.env.NEXU_WORKSPACE_ROOT ?? resolve(electronRoot, "../..");
const openclawRoot = resolve(
  repoRoot,
  "openclaw-runtime/node_modules/openclaw",
);
const sidecarRoot = resolve(repoRoot, ".tmp/sidecars/openclaw");
const sidecarBinDir = resolve(sidecarRoot, "bin");
const openclawWrapperPath = resolve(repoRoot, "openclaw-wrapper");

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
      `Repo-local OpenClaw runtime not found at ${openclawRoot}. Run pnpm install first.`,
    );
  }

  if (!(await pathExists(openclawWrapperPath))) {
    throw new Error(
      `Repo-local OpenClaw wrapper not found at ${openclawWrapperPath}.`,
    );
  }

  await rm(sidecarRoot, { recursive: true, force: true });
  await mkdir(sidecarBinDir, { recursive: true });

  // Keep the first pass lightweight: the sidecar wrapper delegates into the repo-local
  // OpenClaw runtime instead of copying a very large runtime tree into `.tmp` on every cold start.
  const wrapperPath = resolve(sidecarBinDir, "openclaw");
  await writeFile(
    wrapperPath,
    `#!/usr/bin/env bash
set -euo pipefail
exec "${openclawWrapperPath}" "$@"
`,
  );
  await chmod(wrapperPath, 0o755);

  await writeFile(
    resolve(sidecarBinDir, "openclaw.cmd"),
    `@echo off\r\n"${openclawWrapperPath}" %*\r\n`,
  );

  await writeFile(
    resolve(sidecarRoot, "metadata.json"),
    `${JSON.stringify(
      {
        strategy: "repo-local-runtime",
        openclawRoot,
        openclawWrapperPath,
      },
      null,
      2,
    )}\n`,
  );
}

await prepareOpenclawSidecar();
