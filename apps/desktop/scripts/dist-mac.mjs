import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

function shellEscape(value) {
  return `'${String(value).replace(/'/gu, `'"'"'`)}'`;
}

async function runElectronBuilder(args, options = {}) {
  const targetOpenFiles = process.env.NEXU_DESKTOP_MAX_OPEN_FILES ?? "8192";
  const command = [
    `target=${shellEscape(targetOpenFiles)}`,
    'hard_limit=$(ulimit -Hn 2>/dev/null || printf %s "$target")',
    'if [ "$hard_limit" != "unlimited" ] && [ "$hard_limit" -lt "$target" ]; then target="$hard_limit"; fi',
    'ulimit -n "$target" 2>/dev/null || true',
    `exec pnpm exec electron-builder ${args.map(shellEscape).join(" ")}`,
  ].join("; ");

  await run("bash", ["-lc", command], options);
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

async function stapleNotarizedAppBundles() {
  if (isUnsigned) {
    console.log("[dist:mac] skipping stapling in unsigned mode");
    return;
  }

  const releaseRoot = resolve(electronRoot, "release");
  const releaseEntries = await readdir(releaseRoot, { withFileTypes: true });
  const appBundleDirs = releaseEntries.filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("mac-"),
  );

  if (appBundleDirs.length === 0) {
    throw new Error(
      `Expected packaged macOS app bundles under ${releaseRoot}, but none were found.`,
    );
  }

  for (const entry of appBundleDirs) {
    const appPath = resolve(releaseRoot, entry.name, "Nexu.app");

    console.log(`[dist:mac] stapling notarized app bundle: ${appPath}`);
    await run("xcrun", ["stapler", "staple", appPath], { cwd: electronRoot });
    await run("xcrun", ["stapler", "validate", appPath], {
      cwd: electronRoot,
    });
  }
}

async function ensureBuildConfig() {
  const configPath = resolve(electronRoot, "build-config.json");

  try {
    await readFile(configPath, "utf8");
    console.log("[dist:mac] using existing build-config.json");
  } catch {
    // Create default build config (production URLs)
    const defaultConfig = {
      NEXU_CLOUD_URL: "https://nexu.io",
      NEXU_LINK_URL: null,
    };
    await writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log("[dist:mac] created default build-config.json");
  }
}

async function main() {
  await ensureBuildConfig();

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
      env: {
        ...env,
        ...(isUnsigned ? { NEXU_DESKTOP_MAC_UNSIGNED: "true" } : {}),
      },
    },
  );
  env.CUSTOM_DMGBUILD_PATH = await ensureDmgbuildBundle();
  // Use git short SHA as CFBundleVersion (shown in parentheses in About dialog).
  // Falls back to "dev" for local builds outside a git repo.
  let buildVersion = "dev";
  try {
    buildVersion = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    // Not a git repo or git not available — use fallback.
  }

  await runElectronBuilder(
    [
      "--mac",
      "--publish",
      "never",
      `--config.buildVersion=${buildVersion}`,
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
  await stapleNotarizedAppBundles();
}

await main();
