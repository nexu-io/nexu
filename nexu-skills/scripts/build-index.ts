import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.resolve(__dirname, "..", "skills");
const outputPath = path.resolve(__dirname, "..", "skills.json");

interface SkillRequires {
  readonly tools: readonly string[];
  readonly plugins: readonly string[];
}

interface SkillEntry {
  readonly description: string;
  readonly longDescription: string;
  readonly tag: string;
  readonly icon: string;
  readonly source: string;
  readonly examples: readonly string[];
  readonly prompt: string;
  readonly requires: SkillRequires;
  readonly path: string;
}

interface SkillsIndex {
  readonly version: number;
  readonly skills: Record<string, SkillEntry>;
}

function parseSkillFile(
  skillName: string,
  filePath: string,
): SkillEntry | null {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);

  if (!data.description) {
    console.warn(
      `Warning: ${skillName}/SKILL.md missing description, skipping`,
    );
    return null;
  }

  return {
    description: String(data.description ?? ""),
    longDescription: String(data.longDescription ?? ""),
    tag: String(data.tag ?? ""),
    icon: String(data.icon ?? "Sparkles"),
    source: String(data.source ?? "official"),
    examples: Array.isArray(data.examples) ? data.examples.map(String) : [],
    prompt: content.trim(),
    requires: {
      tools: Array.isArray(data.requires?.tools)
        ? data.requires.tools.map(String)
        : [],
      plugins: Array.isArray(data.requires?.plugins)
        ? data.requires.plugins.map(String)
        : [],
    },
    path: `skills/${skillName}`,
  };
}

function buildIndex(): SkillsIndex {
  if (!fs.existsSync(skillsDir)) {
    return { version: 1, skills: {} };
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skills: Record<string, SkillEntry> = {};

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) {
      continue;
    }

    const parsed = parseSkillFile(entry.name, skillMdPath);
    if (parsed !== null) {
      skills[entry.name] = parsed;
    }
  }

  return { version: 1, skills };
}

const index = buildIndex();
const skillCount = Object.keys(index.skills).length;

fs.writeFileSync(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf-8");
console.log(`Generated skills.json with ${skillCount} skills`);
