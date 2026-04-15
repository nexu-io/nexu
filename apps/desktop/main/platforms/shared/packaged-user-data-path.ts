import { join, resolve } from "node:path";

export interface ResolveNonWindowsPackagedUserDataPathInput {
  appDataPath: string;
  overrideUserDataPath?: string | null;
}

export interface ResolveNonWindowsPackagedUserDataPathResult {
  defaultUserDataPath: string;
  resolvedUserDataPath: string;
}

export function resolveNonWindowsPackagedUserDataPath(
  input: ResolveNonWindowsPackagedUserDataPathInput,
): ResolveNonWindowsPackagedUserDataPathResult {
  const defaultUserDataPath = join(input.appDataPath, "@nexu", "desktop");
  const resolvedUserDataPath = input.overrideUserDataPath
    ? resolve(input.overrideUserDataPath)
    : defaultUserDataPath;

  return {
    defaultUserDataPath,
    resolvedUserDataPath,
  };
}
