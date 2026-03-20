import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

const scriptDir = import.meta.dirname;
const electronRoot = resolve(scriptDir, "..");
const repoRoot = resolve(electronRoot, "../..");
const buildConfigPath = resolve(electronRoot, "build-config.json");
const desktopPackageJsonPath = resolve(electronRoot, "package.json");
const DEFAULT_SENTRY_ORG = "refly-ai";
const DEFAULT_SENTRY_PROJECT_BY_ENV = {
  dev: "nexu-desktop-dev",
  test: "nexu-desktop-test",
  prod: "nexu-desktop-prod",
};

function normalizeCommit(commit) {
  if (typeof commit !== "string") {
    return null;
  }

  const trimmedCommit = commit.trim();
  return trimmedCommit.length > 0 ? trimmedCommit : null;
}

function buildSentryRelease(version) {
  return `nexu-desktop@${version}`;
}

function buildSentryDist(version, commit) {
  const normalizedCommit = normalizeCommit(commit);
  if (!normalizedCommit) {
    return undefined;
  }

  return `${version.trim().replace(/[^A-Za-z0-9_.-]+/g, "-")}-${normalizedCommit.replace(/[^A-Za-z0-9_.-]+/g, "-")}`.slice(
    0,
    64,
  );
}

function getSentryApiOrigin(dsn, overrideOrigin) {
  if (overrideOrigin) {
    return overrideOrigin.replace(/\/+$/u, "");
  }

  if (!dsn) {
    return null;
  }

  const host = new URL(dsn).hostname;
  const match = host.match(/^[^.]+\.ingest\.(.+)$/u);
  const apiHost = match ? match[1] : host.replace(/^ingest\./u, "");

  return `https://${apiHost}`;
}

async function loadBuildConfig() {
  const raw = await readFile(buildConfigPath, "utf8");
  return JSON.parse(raw);
}

async function loadDesktopPackageVersion() {
  const raw = await readFile(desktopPackageJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  return typeof parsed.version === "string" ? parsed.version : null;
}

function getGitValue(args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

async function resolveUploadBuildMetadata() {
  const buildConfig = await loadBuildConfig();
  const packageVersion = await loadDesktopPackageVersion();
  const isCi =
    process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

  if (!isCi) {
    return {
      version: packageVersion ?? buildConfig.NEXU_DESKTOP_APP_VERSION ?? null,
      sentryEnv:
        process.env.NEXU_SENTRY_ENV ?? buildConfig.NEXU_SENTRY_ENV ?? "dev",
      commit:
        process.env.NEXU_DESKTOP_BUILD_COMMIT ??
        getGitValue(["rev-parse", "HEAD"]),
      dsn:
        process.env.NEXU_DESKTOP_SENTRY_DSN ??
        buildConfig.NEXU_DESKTOP_SENTRY_DSN,
    };
  }

  return {
    version: buildConfig.NEXU_DESKTOP_APP_VERSION ?? packageVersion,
    sentryEnv:
      buildConfig.NEXU_SENTRY_ENV ?? process.env.NEXU_SENTRY_ENV ?? null,
    commit:
      buildConfig.NEXU_DESKTOP_BUILD_COMMIT ??
      process.env.NEXU_DESKTOP_BUILD_COMMIT ??
      null,
    dsn:
      buildConfig.NEXU_DESKTOP_SENTRY_DSN ??
      process.env.NEXU_DESKTOP_SENTRY_DSN,
  };
}

function resolveSentryProject(sentryEnv) {
  const explicitProject = process.env.NEXU_DESKTOP_SENTRY_PROJECT;

  if (explicitProject) {
    return explicitProject;
  }

  return DEFAULT_SENTRY_PROJECT_BY_ENV[sentryEnv] ?? "";
}

async function collectArtifactFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = resolve(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectArtifactFiles(entryPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (
      entry.name.endsWith(".js") ||
      entry.name.endsWith(".js.map") ||
      entry.name.endsWith(".mjs") ||
      entry.name.endsWith(".mjs.map")
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

function getArtifactName(filePath) {
  const relativePath = relative(electronRoot, filePath).split("\\").join("/");
  return `app:///${relativePath}`;
}

function getContentType(filePath) {
  if (filePath.endsWith(".map")) {
    return "application/json";
  }

  return "application/javascript";
}

async function sentryRequest(url, authToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${authToken}`,
      ...(options.headers ?? {}),
    },
  });

  if (response.ok) {
    return response;
  }

  const body = await response.text();
  throw new Error(
    `[sourcemaps] ${options.method ?? "GET"} ${url} failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
  );
}

async function trySentryRequest(url, authToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${authToken}`,
      ...(options.headers ?? {}),
    },
  });

  return response;
}

async function ensureRelease(apiOrigin, org, project, release, authToken) {
  const response = await fetch(
    `${apiOrigin}/api/0/organizations/${encodeURIComponent(org)}/releases/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: release,
        ...(project ? { projects: [project] } : {}),
      }),
    },
  );

  if (response.ok || response.status === 208 || response.status === 409) {
    return;
  }

  const body = await response.text();
  throw new Error(
    `[sourcemaps] failed to create Sentry release ${release}: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
  );
}

async function listReleaseFiles(apiOrigin, org, release, authToken) {
  const response = await sentryRequest(
    `${apiOrigin}/api/0/organizations/${encodeURIComponent(org)}/releases/${encodeURIComponent(release)}/files/`,
    authToken,
  );

  return response.json();
}

async function deleteReleaseFile(apiOrigin, org, release, fileId, authToken) {
  const response = await trySentryRequest(
    `${apiOrigin}/api/0/organizations/${encodeURIComponent(org)}/releases/${encodeURIComponent(release)}/files/${encodeURIComponent(String(fileId))}/`,
    authToken,
    { method: "DELETE" },
  );

  if (response.ok) {
    return { deleted: true };
  }

  const body = await response.text();
  if (response.status === 403) {
    return {
      deleted: false,
      reason: `permission_denied:${body}`,
    };
  }

  throw new Error(
    `[sourcemaps] DELETE ${apiOrigin}/api/0/organizations/${encodeURIComponent(org)}/releases/${encodeURIComponent(release)}/files/${encodeURIComponent(String(fileId))}/ failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
  );
}

async function uploadReleaseFile(
  apiOrigin,
  org,
  release,
  dist,
  filePath,
  authToken,
) {
  const form = new FormData();
  form.set("name", getArtifactName(filePath));
  form.set("header", `Content-Type:${getContentType(filePath)}`);
  if (dist) {
    form.set("dist", dist);
  }
  form.set(
    "file",
    new Blob([await readFile(filePath)], { type: getContentType(filePath) }),
    basename(filePath),
  );

  await sentryRequest(
    `${apiOrigin}/api/0/organizations/${encodeURIComponent(org)}/releases/${encodeURIComponent(release)}/files/`,
    authToken,
    {
      method: "POST",
      body: form,
    },
  );
}

async function main() {
  const authToken = process.env.SENTRY_AUTH_TOKEN ?? "";
  const org = process.env.NEXU_DESKTOP_SENTRY_ORG ?? DEFAULT_SENTRY_ORG;

  if (!authToken) {
    console.log(
      "[sourcemaps] skipping upload: set SENTRY_AUTH_TOKEN to enable desktop sourcemap upload.",
    );
    return;
  }

  const buildMetadata = await resolveUploadBuildMetadata();
  const version = buildMetadata.version;
  const dsn = buildMetadata.dsn;
  const project = resolveSentryProject(buildMetadata.sentryEnv ?? "dev");

  if (typeof version !== "string" || version.length === 0) {
    console.log(
      "[sourcemaps] skipping upload: unable to resolve desktop app version from build-config.json or package.json.",
    );
    return;
  }

  if (typeof dsn !== "string" || dsn.length === 0) {
    console.log(
      "[sourcemaps] skipping upload: build-config.json is missing NEXU_DESKTOP_SENTRY_DSN.",
    );
    return;
  }

  if (!project) {
    console.log(
      "[sourcemaps] skipping upload: no Sentry project configured for this NEXU_SENTRY_ENV.",
    );
    return;
  }

  const apiOrigin = getSentryApiOrigin(
    dsn,
    process.env.NEXU_DESKTOP_SENTRY_API_ORIGIN,
  );

  if (!apiOrigin) {
    throw new Error("[sourcemaps] unable to determine Sentry API origin.");
  }

  const release = buildSentryRelease(version);
  const dist = buildSentryDist(version, buildMetadata.commit ?? null);
  const artifactFiles = [
    ...(await collectArtifactFiles(resolve(electronRoot, "dist"))),
    ...(await collectArtifactFiles(
      resolve(electronRoot, "dist-electron", "preload"),
    )),
  ];

  await ensureRelease(apiOrigin, org, project, release, authToken);

  const existingFiles = await listReleaseFiles(
    apiOrigin,
    org,
    release,
    authToken,
  );
  const replaceableNames = new Set(artifactFiles.map(getArtifactName));
  const blockedArtifactNames = new Set();
  let skippedReplacementCount = 0;
  let uploadedCount = 0;

  for (const file of existingFiles) {
    if (!replaceableNames.has(file.name)) {
      continue;
    }

    const fileDist = typeof file.dist === "string" ? file.dist : undefined;
    if ((dist ?? undefined) !== fileDist) {
      continue;
    }

    const deletion = await deleteReleaseFile(
      apiOrigin,
      org,
      release,
      file.id,
      authToken,
    );

    if (!deletion.deleted) {
      blockedArtifactNames.add(file.name);
      skippedReplacementCount += 1;
      console.warn(
        `[sourcemaps] keeping existing artifact ${file.name} for release=${release}${dist ? ` dist=${dist}` : ""}; delete was denied, so this file was skipped during upload.`,
      );
    }
  }

  for (const filePath of artifactFiles) {
    if (blockedArtifactNames.has(getArtifactName(filePath))) {
      continue;
    }

    await uploadReleaseFile(apiOrigin, org, release, dist, filePath, authToken);
    uploadedCount += 1;
  }

  console.log(
    `[sourcemaps] uploaded ${uploadedCount}/${artifactFiles.length} desktop artifacts to ${apiOrigin} for project=${project} release=${release}${dist ? ` dist=${dist}` : ""}${skippedReplacementCount > 0 ? ` (${skippedReplacementCount} kept existing)` : ""}.`,
  );
}

await main();
