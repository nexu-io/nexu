import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installRuntime } from "./install-runtime.mjs";
import { computeFingerprint } from "./postinstall-cache.mjs";
import { exists } from "./utils.mjs";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const nodeModulesDir = path.join(runtimeDir, "node_modules");
const cacheFileName = ".postinstall-cache.json";
const cacheFilePath = path.join(runtimeDir, cacheFileName);
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

async function hasCompleteRuntimeInstall() {
  for (const relativePath of criticalRuntimeFiles) {
    if (!(await exists(path.join(runtimeDir, relativePath)))) {
      return false;
    }
  }
  return true;
}
try {
  const fingerprint = await computeFingerprint(runtimeDir);
  const cachedFingerprint = await readCachedFingerprint();
  const hasNodeModules = await exists(nodeModulesDir);
  const hasCompleteRuntime = hasNodeModules
    ? await hasCompleteRuntimeInstall()
    : false;

  if (
    hasNodeModules &&
    hasCompleteRuntime &&
    cachedFingerprint === fingerprint
  ) {
    console.log("openclaw-runtime unchanged, skipping install:pruned.");
    process.exit(0);
  }

  if (!hasNodeModules) {
    console.log(
      "openclaw-runtime node_modules missing, running install:pruned.",
    );
  } else if (!hasCompleteRuntime) {
    console.log(
      "openclaw-runtime critical files missing, running install:pruned.",
    );
  } else if (cachedFingerprint === null) {
    console.log("openclaw-runtime cache missing, running install:pruned.");
  } else {
    console.log("openclaw-runtime inputs changed, running install:pruned.");
  }

  await installRuntime("pruned");
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
