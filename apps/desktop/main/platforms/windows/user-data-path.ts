import { win32 } from "node:path";

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
  const defaultUserDataPath = win32.resolve(input.appDataPath, "nexu-desktop");
  const resolvedUserDataPath = input.overrideUserDataPath
    ? win32.resolve(input.overrideUserDataPath)
    : input.registryUserDataPath
      ? win32.resolve(input.registryUserDataPath)
      : defaultUserDataPath;

  return {
    defaultUserDataPath,
    resolvedUserDataPath,
  };
}
