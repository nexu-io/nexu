import { describe, expect, it } from "vitest";
import {
  isInternalEquivalentAuthor,
  isSentryAutomationAuthor,
} from "../../scripts/nexu-pal/lib/internal-equivalent-author.mjs";

describe("isSentryAutomationAuthor", () => {
  it("matches the real sentry bot login", () => {
    expect(isSentryAutomationAuthor("sentry[bot]")).toBe(true);
    expect(isSentryAutomationAuthor("SENTRY[BOT]")).toBe(true);
    expect(isSentryAutomationAuthor("app/sentry")).toBe(false);
  });
});

describe("isInternalEquivalentAuthor", () => {
  it("treats org members as internal-equivalent", () => {
    expect(
      isInternalEquivalentAuthor({
        isInternalAuthor: true,
        issueAuthorLogin: "someone",
      }),
    ).toBe(true);
  });

  it("treats sentry[bot] as internal-equivalent", () => {
    expect(
      isInternalEquivalentAuthor({
        isInternalAuthor: false,
        issueAuthorLogin: "sentry[bot]",
      }),
    ).toBe(true);
  });
});
