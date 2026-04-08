const { spawn } = require("node:child_process");
const { access, readFile, rename, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
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

async function run(command, args, runtimeDir) {
  await new Promise((resolve, reject) => {
    const commandSpec = createCommandSpec(command, args);
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: runtimeDir,
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

async function installRepoLocalOpenClawRuntime({
  runtimeDir,
  mode = "pruned",
  logger = console,
}) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  if (mode === "full") {
    await run(
      npmCommand,
      ["install", "--no-audit", "--no-fund", "--prefer-offline"],
      runtimeDir,
    );
    return;
  }

  const lockfilePath = path.join(runtimeDir, "package-lock.json");
  const installArgs = getPrunedInstallArgs();

  if (await exists(lockfilePath)) {
    try {
      await run(npmCommand, ["ci", ...installArgs], runtimeDir);
      return;
    } catch (error) {
      logger.warn(
        "openclaw-runtime npm ci failed, falling back to npm install --prefer-offline.",
      );
      logger.warn(error instanceof Error ? error.message : String(error));
    }
  }

  await run(
    npmCommand,
    ["install", ...installArgs, "--prefer-offline"],
    runtimeDir,
  );
}

async function refreshRepoLocalOpenClawRuntimeLock({
  runtimeDir,
  pruneTargets,
  logger = console,
}) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  await run(npmCommand, ["install"], runtimeDir);
  await pruneOpenClawRuntimePaths({
    runtimeDir,
    pruneTargets,
    dryRun: false,
    logger,
  });
}

async function cleanRepoLocalOpenClawRuntimeNodeModules({
  runtimeDir,
  dryRun = false,
  logger = console,
}) {
  const nodeModulesDir = path.join(runtimeDir, "node_modules");

  if (!(await exists(nodeModulesDir))) {
    logger.log("node_modules does not exist, nothing to clean.");
    return { removed: false, reason: "missing", nodeModulesDir };
  }

  if (dryRun) {
    logger.log(`Would remove ${nodeModulesDir}`);
    return { removed: false, reason: "dry-run", nodeModulesDir };
  }

  await rm(nodeModulesDir, { recursive: true, force: true });
  logger.log(`Removed ${nodeModulesDir}`);
  return { removed: true, reason: "removed", nodeModulesDir };
}

async function pruneOpenClawRuntimePaths({
  runtimeDir,
  pruneTargets,
  dryRun = false,
  logger = console,
}) {
  if (pruneTargets.length === 0) {
    logger.log("No prune targets configured.");
    return { removedCount: 0, results: [] };
  }

  let removedCount = 0;

  const results = await Promise.all(
    pruneTargets.map(async (relativePath) => {
      const absolutePath = path.resolve(runtimeDir, relativePath);
      const relativeDisplayPath =
        path.relative(runtimeDir, absolutePath) || ".";

      if (!absolutePath.startsWith(runtimeDir)) {
        throw new Error(
          `Refusing to prune outside runtime directory: ${relativePath}`,
        );
      }

      if (!(await exists(absolutePath))) {
        return { action: "skip", relativeDisplayPath };
      }

      if (dryRun) {
        return { action: "dry-run", relativeDisplayPath };
      }

      await rm(absolutePath, { recursive: true, force: true });
      return { action: "removed", relativeDisplayPath };
    }),
  );

  for (const result of results) {
    if (result.action === "skip") {
      logger.log(`Skip missing ${result.relativeDisplayPath}`);
      continue;
    }

    if (result.action === "dry-run") {
      logger.log(`Would remove ${result.relativeDisplayPath}`);
      removedCount += 1;
      continue;
    }

    logger.log(`Removed ${result.relativeDisplayPath}`);
    removedCount += 1;
  }

  if (removedCount === 0) {
    logger.log("No configured prune targets were present.");
    return { removedCount, results };
  }

  logger.log(
    `${dryRun ? "Would prune" : "Pruned"} ${removedCount} path${removedCount === 1 ? "" : "s"}.`,
  );

  return { removedCount, results };
}

async function readCachedFingerprint(cacheFilePath) {
  if (!(await exists(cacheFilePath))) {
    return null;
  }

  try {
    const content = await readFile(cacheFilePath, "utf8");
    const parsed = JSON.parse(content);
    return typeof parsed.fingerprint === "string" ? parsed.fingerprint : null;
  } catch {
    return null;
  }
}

async function hasCompleteRuntimeInstall({ runtimeDir, criticalRuntimeFiles }) {
  for (const relativePath of criticalRuntimeFiles) {
    if (!(await exists(path.join(runtimeDir, relativePath)))) {
      return false;
    }
  }

  return true;
}

async function writeRuntimeCacheFile({ cacheFilePath, fingerprint }) {
  const tempCacheFilePath = `${cacheFilePath}.tmp`;
  await writeFile(
    tempCacheFilePath,
    `${JSON.stringify(
      {
        fingerprint,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await rename(tempCacheFilePath, cacheFilePath);
}

async function runRepoLocalOpenClawRuntimePostinstall({
  runtimeDir,
  nodeModulesDir,
  cacheFilePath,
  criticalRuntimeFiles,
  pruneTargets,
  fingerprint,
  logger = console,
}) {
  const cachedFingerprint = await readCachedFingerprint(cacheFilePath);
  const hasNodeModules = await exists(nodeModulesDir);
  const hasCompleteRuntime = hasNodeModules
    ? await hasCompleteRuntimeInstall({ runtimeDir, criticalRuntimeFiles })
    : false;

  if (
    hasNodeModules &&
    hasCompleteRuntime &&
    cachedFingerprint === fingerprint
  ) {
    logger.log("openclaw-runtime unchanged, skipping install:pruned.");
    return { skipped: true, reason: "unchanged" };
  }

  if (!hasNodeModules) {
    logger.log(
      "openclaw-runtime node_modules missing, running install:pruned.",
    );
  } else if (!hasCompleteRuntime) {
    logger.log(
      "openclaw-runtime critical files missing, running install:pruned.",
    );
  } else if (cachedFingerprint === null) {
    logger.log("openclaw-runtime cache missing, running install:pruned.");
  } else {
    logger.log("openclaw-runtime inputs changed, running install:pruned.");
  }

  await installRepoLocalOpenClawRuntime({
    runtimeDir,
    mode: "pruned",
    logger,
  });
  await pruneOpenClawRuntimePaths({
    runtimeDir,
    pruneTargets,
    dryRun: false,
    logger,
  });
  await writeRuntimeCacheFile({ cacheFilePath, fingerprint });

  logger.log("openclaw-runtime cache updated.");
  return { skipped: false, reason: "updated" };
}

module.exports = {
  cleanRepoLocalOpenClawRuntimeNodeModules,
  installRepoLocalOpenClawRuntime,
  pruneOpenClawRuntimePaths,
  refreshRepoLocalOpenClawRuntimeLock,
  runRepoLocalOpenClawRuntimePostinstall,
};
