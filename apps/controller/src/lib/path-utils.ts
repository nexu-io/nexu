import { homedir } from "node:os";
import path from "node:path";

export function expandHomeDir(inputPath: string): string {
  if (inputPath.startsWith("~/")) {
    return path.join(homedir(), inputPath.slice(2));
  }

  return inputPath;
}

export function ensureRelativeChildPath(inputPath: string): string {
  const normalized = inputPath.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.includes("..") ||
    normalized.includes("\u0000")
  ) {
    throw new Error(`Invalid relative path: ${inputPath}`);
  }

  return normalized;
}
