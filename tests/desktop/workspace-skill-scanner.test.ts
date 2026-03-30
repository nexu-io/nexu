import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceSkillScanner } from "#controller/services/skillhub/workspace-skill-scanner.js";

describe("WorkspaceSkillScanner", () => {
  let tmpDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "ws-scan-"));
    stateDir = tmpDir;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function createAgentSkill(botId: string, slug: string): void {
    const dir = path.join(stateDir, "agents", botId, "skills", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: ${slug}\ndescription: Test skill\n---\nInstructions here.`,
    );
  }

  it("returns empty map when no agents dir exists", () => {
    const scanner = new WorkspaceSkillScanner(stateDir);
    const result = scanner.scanAll(["bot-1"]);
    expect(result.size).toBe(0);
  });

  it("detects skills in agent workspace", () => {
    createAgentSkill("bot-1", "my-tool");
    createAgentSkill("bot-1", "web-scraper");

    const scanner = new WorkspaceSkillScanner(stateDir);
    const result = scanner.scanAll(["bot-1"]);

    expect(result.get("bot-1")).toEqual(
      expect.arrayContaining(["my-tool", "web-scraper"]),
    );
    expect(result.get("bot-1")).toHaveLength(2);
  });

  it("scans multiple agents independently", () => {
    createAgentSkill("bot-1", "tool-a");
    createAgentSkill("bot-2", "tool-b");

    const scanner = new WorkspaceSkillScanner(stateDir);
    const result = scanner.scanAll(["bot-1", "bot-2"]);

    expect(result.get("bot-1")).toEqual(["tool-a"]);
    expect(result.get("bot-2")).toEqual(["tool-b"]);
  });

  it("ignores directories without SKILL.md", () => {
    const dir = path.join(stateDir, "agents", "bot-1", "skills", "broken");
    mkdirSync(dir, { recursive: true });
    // No SKILL.md

    const scanner = new WorkspaceSkillScanner(stateDir);
    const result = scanner.scanAll(["bot-1"]);

    expect(result.size).toBe(0);
  });

  it("detects symlinked skills (clawhub install pattern)", () => {
    // clawhub install creates: workspace/skills/slug -> ../.agents/skills/slug
    const realDir = path.join(
      stateDir,
      "agents",
      "bot-1",
      ".agents",
      "skills",
      "obsidian",
    );
    mkdirSync(realDir, { recursive: true });
    writeFileSync(
      path.join(realDir, "SKILL.md"),
      "---\nname: obsidian\n---\nTest.",
    );

    const linkDir = path.join(stateDir, "agents", "bot-1", "skills");
    mkdirSync(linkDir, { recursive: true });
    symlinkSync(realDir, path.join(linkDir, "obsidian"));

    const scanner = new WorkspaceSkillScanner(stateDir);
    const result = scanner.scanAll(["bot-1"]);

    expect(result.get("bot-1")).toEqual(["obsidian"]);
  });

  it("only scans provided bot IDs", () => {
    createAgentSkill("bot-1", "tool-a");
    createAgentSkill("bot-2", "tool-b");

    const scanner = new WorkspaceSkillScanner(stateDir);
    const result = scanner.scanAll(["bot-1"]);

    expect(result.has("bot-1")).toBe(true);
    expect(result.has("bot-2")).toBe(false);
  });
});
