import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");
const repoRoot =
  process.env.NEXU_WORKSPACE_ROOT ?? resolve(electronRoot, "../..");
const isUnsigned =
  process.argv.includes("--unsigned") ||
  process.env.NEXU_DESKTOP_MAC_UNSIGNED === "1" ||
  process.env.NEXU_DESKTOP_MAC_UNSIGNED?.toLowerCase() === "true";
const dmgBuilderReleaseName = "dmg-builder@1.2.0";
const dmgBuilderReleaseVersion = "75c8a6c";
const dmgBuilderArch = process.arch === "arm64" ? "arm64" : "x86_64";
const dmgBuilderArchiveName = `dmgbuild-bundle-${dmgBuilderArch}-${dmgBuilderReleaseVersion}.tar.gz`;
const dmgBuilderChecksum = {
  arm64: "a785f2a385c8c31996a089ef8e26361904b40c772d5ea65a36001212f1fc25e0",
  x86_64: "87b3bb72148b11451ee90ede79cc8d59305c9173b68b0f2b50a3bea51fc4a4e2",
}[dmgBuilderArch];

const rmWithRetriesOptions = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
};

function parseEnvFile(content) {
  const values = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

async function loadDesktopEnv() {
  const envPath = resolve(electronRoot, ".env.local");

  try {
    const content = await readFile(envPath, "utf8");
    return parseEnvFile(content);
  } catch {
    return {};
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
    });

    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "null"}.`,
        ),
      );
    });
  });
}

async function ensureDmgbuildBundle() {
  if (process.env.CUSTOM_DMGBUILD_PATH) {
    return process.env.CUSTOM_DMGBUILD_PATH;
  }

  const cacheRoot = resolve(electronRoot, ".cache", dmgBuilderReleaseName);
  const extractDir = resolve(
    cacheRoot,
    dmgBuilderArchiveName.replace(/\.(tar\.gz|tgz)$/u, ""),
  );
  const dmgbuildPath = resolve(extractDir, "dmgbuild");
  const archivePath = resolve(cacheRoot, dmgBuilderArchiveName);
  const url = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${dmgBuilderReleaseName}/${dmgBuilderArchiveName}`;

  try {
    await readFile(dmgbuildPath);
    return dmgbuildPath;
  } catch {
    // Download below.
  }

  await rm(extractDir, rmWithRetriesOptions);
  await mkdir(cacheRoot, { recursive: true });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const archiveBuffer = Buffer.from(await response.arrayBuffer());
  const archiveHash = createHash("sha256").update(archiveBuffer).digest("hex");

  if (archiveHash !== dmgBuilderChecksum) {
    throw new Error(
      `Unexpected SHA-256 for ${dmgBuilderArchiveName}: ${archiveHash}`,
    );
  }

  await writeFile(archivePath, archiveBuffer);
  await mkdir(extractDir, { recursive: true });
  await run("tar", [
    "-xzf",
    archivePath,
    "-C",
    extractDir,
    "--strip-components",
    "1",
  ]);

  return dmgbuildPath;
}

async function main() {
  const desktopEnv = await loadDesktopEnv();
  const env = {
    ...process.env,
    ...desktopEnv,
    NEXU_WORKSPACE_ROOT: repoRoot,
  };
  const {
    APPLE_ID: appleId,
    APPLE_APP_SPECIFIC_PASSWORD: appleAppSpecificPassword,
    APPLE_TEAM_ID: appleTeamId,
    ...notarizeEnv
  } = env;

  if (appleId) {
    notarizeEnv.NEXU_APPLE_ID = appleId;
  }

  if (appleAppSpecificPassword) {
    notarizeEnv.NEXU_APPLE_APP_SPECIFIC_PASSWORD = appleAppSpecificPassword;
  }

  if (appleTeamId) {
    notarizeEnv.NEXU_APPLE_TEAM_ID = appleTeamId;
  }

  const webPort = process.env.NEXU_WEB_PORT ?? "50810";

  await rm(resolve(electronRoot, "release"), rmWithRetriesOptions);
  await rm(resolve(electronRoot, ".dist-runtime"), rmWithRetriesOptions);

  await run("pnpm", ["--dir", repoRoot, "--filter", "@nexu/shared", "build"], {
    env,
  });
  await run("pnpm", ["--dir", repoRoot, "--filter", "@nexu/api", "build"], {
    env,
  });
  await run("pnpm", ["--dir", repoRoot, "--filter", "@nexu/gateway", "build"], {
    env,
  });
  await run("pnpm", ["--dir", repoRoot, "openclaw-runtime:install"], {
    env,
  });
  await run("pnpm", ["--dir", repoRoot, "--filter", "@nexu/web", "build"], {
    env: {
      ...env,
      VITE_AUTH_BASE_URL: `http://127.0.0.1:${webPort}`,
    },
  });
  await run("pnpm", ["run", "build"], { cwd: electronRoot, env });
  await run(
    "node",
    [resolve(scriptDir, "prepare-runtime-sidecars.mjs"), "--release"],
    {
      cwd: electronRoot,
      env,
    },
  );
  env.CUSTOM_DMGBUILD_PATH = await ensureDmgbuildBundle();
  await run(
    "pnpm",
    [
      "exec",
      "electron-builder",
      "--mac",
      "--publish",
      "never",
      ...(isUnsigned
        ? ["--config.mac.identity=null", "--config.mac.hardenedRuntime=false"]
        : []),
    ],
    {
      cwd: electronRoot,
      env: isUnsigned
        ? {
            ...notarizeEnv,
            CSC_IDENTITY_AUTO_DISCOVERY: "false",
            NEXU_DESKTOP_MAC_UNSIGNED: "true",
          }
        : notarizeEnv,
    },
  );
}

await main();
