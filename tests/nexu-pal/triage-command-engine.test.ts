import { describe, expect, it } from "vitest";
import {
  buildTriageCommandPlan,
  parseTriageCommand,
} from "../../scripts/nexu-pal/lib/triage-command-engine.mjs";

describe("parseTriageCommand", () => {
  it("parses supported commands case-insensitively", () => {
    expect(parseTriageCommand("/triage accepted")).toEqual({
      action: "accepted",
      raw: "/triage accepted",
    });
    expect(parseTriageCommand(" /TRIAGE duplicated ")).toEqual({
      action: "duplicated",
      raw: "/TRIAGE duplicated",
    });
  });

  it("ignores unsupported comments", () => {
    expect(parseTriageCommand("looks good")).toBeNull();
    expect(parseTriageCommand("/triage maybe")).toBeNull();
  });
});

describe("buildTriageCommandPlan", () => {
  it("builds the accepted plan", () => {
    expect(buildTriageCommandPlan("accepted")).toEqual({
      labelsToAdd: ["triage:accepted"],
      labelsToRemove: [
        "needs-triage",
        "needs-information",
        "triage:accepted",
        "triage:declined",
        "triage:duplicated",
      ],
      commentsToAdd: [
        "Thanks for the report. We've accepted this issue into triage and will track it in planning.",
      ],
      closeIssue: false,
      diagnostics: [],
    });
  });

  it("builds the duplicated plan with close and duplicate cleanup", () => {
    expect(buildTriageCommandPlan("duplicated")).toEqual({
      labelsToAdd: ["triage:duplicated"],
      labelsToRemove: [
        "needs-triage",
        "needs-information",
        "triage:accepted",
        "triage:declined",
        "triage:duplicated",
        "possible-duplicate",
      ],
      commentsToAdd: [
        "Thanks for the report. We've confirmed this issue as a duplicate and will close it so follow-up stays on the primary thread.",
      ],
      closeIssue: true,
      diagnostics: [],
    });
  });
});
