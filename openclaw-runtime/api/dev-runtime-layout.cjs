const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { resolveOpenClawRepoLocalLayout } = require("./repo-local-layout.cjs");

const DEV_RUNTIME_MANIFEST_FILENAME = "manifest.json";

function getRepoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function getPreparedDevOpenclawRoot() {
  return path.join(
    getRepoRoot(),
    "openclaw-runtime",
    "node_modules",
    ".nexu-dev-runtime",
  );
}

function getPreparedDevOpenclawManifestPath() {
  return path.join(getPreparedDevOpenclawRoot(), DEV_RUNTIME_MANIFEST_FILENAME);
}

async function loadPrepareOpenclawRuntimeStage() {
  const moduleUrl = pathToFileURL(
    path.join(getRepoRoot(), "packages", "dev-utils", "dist", "index.js"),
  ).href;
  const module = await import(moduleUrl);
  return module.prepareOpenclawRuntimeStage;
}

async function prepareRepoLocalDevOpenclawRuntime(options = {}) {
  const layout = resolveOpenClawRepoLocalLayout();
  const preparedRoot = getPreparedDevOpenclawRoot();
  const prepareOpenclawRuntimeStage = await loadPrepareOpenclawRuntimeStage();
  const stage = await prepareOpenclawRuntimeStage({
    sourceOpenclawRoot: layout.openclawStageSourceRootPath,
    patchRoot: layout.openclawPatchRootPath,
    targetStageRoot: preparedRoot,
    log: options.log,
  });

  return {
    preparedRoot,
    manifestPath: getPreparedDevOpenclawManifestPath(),
    entryPath: path.join(stage.stagedOpenclawRoot, "openclaw.mjs"),
    builtinExtensionsDir: path.join(stage.stagedOpenclawRoot, "extensions"),
    stagedOpenclawRoot: stage.stagedOpenclawRoot,
    sourceRoot: layout.openclawStageSourceRootPath,
    patchRoot: layout.openclawPatchRootPath,
    fingerprint: stage.fingerprint,
    patchedFileCount: stage.patchedFileCount,
    reused: stage.reused,
  };
}

async function readPreparedDevOpenclawManifest() {
  const manifestSource = await readFile(
    getPreparedDevOpenclawManifestPath(),
    "utf8",
  );
  return JSON.parse(manifestSource);
}

function resolvePreparedDevOpenclawLayout() {
  const preparedRoot = getPreparedDevOpenclawRoot();
  const stagedOpenclawRoot = path.join(preparedRoot, "openclaw");
  const manifestPath = getPreparedDevOpenclawManifestPath();
  const sourceLayout = resolveOpenClawRepoLocalLayout();

  return {
    preparedRoot,
    manifestPath,
    entryPath: path.join(stagedOpenclawRoot, "openclaw.mjs"),
    builtinExtensionsDir: path.join(stagedOpenclawRoot, "extensions"),
    stagedOpenclawRoot,
    sourceRoot: sourceLayout.openclawStageSourceRootPath,
    patchRoot: sourceLayout.openclawPatchRootPath,
    fingerprint: "",
    patchedFileCount: 0,
    reused: false,
  };
}

module.exports = {
  getPreparedDevOpenclawManifestPath,
  getPreparedDevOpenclawRoot,
  prepareRepoLocalDevOpenclawRuntime,
  readPreparedDevOpenclawManifest,
  resolvePreparedDevOpenclawLayout,
};
