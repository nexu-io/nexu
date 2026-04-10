import { join } from "node:path";

export interface ResolveNonWindowsPackagedUserDataPathInput {
  appDataPath: string;
}

export interface ResolveNonWindowsPackagedUserDataPathResult {
  defaultUserDataPath: string;
  resolvedUserDataPath: string;
}

export function resolveNonWindowsPackagedUserDataPath(
  input: ResolveNonWindowsPackagedUserDataPathInput,
): ResolveNonWindowsPackagedUserDataPathResult {
  const resolvedUserDataPath = join(input.appDataPath, "@nexu", "desktop");

  return {
    defaultUserDataPath: resolvedUserDataPath,
    resolvedUserDataPath,
  };
}
