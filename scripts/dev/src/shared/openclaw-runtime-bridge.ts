import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type OpenClawRepoLocalLayout = {
  openclawPackageRootPath: string;
  openclawEntryPath: string;
  openclawBuiltinExtensionsDir: string;
  openclawStageSourceRootPath: string;
  openclawPatchRootPath: string;
  openclawSidecarRootPath: string;
};

export type PreparedDevOpenclawLayout = {
  preparedRoot: string;
  manifestPath: string;
  entryPath: string;
  builtinExtensionsDir: string;
  stagedOpenclawRoot: string;
  sourceRoot: string;
  patchRoot: string;
  fingerprint: string;
  patchedFileCount: number;
  reused: boolean;
};

type DevRuntimeBridgeModule = {
  getPreparedDevOpenclawManifestPath: () => string;
  prepareRepoLocalDevOpenclawRuntime: (options?: {
    log?: (message: string) => void;
  }) => Promise<PreparedDevOpenclawLayout>;
  resolvePreparedDevOpenclawLayout: () => PreparedDevOpenclawLayout;
};

type RepoLocalLayoutBridgeModule = {
  resolveOpenClawRepoLocalLayout: (input?: {
    openclawEntryPath?: string;
  }) => OpenClawRepoLocalLayout;
};

const require = createRequire(import.meta.url);
const bridgeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../openclaw-runtime/api",
);
const devRuntimeBridge = require(
  path.join(bridgeRoot, "dev-runtime-layout.cjs"),
) as DevRuntimeBridgeModule;
const repoLocalLayoutBridge = require(
  path.join(bridgeRoot, "repo-local-layout.cjs"),
) as RepoLocalLayoutBridgeModule;

export const getPreparedDevOpenclawManifestPath =
  devRuntimeBridge.getPreparedDevOpenclawManifestPath;
export const prepareRepoLocalDevOpenclawRuntime =
  devRuntimeBridge.prepareRepoLocalDevOpenclawRuntime;
export const resolveOpenClawRepoLocalLayout =
  repoLocalLayoutBridge.resolveOpenClawRepoLocalLayout;
export const resolvePreparedDevOpenclawLayout =
  devRuntimeBridge.resolvePreparedDevOpenclawLayout;
