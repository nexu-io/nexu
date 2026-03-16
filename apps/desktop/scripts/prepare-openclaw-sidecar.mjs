import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pruneOpenclawPackage } from "./lib/prune-openclaw-package.mjs";
import {
  getSidecarRoot,
  linkOrCopyDirectory,
  pathExists,
  removePathIfExists,
  repoRoot,
  resetDir,
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
  await pruneOpenclawPackage(sidecarNodeModules);
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
    `#!/usr/bin/env bash
set -euo pipefail
exec node "${packagedOpenclawEntry}" "$@"
`,
  );
  await chmod(wrapperPath, 0o755);
}

await prepareOpenclawSidecar();
