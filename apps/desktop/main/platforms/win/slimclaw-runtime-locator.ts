import { existsSync } from "node:fs";
import path from "node:path";

type WindowsPackagedOpenclawRootInput = {
  packagedSidecarRoot: string;
  extractedSidecarRoot: string;
  packagedArchivePath: string | null;
};

function hasPackagedOpenclawEntrypoint(packagedSidecarRoot: string): boolean {
  const packagedBinPath = path.resolve(
    packagedSidecarRoot,
    "bin",
    "openclaw.cmd",
  );
  const packagedEntryPath = path.resolve(
    packagedSidecarRoot,
    "node_modules",
    "openclaw",
    "openclaw.mjs",
  );
  return existsSync(packagedBinPath) && existsSync(packagedEntryPath);
}

export function resolveWindowsPackagedOpenclawSidecarRoot(
  input: WindowsPackagedOpenclawRootInput,
): string {
  if (hasPackagedOpenclawEntrypoint(input.packagedSidecarRoot)) {
    return input.packagedSidecarRoot;
  }

  throw new Error(
    input.packagedArchivePath
      ? `Windows packaged OpenClaw runtime must be exe-relative, but archive packaging is still enabled at ${input.packagedArchivePath}`
      : `Windows packaged OpenClaw runtime is missing exe-relative entrypoint under ${input.packagedSidecarRoot}`,
  );
}
