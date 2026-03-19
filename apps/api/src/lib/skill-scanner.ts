import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export type SkillSource = "curated" | "managed";

export type InstalledSkill = {
  slug: string;
  source: SkillSource;
  name: string;
  description: string;
};

export type ScanDirs = {
  curatedDir?: string;
  managedDir?: string;
};

function parseFrontmatter(filePath: string): {
  name: string;
  description: string;
} {
  try {
    const content = readFileSync(filePath, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match?.[1]) return { name: "", description: "" };
    const frontmatter = match[1];
    const nameMatch = frontmatter.match(/^name:\s*['"]?(.+?)['"]?\s*$/m);
    const descMatch = frontmatter.match(/^description:\s*['"]?(.+?)['"]?\s*$/m);
    return {
      name: nameMatch?.[1]?.trim() ?? "",
      description: descMatch?.[1]?.trim() ?? "",
    };
  } catch {
    return { name: "", description: "" };
  }
}

/**
 * Returns the installed skills in `dir`, with `name` and `description` parsed
 * from each SKILL.md frontmatter block. Returns an empty array if the directory
 * does not exist or cannot be read.
 */
function scanDirWithMeta(dir: string, source: SkillSource): InstalledSkill[] {
  if (!dir || !existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(resolve(dir, entry.name, "SKILL.md")),
      )
      .map((entry) => {
        const { name, description } = parseFrontmatter(
          resolve(dir, entry.name, "SKILL.md"),
        );
        return {
          slug: entry.name,
          source,
          name: name || entry.name,
          description: description || "",
        };
      });
  } catch {
    return [];
  }
}

/**
 * Scans curated and managed skill directories and returns a deduplicated
 * flat array of `InstalledSkill` objects.
 *
 * Precedence (lowest to highest — later source wins on slug collision):
 *   curated < managed
 */
export function scanInstalledSkills(dirs: ScanDirs): InstalledSkill[] {
  const merged = new Map<string, InstalledSkill>();

  // Tier 1: curated (Nexu bundled defaults — lower precedence)
  for (const skill of scanDirWithMeta(dirs.curatedDir ?? "", "curated")) {
    merged.set(skill.slug, skill);
  }

  // Tier 2: managed (user community installs — higher precedence)
  for (const skill of scanDirWithMeta(dirs.managedDir ?? "", "managed")) {
    merged.set(skill.slug, skill);
  }

  return Array.from(merged.values());
}
