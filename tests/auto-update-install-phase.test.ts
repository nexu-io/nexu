import { describe, expect, it } from "vitest";
import { restorePhaseAfterInstall as restoreDesktopPhase } from "../apps/desktop/src/hooks/use-auto-update";
import { restorePhaseAfterInstall as restoreWebPhase } from "../apps/web/src/hooks/use-auto-update";

describe("desktop useAutoUpdate", () => {
  it("restores the prior actionable phase after install returns without quitting", () => {
    expect(
      restoreDesktopPhase(
        {
          capability: null,
          phase: "installing",
          version: "1.2.3",
          releaseNotes: null,
          actionUrl: null,
          percent: 100,
          errorMessage: null,
          dismissed: false,
          userInitiated: false,
        },
        "ready",
      ).phase,
    ).toBe("ready");
  });

  it("keeps later non-installing phases intact", () => {
    expect(
      restoreDesktopPhase(
        {
          capability: null,
          phase: "error",
          version: "1.2.3",
          releaseNotes: null,
          actionUrl: null,
          percent: 100,
          errorMessage: "failed",
          dismissed: false,
          userInitiated: false,
        },
        "available",
      ).phase,
    ).toBe("error");
  });
});

describe("web useAutoUpdate", () => {
  it("restores the prior actionable phase after install returns without quitting", () => {
    expect(
      restoreWebPhase(
        {
          phase: "installing",
          version: "1.2.3",
          percent: 100,
          errorMessage: null,
        },
        "ready",
      ).phase,
    ).toBe("ready");
  });

  it("keeps later phase changes intact", () => {
    expect(
      restoreWebPhase(
        {
          phase: "error",
          version: "1.2.3",
          percent: 100,
          errorMessage: "failed",
        },
        "ready",
      ).phase,
    ).toBe("error");
  });

  it("restores downloading after install returns without quitting", () => {
    expect(
      restoreWebPhase(
        {
          phase: "installing",
          version: "1.2.3",
          percent: 100,
          errorMessage: null,
        },
        "downloading",
      ).phase,
    ).toBe("downloading");
  });
});
