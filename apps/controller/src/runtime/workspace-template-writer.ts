import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ControllerEnv } from "../app/env.js";

export class WorkspaceTemplateWriter {
  constructor(private readonly env: ControllerEnv) {}

  async write(
    templates: Array<{ id: string; name: string; content: string }>,
  ): Promise<void> {
    await mkdir(this.env.openclawWorkspaceTemplatesDir, { recursive: true });

    for (const template of templates) {
      const targetPath = path.join(
        this.env.openclawWorkspaceTemplatesDir,
        `${template.id}.md`,
      );
      const tempPath = `${targetPath}.tmp`;
      await writeFile(tempPath, template.content, "utf8");
      await rename(tempPath, targetPath);
    }
  }
}
