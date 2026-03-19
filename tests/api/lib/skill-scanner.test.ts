import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanInstalledSkills } from "#api/lib/skill-scanner.js";

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `skill-scanner-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkill(dir: string, slug: string, content = "# Test Skill"): void {
  const skillDir = resolve(dir, slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(resolve(skillDir, "SKILL.md"), content, "utf8");
}

describe("scanInstalledSkills", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("returns empty array when no dirs exist", () => {
    const result = scanInstalledSkills({});
    expect(result).toEqual([]);
  });

  it("scans curated skills directory", () => {
    const curatedDir = resolve(tempRoot, "curated");
    writeSkill(curatedDir, "weather");
    writeSkill(curatedDir, "github");

    const result = scanInstalledSkills({ curatedDir });
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      slug: "weather",
      source: "curated",
      name: "weather",
      description: "",
    });
    expect(result).toContainEqual({
      slug: "github",
      source: "curated",
      name: "github",
      description: "",
    });
  });

  it("scans managed skills directory", () => {
    const managedDir = resolve(tempRoot, "managed");
    writeSkill(managedDir, "my-skill");

    const result = scanInstalledSkills({ managedDir });
    expect(result).toEqual([
      {
        slug: "my-skill",
        source: "managed",
        name: "my-skill",
        description: "",
      },
    ]);
  });

  it("managed overrides curated with same slug", () => {
    const curatedDir = resolve(tempRoot, "curated");
    const managedDir = resolve(tempRoot, "managed");
    writeSkill(curatedDir, "weather");
    writeSkill(managedDir, "weather");

    const result = scanInstalledSkills({ curatedDir, managedDir });
    const skill = result.find((s) => s.slug === "weather");
    expect(skill?.source).toBe("managed");
    expect(result).toHaveLength(1);
  });

  it("combines both sources without duplicates", () => {
    const curatedDir = resolve(tempRoot, "curated");
    const managedDir = resolve(tempRoot, "managed");
    writeSkill(curatedDir, "weather");
    writeSkill(curatedDir, "github");
    writeSkill(managedDir, "deploy");

    const result = scanInstalledSkills({ curatedDir, managedDir });
    expect(result).toHaveLength(3);
    expect(result).toContainEqual({
      slug: "weather",
      source: "curated",
      name: "weather",
      description: "",
    });
    expect(result).toContainEqual({
      slug: "github",
      source: "curated",
      name: "github",
      description: "",
    });
    expect(result).toContainEqual({
      slug: "deploy",
      source: "managed",
      name: "deploy",
      description: "",
    });
  });

  it("ignores directories without SKILL.md", () => {
    const managedDir = resolve(tempRoot, "managed");
    const emptySkillDir = resolve(managedDir, "broken-skill");
    mkdirSync(emptySkillDir, { recursive: true });
    writeFileSync(resolve(emptySkillDir, "README.md"), "not a skill", "utf8");

    const result = scanInstalledSkills({ managedDir });
    expect(result).toEqual([]);
  });

  it("extracts name and description from SKILL.md frontmatter", () => {
    const curatedDir = resolve(tempRoot, "curated");
    const skillDir = resolve(curatedDir, "weather");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      resolve(skillDir, "SKILL.md"),
      "---\nname: Weather\ndescription: Get weather forecasts.\n---\n\n# Weather\n",
      "utf8",
    );
    const result = scanInstalledSkills({ curatedDir });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Weather");
    expect(result[0]?.description).toBe("Get weather forecasts.");
  });

  it("uses slug as fallback name when frontmatter is missing", () => {
    const curatedDir = resolve(tempRoot, "curated");
    writeSkill(curatedDir, "plain-skill");
    const result = scanInstalledSkills({ curatedDir });
    expect(result[0]?.name).toBe("plain-skill");
    expect(result[0]?.description).toBe("");
  });
});
