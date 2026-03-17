import { describe, expect, it } from "vitest";
import {
  resolveSkillhubPath,
  skillhubSlugSchema,
} from "../apps/api/src/routes/skillhub-route-helpers.js";

describe("skillhub-route-helpers", () => {
  it("accepts normal skill slugs", () => {
    expect(() => skillhubSlugSchema.parse("feishu-calendar")).not.toThrow();
  });

  it("rejects traversal and malformed skill slugs", () => {
    const invalid = ["../../agents", "../foo", "/tmp/x", "bad/slug", "A-Upper"];

    for (const slug of invalid) {
      expect(() => skillhubSlugSchema.parse(slug)).toThrow();
    }
  });

  it("keeps resolved skill paths inside the configured skills directory", () => {
    expect(
      resolveSkillhubPath("/data/openclaw/skills", "feishu-calendar"),
    ).toBe("/data/openclaw/skills/feishu-calendar");
    expect(
      resolveSkillhubPath("/data/openclaw/skills", "../../agents"),
    ).toBeNull();
  });
});
