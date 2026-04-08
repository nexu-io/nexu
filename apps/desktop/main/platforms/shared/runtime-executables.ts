import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type {
  DesktopRuntimeExecutableResolver,
  ResolveRuntimeExecutablesArgs,
} from "../types";

function normalizeNodeCandidate(
  candidate: string | undefined,
): string | undefined {
  const trimmed = candidate?.trim();
  if (!trimmed || !existsSync(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function buildNode22Path(): string | undefined {
  const nvmDir = process.env.NVM_DIR;
  if (!nvmDir) return undefined;
  try {
    const versionsDir = path.resolve(nvmDir, "versions/node");
    const dirs = readdirSync(versionsDir)
      .filter((d) => d.startsWith("v22."))
      .sort()
      .reverse();
    for (const d of dirs) {
      const binDir = path.resolve(versionsDir, d, "bin");
      if (existsSync(path.resolve(binDir, "node"))) {
        return `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function supportsOpenclawRuntime(
  nodeBinaryPath: string,
  openclawSidecarRoot: string,
): boolean {
  try {
    execFileSync(
      nodeBinaryPath,
      [
        "-e",
        'require(require("node:path").resolve(process.argv[1], "node_modules/@snazzah/davey"))',
        openclawSidecarRoot,
      ],
      {
        stdio: "ignore",
        env: {
          ...process.env,
          NODE_PATH: "",
        },
      },
    );
    return true;
  } catch {
    return false;
  }
}

function resolveOpenclawNodePath({
  openclawSidecarRoot,
}: ResolveRuntimeExecutablesArgs): string | undefined {
  const currentPath = process.env.PATH ?? "";
  const candidates = [normalizeNodeCandidate(process.env.NODE)];

  try {
    candidates.push(
      normalizeNodeCandidate(
        execFileSync("which", ["node"], { encoding: "utf8" }),
      ),
    );
  } catch {
    // ignore
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (!supportsOpenclawRuntime(candidate, openclawSidecarRoot)) {
      continue;
    }

    const candidateDir = path.dirname(candidate);
    const currentFirstPath = currentPath.split(path.delimiter)[0] ?? "";
    if (candidateDir === currentFirstPath) {
      return undefined;
    }

    return `${candidateDir}${path.delimiter}${currentPath}`;
  }

  return buildNode22Path();
}

function resolveSkillNodePath({
  electronRoot,
  isPackaged,
  inheritedNodePath = process.env.NODE_PATH,
}: ResolveRuntimeExecutablesArgs): string {
  const bundledModulesPath = isPackaged
    ? path.resolve(electronRoot, "bundled-node-modules")
    : path.resolve(electronRoot, "node_modules");
  const inheritedEntries = (inheritedNodePath ?? "")
    .split(path.delimiter)
    .filter((entry) => entry.length > 0);

  return Array.from(new Set([bundledModulesPath, ...inheritedEntries])).join(
    path.delimiter,
  );
}

export function createDefaultRuntimeExecutableResolver(): DesktopRuntimeExecutableResolver {
  return {
    resolveSkillNodePath,
    resolveOpenclawNodePath,
  };
}
