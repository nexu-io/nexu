import crypto from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export interface InstalledSkill {
  name: string;
  description: string;
  longDescription?: string;
  tag: string;
  icon: string;
  source: string;
  examples?: string[];
  prompt: string;
  requires?: { tools?: string[]; plugins?: string[] };
  contentHash: string;
}

interface FrontmatterData {
  name?: string;
  description?: string;
  longDescription?: string;
  tag?: string;
  icon?: string;
  source?: string;
  examples?: string[];
  prompt?: string;
  requires?: { tools?: string[]; plugins?: string[] };
}

/**
 * Parse YAML frontmatter between `---` markers.
 *
 * Handles:
 * - Simple key-value pairs (`key: value`)
 * - Quoted strings (`key: "value"`)
 * - Block scalars (`key: |` or `key: >` followed by indented lines)
 * - Arrays (`key:` followed by `  - item` lines)
 * - One level of nested objects (`key:` → `  nestedKey:` → `    - item`)
 */
export function parseFrontmatter(content: string): {
  data: FrontmatterData;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) {
    return { data: {}, body: content };
  }

  const frontmatterBlock = match[1];
  const body = content.slice(match[0].length).trim();
  const lines = frontmatterBlock.split(/\r?\n/);

  const data: Record<string, unknown> = {};

  // Parser state
  let currentKey = "";
  let currentNested: Record<string, unknown> | null = null;
  let nestedKey = "";
  // Block scalar state (for `key: |` or `key: >`)
  let blockScalarKey = "";
  let blockScalarLines: string[] = [];
  let blockScalarIndent = 0;
  let blockScalarNested: Record<string, unknown> | null = null;
  let blockScalarNestedKey = "";

  function flushBlockScalar(): void {
    if (!blockScalarKey) return;
    const text = blockScalarLines.join("\n").trimEnd();
    if (blockScalarNested && blockScalarNestedKey) {
      blockScalarNested[blockScalarNestedKey] = text;
    } else {
      data[blockScalarKey] = text;
    }
    blockScalarKey = "";
    blockScalarLines = [];
    blockScalarIndent = 0;
    blockScalarNested = null;
    blockScalarNestedKey = "";
  }

  for (const line of lines) {
    // If collecting a block scalar, check if this line continues it
    if (blockScalarKey) {
      // A line indented deeper than the key belongs to the block scalar.
      // First content line determines the indent level.
      if (blockScalarIndent === 0 && line.match(/^\s+\S/)) {
        const indentMatch = line.match(/^(\s+)/);
        blockScalarIndent = indentMatch?.[1]?.length ?? 2;
      }

      if (
        blockScalarIndent > 0 &&
        (line === "" || line.match(new RegExp(`^\\s{${blockScalarIndent}}`)))
      ) {
        // Strip the block indent and add the content line
        const stripped = line === "" ? "" : line.slice(blockScalarIndent);
        blockScalarLines.push(stripped);
        continue;
      }

      // This line is not part of the block scalar — flush and fall through
      flushBlockScalar();
    }

    // Skip empty lines (outside block scalars)
    if (line.trim() === "") continue;

    // Nested object's array item: 4 spaces + "- value"
    const nestedArrayItem = line.match(/^ {4}- (.+)$/);
    if (nestedArrayItem?.[1] && currentNested && nestedKey) {
      const arr = currentNested[nestedKey];
      if (Array.isArray(arr)) {
        arr.push(nestedArrayItem[1].replace(/^"|"$/g, "").trim());
      }
      continue;
    }

    // Top-level array item: 2 spaces + "- value"
    const arrayItem = line.match(/^ {2}- (.+)$/);
    if (arrayItem?.[1] && currentKey && !currentNested) {
      const arr = data[currentKey];
      if (Array.isArray(arr)) {
        arr.push(arrayItem[1].replace(/^"|"$/g, "").trim());
      }
      continue;
    }

    // Nested key inside an object: 2 spaces + "key:"
    const nestedKeyMatch = line.match(/^ {2}(\w[\w-]*):\s*(.*)$/);
    if (nestedKeyMatch?.[1] && currentNested) {
      nestedKey = nestedKeyMatch[1];
      const val = nestedKeyMatch[2]?.trim() ?? "";
      if (val === "|" || val === ">") {
        blockScalarKey = currentKey;
        blockScalarNested = currentNested;
        blockScalarNestedKey = nestedKey;
      } else if (val === "") {
        currentNested[nestedKey] = [];
      } else {
        currentNested[nestedKey] = val.replace(/^"|"$/g, "");
      }
      continue;
    }

    // Top-level key-value pair
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kvMatch?.[1]) {
      const key = kvMatch[1];
      const val = kvMatch[2]?.trim() ?? "";

      currentNested = null;
      nestedKey = "";

      if (val === "|" || val === ">") {
        // Block scalar — collect following indented lines
        currentKey = key;
        blockScalarKey = key;
      } else if (val === "") {
        // Could be an array or nested object — determined by next line
        data[key] = [];
        currentKey = key;
      } else {
        data[key] = val.replace(/^"|"$/g, "");
        currentKey = key;
      }
      continue;
    }

    // Check if the current top-level key should become a nested object
    if (
      currentKey &&
      Array.isArray(data[currentKey]) &&
      (data[currentKey] as unknown[]).length === 0
    ) {
      const possibleNested = line.match(/^ {2}(\w[\w-]*):\s*(.*)$/);
      if (possibleNested?.[1]) {
        const obj: Record<string, unknown> = {};
        currentNested = obj;
        data[currentKey] = obj;
        nestedKey = possibleNested[1];
        const nVal = possibleNested[2]?.trim() ?? "";
        if (nVal === "|" || nVal === ">") {
          blockScalarKey = currentKey;
          blockScalarNested = currentNested;
          blockScalarNestedKey = nestedKey;
        } else if (nVal === "") {
          obj[nestedKey] = [];
        } else {
          obj[nestedKey] = nVal.replace(/^"|"$/g, "");
        }
      }
    }
  }

  // Flush any trailing block scalar
  flushBlockScalar();

  return { data: data as FrontmatterData, body };
}

/**
 * Recursively collect all file paths under a directory, sorted by relative path.
 * Hash each file's relative path + content. Return the SHA-256 hex digest.
 */
export async function hashDirectory(dirPath: string): Promise<string> {
  const files = await collectFiles(dirPath);
  const relativePaths = files
    .map((f) => relative(dirPath, f))
    .sort((a, b) => a.localeCompare(b));

  const hash = crypto.createHash("sha256");

  for (const relPath of relativePaths) {
    const fullPath = join(dirPath, relPath);
    const content = await readFile(fullPath);
    hash.update(relPath);
    hash.update(content);
  }

  return hash.digest("hex");
}

async function collectFiles(dirPath: string): Promise<readonly string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Scan a directory for installed skills.
 * Each subdirectory containing a SKILL.md file is treated as an installed skill.
 * Returns an empty array if the directory does not exist.
 */
export async function scanInstalledSkills(
  skillsDir: string,
): Promise<readonly InstalledSkill[]> {
  const dirExists = await stat(skillsDir)
    .then((s) => s.isDirectory())
    .catch(() => false);

  if (!dirExists) {
    return [];
  }

  const entries = await readdir(skillsDir, { withFileTypes: true });
  const results: InstalledSkill[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory()) continue;

    const skillDir = join(skillsDir, entry.name);
    const skillMdPath = join(skillDir, "SKILL.md");

    const skillMdExists = await stat(skillMdPath)
      .then((s) => s.isFile())
      .catch(() => false);

    if (!skillMdExists) continue;

    const rawContent = await readFile(skillMdPath, "utf-8");
    const { data, body } = parseFrontmatter(rawContent);
    const contentHash = await hashDirectory(skillDir);

    // The `prompt` field is the full markdown body (the actual skill instructions),
    // matching build-index.ts which sets `prompt: content.trim()`.
    // The frontmatter `prompt` field is just a one-line summary for the UI.
    const skill: InstalledSkill = {
      name: data.name ?? entry.name,
      description: data.description ?? "",
      tag: data.tag ?? "",
      icon: data.icon ?? "",
      source: data.source ?? "local",
      prompt: body,
      contentHash,
    };

    if (data.longDescription !== undefined) {
      skill.longDescription = data.longDescription;
    }

    if (data.examples !== undefined && Array.isArray(data.examples)) {
      skill.examples = data.examples;
    }

    if (data.requires !== undefined) {
      skill.requires = data.requires as {
        tools?: string[];
        plugins?: string[];
      };
    }

    results.push(skill);
  }

  return results;
}

/**
 * Resolve the skills directory path.
 *
 * Priority:
 * 1. OPENCLAW_SKILLS_DIR env var (explicit override)
 * 2. ~/.openclaw/skills (user home — canonical location for local dev & desktop)
 */
export function resolveSkillsDir(): string {
  if (process.env.OPENCLAW_SKILLS_DIR) {
    return process.env.OPENCLAW_SKILLS_DIR;
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return resolve(home, ".openclaw", "skills");
}
