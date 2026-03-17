import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { skillListResponseSchema } from "@nexu/shared";
import type { CatalogSkill } from "../services/runtime/skill-catalog.js";
import { fetchSkillCatalog } from "../services/runtime/skill-catalog.js";
import type { InstalledSkill } from "../services/runtime/skill-scanner.js";
import {
  resolveSkillsDir,
  scanInstalledSkills,
} from "../services/runtime/skill-scanner.js";
import type { AppBindings } from "../types.js";

const TAG_LABELS: Record<string, string> = {
  "office-collab": "Office & Collaboration",
  "file-knowledge": "Files & Knowledge",
  "creative-design": "Creative & Design",
  "biz-analysis": "Business Analysis",
  "av-generation": "Audio & Video",
  "info-content": "Info & Content",
  "dev-tools": "Dev Tools",
};

type SkillTag =
  | "office-collab"
  | "file-knowledge"
  | "creative-design"
  | "biz-analysis"
  | "av-generation"
  | "info-content"
  | "dev-tools";

type SkillSource = "official" | "custom" | "community";

interface MergedSkillInfo {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly longDescription?: string;
  readonly iconName: string;
  readonly prompt: string;
  readonly examples?: string[];
  readonly tag: SkillTag;
  readonly source: SkillSource;
  readonly githubUrl?: string;
  readonly installed: boolean;
  readonly updatable: boolean;
}

const VALID_TAGS = new Set<string>(Object.keys(TAG_LABELS));

function isValidTag(tag: string): tag is SkillTag {
  return VALID_TAGS.has(tag);
}

function toValidTag(tag: string): SkillTag {
  return isValidTag(tag) ? tag : "dev-tools";
}

function toValidSource(source: string): SkillSource {
  if (source === "official" || source === "custom" || source === "community") {
    return source;
  }
  return "custom";
}

function buildCatalogSkillInfo(
  slug: string,
  catalogSkill: CatalogSkill,
  installed: boolean,
): MergedSkillInfo {
  return {
    slug,
    name: slug,
    description: catalogSkill.description,
    longDescription: catalogSkill.longDescription,
    iconName: catalogSkill.icon || "package",
    prompt: catalogSkill.prompt,
    examples:
      catalogSkill.examples && catalogSkill.examples.length > 0
        ? catalogSkill.examples
        : undefined,
    tag: toValidTag(catalogSkill.tag),
    source: toValidSource(catalogSkill.source),
    githubUrl: catalogSkill.path || undefined,
    installed,
    updatable: false,
  };
}

function buildLocalOnlySkillInfo(local: InstalledSkill): MergedSkillInfo {
  return {
    slug: local.name,
    name: local.name,
    description: local.description,
    longDescription: local.longDescription,
    iconName: local.icon || "package",
    prompt: local.prompt,
    examples:
      local.examples && local.examples.length > 0 ? local.examples : undefined,
    tag: toValidTag(local.tag),
    source: "custom",
    installed: true,
    updatable: false,
  };
}

const listFilesystemSkillsRoute = createRoute({
  method: "get",
  path: "/api/v1/skills/filesystem",
  tags: ["Skills"],
  responses: {
    200: {
      content: {
        "application/json": { schema: skillListResponseSchema },
      },
      description: "Merged list of catalog and locally installed skills",
    },
    500: {
      content: {
        "application/json": { schema: z.object({ message: z.string() }) },
      },
      description: "Internal server error",
    },
  },
});

export function registerFilesystemSkillRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(listFilesystemSkillsRoute, async (c) => {
    const skillsDir = resolveSkillsDir();
    const installedSkills = await scanInstalledSkills(skillsDir);

    const catalogResult = await fetchSkillCatalog().catch(
      (): { version: number; skills: Record<string, CatalogSkill> } => ({
        version: 0,
        skills: {},
      }),
    );

    const installedByName = new Map(installedSkills.map((s) => [s.name, s]));

    const tagCounts: Record<string, number> = {};
    const mergedSkills: MergedSkillInfo[] = [];

    // Process catalog skills, marking installed ones
    for (const [slug, catalogSkill] of Object.entries(catalogResult.skills)) {
      const isInstalled = installedByName.has(slug);
      const skill = buildCatalogSkillInfo(slug, catalogSkill, isInstalled);
      mergedSkills.push(skill);
      tagCounts[skill.tag] = (tagCounts[skill.tag] ?? 0) + 1;

      // Remove from local map so we don't double-add
      installedByName.delete(slug);
    }

    // Add local-only skills (not in catalog)
    for (const local of installedByName.values()) {
      const skill = buildLocalOnlySkillInfo(local);
      mergedSkills.push(skill);
      tagCounts[skill.tag] = (tagCounts[skill.tag] ?? 0) + 1;
    }

    const tags = Object.entries(TAG_LABELS).map(([id, label]) => ({
      id: id as SkillTag,
      label,
      count: tagCounts[id] ?? 0,
    }));

    return c.json({ skills: mergedSkills, tags }, 200);
  });
}
