import { describe, expect, it } from "vitest";
import { rewardTasks } from "../../packages/shared/src/schemas/rewards";

const GITHUB_URL = "https://github.com/nexu-io/nexu";
const REDDIT_LINK =
  "https://dev.to/joey_lee_c96e4ad421791371/we-built-an-open-source-openclaw-desktop-client-that-fixes-17-pitfalls-gjn";
const SHARE_COPY =
  "The simplest desktop client for OpenClaw 🦞 — bridge your Agent to WeChat, Feishu, Slack & Discord and more in one click. Works with Claude Code, Codex & any LLM. BYOK, Oauth, local-first, chat from your phone 24/7.";

function getTaskUrl(taskId: (typeof rewardTasks)[number]["id"]): URL {
  const task = rewardTasks.find((entry) => entry.id === taskId);
  expect(task?.actionUrl).toBeTruthy();
  return new URL(task?.actionUrl ?? "");
}

describe("reward share templates", () => {
  it("uses the refreshed copy for X and WhatsApp", () => {
    const expectedText = `${SHARE_COPY} ${GITHUB_URL}`;

    const xUrl = getTaskUrl("x_share");
    expect(xUrl.origin).toBe("https://x.com");
    expect(xUrl.pathname).toBe("/intent/tweet");
    expect(xUrl.searchParams.get("text")).toBe(expectedText);

    const whatsappUrl = getTaskUrl("whatsapp");
    expect(whatsappUrl.origin).toBe("https://wa.me");
    expect(whatsappUrl.pathname).toBe("/");
    expect(whatsappUrl.searchParams.get("text")).toBe(expectedText);
  });

  it("uses the dev.to article as the standalone Reddit share link", () => {
    const redditUrl = getTaskUrl("reddit");

    expect(redditUrl.origin).toBe("https://www.reddit.com");
    expect(redditUrl.pathname).toBe("/submit");
    expect(redditUrl.searchParams.get("url")).toBe(REDDIT_LINK);
    expect(redditUrl.searchParams.has("title")).toBe(false);
  });

  it("shares the same dev.to article on Facebook", () => {
    const facebookUrl = getTaskUrl("facebook");

    expect(facebookUrl.origin).toBe("https://www.facebook.com");
    expect(facebookUrl.pathname).toBe("/sharer/sharer.php");
    expect(facebookUrl.searchParams.get("u")).toBe(REDDIT_LINK);
  });
});
