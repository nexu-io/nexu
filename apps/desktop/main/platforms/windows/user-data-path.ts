import { resolve } from "node:path";

export interface ResolveWindowsPackagedUserDataPathInput {
  appDataPath: string;
  overrideUserDataPath?: string | null;
  registryUserDataPath?: string | null;
}

export interface ResolveWindowsPackagedUserDataPathResult {
  defaultUserDataPath: string;
  resolvedUserDataPath: string;
}

export function resolveWindowsPackagedUserDataPath(
  input: ResolveWindowsPackagedUserDataPathInput,
): ResolveWindowsPackagedUserDataPathResult {
  const defaultUserDataPath = resolve(input.appDataPath, "nexu-desktop");
  const resolvedUserDataPath = input.overrideUserDataPath
    ? resolve(input.overrideUserDataPath)
    : input.registryUserDataPath
      ? resolve(input.registryUserDataPath)
      : defaultUserDataPath;

  return {
    defaultUserDataPath,
    resolvedUserDataPath,
  };
}
