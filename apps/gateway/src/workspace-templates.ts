import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  openclawConfigSchema,
  runtimeWorkspaceTemplatesResponseSchema,
} from "@nexu/shared";
import { fetchJson } from "./api.js";
import { env } from "./env.js";
import { GatewayError, logger } from "./log.js";
import type { RuntimeState } from "./state.js";
import { setWorkspaceTemplatesSyncStatus } from "./state.js";

const BLOCK_START = "<!-- NEXU-PLATFORM-START -->";
const BLOCK_END = "<!-- NEXU-PLATFORM-END -->";

interface TemplateEntry {
  content: string;
  writeMode: "seed" | "inject";
}

/**
 * Cached templates from the latest snapshot.
 * Kept in memory so we can re-apply when config changes even if templates
 * themselves haven't changed (e.g. a new bot workspace appeared).
 */
let cachedTemplates: Record<string, TemplateEntry> | null = null;

async function readWorkspacePaths(): Promise<string[]> {
  try {
    const raw = await readFile(env.OPENCLAW_CONFIG_PATH, "utf8");
    const config = openclawConfigSchema.parse(JSON.parse(raw));
    return config.agents.list
      .map((agent) => agent.workspace)
      .filter((ws): ws is string => typeof ws === "string" && ws.length > 0);
  } catch (error) {
    logger.warn(
      GatewayError.from(
        {
          source: "workspace-templates/read-config",
          message: "failed to read workspace paths from config",
          code: "config_read_error",
        },
        { reason: error instanceof Error ? error.message : String(error) },
      ).toJSON(),
      "failed to read workspace paths from config",
    );
    return [];
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, filePath);
}

/**
 * Apply inject content to an existing file.
 * The injectBlock already includes NEXU-PLATFORM-START/END markers.
 */
function applyInjectBlock(
  existingContent: string,
  injectBlock: string,
): string {
  const startIdx = existingContent.indexOf(BLOCK_START);
  const endIdx = existingContent.indexOf(BLOCK_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return (
      existingContent.substring(0, startIdx) +
      injectBlock +
      existingContent.substring(endIdx + BLOCK_END.length)
    );
  }

  const separator = existingContent.endsWith("\n") ? "\n" : "\n\n";
  return `${existingContent}${separator}${injectBlock}\n`;
}

async function writeTemplateToWorkspace(
  workspacePath: string,
  fileName: string,
  template: TemplateEntry,
): Promise<void> {
  const filePath = join(workspacePath, fileName);

  if (template.writeMode === "seed") {
    if (await fileExists(filePath)) {
      return;
    }
    await atomicWrite(filePath, template.content);
    return;
  }

  if (template.writeMode === "inject") {
    if (!(await fileExists(filePath))) {
      return;
    }

    const existing = await readFile(filePath, "utf8");
    const updated = applyInjectBlock(existing, template.content);

    if (updated !== existing) {
      await atomicWrite(filePath, updated);
    }
  }
}

async function writeTemplatesToWorkspaces(
  templates: Record<string, TemplateEntry>,
): Promise<void> {
  const workspacePaths = await readWorkspacePaths();

  if (workspacePaths.length === 0) {
    return;
  }

  for (const wsPath of workspacePaths) {
    for (const [fileName, template] of Object.entries(templates)) {
      try {
        await writeTemplateToWorkspace(wsPath, fileName, template);
      } catch (error) {
        logger.warn(
          GatewayError.from(
            {
              source: "workspace-templates/write",
              message: "failed to write template file",
              code: "template_write_error",
            },
            {
              workspace: wsPath,
              fileName,
              writeMode: template.writeMode,
              reason: error instanceof Error ? error.message : String(error),
            },
          ).toJSON(),
          "failed to write template file",
        );
      }
    }
  }
}

/**
 * Poll the API for workspace template changes.
 * If templates changed → fetch + write to all workspaces.
 * If only config changed (new workspace) → re-apply cached templates.
 */
export async function pollLatestWorkspaceTemplates(
  state: RuntimeState,
): Promise<boolean> {
  const response = await fetchJson("/api/internal/workspace-templates/latest", {
    method: "GET",
  });
  const payload = runtimeWorkspaceTemplatesResponseSchema.parse(response);

  const templatesChanged =
    payload.templatesHash !== state.lastWorkspaceTemplatesHash;
  const configChanged =
    state.lastConfigHash !== state._prevConfigHashForTemplates;

  if (!templatesChanged && !configChanged) {
    return false;
  }

  const templates = templatesChanged
    ? (payload.templates as Record<string, TemplateEntry>)
    : cachedTemplates;

  if (!templates || Object.keys(templates).length === 0) {
    state.lastWorkspaceTemplatesHash = payload.templatesHash;
    state._prevConfigHashForTemplates = state.lastConfigHash;
    return false;
  }

  await writeTemplatesToWorkspaces(templates);

  if (templatesChanged) {
    cachedTemplates = templates;
    state.lastWorkspaceTemplatesHash = payload.templatesHash;
    setWorkspaceTemplatesSyncStatus(state, "active");

    logger.info(
      { version: payload.version, hash: payload.templatesHash },
      "applied new workspace templates snapshot",
    );
  }

  if (configChanged) {
    state._prevConfigHashForTemplates = state.lastConfigHash;
    logger.info("re-applied workspace templates for config change");
  }

  return true;
}
