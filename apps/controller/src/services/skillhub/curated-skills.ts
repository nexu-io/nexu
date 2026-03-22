import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { SkillDb } from "./skill-db.js";

/**
 * Skills to install from ClawHub on first launch.
 */
export const CURATED_SKILL_SLUGS: readonly string[] = [
  // Security & tools
  "1password",
  "healthcheck",
  "skill-vetter",
  // Coding & GitHub
  "github",
  // Search & information
  "multi-search-engine",
  "xiaohongshu-mcp",
  "weather",
  // Communication & calendar
  "imap-smtp-email",
  "calendar",
  // Notes & content
  "apple-notes",
  "humanize-ai-text",
  // File & system
  "file-organizer-skill",
  "video-frames",
  "session-logs",
  // Skill management
  "skill-creator",
  // Browser & web
  "agent-browser",
  // Skill discovery
  "find-skill",
  // Search & content (ClawHub)
  "wechat-article-search",
  // Image generation (ClawHub)
  "liblib-ai-gen",
  // Audio & music
  "listenhub-ai",
] as const;

/**
 * Skills shipped as static files in the app bundle (apps/desktop/static/bundled-skills/).
 * These are NOT on ClawHub, so they're copied directly to the skills directory.
 */
export const STATIC_SKILL_SLUGS: readonly string[] = [
  "coding-agent",
  "gh-issues",
  "clawhub",
  "nano-banana-one-shop",
  "deep-research",
  "research-to-diagram",
  "qiaomu-mondo-poster-design",
] as const;

/**
 * Copies static skills from the app bundle to the target skills directory.
 * Respects the user's removal ledger — won't re-copy skills the user uninstalled.
 */
export function copyStaticSkills(params: {
  staticDir: string;
  targetDir: string;
  skillDb: SkillDb;
}): { copied: string[]; skipped: string[] } {
  const copied: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(params.staticDir)) {
    return { copied, skipped };
  }

  for (const slug of STATIC_SKILL_SLUGS) {
    if (params.skillDb.isRemovedByUser(slug)) {
      skipped.push(slug);
      continue;
    }

    const destDir = resolve(params.targetDir, slug);
    if (existsSync(resolve(destDir, "SKILL.md"))) {
      skipped.push(slug);
      continue;
    }

    const srcDir = resolve(params.staticDir, slug);
    if (!existsSync(srcDir)) {
      skipped.push(slug);
      continue;
    }

    mkdirSync(destDir, { recursive: true });
    cpSync(srcDir, destDir, { recursive: true });
    copied.push(slug);
  }

  return { copied, skipped };
}

export type CuratedInstallResult = {
  installed: string[];
  skipped: string[];
  failed: string[];
};

/**
 * Returns the list of curated skill slugs that need to be installed.
 * Skips slugs the user explicitly removed and slugs already present on disk.
 */
export function resolveCuratedSkillsToInstall(params: {
  targetDir: string;
  skillDb: SkillDb;
}): { toInstall: string[]; toSkip: string[] } {
  const toInstall: string[] = [];
  const toSkip: string[] = [];

  for (const slug of CURATED_SKILL_SLUGS) {
    if (params.skillDb.isRemovedByUser(slug)) {
      toSkip.push(slug);
      continue;
    }
    const skillDir = resolve(params.targetDir, slug);
    if (existsSync(resolve(skillDir, "SKILL.md"))) {
      toSkip.push(slug);
      continue;
    }
    toInstall.push(slug);
  }

  return { toInstall, toSkip };
}
