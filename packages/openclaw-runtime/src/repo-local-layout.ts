import { dirname, join } from "node:path";

import { repoRootPath } from "@nexu/dev-utils";

export type OpenClawRepoLocalLayout = {
  openclawPackageRootPath: string;
  openclawEntryPath: string;
  openclawBuiltinExtensionsDir: string;
  openclawStageSourceRootPath: string;
  openclawPatchRootPath: string;
  openclawSidecarRootPath: string;
};

export function resolveOpenClawRepoLocalLayout(input?: {
  openclawEntryPath?: string;
}): OpenClawRepoLocalLayout {
  const openclawEntryPath =
    input?.openclawEntryPath ??
    join(
      repoRootPath,
      "openclaw-runtime",
      "node_modules",
      "openclaw",
      "openclaw.mjs",
    );

  return {
    openclawPackageRootPath: join(repoRootPath, "openclaw-runtime"),
    openclawEntryPath,
    openclawBuiltinExtensionsDir: join(
      dirname(openclawEntryPath),
      "extensions",
    ),
    openclawStageSourceRootPath: join(
      repoRootPath,
      "openclaw-runtime",
      "node_modules",
      "openclaw",
    ),
    openclawPatchRootPath: join(repoRootPath, "openclaw-runtime-patches"),
    openclawSidecarRootPath: join(repoRootPath, "openclaw-runtime", "openclaw"),
  };
}
