import { cp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getSidecarRoot,
  pathExists,
  repoRoot,
  resetDir,
} from "./lib/sidecar-paths.mjs";

const nexuRoot = repoRoot;
const webRoot = resolve(nexuRoot, "apps/web");
const webDistRoot = resolve(webRoot, "dist");
const webSidecarSourceRoot = resolve(nexuRoot, "apps/desktop/sidecars/web");
const sidecarRoot = getSidecarRoot("web");
const sidecarDistRoot = resolve(sidecarRoot, "dist");

async function ensureBuildArtifacts() {
  if (!(await pathExists(webDistRoot))) {
    throw new Error(
      "Missing web build artifact: apps/web/dist. Build web first.",
    );
  }

  if (!(await pathExists(resolve(webSidecarSourceRoot, "index.js")))) {
    throw new Error(
      "Missing web sidecar source: apps/desktop/sidecars/web/index.js",
    );
  }
}

async function prepareWebSidecar() {
  await ensureBuildArtifacts();
  await resetDir(sidecarRoot);
  await cp(webDistRoot, sidecarDistRoot, { recursive: true });
  await cp(
    resolve(webSidecarSourceRoot, "index.js"),
    resolve(sidecarRoot, "index.js"),
  );

  await writeFile(
    resolve(sidecarRoot, "package.json"),
    `${JSON.stringify({ name: "web-sidecar", private: true, type: "module" }, null, 2)}\n`,
  );
}

await prepareWebSidecar();
