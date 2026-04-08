const { createHash } = require("node:crypto");
const { access, readFile } = require("node:fs/promises");
const path = require("node:path");

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

const runtimeDir = __dirname;

const cacheFileName = ".postinstall-cache.json";

const criticalRuntimeFiles = [
  path.join("node_modules", "openclaw", "dist"),
  path.join("node_modules", "@whiskeysockets", "baileys", "lib", "index.js"),
  path.join(
    "node_modules",
    "@whiskeysockets",
    "baileys",
    "WAProto",
    "index.js",
  ),
  path.join("node_modules", "@whiskeysockets", "baileys", "package.json"),
];

const clipboardNativeTargets = [
  "node_modules/@mariozechner/clipboard-darwin-arm64/clipboard.darwin-arm64.node",
  "node_modules/@mariozechner/clipboard-darwin-x64/clipboard.darwin-x64.node",
  "node_modules/@mariozechner/clipboard-darwin-universal/clipboard.darwin-universal.node",
];

const daveyNativeTargets = [
  "node_modules/@snazzah/davey-darwin-arm64/davey.darwin-arm64.node",
  "node_modules/@snazzah/davey-darwin-x64/davey.darwin-x64.node",
  "node_modules/@snazzah/davey-darwin-universal/davey.darwin-universal.node",
];

const shouldPruneDavey = process.env.NEXU_OPENCLAW_PRUNE_DAVEY === "1";

const pruneDependencyTargets = [
  "node_modules/koffi",
  "node_modules/node-llama-cpp",
  "node_modules/@node-llama-cpp",
  "node_modules/@mistralai",
  "node_modules/@octokit",
  "node_modules/octokit",
  "node_modules/@cloudflare",
  "node_modules/bun-types",
  "node_modules/simple-git",
  "node_modules/ipull",
  "node_modules/fast-xml-builder",
  "node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node",
  "node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.17.3.dylib",
  "node_modules/@lydell/node-pty-darwin-arm64/prebuilds/darwin-arm64/pty.node",
  "node_modules/@lydell/node-pty-darwin-arm64/prebuilds/darwin-arm64/spawn-helper",
  ...clipboardNativeTargets,
  "node_modules/@reflink/reflink-darwin-arm64/reflink.darwin-arm64.node",
  ...(shouldPruneDavey ? daveyNativeTargets : []),
  "node_modules/sqlite-vec-darwin-arm64/vec0.dylib",
];

const docsPruneTargets = [
  "node_modules/@mariozechner/pi-coding-agent/docs",
  "node_modules/pino/docs",
  "node_modules/smart-buffer/docs",
  "node_modules/socks/docs",
  "node_modules/undici/docs",
  "node_modules/openclaw/docs/assets",
  "node_modules/openclaw/docs/images",
  "node_modules/openclaw/docs/zh-CN",
  "node_modules/openclaw/docs/ja-JP",
];

const pruneTargets = [...pruneDependencyTargets, ...docsPruneTargets];

const runtimeCacheInputs = [
  "package.json",
  "package-lock.json",
  "clean-node-modules.mjs",
  "install-runtime.mjs",
  "postinstall.mjs",
  "postinstall-cache.mjs",
  "prune-runtime.mjs",
  "prune-runtime-paths.mjs",
  "refresh-lock.mjs",
];

const packageCacheInputs = ["runtime-maintenance.cjs", "runtime-policy.cjs"];

const cacheInputs = runtimeCacheInputs;

const cacheEnvInputs = ["NEXU_OPENCLAW_PRUNE_DAVEY"];

async function computeFingerprint(runtimeDirPath) {
  const hash = createHash("sha256");
  hash.update(process.platform);
  hash.update("\0");
  hash.update(process.arch);
  hash.update("\0");
  hash.update(process.version);
  hash.update("\0");

  for (const envName of cacheEnvInputs) {
    hash.update(envName);
    hash.update("\0");
    hash.update(process.env[envName] ?? "<unset>");
    hash.update("\0");
  }

  for (const relativePath of runtimeCacheInputs) {
    const absolutePath = path.join(runtimeDirPath, relativePath);
    hash.update(`runtime:${relativePath}`);
    hash.update("\0");

    if (await exists(absolutePath)) {
      hash.update(await readFile(absolutePath));
    } else {
      hash.update("<missing>");
    }

    hash.update("\0");
  }

  for (const relativePath of packageCacheInputs) {
    const absolutePath = path.join(runtimeDir, relativePath);
    hash.update(`package:${relativePath}`);
    hash.update("\0");

    if (await exists(absolutePath)) {
      hash.update(await readFile(absolutePath));
    } else {
      hash.update("<missing>");
    }

    hash.update("\0");
  }

  return hash.digest("hex");
}

module.exports = {
  cacheEnvInputs,
  cacheFileName,
  cacheInputs,
  computeFingerprint,
  criticalRuntimeFiles,
  docsPruneTargets,
  packageCacheInputs,
  pruneDependencyTargets,
  pruneTargets,
  runtimeCacheInputs,
};
