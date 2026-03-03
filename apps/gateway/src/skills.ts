import { chmod, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { runtimeSkillsResponseSchema } from "@nexu/shared";
import { fetchJson } from "./api.js";
import { env } from "./env.js";
import { GatewayError, logger } from "./log.js";
import type { RuntimeState } from "./state.js";
import { setSkillsSyncStatus } from "./state.js";

function isValidSkillFilePath(filePath: string): boolean {
  return (
    filePath.length > 0 &&
    !filePath.startsWith("/") &&
    !filePath.includes("..") &&
    !filePath.includes("\\") &&
    !filePath.includes("\x00") &&
    /^[a-zA-Z0-9._/-]+$/.test(filePath)
  );
}

async function pruneStaleFiles(
  skillDir: string,
  keepPaths: Set<string>,
): Promise<void> {
  const entries = await readdir(skillDir, {
    withFileTypes: true,
    recursive: true,
  });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith(".tmp")) continue;
    const rel = relative(
      skillDir,
      join(entry.parentPath ?? skillDir, entry.name),
    );
    if (!keepPaths.has(rel)) {
      await rm(join(skillDir, rel), { force: true });
    }
  }
}

async function writeSkillFiles(
  skillsMap: Record<string, Record<string, string>>,
): Promise<void> {
  await mkdir(env.OPENCLAW_SKILLS_DIR, { recursive: true });

  const existing = await readdir(env.OPENCLAW_SKILLS_DIR, {
    withFileTypes: true,
  });
  const incomingNames = new Set(Object.keys(skillsMap));
  for (const entry of existing) {
    if (entry.isDirectory() && !incomingNames.has(entry.name)) {
      await rm(join(env.OPENCLAW_SKILLS_DIR, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }

  for (const [name, files] of Object.entries(skillsMap)) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
      throw new Error(`invalid skill name: ${name}`);
    }
    const skillDir = join(env.OPENCLAW_SKILLS_DIR, name);
    await mkdir(skillDir, { recursive: true });

    const writtenPaths = new Set<string>();

    for (const [filePath, content] of Object.entries(files)) {
      if (!isValidSkillFilePath(filePath)) {
        logger.warn(
          GatewayError.from(
            {
              source: "skills/write-files",
              message: "skipping invalid skill file path",
              code: "invalid_skill_file_path",
            },
            {
              name,
              filePath,
            },
          ).toJSON(),
          "skipping invalid skill file path",
        );
        continue;
      }
      const target = join(skillDir, filePath);
      await mkdir(dirname(target), { recursive: true });
      const temp = `${target}.tmp`;
      await writeFile(temp, content, "utf8");
      await rename(temp, target);

      if (filePath.endsWith(".sh")) {
        await chmod(target, 0o755);
      }

      writtenPaths.add(filePath);
    }

    await pruneStaleFiles(skillDir, writtenPaths);
  }
}

export async function pollLatestSkills(state: RuntimeState): Promise<boolean> {
  const response = await fetchJson("/api/internal/skills/latest", {
    method: "GET",
  });
  const payload = runtimeSkillsResponseSchema.parse(response);

  if (payload.skillsHash === state.lastSkillsHash) {
    return false;
  }

  await writeSkillFiles(payload.skills);
  state.lastSkillsHash = payload.skillsHash;
  setSkillsSyncStatus(state, "active");

  logger.info(
    {
      version: payload.version,
      hash: payload.skillsHash,
    },
    "applied new skills snapshot",
  );

  return true;
}
