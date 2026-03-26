import { describe, expect, it, vi } from "vitest";
import {
  buildOpenedIssueTriagePlan,
  createTriagePlan,
} from "../../scripts/nexu-pal/lib/triage-opened-engine.mjs";

describe("createTriagePlan", () => {
  it("returns the stable triage plan shape", () => {
    expect(createTriagePlan()).toEqual({
      labelsToAdd: [],
      labelsToRemove: [],
      commentsToAdd: [],
      closeIssue: false,
      diagnostics: [],
    });
  });
});

describe("buildOpenedIssueTriagePlan", () => {
  it("returns a full plan with stub diagnostics and bug-only labeling", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          is_non_english: false,
          detected_language: null,
          translated_title: "App crashes on launch",
          translated_body: "Steps to reproduce...",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          is_bug: true,
          reason: "clear broken behavior",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          needs_information: false,
          reason: "enough detail for triage",
          missing_items: [],
        }),
      );

    const plan = await buildOpenedIssueTriagePlan({
      issueTitle: "App crashes on launch",
      issueBody: "Steps to reproduce...",
      chat,
    });

    expect(plan).toMatchObject({
      labelsToAdd: ["bug", "needs-triage"],
      labelsToRemove: [],
      commentsToAdd: [],
      closeIssue: false,
    });
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining("roadmap matcher stub"),
        expect.stringContaining("duplicate detector stub"),
        "bug classification: clear broken behavior",
        "information completeness: enough detail for triage",
      ]),
    );
  });

  it("pauses triage with needs-information when the issue is too incomplete", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          is_non_english: false,
          detected_language: null,
          translated_title: "It broke",
          translated_body: "Please fix",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          is_bug: true,
          reason: "describes broken behavior",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          needs_information: true,
          reason: "missing reproduction details",
          missing_items: ["Steps to reproduce", "Expected behavior"],
        }),
      );

    const plan = await buildOpenedIssueTriagePlan({
      issueTitle: "It broke",
      issueBody: "Please fix",
      chat,
    });

    expect(plan.labelsToAdd).toEqual(["bug", "needs-information"]);
    expect(plan.labelsToRemove).toEqual([]);
    expect(plan.closeIssue).toBe(false);
    expect(plan.commentsToAdd).toEqual([
      [
        "Thanks for the report. We need a bit more information before we can continue triage.",
        "",
        "Please update this issue with:",
        "- Steps to reproduce",
        "- Expected behavior",
        "",
        "Once the missing details are added, a maintainer can continue triage.",
      ].join("\n"),
    ]);
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        "information completeness: missing reproduction details",
      ]),
    );
  });
});
