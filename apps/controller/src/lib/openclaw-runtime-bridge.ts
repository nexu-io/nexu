import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface OpenClawCommandSpecInput {
  openclawBin: string;
  openclawElectronExecutable?: string | null;
  workspaceRoot?: string | null;
}

export interface OpenClawEntryResolutionInput {
  openclawBin: string;
  workspaceRoot?: string | null;
}

export interface OpenClawCommandSpec {
  command: string;
  argsPrefix: string[];
  extraEnv: Record<string, string>;
}

type OpenClawRuntimeBridgeModule = {
  getOpenClawCommandSpec: (
    input: OpenClawCommandSpecInput,
  ) => OpenClawCommandSpec;
  resolveOpenClawEntryPath: (
    input: OpenClawEntryResolutionInput,
  ) => string | null;
};

const require = createRequire(import.meta.url);
const runtimeBridgeModulePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../openclaw-runtime/api/openclaw-command-spec.cjs",
);
const runtimeBridge = require(
  runtimeBridgeModulePath,
) as OpenClawRuntimeBridgeModule;

export const getOpenClawCommandSpec = runtimeBridge.getOpenClawCommandSpec;
export const resolveOpenClawEntryPath = runtimeBridge.resolveOpenClawEntryPath;
