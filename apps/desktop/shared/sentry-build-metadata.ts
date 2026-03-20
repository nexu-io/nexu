import type { DesktopBuildInfo } from "./runtime-config";

export type DesktopSentryBuildMetadata = {
  release: string;
  dist?: string;
  buildContext: DesktopBuildInfo;
};

const SENTRY_DIST_MAX_LENGTH = 64;

function normalizeCommit(commit: string | null): string | null {
  if (!commit) {
    return null;
  }

  const trimmedCommit = commit.trim();
  return trimmedCommit.length > 0 ? trimmedCommit : null;
}

function buildSentryDist(
  version: string,
  commit: string | null,
): string | undefined {
  if (!commit) {
    return undefined;
  }

  const normalizedVersion = version.trim().replace(/[^A-Za-z0-9_.-]+/g, "-");
  const normalizedCommit = commit.replace(/[^A-Za-z0-9_.-]+/g, "-");
  const dist = `${normalizedVersion}-${normalizedCommit}`.slice(
    0,
    SENTRY_DIST_MAX_LENGTH,
  );

  return dist.length > 0 ? dist : undefined;
}

export function getDesktopSentryBuildMetadata(
  buildInfo: DesktopBuildInfo,
): DesktopSentryBuildMetadata {
  const release = `nexu-desktop@${buildInfo.version}`;
  const commit = normalizeCommit(buildInfo.commit);
  const dist = buildSentryDist(buildInfo.version, commit);

  return {
    release,
    ...(dist ? { dist } : {}),
    buildContext: {
      ...buildInfo,
      commit,
    },
  };
}
