import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

/**
 * Skills to install from ClawHub into `state/bundled-skills/` on first launch.
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
  "find-skills",
  "skill-creator",
] as const;

/**
 * Skills shipped as static files in the app bundle (apps/desktop/static/bundled-skills/).
 * These are NOT on ClawHub, so they're copied directly to `state/bundled-skills/`
 * instead of being installed via `clawhub install`.
 */
export const STATIC_SKILL_SLUGS: readonly string[] = [
  "coding-agent",
  "gh-issues",
  "clawhub",
] as const;

/**
 * Copies static skills from the app bundle to the curated skills directory.
 * Respects the user's removal ledger — won't re-copy skills the user uninstalled.
 */
export function copyStaticSkills(params: {
  staticDir: string;
  curatedDir: string;
  statePath: string;
}): { copied: string[]; skipped: string[] } {
  const state = readState(params.statePath);
  const removedSet = new Set(state.removedByUser);
  const copied: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(params.staticDir)) {
    return { copied, skipped };
  }

  for (const slug of STATIC_SKILL_SLUGS) {
    if (removedSet.has(slug)) {
      skipped.push(slug);
      continue;
    }

    const destDir = resolve(params.curatedDir, slug);
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

type CuratedState = {
  /** Slugs the user explicitly uninstalled — don't re-install on update */
  removedByUser: string[];
  /** Last set of slugs we attempted to install */
  lastInstalledVersion: string[];
};

function readState(statePath: string): CuratedState {
  if (!existsSync(statePath)) {
    return { removedByUser: [], lastInstalledVersion: [] };
  }
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as CuratedState;
  } catch {
    return { removedByUser: [], lastInstalledVersion: [] };
  }
}

function writeState(statePath: string, state: CuratedState): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
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
  curatedDir: string;
  statePath: string;
}): { toInstall: string[]; toSkip: string[] } {
  const state = readState(params.statePath);
  const removedSet = new Set(state.removedByUser);
  const toInstall: string[] = [];
  const toSkip: string[] = [];

  for (const slug of CURATED_SKILL_SLUGS) {
    if (removedSet.has(slug)) {
      toSkip.push(slug);
      continue;
    }
    const skillDir = resolve(params.curatedDir, slug);
    if (existsSync(resolve(skillDir, "SKILL.md"))) {
      toSkip.push(slug);
      continue;
    }
    toInstall.push(slug);
  }

  return { toInstall, toSkip };
}

/**
 * Records that the user explicitly uninstalled a curated skill,
 * so it won't be re-installed on the next app update.
 */
export function recordCuratedRemoval(params: {
  slug: string;
  statePath: string;
}): void {
  const state = readState(params.statePath);
  if (!state.removedByUser.includes(params.slug)) {
    const updated: CuratedState = {
      ...state,
      removedByUser: [...state.removedByUser, params.slug],
    };
    writeState(params.statePath, updated);
  }
}

/**
 * Updates the state file after a successful installation round.
 */
export function recordCuratedInstallation(params: {
  statePath: string;
  installed: string[];
}): void {
  const state = readState(params.statePath);
  const updated: CuratedState = {
    ...state,
    lastInstalledVersion: [...CURATED_SKILL_SLUGS],
  };
  writeState(params.statePath, updated);
}
