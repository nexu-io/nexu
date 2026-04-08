import { createDesktopWebBuildEnv } from "../shared/build-capabilities.mjs";

export function createWindowsBuildCapabilities({
  env,
  releaseRoot,
  processPlatform,
}) {
  return {
    platformId: "win",
    artifactLayout: {
      primaryTargets: ["nsis", "dir"],
      unpackedDirName: "win-unpacked",
    },
    webBuildEnv: createDesktopWebBuildEnv(env, processPlatform),
    sidecarReleaseEnv: env,
    createElectronBuilderArgs({
      electronVersion,
      buildVersion,
      dirOnly,
      targets,
    }) {
      const resolvedTargets =
        Array.isArray(targets) && targets.length > 0
          ? targets
          : dirOnly
            ? ["dir"]
            : this.artifactLayout.primaryTargets;

      return [
        "--win",
        ...resolvedTargets,
        "--publish",
        "never",
        `--config.electronVersion=${electronVersion}`,
        `--config.buildVersion=${buildVersion}`,
        `--config.directories.output=${releaseRoot}`,
      ];
    },
    createElectronBuilderEnv() {
      return {
        ...env,
        CSC_IDENTITY_AUTO_DISCOVERY: "false",
      };
    },
  };
}
