import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ControllerEnv } from "../app/env.js";
import { ensureRelativeChildPath } from "../lib/path-utils.js";
import { buildSkillManifest } from "../lib/skill-manifest.js";
import type { ControllerSkills } from "../store/schemas.js";

export class OpenClawSkillsWriter {
  constructor(private readonly env: ControllerEnv) {}

  async materialize(skills: ControllerSkills): Promise<void> {
    await mkdir(this.env.openclawSkillsDir, { recursive: true });
    const enabledEntries = Object.entries(skills.items).filter(
      ([, item]) => item.enabled,
    );
    const expectedSlugs = new Set(enabledEntries.map(([slug]) => slug));

    const existingEntries = await readdir(this.env.openclawSkillsDir, {
      withFileTypes: true,
    });
    for (const entry of existingEntries) {
      if (entry.isDirectory() && !expectedSlugs.has(entry.name)) {
        await rm(path.join(this.env.openclawSkillsDir, entry.name), {
          recursive: true,
          force: true,
        });
      }
    }

    for (const [slug, item] of enabledEntries) {
      const skillDir = path.join(this.env.openclawSkillsDir, slug);
      const files: Record<string, string> = {
        "SKILL.md": item.content,
        ...item.files,
      };

      await mkdir(skillDir, { recursive: true });
      for (const [relativeFilePath, content] of Object.entries(files)) {
        const safeRelativePath = ensureRelativeChildPath(relativeFilePath);
        const targetPath = path.join(skillDir, safeRelativePath);
        await mkdir(path.dirname(targetPath), { recursive: true });
        const tempPath = `${targetPath}.tmp`;
        await writeFile(tempPath, content, "utf8");
        await rename(tempPath, targetPath);
      }

      const manifest = buildSkillManifest({
        slug,
        source: item.source,
        files,
      });
      const manifestPath = path.join(skillDir, ".nexu-skill.json");
      const tempManifestPath = `${manifestPath}.tmp`;
      await writeFile(
        tempManifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
      await rename(tempManifestPath, manifestPath);
    }
  }
}
