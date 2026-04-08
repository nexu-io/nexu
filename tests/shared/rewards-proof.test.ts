import {
  rewardTaskRequiresGithubStarSession,
  rewardTaskRequiresUrlProof,
  validateRewardProofUrl,
} from "@nexu/shared";
import { describe, expect, it } from "vitest";

describe("reward proof helpers", () => {
  it("marks only web share tasks as URL-proof tasks", () => {
    expect(rewardTaskRequiresUrlProof("x_share")).toBe(true);
    expect(rewardTaskRequiresUrlProof("reddit")).toBe(true);
    expect(rewardTaskRequiresUrlProof("lingying")).toBe(true);
    expect(rewardTaskRequiresUrlProof("facebook")).toBe(true);

    expect(rewardTaskRequiresUrlProof("github_star")).toBe(false);
    expect(rewardTaskRequiresUrlProof("daily_checkin")).toBe(false);
    expect(rewardTaskRequiresUrlProof("mobile_share")).toBe(false);
    expect(rewardTaskRequiresUrlProof("whatsapp")).toBe(false);
  });

  it("validates platform proof URLs with task-specific regexes", () => {
    expect(
      validateRewardProofUrl(
        "x_share",
        "https://x.com/nexu_io/status/1900000000000000000",
      ),
    ).toBe(true);
    expect(
      validateRewardProofUrl(
        "reddit",
        "https://www.reddit.com/r/openai/comments/abc123/example-post/",
      ),
    ).toBe(true);
    expect(
      validateRewardProofUrl(
        "lingying",
        "https://www.linkedin.com/feed/update/urn:li:share:1234567890/",
      ),
    ).toBe(true);
    expect(
      validateRewardProofUrl(
        "facebook",
        "https://www.facebook.com/nexu/posts/1234567890",
      ),
    ).toBe(true);
  });

  it("rejects cross-platform or malformed proof URLs", () => {
    expect(
      validateRewardProofUrl(
        "x_share",
        "https://www.reddit.com/r/openai/comments/abc123/example-post/",
      ),
    ).toBe(false);
    expect(
      validateRewardProofUrl("facebook", "https://example.com/not-facebook"),
    ).toBe(false);
  });

  it("only requires a GitHub monitoring session for the star task", () => {
    expect(rewardTaskRequiresGithubStarSession("github_star")).toBe(true);
    expect(rewardTaskRequiresGithubStarSession("x_share")).toBe(false);
  });
});
