import { describe, expect, it } from "vitest";
import { composeSkillSearchText } from "../src/lib/skill-translations";

describe("composeSkillSearchText", () => {
  it("includes localized Chinese display text in zh locale", () => {
    const searchText = composeSkillSearchText(
      "second-brain",
      "Second Brain",
      "Build a personal knowledge base",
      "第二大脑",
      "构建个人知识库",
    );

    expect(searchText).toContain("第二大脑");
  });

  it("keeps source English text searchable in zh locale", () => {
    const searchText = composeSkillSearchText(
      "second-brain",
      "Second Brain",
      "Build a personal knowledge base",
      "第二大脑",
      "构建个人知识库",
    );

    expect(searchText).toContain("second brain");
    expect(searchText).toContain("build a personal knowledge base");
    expect(searchText).toContain("second-brain");
  });
});
