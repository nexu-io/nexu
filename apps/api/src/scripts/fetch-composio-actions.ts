/**
 * Fetches real action slugs from the Composio API for all 26 toolkits
 * and writes them to data/composio-actions.json.
 *
 * Run via: pnpm --filter @nexu/api fetch-composio-actions
 *
 * This is a one-time fetch — re-run only when Composio adds new actions.
 * The seed script reads from the cached JSON file.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Composio } from "@composio/core";

// Maps our toolkit slug → Composio API slug (most are the same)
const TOOLKIT_SLUG_MAP: Record<string, string> = {
  gmail: "gmail",
  googlecalendar: "googlecalendar",
  slack: "slack",
  googledocs: "googledocs",
  googlesheets: "googlesheets",
  googledrive: "googledrive",
  github: "github",
  notion: "notion",
  linear: "linear",
  jira: "jira",
  asana: "asana",
  trello: "trello",
  airtable: "airtable",
  hubspot: "hubspot",
  salesforce: "salesforce",
  stripe: "stripe",
  sendgrid: "sendgrid",
  mailchimp: "mailchimp",
  zoom: "zoom",
  dropbox: "dropbox",
  figma: "figma",
  clickup: "clickup",
  monday: "monday",
  zendesk: "zendesk",
  googlemeet: "googlemeet",
  googleslides: "googleslides",
  googletasks: "googletasks",
};

interface FetchedAction {
  slug: string;
  name: string;
  description: string;
  keyParams: string[];
  tags?: string[];
}

interface ToolkitActions {
  slug: string;
  actions: FetchedAction[];
  fetchedAt: string;
}

function extractKeyParams(tool: Record<string, unknown>): string[] {
  const inputParams = tool.inputParameters as
    | { properties?: Record<string, unknown>; required?: string[] }
    | undefined;
  if (!inputParams?.properties) return [];

  const required = new Set(inputParams.required ?? []);
  const params: string[] = [];

  for (const [key, _meta] of Object.entries(inputParams.properties)) {
    if (required.has(key)) {
      params.push(key);
    } else {
      params.push(`${key} (optional)`);
    }
  }

  // Put required params first, limit to 6 most relevant
  const sorted = [
    ...params.filter((p) => !p.includes("(optional)")),
    ...params.filter((p) => p.includes("(optional)")),
  ];
  return sorted.slice(0, 6);
}

async function main() {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    console.error("COMPOSIO_API_KEY not set in environment");
    process.exit(1);
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.join(__dirname, "data", "composio-actions.json");

  // Load previous cache for fallback on partial failures
  let previousCache: ToolkitActions[] = [];
  if (fs.existsSync(outPath)) {
    try {
      previousCache = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    } catch {
      console.log("Warning: Could not parse existing cache, starting fresh");
    }
  }
  const previousBySlug = new Map(previousCache.map((t) => [t.slug, t]));

  const client = new Composio({ apiKey });
  const results: ToolkitActions[] = [];
  const now = new Date().toISOString();
  let updated = 0;
  let preserved = 0;
  let failed = 0;
  const totalToolkits = Object.keys(TOOLKIT_SLUG_MAP).length;

  for (const [ourSlug, composioSlug] of Object.entries(TOOLKIT_SLUG_MAP)) {
    process.stdout.write(`Fetching ${ourSlug} (${composioSlug})...`);
    try {
      const tools = (await client.tools.getRawComposioTools({
        toolkits: [composioSlug],
        limit: 100,
      })) as Array<Record<string, unknown>>;

      const actions: FetchedAction[] = tools
        .filter((t) => t.slug && typeof t.slug === "string")
        .map((t) => ({
          slug: t.slug as string,
          name: (t.name as string) ?? (t.slug as string),
          description: ((t.description as string) ?? "").slice(0, 120),
          keyParams: extractKeyParams(t),
          tags: Array.isArray(t.tags) ? (t.tags as string[]) : ([] as string[]),
        }));

      results.push({ slug: ourSlug, actions, fetchedAt: now });
      updated++;
      console.log(` ${actions.length} actions`);
    } catch (err) {
      const e = err as Error;
      console.log(` FAILED: ${e.message}`);

      // Preserve previous cached entry if available
      const cached = previousBySlug.get(ourSlug);
      if (cached && cached.actions.length > 0) {
        results.push(cached);
        preserved++;
        console.log(
          `  -> Preserved ${cached.actions.length} cached actions from ${cached.fetchedAt}`,
        );
      } else {
        results.push({ slug: ourSlug, actions: [], fetchedAt: now });
        failed++;
      }
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

  const total = results.reduce((sum, r) => sum + r.actions.length, 0);
  console.log(`\nDone. ${total} total actions written to ${outPath}`);
  console.log(
    `  Updated: ${updated} | Preserved from cache: ${preserved} | Failed: ${failed}`,
  );

  // Safety threshold: exit non-zero if >20% of toolkits failed completely
  if (failed > totalToolkits * 0.2) {
    console.error(
      `\nError: ${failed}/${totalToolkits} toolkits failed (>${Math.round(totalToolkits * 0.2)} threshold). Check Composio API status.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fetch failed:", err);
  process.exit(1);
});
