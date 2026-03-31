import { describe, expect, it } from "vitest";
import {
  applySkillsViewStatePatch,
  createSkillDetailPath,
  createSkillDetailState,
  getSkillsBackNavigation,
  getUnavailableSkillDetailSlugs,
  parseSkillsViewState,
} from "../src/lib/skills-view-state";

describe("skills-view-state", () => {
  it("parses default skills view state when params are missing", () => {
    expect(parseSkillsViewState(new URLSearchParams())).toEqual({
      topTab: "yours",
      yoursSubTab: "all",
      activeTag: null,
      searchQuery: "",
    });
  });

  it("ignores invalid tab and source params", () => {
    expect(
      parseSkillsViewState(
        new URLSearchParams("tab=invalid&source=nope&tag=latest&q=tavily"),
      ),
    ).toEqual({
      topTab: "yours",
      yoursSubTab: "all",
      activeTag: "latest",
      searchQuery: "tavily",
    });
  });

  it("applies partial patches while preserving the rest of the view state", () => {
    const next = applySkillsViewStatePatch(
      new URLSearchParams("tab=explore&tag=latest&q=tavily"),
      {
        activeTag: "automation",
      },
    );

    expect(next.toString()).toBe("tab=explore&tag=automation&q=tavily");
  });

  it("preserves the current query string on detail links", () => {
    expect(
      createSkillDetailPath(
        "tavily-search",
        "?tab=explore&tag=latest&q=tavily",
      ),
    ).toBe("/workspace/skills/tavily-search?tab=explore&tag=latest&q=tavily");
  });

  it("marks detail links as originating from the skills list", () => {
    expect(createSkillDetailState()).toEqual({ fromSkillsList: true });
  });

  it("marks queued placeholder skills as lacking detail pages", () => {
    const unavailableSlugs = getUnavailableSkillDetailSlugs(
      [{ slug: "clawhub" }, { slug: "tavily-search" }],
      [{ slug: "queued-custom" }, { slug: "tavily-search" }],
    );

    expect(Array.from(unavailableSlugs)).toEqual(["queued-custom"]);
  });

  it("uses history back only when the detail page was opened from the skills list", () => {
    expect(
      getSkillsBackNavigation(
        { idx: 1 },
        "?tab=explore",
        createSkillDetailState(),
      ),
    ).toEqual({
      kind: "history",
      delta: -1,
    });
  });

  it("falls back to the list path with replace when history starts at the detail page", () => {
    expect(
      getSkillsBackNavigation(
        { idx: 0 },
        "?tab=explore&tag=latest",
        createSkillDetailState(),
      ),
    ).toEqual({
      kind: "path",
      replace: true,
      to: "/workspace/skills?tab=explore&tag=latest",
    });
  });

  it("falls back to the list path when prior history is unrelated", () => {
    expect(
      getSkillsBackNavigation({ idx: 2 }, "?tab=explore&tag=latest", null),
    ).toEqual({
      kind: "path",
      replace: true,
      to: "/workspace/skills?tab=explore&tag=latest",
    });
  });
});
