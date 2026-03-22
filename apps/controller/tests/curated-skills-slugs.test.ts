import { describe, expect, it } from "vitest";
import {
  CURATED_SKILL_SLUGS,
  STATIC_SKILL_SLUGS,
} from "../src/services/skillhub/curated-skills.js";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,127}$/;

describe("curated skill slugs", () => {
  it("all curated slugs pass validation regex", () => {
    for (const slug of CURATED_SKILL_SLUGS) {
      expect(slug, `slug "${slug}" failed validation`).toMatch(SLUG_REGEX);
    }
  });

  it("all static slugs pass validation regex", () => {
    for (const slug of STATIC_SKILL_SLUGS) {
      expect(slug, `slug "${slug}" failed validation`).toMatch(SLUG_REGEX);
    }
  });

  it("no duplicate curated slugs", () => {
    const unique = new Set(CURATED_SKILL_SLUGS);
    expect(unique.size).toBe(CURATED_SKILL_SLUGS.length);
  });

  it("no overlap between curated and static slugs", () => {
    const curated = new Set(CURATED_SKILL_SLUGS);
    for (const slug of STATIC_SKILL_SLUGS) {
      expect(curated.has(slug), `"${slug}" is in both curated and static`).toBe(
        false,
      );
    }
  });

  it("includes bundled KOL skills in static", () => {
    const bundledKolSlugs = [
      "deep-research",
      "research-to-diagram",
      "qiaomu-mondo-poster-design",
    ];
    for (const slug of bundledKolSlugs) {
      expect(
        STATIC_SKILL_SLUGS,
        `"${slug}" missing from static slugs`,
      ).toContain(slug);
    }
  });

  it("no duplicate static slugs", () => {
    const unique = new Set(STATIC_SKILL_SLUGS);
    expect(unique.size).toBe(STATIC_SKILL_SLUGS.length);
  });
});
