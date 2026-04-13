import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { SkillDb } from "./skill-db.js";

const LIBTV_VIDEO_SLUG = "libtv-video";

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
  "libtv-video",
  "coding-agent",
  "gh-issues",
  "clawhub",
  "nano-banana-one-shop",
  "deep-research",
  "research-to-diagram",
  "qiaomu-mondo-poster-design",
  "medeo-video",
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

  const knownSlugs = params.skillDb.getAllKnownSlugs();

  for (const slug of STATIC_SKILL_SLUGS) {
    const destDir = resolve(params.targetDir, slug);
    if (existsSync(resolve(destDir, "SKILL.md"))) {
      skipped.push(slug);
      continue;
    }

    // Skip if ledger already knows this slug (user uninstalled it, or it's tracked)
    if (knownSlugs.has(slug)) {
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

/**
 * Unconditionally install the latest bundled libtv-video into the state
 * dir on every controller startup. If a previous copy exists, it is
 * wiped and replaced; if not, a fresh copy is installed. The managed
 * ledger record is upserted via `recordInstall`, which also flips any
 * prior `uninstalled` status back to `installed` (intentional — see
 * below).
 *
 * Why this exists: `copyStaticSkills` only copies a static skill on
 * first install (both `destDir/SKILL.md` and `knownSlugs.has(slug)`
 * guards skip thereafter), so bundled libtv-video updates never reach
 * existing users on an app update. This function is how the libtv-video
 * refactor (detached background waiter + direct Feishu delivery via
 * `feishu_send_video.py`) ships to existing users on their next boot.
 *
 * Scope constraints:
 *   - Only libtv-video. Other bundled static skills keep the existing
 *     first-install-only semantics from `copyStaticSkills`.
 *   - Only touches `<targetDir>/libtv-video/`. User-scoped copies under
 *     `~/.agents/skills/libtv-video/` and per-agent workspace copies
 *     under `<openclawStateDir>/agents/<agentId>/skills/libtv-video/`
 *     are left alone — they represent explicit user choices under
 *     different ledger sources.
 *   - Only modifies the `source: "managed"` ledger record. Workspace /
 *     user / custom records for the same slug are left untouched.
 *   - Does NOT respect the managed record's uninstalled status —
 *     libtv-video is treated as a core bundled capability that always
 *     tracks the shipped version. `recordInstall` upserts any prior
 *     `uninstalled` record back to `installed`.
 *
 * Why a dedicated function instead of reusing `copyStaticSkills`: its
 * `knownSlugs.has(slug)` guard skips on any ledger source, so even if
 * we removed the `managed` record beforehand, any stray workspace or
 * user record for libtv-video would still cause a silent skip. This
 * function bypasses that check deterministically.
 */
export function replaceLibtvVideoFromBundle(params: {
  staticDir: string;
  targetDir: string;
  skillDb: SkillDb;
}): {
  installed: boolean;
  reason: "bundle-missing" | "fresh-install" | "replaced";
} {
  const srcDir = resolve(params.staticDir, LIBTV_VIDEO_SLUG);
  if (!existsSync(srcDir)) {
    return { installed: false, reason: "bundle-missing" };
  }

  const destDir = resolve(params.targetDir, LIBTV_VIDEO_SLUG);
  const existed = existsSync(destDir);
  if (existed) {
    rmSync(destDir, { recursive: true, force: true });
  }
  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, { recursive: true });
  params.skillDb.recordInstall(LIBTV_VIDEO_SLUG, "managed");

  return { installed: true, reason: existed ? "replaced" : "fresh-install" };
}

export type CuratedInstallResult = {
  installed: string[];
  skipped: string[];
  failed: string[];
};

/**
 * Returns the list of curated skill slugs that need to be installed.
 * Skips slugs the user explicitly removed and slugs already present on disk.
 *
 * @deprecated Use {@link CatalogManager.getCuratedSlugsToEnqueue} instead,
 * which checks only the ledger (no disk I/O). This function is retained for
 * backward compatibility with {@link CatalogManager.installCuratedSkills}.
 */
export function resolveCuratedSkillsToInstall(params: {
  targetDir: string;
  skillDb: SkillDb;
}): { toInstall: string[]; toSkip: string[] } {
  const toInstall: string[] = [];
  const toSkip: string[] = [];

  for (const slug of CURATED_SKILL_SLUGS) {
    const skillDir = resolve(params.targetDir, slug);
    if (existsSync(resolve(skillDir, "SKILL.md"))) {
      toSkip.push(slug);
      continue;
    }
    toInstall.push(slug);
  }

  return { toInstall, toSkip };
}
