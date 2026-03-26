import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGitHubIssueClient,
  normalizeTriagePlan,
} from "../../scripts/nexu-pal/lib/github-client.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeTriagePlan", () => {
  it("deduplicates values and preserves add-over-remove label intent", () => {
    const plan = normalizeTriagePlan({
      labelsToAdd: ["bug", "needs-triage", "bug", "  "],
      labelsToRemove: [
        "needs-triage",
        "possible-duplicate",
        "possible-duplicate",
      ],
      commentsToAdd: ["first", "first", "second"],
      closeIssue: true,
      diagnostics: ["a", "a", "b"],
    });

    expect(plan).toEqual({
      labelsToAdd: ["bug", "needs-triage"],
      labelsToRemove: ["possible-duplicate"],
      commentsToAdd: ["first", "second"],
      closeIssue: true,
      diagnostics: ["a", "b"],
    });
  });
});

describe("createGitHubIssueClient.applyPlan", () => {
  it("applies comments, label additions, removals, and close in order", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    vi.stubGlobal("fetch", fetchMock);

    const client = createGitHubIssueClient({
      token: "token",
      repo: "owner/repo",
      issueNumber: "123",
    });

    await client.applyPlan({
      commentsToAdd: ["accepted"],
      labelsToAdd: ["triage:accepted", "triage:accepted"],
      labelsToRemove: ["needs-triage"],
      closeIssue: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/owner/repo/issues/123/comments",
      "https://api.github.com/repos/owner/repo/issues/123/labels",
      "https://api.github.com/repos/owner/repo/issues/123/labels/needs-triage",
      "https://api.github.com/repos/owner/repo/issues/123",
    ]);
    expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual([
      "POST",
      "POST",
      "DELETE",
      "PATCH",
    ]);
  });

  it("surfaces label removal 404s instead of swallowing them", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "missing",
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = createGitHubIssueClient({
      token: "token",
      repo: "owner/repo",
      issueNumber: "123",
    });

    await expect(client.removeLabel("needs-triage")).rejects.toThrow(
      "GitHub API DELETE /issues/123/labels/needs-triage failed (404): missing",
    );
  });
});
