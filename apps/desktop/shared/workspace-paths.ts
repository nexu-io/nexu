import { resolve } from "node:path";

export function getWorkspaceRoot(): string {
  return (
    process.env.NEXU_WORKSPACE_ROOT ?? resolve(import.meta.dirname, "../../..")
  );
}

export function getDesktopAppRoot(): string {
  return (
    process.env.NEXU_DESKTOP_APP_ROOT ??
    resolve(getWorkspaceRoot(), "apps/desktop")
  );
}
