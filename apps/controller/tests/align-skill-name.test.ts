import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CatalogManager } from "../src/services/skillhub/catalog-manager.js";
import {
  alignSkillName,
  stripRequiresBins,
} from "../src/services/skillhub/curated-skills.js";
import { SkillDb } from "../src/services/skillhub/skill-db.js";

describe("alignSkillName", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "nexu-align-skill-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("patches mismatched name to match slug", () => {
    const skillDir = path.join(tmpDir, "find-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: find-skills\ndescription: Find skills\n---\n# Find Skills\n",
    );

    alignSkillName(tmpDir, "find-skill");

    const content = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    expect(content).toContain("name: find-skill\n");
    expect(content).not.toContain("name: find-skills");
  });

  it("leaves file unchanged when name already matches slug", () => {
    const skillDir = path.join(tmpDir, "weather");
    mkdirSync(skillDir, { recursive: true });
    const original =
      "---\nname: weather\ndescription: Weather info\n---\n# Weather\n";
    writeFileSync(path.join(skillDir, "SKILL.md"), original);

    alignSkillName(tmpDir, "weather");

    const content = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    expect(content).toBe(original);
  });

  it("handles CRLF line endings", () => {
    const skillDir = path.join(tmpDir, "listenhub-ai");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\r\nname: listenhub\r\ndescription: Podcasts\r\n---\r\n# ListenHub\r\n",
    );

    alignSkillName(tmpDir, "listenhub-ai");

    const content = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    expect(content).toContain("name: listenhub-ai");
    expect(content).not.toContain("name: listenhub\r\n");
  });

  it("silently skips when SKILL.md does not exist", () => {
    // Should not throw
    alignSkillName(tmpDir, "nonexistent-skill");
  });

  it("silently skips when SKILL.md has no frontmatter", () => {
    const skillDir = path.join(tmpDir, "bad-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "# No frontmatter here\n");

    // Should not throw
    alignSkillName(tmpDir, "bad-skill");

    const content = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    expect(content).toBe("# No frontmatter here\n");
  });
});

describe("CatalogManager.getCatalog() display name with catalog-name", () => {
  let tmpDir: string;
  let skillDb: SkillDb;
  let skillsDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "nexu-catalog-name-"));
    const stateDir = path.join(tmpDir, "openclaw-state");
    skillsDir = path.join(stateDir, "skills");
    cacheDir = path.join(tmpDir, "skillhub-cache");
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });

    const dbPath = path.join(tmpDir, "skill-ledger.json");
    skillDb = await SkillDb.create(dbPath);
  });

  afterEach(async () => {
    skillDb.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("uses catalog-name for display when present", () => {
    const skillDir = path.join(skillsDir, "nano-banana-one-shop");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: nano-banana-one-shop\ncatalog-name: Nano Banana One Shop\ndescription: Image generation\n---\n",
    );
    skillDb.recordInstall("nano-banana-one-shop", "managed");

    const catalog = new CatalogManager(cacheDir, {
      skillsDir,
      userSkillsDir: path.join(tmpDir, "user-skills"),
      staticSkillsDir: undefined,
      skillDb,
      log: () => {},
    });

    const result = catalog.getCatalog();
    const skill = result.installedSkills.find(
      (s) => s.slug === "nano-banana-one-shop",
    );
    expect(skill?.name).toBe("Nano Banana One Shop");
  });

  it("falls back to name when catalog-name is absent", () => {
    const skillDir = path.join(skillsDir, "weather");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: weather\ndescription: Weather info\n---\n",
    );
    skillDb.recordInstall("weather", "managed");

    const catalog = new CatalogManager(cacheDir, {
      skillsDir,
      userSkillsDir: path.join(tmpDir, "user-skills"),
      staticSkillsDir: undefined,
      skillDb,
      log: () => {},
    });

    const result = catalog.getCatalog();
    const skill = result.installedSkills.find((s) => s.slug === "weather");
    expect(skill?.name).toBe("weather");
  });

  it("handles CRLF frontmatter for catalog-name extraction", () => {
    const skillDir = path.join(skillsDir, "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\r\nname: my-skill\r\ncatalog-name: My Skill\r\ndescription: A skill\r\n---\r\n",
    );
    skillDb.recordInstall("my-skill", "managed");

    const catalog = new CatalogManager(cacheDir, {
      skillsDir,
      userSkillsDir: path.join(tmpDir, "user-skills"),
      staticSkillsDir: undefined,
      skillDb,
      log: () => {},
    });

    const result = catalog.getCatalog();
    const skill = result.installedSkills.find((s) => s.slug === "my-skill");
    expect(skill?.name).toBe("My Skill");
  });

  it("falls back to slug when both catalog-name and name are missing", () => {
    const skillDir = path.join(skillsDir, "bare-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\ndescription: No name field\n---\n",
    );
    skillDb.recordInstall("bare-skill", "managed");

    const catalog = new CatalogManager(cacheDir, {
      skillsDir,
      userSkillsDir: path.join(tmpDir, "user-skills"),
      staticSkillsDir: undefined,
      skillDb,
      log: () => {},
    });

    const result = catalog.getCatalog();
    const skill = result.installedSkills.find((s) => s.slug === "bare-skill");
    expect(skill?.name).toBe("bare-skill");
  });
});

describe("stripRequiresBins", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "nexu-strip-requires-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("strips requires.bins from JSON-in-YAML metadata", () => {
    const skillDir = path.join(tmpDir, "libtv-video");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      '---\nname: libtv-video\nmetadata:\n  {\n    "openclaw":\n      {\n        "emoji": "🎬",\n        "requires": { "bins": ["python3"] },\n      },\n  }\n---\n# LibTV\n',
    );

    stripRequiresBins(tmpDir, "libtv-video");

    const content = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    expect(content).not.toContain("requires");
    expect(content).not.toContain("python3");
    expect(content).toContain("emoji");
    expect(content).toContain("# LibTV");
  });

  it("strips requires.anyBins from JSON-in-YAML metadata", () => {
    const skillDir = path.join(tmpDir, "coding-agent");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      '---\nname: coding-agent\nmetadata:\n  {\n    "openclaw": { "emoji": "🧩", "requires": { "anyBins": ["claude", "codex"] } },\n  }\n---\n# Agent\n',
    );

    stripRequiresBins(tmpDir, "coding-agent");

    const content = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    expect(content).not.toContain("requires");
    expect(content).not.toContain("claude");
    expect(content).toContain("emoji");
  });

  it("strips requires from standard YAML metadata", () => {
    const skillDir = path.join(tmpDir, "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: my-skill\nmetadata:\n  openclaw:\n    emoji: test\n    requires:\n      bins:\n        - node\n        - npm\n---\n# My Skill\n",
    );

    stripRequiresBins(tmpDir, "my-skill");

    const content = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    expect(content).not.toContain("requires");
    expect(content).not.toContain("node");
    expect(content).toContain("emoji: test");
    expect(content).toContain("# My Skill");
  });

  it("handles CRLF line endings", () => {
    const skillDir = path.join(tmpDir, "crlf-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      '---\r\nname: crlf-skill\r\nmetadata:\r\n  {\r\n    "openclaw":\r\n      {\r\n        "requires": { "bins": ["python3"] },\r\n      },\r\n  }\r\n---\r\n# CRLF\r\n',
    );

    stripRequiresBins(tmpDir, "crlf-skill");

    const content = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    expect(content).not.toContain("requires");
    expect(content).not.toContain("python3");
  });

  it("leaves file unchanged when no requires present", () => {
    const skillDir = path.join(tmpDir, "clean-skill");
    mkdirSync(skillDir, { recursive: true });
    const original =
      '---\nname: clean-skill\nmetadata:\n  {\n    "openclaw": { "emoji": "✅" },\n  }\n---\n# Clean\n';
    writeFileSync(path.join(skillDir, "SKILL.md"), original);

    stripRequiresBins(tmpDir, "clean-skill");

    const content = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    expect(content).toBe(original);
  });

  it("silently skips when SKILL.md does not exist", () => {
    stripRequiresBins(tmpDir, "nonexistent");
  });

  it("preserves skill body and scripts references", () => {
    const skillDir = path.join(tmpDir, "full-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      '---\nname: full-skill\ndescription: A full skill\nmetadata:\n  {\n    "openclaw":\n      {\n        "emoji": "🔧",\n        "requires": { "bins": ["ffmpeg"] },\n      },\n  }\n---\n# Full Skill\n\n## Requirements\n\n- ffmpeg required\n\n## Usage\n\n```bash\nffmpeg -i input.mp4 output.webm\n```\n',
    );

    stripRequiresBins(tmpDir, "full-skill");

    const content = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    expect(content).not.toContain('"requires"');
    expect(content).toContain("description: A full skill");
    expect(content).toContain("# Full Skill");
    expect(content).toContain("## Requirements");
    expect(content).toContain("ffmpeg -i input.mp4 output.webm");
  });
});
