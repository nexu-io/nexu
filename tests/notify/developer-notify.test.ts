import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDeveloperIssuePayload,
  buildDeveloperPrPayload,
  checkOrganizationMembership,
  isInternalEquivalentAuthor,
  runFromEnv,
  sanitizeText,
  validateGithubUrl,
} from "../../scripts/notify/developer-notify.mjs";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("developer-notify", () => {
  it("sanitizes markdown-sensitive characters and mentions", () => {
    expect(sanitizeText("hi\n@team [link]!")).toBe("hi ＠team \\[link\\]\\!");
  });

  it("validates GitHub URLs", () => {
    expect(validateGithubUrl("https://github.com/nexu-io/nexu/issues/1")).toBe(
      "https://github.com/nexu-io/nexu/issues/1",
    );
    expect(() => validateGithubUrl("https://example.com/test")).toThrow(
      "Only https://github.com URLs are allowed",
    );
  });

  it("builds the developer PR payload with expected buttons", () => {
    const payload = buildDeveloperPrPayload({
      author: "alice",
      labels: "bug, help wanted",
      prUrl: "https://github.com/nexu-io/nexu/pull/10",
    });

    expect(payload.card.header.title.content).toContain("新增 1 位贡献者");
    expect(payload.card.body.elements[0]).toMatchObject({
      tag: "markdown",
      content: expect.stringContaining("**Author:** alice"),
    });
    expect(payload.card.body.elements[1]).toMatchObject({
      tag: "column_set",
      flex_mode: "flow",
    });
    expect(
      payload.card.body.elements[1].columns.map(
        (column) => column.elements[0].text.content,
      ),
    ).toEqual(["查看贡献 PR"]);
    expect(payload.card.body.elements[1].columns).toEqual([
      expect.objectContaining({
        elements: [
          expect.objectContaining({
            url: "https://github.com/nexu-io/nexu/pull/10",
            text: expect.objectContaining({ content: "查看贡献 PR" }),
          }),
        ],
      }),
    ]);
    expect(payload.card.body.elements[3]).toMatchObject({ tag: "column_set" });
    expect(
      payload.card.body.elements[3].columns.map(
        (column) => column.elements[0].text.content,
      ),
    ).toEqual(["贡献者指南", "立即贡献"]);
    expect(payload.card.body.elements[2]).toMatchObject({
      tag: "markdown",
      content: expect.stringContaining("只需 3 步💥，1️⃣选任务 2️⃣ 认领 3️⃣ 提交"),
    });
  });

  it("builds the developer issue payload with three actions", () => {
    const payload = buildDeveloperIssuePayload({
      issueUrl: "https://github.com/nexu-io/nexu/issues/99",
    });

    expect(payload.card.header.title.content).toContain("新手友好 Issue");
    expect(payload.card.body.elements[1]).toMatchObject({ tag: "column_set" });
    expect(
      payload.card.body.elements[1].columns.map(
        (column) => column.elements[0].text.content,
      ),
    ).toEqual(["查看 issue"]);
    expect(payload.card.body.elements[3]).toMatchObject({ tag: "column_set" });
    expect(
      payload.card.body.elements[3].columns.map(
        (column) => column.elements[0].text.content,
      ),
    ).toEqual(["领取新手友好 issue", "贡献者指南"]);
    expect(payload.card.body.elements[2]).toMatchObject({
      tag: "markdown",
      content: expect.stringContaining(
        "1️⃣ 500—2000 积分奖励 = 价值 20 美金 nexu 使用额度",
      ),
    });
  });

  it("treats sentry bot as internal-equivalent", () => {
    expect(isInternalEquivalentAuthor("sentry[bot]")).toBe(true);
    expect(isInternalEquivalentAuthor("alice")).toBe(false);
  });

  it("treats redirect membership responses as non-member", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 302, ok: false });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      checkOrganizationMembership({
        token: "token",
        org: "nexu-io",
        username: "octocat",
      }),
    ).resolves.toBe(false);
  });

  it("treats permanent and preserved redirects as non-member", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 307, ok: false });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      checkOrganizationMembership({
        token: "token",
        org: "nexu-io",
        username: "octocat",
      }),
    ).resolves.toBe(false);
  });

  it("times out stalled membership lookups", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      checkOrganizationMembership({
        token: "token",
        org: "nexu-io",
        username: "octocat",
      }),
    ).rejects.toThrow("GitHub membership lookup timed out after 30000ms");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/orgs/nexu-io/members/octocat",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("skips issue notification for internal authors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 204, ok: true })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runFromEnv({
      WEBHOOK_URL: "https://example.feishu.cn/webhook/test",
      EVENT_KIND: "issue",
      GITHUB_TOKEN: "token",
      GITHUB_REPOSITORY_OWNER: "nexu-io",
      AUTHOR: "internal-user",
      URL: "https://github.com/nexu-io/nexu/issues/1",
    });

    expect(result).toEqual({ skipped: true, reason: "internal-author" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends PR notification without membership lookup", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, msg: "success" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runFromEnv({
      WEBHOOK_URL: "https://example.feishu.cn/webhook/test",
      EVENT_KIND: "pr",
      AUTHOR: "alice",
      LABELS_OR_CATEGORY: "none",
      URL: "https://github.com/nexu-io/nexu/pull/1",
    });

    expect(result).toEqual({ skipped: false, eventKind: "pr" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://example.feishu.cn/webhook/test",
    );
  });

  it("throws when webhook returns a business error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 11246, msg: "unsupported tag action" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runFromEnv({
        WEBHOOK_URL: "https://example.feishu.cn/webhook/test",
        EVENT_KIND: "pr",
        AUTHOR: "alice",
        LABELS_OR_CATEGORY: "none",
        URL: "https://github.com/nexu-io/nexu/pull/1",
      }),
    ).rejects.toThrow("Webhook business error (11246): unsupported tag action");
  });
});
