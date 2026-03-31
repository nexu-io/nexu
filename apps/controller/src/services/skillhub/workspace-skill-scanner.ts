import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export class WorkspaceSkillScanner {
  constructor(private readonly openclawStateDir: string) {}

  /**
   * Scan workspace skill directories for the given bot IDs.
   * Returns a map of botId -> slug[].
   * Only includes directories containing a SKILL.md file.
   */
  scanAll(botIds: readonly string[]): ReadonlyMap<string, readonly string[]> {
    const result = new Map<string, string[]>();

    for (const botId of botIds) {
      const workspaceSkillsDir = join(
        this.openclawStateDir,
        "agents",
        botId,
        "skills",
      );
      if (!existsSync(workspaceSkillsDir)) continue;

      const slugs = this.scanDir(workspaceSkillsDir);
      if (slugs.length > 0) {
        result.set(botId, slugs);
      }
    }

    return result;
  }

  private scanDir(dir: string): string[] {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => existsSync(join(dir, entry.name, "SKILL.md")))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }
}
