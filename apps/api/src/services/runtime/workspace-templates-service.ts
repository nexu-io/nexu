import crypto from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { desc, eq } from "drizzle-orm";
import type { Database } from "../../db/index.js";
import {
  workspaceTemplateSnapshots,
  workspaceTemplates,
} from "../../db/schema/index.js";

interface TemplateEntry {
  content: string;
  writeMode: "seed" | "inject";
}

interface WorkspaceTemplatesSnapshotRecord {
  id: string;
  version: number;
  templatesHash: string;
  templates: Record<string, TemplateEntry>;
  createdAt: string;
}

export function toWorkspaceTemplatesHash(
  templatesMap: Record<string, TemplateEntry>,
): string {
  const sorted: Record<string, TemplateEntry> = {};
  for (const [name, entry] of Object.entries(templatesMap).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    sorted[name] = entry;
  }
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(sorted))
    .digest("hex");
}

const MAX_PUBLISH_RETRIES = 5;

export async function publishWorkspaceTemplatesSnapshot(
  db: Database,
): Promise<WorkspaceTemplatesSnapshotRecord> {
  const activeTemplates = await db
    .select({
      name: workspaceTemplates.name,
      content: workspaceTemplates.content,
      writeMode: workspaceTemplates.writeMode,
    })
    .from(workspaceTemplates)
    .where(eq(workspaceTemplates.status, "active"))
    .orderBy(workspaceTemplates.name);

  const templatesMap: Record<string, TemplateEntry> = {};
  for (const tpl of activeTemplates) {
    templatesMap[tpl.name] = {
      content: tpl.content,
      writeMode: tpl.writeMode as "seed" | "inject",
    };
  }

  const templatesHash = toWorkspaceTemplatesHash(templatesMap);
  const templatesJson = JSON.stringify(templatesMap);

  for (let attempt = 0; attempt < MAX_PUBLISH_RETRIES; attempt++) {
    const [latest] = await db
      .select()
      .from(workspaceTemplateSnapshots)
      .orderBy(desc(workspaceTemplateSnapshots.version))
      .limit(1);

    if (latest && latest.templatesHash === templatesHash) {
      return {
        id: latest.id,
        version: latest.version,
        templatesHash: latest.templatesHash,
        templates: JSON.parse(latest.templatesJson) as Record<
          string,
          TemplateEntry
        >,
        createdAt: latest.createdAt,
      };
    }

    const nextVersion = (latest?.version ?? 0) + 1;
    const now = new Date().toISOString();

    await db
      .insert(workspaceTemplateSnapshots)
      .values({
        id: createId(),
        version: nextVersion,
        templatesHash,
        templatesJson,
        createdAt: now,
      })
      .onConflictDoNothing();

    const [committed] = await db
      .select()
      .from(workspaceTemplateSnapshots)
      .where(eq(workspaceTemplateSnapshots.version, nextVersion))
      .limit(1);

    if (committed && committed.templatesHash === templatesHash) {
      return {
        id: committed.id,
        version: committed.version,
        templatesHash: committed.templatesHash,
        templates: JSON.parse(committed.templatesJson) as Record<
          string,
          TemplateEntry
        >,
        createdAt: committed.createdAt,
      };
    }
  }

  throw new Error("publishWorkspaceTemplatesSnapshot: max retries exceeded");
}

export async function getLatestWorkspaceTemplatesSnapshot(
  db: Database,
): Promise<WorkspaceTemplatesSnapshotRecord> {
  const [latest] = await db
    .select()
    .from(workspaceTemplateSnapshots)
    .orderBy(desc(workspaceTemplateSnapshots.version))
    .limit(1);

  if (latest) {
    return {
      id: latest.id,
      version: latest.version,
      templatesHash: latest.templatesHash,
      templates: JSON.parse(latest.templatesJson) as Record<
        string,
        TemplateEntry
      >,
      createdAt: latest.createdAt,
    };
  }

  return publishWorkspaceTemplatesSnapshot(db);
}
