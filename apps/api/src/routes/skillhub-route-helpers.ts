import { resolve, sep } from "node:path";
import { z } from "@hono/zod-openapi";

export const SKILLHUB_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,127}$/;

export const skillhubSlugSchema = z.string().regex(SKILLHUB_SLUG_REGEX);

export function resolveSkillhubPath(
  skillsDir: string,
  slug: string,
): string | null {
  const rootDir = resolve(skillsDir);
  const skillPath = resolve(rootDir, slug);
  const normalizedRoot = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;

  if (skillPath === rootDir || skillPath.startsWith(normalizedRoot)) {
    return skillPath;
  }

  return null;
}
