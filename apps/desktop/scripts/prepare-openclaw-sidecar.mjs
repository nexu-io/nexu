import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pruneOpenclawPackage } from "./lib/prune-openclaw-package.mjs";
import {
  electronRoot,
  getSidecarRoot,
  linkOrCopyDirectory,
  pathExists,
  removePathIfExists,
  resetDir,
} from "./lib/sidecar-paths.mjs";

const openclawRoot = resolve(electronRoot, "node_modules/openclaw");
const sidecarRoot = getSidecarRoot("openclaw");
const sidecarBinDir = resolve(sidecarRoot, "bin");
const sidecarNodeModules = resolve(sidecarRoot, "node_modules");
const electronNodeModules = resolve(electronRoot, "node_modules");
const packagedOpenclawEntry = resolve(
  sidecarNodeModules,
  "openclaw/openclaw.mjs",
);

async function prepareOpenclawSidecar() {
  if (!(await pathExists(openclawRoot))) {
    throw new Error(
      `Electron OpenClaw dependency not found at ${openclawRoot}. Install electron dependencies first.`,
    );
  }

  await resetDir(sidecarRoot);
  await mkdir(sidecarBinDir, { recursive: true });
  await linkOrCopyDirectory(electronNodeModules, sidecarNodeModules);
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
