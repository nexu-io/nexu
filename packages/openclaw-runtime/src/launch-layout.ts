import path from "node:path";

export type OpenClawLaunchLayout = {
  openclawPath: string;
  openclawCwd: string;
  openclawBinPath: string;
  openclawExtensionsDir: string;
};

export function resolvePackagedOpenClawLaunchLayout(
  sidecarRoot: string,
): OpenClawLaunchLayout {
  return {
    openclawPath: path.join(
      sidecarRoot,
      "node_modules",
      "openclaw",
      "openclaw.mjs",
    ),
    openclawCwd: sidecarRoot,
    openclawBinPath: path.join(sidecarRoot, "bin", "openclaw"),
    openclawExtensionsDir: path.join(
      sidecarRoot,
      "node_modules",
      "openclaw",
      "extensions",
    ),
  };
}

export function resolveRepoLocalOpenClawLaunchLayout(
  repoRoot: string,
): OpenClawLaunchLayout {
  return {
    openclawPath: path.join(
      repoRoot,
      "openclaw-runtime",
      "node_modules",
      "openclaw",
      "openclaw.mjs",
    ),
    openclawCwd: repoRoot,
    openclawBinPath: path.join(
      repoRoot,
      ".tmp",
      "sidecars",
      "openclaw",
      "bin",
      "openclaw",
    ),
    openclawExtensionsDir: path.join(
      repoRoot,
      ".tmp",
      "sidecars",
      "openclaw",
      "node_modules",
      "openclaw",
      "extensions",
    ),
  };
}
