import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeFingerprint } from "./postinstall-cache.mjs";
import { exists } from "./utils.mjs";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const nodeModulesDir = path.join(runtimeDir, "node_modules");
const cacheFileName = ".postinstall-cache.json";
const cacheFilePath = path.join(runtimeDir, cacheFileName);
const lockfilePath = path.join(runtimeDir, "package-lock.json");

async function readCachedFingerprint() {
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

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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

async function installRuntime() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  if (await exists(lockfilePath)) {
    try {
      await run(npmCommand, ["ci", "--no-audit", "--no-fund"]);
      return;
    } catch (error) {
      console.warn(
        "openclaw-runtime npm ci failed, falling back to npm install --prefer-offline.",
      );
      console.warn(error instanceof Error ? error.message : String(error));
    }
  }

  await run(npmCommand, [
    "install",
    "--no-audit",
    "--no-fund",
    "--prefer-offline",
  ]);
}

try {
  const fingerprint = await computeFingerprint(runtimeDir);
  const cachedFingerprint = await readCachedFingerprint();
  const hasNodeModules = await exists(nodeModulesDir);

  if (hasNodeModules && cachedFingerprint === fingerprint) {
    console.log("openclaw-runtime unchanged, skipping install:pruned.");
    process.exit(0);
  }

  if (!hasNodeModules) {
    console.log(
      "openclaw-runtime node_modules missing, running install:pruned.",
    );
  } else if (cachedFingerprint === null) {
    console.log("openclaw-runtime cache missing, running install:pruned.");
  } else {
    console.log("openclaw-runtime inputs changed, running install:pruned.");
  }

  await installRuntime();
  await run(process.execPath, ["./prune-runtime.mjs"]);

  await writeFile(
    cacheFilePath,
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

  console.log("openclaw-runtime cache updated.");
} catch (error) {
  console.error("openclaw-runtime postinstall failed.");
  throw error;
}
