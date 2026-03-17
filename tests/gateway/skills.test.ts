import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#gateway/api.js");
vi.mock("#gateway/env.js", () => ({
  env: {
    OPENCLAW_SKILLS_DIR: "",
  },
}));
vi.mock("#gateway/log.js", () => ({
  log: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as api from "#gateway/api.js";
import { env } from "#gateway/env.js";
import { pollLatestSkills } from "#gateway/skills.js";
import { createRuntimeState } from "#gateway/state.js";

const fetchJson = vi.mocked(api.fetchJson);

function makePayload(
  skills: Record<string, Record<string, string>>,
  hash?: string,
  version = 1,
) {
  const h =
    hash ?? createHash("sha256").update(JSON.stringify(skills)).digest("hex");
  return {
    version,
    skillsHash: h,
    skills,
    createdAt: new Date().toISOString(),
  };
}

/** Shorthand: wrap flat skill content into nested { "SKILL.md": content } format */
function flat(
  skills: Record<string, string>,
): Record<string, Record<string, string>> {
  const nested: Record<string, Record<string, string>> = {};
  for (const [name, content] of Object.entries(skills)) {
    nested[name] = { "SKILL.md": content };
  }
  return nested;
}

describe("Gateway skills.ts", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "nexu-skills-test-"));
    (env as { OPENCLAW_SKILLS_DIR: string }).OPENCLAW_SKILLS_DIR = tempDir;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ----------------------------------------------------------------
  // pollLatestSkills
  // ----------------------------------------------------------------

  it("1. hash matches state → returns false, no files written", async () => {
    const state = createRuntimeState();
    const payload = makePayload(flat({ "my-skill": "# Content" }), "abc123");
    state.lastSkillsHash = "abc123";
    (fetchJson as ReturnType<typeof vi.fn>).mockResolvedValue(payload);

    const result = await pollLatestSkills(state);

    expect(result).toBe(false);
    const entries = await readdir(tempDir);
    expect(entries).toHaveLength(0);
  });

  it("2. hash differs → returns true, SKILL.md written", async () => {
    const state = createRuntimeState();
    const payload = makePayload(flat({ "my-skill": "# Hello" }));
    (fetchJson as ReturnType<typeof vi.fn>).mockResolvedValue(payload);

    const result = await pollLatestSkills(state);

    expect(result).toBe(true);
    const content = await readFile(
      join(tempDir, "my-skill", "SKILL.md"),
      "utf8",
    );
    expect(content).toBe("# Hello");
  });

  it("3. after write → lastSkillsHash updated, skillsSyncStatus active", async () => {
    const state = createRuntimeState();
    const payload = makePayload(flat({ "my-skill": "# Hello" }));
    (fetchJson as ReturnType<typeof vi.fn>).mockResolvedValue(payload);

    await pollLatestSkills(state);

    expect(state.lastSkillsHash).toBe(payload.skillsHash);
    expect(state.skillsSyncStatus).toBe("active");
  });

  it("4. snapshot removes a skill → old dir deleted, new file present", async () => {
    // First write: skill-a and skill-b
    const state = createRuntimeState();
    const payload1 = makePayload(flat({ "skill-a": "a", "skill-b": "b" }));
    (fetchJson as ReturnType<typeof vi.fn>).mockResolvedValue(payload1);
    await pollLatestSkills(state);

    // Second write: only skill-a remains
    const payload2 = makePayload(flat({ "skill-a": "a updated" }));
    (fetchJson as ReturnType<typeof vi.fn>).mockResolvedValue(payload2);
    await pollLatestSkills(state);

    const entries = await readdir(tempDir);
    expect(entries).toContain("skill-a");
    expect(entries).not.toContain("skill-b");

    const content = await readFile(
      join(tempDir, "skill-a", "SKILL.md"),
      "utf8",
    );
    expect(content).toBe("a updated");
  });

  it("5. invalid name in payload → throws 'invalid skill name'", async () => {
    const state = createRuntimeState();
    const payload = makePayload(flat({ "../escape": "evil" }));
    (fetchJson as ReturnType<typeof vi.fn>).mockResolvedValue(payload);

    await expect(pollLatestSkills(state)).rejects.toThrow("invalid skill name");
  });

  // ----------------------------------------------------------------
  // pollLatestSkills — multiple skills
  // ----------------------------------------------------------------

  it("6. multiple skills → all SKILL.md files written via pollLatestSkills", async () => {
    const state = createRuntimeState();
    const skillsFlat = {
      "skill-one": "# One",
      "skill-two": "# Two",
      "skill-three": "# Three",
    };
    const payload = makePayload(flat(skillsFlat));
    (fetchJson as ReturnType<typeof vi.fn>).mockResolvedValue(payload);

    const result = await pollLatestSkills(state);

    expect(result).toBe(true);
    for (const [name, content] of Object.entries(skillsFlat)) {
      const written = await readFile(join(tempDir, name, "SKILL.md"), "utf8");
      expect(written).toBe(content);
    }
    expect(state.lastSkillsHash).toBe(payload.skillsHash);
  });

  // ----------------------------------------------------------------
  // writeSkillFiles (via pollLatestSkills)
  // ----------------------------------------------------------------

  it("8. write + read → content matches", async () => {
    const state = createRuntimeState();
    const content = "# My Skill\n\nDoes things.";
    const payload = makePayload(flat({ "content-skill": content }));
    (fetchJson as ReturnType<typeof vi.fn>).mockResolvedValue(payload);

    await pollLatestSkills(state);

    const written = await readFile(
      join(tempDir, "content-skill", "SKILL.md"),
      "utf8",
    );
    expect(written).toBe(content);
  });

  it("9. after write → no *.tmp files in skill dir", async () => {
    const state = createRuntimeState();
    const payload = makePayload(flat({ "clean-skill": "# Clean" }));
    (fetchJson as ReturnType<typeof vi.fn>).mockResolvedValue(payload);

    await pollLatestSkills(state);

    const skillDir = join(tempDir, "clean-skill");
    const files = await readdir(skillDir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});
