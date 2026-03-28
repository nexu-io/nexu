import { createDesktopWebBuildEnv } from "../shared/build-capabilities.mjs";

export function createWindowsBuildCapabilities({ env, releaseRoot, processPlatform }) {
  return {
    platformId: "win",
    artifactLayout: {
      primaryTargets: ["nsis", "dir"],
      unpackedDirName: "win-unpacked",
    },
    webBuildEnv: createDesktopWebBuildEnv(env, processPlatform),
    sidecarReleaseEnv: env,
    createElectronBuilderArgs({ electronVersion, buildVersion, dirOnly }) {
      return [
        "--win",
        ...(dirOnly ? ["dir"] : this.artifactLayout.primaryTargets),
        "--publish",
        "never",
        `--config.electronVersion=${electronVersion}`,
        `--config.buildVersion=${buildVersion}`,
        `--config.directories.output=${releaseRoot}`,
        ...(dirOnly ? ["--config.win.signAndEditExecutable=false"] : []),
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
