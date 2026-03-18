import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Re-implement the pure functions from catalog-manager.ts for testing.
// These are private in the source module but the logic is critical to test.

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,127}$/;

function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

function resolveSkillPath(skillsDir: string, slug: string): string | null {
  const rootDir = resolve(skillsDir);
  const skillPath = resolve(rootDir, slug);
  const normalizedRoot = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;

  if (skillPath === rootDir || !skillPath.startsWith(normalizedRoot)) {
    return null;
  }

  return skillPath;
}

describe("desktop skillhub slug validation", () => {
  describe("isValidSlug", () => {
    it("accepts valid slugs", () => {
      expect(isValidSlug("ontology")).toBe(true);
      expect(isValidSlug("tavily-search")).toBe(true);
      expect(isValidSlug("self-improving-agent")).toBe(true);
      expect(isValidSlug("a")).toBe(true);
      expect(isValidSlug("gog")).toBe(true);
      expect(isValidSlug("agent-browser")).toBe(true);
    });

    it("rejects path traversal attempts", () => {
      expect(isValidSlug("../../etc")).toBe(false);
      expect(isValidSlug("../foo")).toBe(false);
      expect(isValidSlug("foo/../bar")).toBe(false);
    });

    it("rejects absolute paths", () => {
      expect(isValidSlug("/tmp/evil")).toBe(false);
      expect(isValidSlug("/etc/passwd")).toBe(false);
    });

    it("rejects slugs with invalid characters", () => {
      expect(isValidSlug("Bad-Upper")).toBe(false);
      expect(isValidSlug("has space")).toBe(false);
      expect(isValidSlug("has/slash")).toBe(false);
      expect(isValidSlug("has.dot")).toBe(false);
      expect(isValidSlug("has_underscore")).toBe(false);
    });

    it("rejects empty and leading-hyphen slugs", () => {
      expect(isValidSlug("")).toBe(false);
      expect(isValidSlug("-leading-hyphen")).toBe(false);
    });

    it("rejects slugs exceeding 128 characters", () => {
      expect(isValidSlug("a".repeat(128))).toBe(true);
      expect(isValidSlug("a".repeat(129))).toBe(false);
    });
  });

  describe("resolveSkillPath", () => {
    const skillsDir = "/data/openclaw/skills";

    it("resolves valid slug to path inside skills directory", () => {
      expect(resolveSkillPath(skillsDir, "ontology")).toBe(
        "/data/openclaw/skills/ontology",
      );
      expect(resolveSkillPath(skillsDir, "tavily-search")).toBe(
        "/data/openclaw/skills/tavily-search",
      );
    });

    it("rejects path traversal via ..", () => {
      expect(resolveSkillPath(skillsDir, "../../etc")).toBeNull();
      expect(resolveSkillPath(skillsDir, "../foo")).toBeNull();
    });

    it("rejects slug that resolves to the root directory itself", () => {
      expect(resolveSkillPath(skillsDir, ".")).toBeNull();
      expect(resolveSkillPath(skillsDir, "")).toBeNull();
    });

    it("works with skills directory that has trailing separator", () => {
      expect(resolveSkillPath(`${skillsDir}/`, "ontology")).toBe(
        "/data/openclaw/skills/ontology",
      );
    });

    it("works with spaces in skills directory path", () => {
      const dirWithSpaces =
        "/Users/test/Library/Application Support/@nexu/desktop/runtime/openclaw/state/skills";
      expect(resolveSkillPath(dirWithSpaces, "ontology")).toBe(
        `${dirWithSpaces}/ontology`,
      );
      expect(resolveSkillPath(dirWithSpaces, "../../..")).toBeNull();
    });
  });
});
