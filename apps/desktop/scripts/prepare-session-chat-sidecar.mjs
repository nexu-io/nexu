import { cp, lstat, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");
const repoRoot =
  process.env.NEXU_WORKSPACE_ROOT ?? resolve(electronRoot, "../..");
const appRoot = resolve(repoRoot, "apps/chat");
const buildRoot = resolve(appRoot, ".next");
const standaloneRoot = resolve(buildRoot, "standalone");
const standaloneAppRoot = resolve(standaloneRoot, "apps/chat");
const staticRoot = resolve(buildRoot, "static");
const publicRoot = resolve(appRoot, "public");
const migrationsRoot = resolve(appRoot, "migrations");
const sidecarRoot = resolve(repoRoot, ".tmp/sidecars/session-chat");
const sidecarAppRoot = resolve(sidecarRoot, "apps/chat");

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureBuildArtifacts() {
  if (!(await pathExists(standaloneAppRoot))) {
    throw new Error(
      "Missing Session Chat standalone app artifact: apps/chat/.next/standalone/apps/chat. Build @nexu/chat first.",
    );
  }

  if (!(await pathExists(staticRoot))) {
    throw new Error(
      "Missing Session Chat static artifact: apps/chat/.next/static. Build @nexu/chat first.",
    );
  }
}

async function prepareSessionChatSidecar() {
  await ensureBuildArtifacts();
  await rm(sidecarRoot, { recursive: true, force: true });
  await mkdir(sidecarRoot, { recursive: true });
  await cp(standaloneRoot, sidecarRoot, { recursive: true });
  await mkdir(resolve(sidecarAppRoot, ".next"), { recursive: true });
  await cp(staticRoot, resolve(sidecarAppRoot, ".next/static"), {
    recursive: true,
  });

  if (await pathExists(publicRoot)) {
    await cp(publicRoot, resolve(sidecarAppRoot, "public"), {
      recursive: true,
    });
  }

  if (await pathExists(migrationsRoot)) {
    await cp(migrationsRoot, resolve(sidecarAppRoot, "migrations"), {
      recursive: true,
    });
  }
}

await prepareSessionChatSidecar();
