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
  it("restores public translation comments for non-English issues", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          should_translate: true,
          detected_language: "Chinese",
          translated_title: "Cannot choose install directory on Windows",
          translated_body:
            "The installer always uses the system drive and does not allow choosing a workspace.",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          is_bug: false,
          reason: "feature request rather than broken behavior",
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
      issueTitle: "win版安装无法指定目录",
      issueBody: "安装器总是写到系统盘。",
      chat,
    });

    expect(plan.labelsToAdd).toEqual(["ai-translated", "needs-triage"]);
    expect(plan.commentsToAdd).toEqual([
      [
        "# AI Translation",
        "",
        "Only the non-English parts are translated below.",
        "",
        "**Title:**",
        "",
        "Cannot choose install directory on Windows",
        "",
        "**Translated sections:**",
        "",
        "**Body:**",
        "",
        "The installer always uses the system drive and does not allow choosing a workspace.",
      ].join("\n"),
    ]);
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        "translation comment prepared for Chinese issue",
        "bug classification: feature request rather than broken behavior",
      ]),
    );
  });

  it("falls back to non-English when detected language is blank", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          should_translate: true,
          detected_language: "   ",
          translated_title: "Translated title",
          translated_body: "Translated body",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          is_bug: false,
          reason: "not a bug",
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
      issueTitle: "原始标题",
      issueBody: "原始内容",
      chat,
    });

    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        "translation comment prepared for non-English issue",
      ]),
    );
  });

  it("truncates oversized translation comments to stay under GitHub limits", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          should_translate: true,
          detected_language: "Chinese",
          translated_title: "Translated title",
          translated_body: "A".repeat(70000),
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          is_bug: false,
          reason: "not a bug",
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
      issueTitle: "原始标题",
      issueBody: "原始内容",
      chat,
    });

    expect(plan.commentsToAdd).toHaveLength(1);
    const [translationComment] = plan.commentsToAdd;
    expect(typeof translationComment).toBe("string");
    if (typeof translationComment !== "string") {
      throw new Error("expected translation comment");
    }
    expect(translationComment).toContain("… [truncated]");
    expect(String(translationComment).length).toBeLessThanOrEqual(65500);
  });

  it("returns a full plan with stub diagnostics and bug-only labeling", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          should_translate: false,
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
          should_translate: false,
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

  it("treats sentry[bot] as internal-equivalent and skips needs-information or needs-triage", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          should_translate: false,
          detected_language: null,
          translated_title:
            "Error: Cannot write headers after they are sent to the client",
          translated_body: "Sentry issue body",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          is_bug: true,
          reason: "clear broken behavior",
        }),
      );

    const plan = await buildOpenedIssueTriagePlan({
      issueTitle:
        "Error: Cannot write headers after they are sent to the client",
      issueBody: "Sentry issue body",
      issueAuthorLogin: "sentry[bot]",
      isInternalAuthor: false,
      chat,
    });

    expect(plan.labelsToAdd).toEqual(["bug"]);
    expect(plan.commentsToAdd).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        "organization membership: non-member",
        "author is sentry[bot]; treated as internal-equivalent automation for triage short-circuit",
        "internal-equivalent author detected; skipped roadmap/duplicate/completeness/needs-triage checks",
      ]),
    );
  });
});
