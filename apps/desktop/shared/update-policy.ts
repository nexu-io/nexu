import type { DesktopBuildInfo, DesktopBuildSource } from "./runtime-config";

export type DesktopUpdateExperience =
  | "normal"
  | "local-validation"
  | "local-test-feed";

export function resolveDesktopUpdateExperience(input: {
  buildSource: DesktopBuildSource;
  updateFeed: string | null;
}): DesktopUpdateExperience {
  if (input.buildSource !== "local-dist") {
    return "normal";
  }

  return input.updateFeed ? "local-test-feed" : "local-validation";
}

export function shouldEnableDesktopUpdateManager(input: {
  buildSource: DesktopBuildSource;
  updateFeed: string | null;
}): boolean {
  return resolveDesktopUpdateExperience(input) !== "local-validation";
}

export function shouldStartDesktopPeriodicUpdateChecks(input: {
  buildSource: DesktopBuildSource;
  updateFeed: string | null;
}): boolean {
  const experience = resolveDesktopUpdateExperience(input);
  return experience === "normal" || experience === "local-test-feed";
}

export function getDesktopUpdateTestingGuideUrl(
  buildInfo: Pick<DesktopBuildInfo, "commit">,
): string {
  const ref = buildInfo.commit ?? "main";
  return `https://github.com/nexu-io/nexu/blob/${ref}/specs/guides/desktop-update-testing.md`;
}
