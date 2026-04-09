import { resolve } from "node:path";

export function createDesktopBuildContext({
  electronRoot,
  repoRoot,
  processEnv = process.env,
}) {
  const env = {
    ...processEnv,
    NEXU_WORKSPACE_ROOT: repoRoot,
  };

  return {
    electronRoot,
    repoRoot,
    env,
    resolveReleaseRoot(customReleaseDir = env.NEXU_DESKTOP_RELEASE_DIR) {
      return customReleaseDir
        ? resolve(customReleaseDir)
        : resolve(electronRoot, "release");
    },
    resolveRuntimeDistRoot() {
      return resolve(electronRoot, ".dist-runtime");
    },
  };
}

export function createDesktopWebBuildEnv(baseEnv, platform) {
  return {
    ...baseEnv,
    VITE_DESKTOP_PLATFORM: platform,
  };
}

export function getSharedBuildSteps({ repoRoot }) {
  return [
    ["pnpm", ["--dir", repoRoot, "--filter", "@nexu/dev-utils", "build"]],
    ["pnpm", ["--dir", repoRoot, "--filter", "@nexu/shared", "build"]],
    ["pnpm", ["--dir", repoRoot, "--filter", "@nexu/controller", "build"]],
    ["pnpm", ["--dir", repoRoot, "slimclaw:prepare"]],
  ];
}
