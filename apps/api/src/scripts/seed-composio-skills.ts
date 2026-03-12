/**
 * Seed script: inserts all 26 Composio-based skills into the `skills` table
 * and publishes a snapshot so the gateway sidecar picks them up.
 *
 * Prerequisites:
 *   pnpm --filter @nexu/api fetch-composio-actions   (fetches real action slugs)
 *
 * Run via: pnpm --filter @nexu/api seed-composio-skills
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { db, pool } from "../db/index.js";
import { skills } from "../db/schema/index.js";
import { publishSkillsSnapshot } from "../services/runtime/skills-service.js";

// ---------------------------------------------------------------------------
// Toolkit display metadata (static — rarely changes)
// ---------------------------------------------------------------------------

interface ToolkitDisplay {
  slug: string;
  displayName: string;
  description: string;
}

const TOOLKIT_DISPLAY: Record<string, ToolkitDisplay> = {
  gmail: {
    slug: "gmail",
    displayName: "Gmail",
    description:
      "Send, read, and manage emails via Gmail. Use when user asks to send an email, read inbox, search emails, or manage Gmail.",
  },
  googlecalendar: {
    slug: "googlecalendar",
    displayName: "Google Calendar",
    description:
      "Create, read, update, and delete calendar events. Use when user asks about meetings, schedules, or calendar management.",
  },
  slack: {
    slug: "slack",
    displayName: "Slack",
    description:
      "Send messages, read channels, and manage Slack workspace interactions.",
  },
  googledocs: {
    slug: "googledocs",
    displayName: "Google Docs",
    description: "Create, read, and edit Google Documents.",
  },
  googlesheets: {
    slug: "googlesheets",
    displayName: "Google Sheets",
    description: "Read, write, and manage spreadsheets in Google Sheets.",
  },
  googledrive: {
    slug: "googledrive",
    displayName: "Google Drive",
    description: "List, search, upload, and manage files in Google Drive.",
  },
  github: {
    slug: "github",
    displayName: "GitHub",
    description:
      "Manage repositories, issues, pull requests, and code on GitHub.",
  },
  notion: {
    slug: "notion",
    displayName: "Notion",
    description:
      "Create, read, and manage pages, databases, and blocks in Notion.",
  },
  linear: {
    slug: "linear",
    displayName: "Linear",
    description: "Manage issues, projects, and team workflows in Linear.",
  },
  jira: {
    slug: "jira",
    displayName: "Jira",
    description: "Create, update, and manage Jira issues and projects.",
  },
  asana: {
    slug: "asana",
    displayName: "Asana",
    description: "Manage tasks, projects, and workspaces in Asana.",
  },
  trello: {
    slug: "trello",
    displayName: "Trello",
    description: "Manage boards, lists, and cards in Trello.",
  },
  airtable: {
    slug: "airtable",
    displayName: "Airtable",
    description: "Read and write records in Airtable bases.",
  },
  hubspot: {
    slug: "hubspot",
    displayName: "HubSpot",
    description: "Manage contacts, deals, and companies in HubSpot CRM.",
  },
  salesforce: {
    slug: "salesforce",
    displayName: "Salesforce",
    description:
      "Manage leads, contacts, opportunities, and accounts in Salesforce.",
  },
  stripe: {
    slug: "stripe",
    displayName: "Stripe",
    description: "Manage payments, customers, and subscriptions in Stripe.",
  },
  sendgrid: {
    slug: "sendgrid",
    displayName: "SendGrid",
    description: "Send transactional and marketing emails via SendGrid.",
  },
  mailchimp: {
    slug: "mailchimp",
    displayName: "Mailchimp",
    description: "Manage campaigns, subscribers, and email lists in Mailchimp.",
  },
  zoom: {
    slug: "zoom",
    displayName: "Zoom",
    description: "Create and manage Zoom meetings.",
  },
  dropbox: {
    slug: "dropbox",
    displayName: "Dropbox",
    description: "Manage files and folders in Dropbox.",
  },
  figma: {
    slug: "figma",
    displayName: "Figma",
    description: "Access Figma files, components, and design data.",
  },
  clickup: {
    slug: "clickup",
    displayName: "ClickUp",
    description: "Manage tasks, spaces, and lists in ClickUp.",
  },
  monday: {
    slug: "monday",
    displayName: "Monday.com",
    description: "Manage boards, items, and updates in Monday.com.",
  },
  zendesk: {
    slug: "zendesk",
    displayName: "Zendesk",
    description: "Manage tickets, users, and support workflows in Zendesk.",
  },
  googlemeet: {
    slug: "googlemeet",
    displayName: "Google Meet",
    description:
      "Create meeting spaces, manage recordings, retrieve transcripts, and view participant details in Google Meet.",
  },
  googleslides: {
    slug: "googleslides",
    displayName: "Google Slides",
    description:
      "Create, read, and update Google Slides presentations. Generate slides from markdown.",
  },
  googletasks: {
    slug: "googletasks",
    displayName: "Google Tasks",
    description:
      "Create, read, update, and manage task lists and tasks in Google Tasks.",
  },
};

// ---------------------------------------------------------------------------
// Cached action data types (from fetch-composio-actions.ts output)
// ---------------------------------------------------------------------------

interface CachedAction {
  slug: string;
  name: string;
  description: string;
  keyParams: string[];
  tags?: string[];
}

interface CachedToolkit {
  slug: string;
  actions: CachedAction[];
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// SKILL.md template
// ---------------------------------------------------------------------------

function buildSkillMd(
  display: ToolkitDisplay,
  actions: CachedAction[],
): string {
  const actionsTable = actions
    .map((a) => `| ${a.slug} | ${a.description} | ${a.keyParams.join(", ")} |`)
    .join("\n");

  const firstAction = actions[0];

  return `---
name: ${display.slug}
description: "${display.description}"
metadata:
  { "openclaw": { "requires": { "bins": ["node"] } } }
---

# ${display.displayName}

${display.description}

## Available Actions

| Action | Description | Key Parameters |
|--------|-------------|----------------|
${actionsTable}

## Usage

To execute an action, run:

\`\`\`bash
node "$SKILL_DIR/scripts/composio-exec.js" --action "ACTION_NAME" --params '{"key":"value"}'
\`\`\`

### Examples

\`\`\`bash
# ${firstAction?.description ?? "Example"}
node "$SKILL_DIR/scripts/composio-exec.js" --action "${firstAction?.slug ?? "ACTION"}" --params '{}'
\`\`\`

## Handling Authorization Errors

If the script exits with an error containing an \`authCard\` field, the user needs to authorize ${display.displayName}.

1. Parse the JSON error from stderr
2. Reply with the pre-formatted text from \`authCard\` matching the current platform:
   - **Slack**: reply with \`authCard.slack\`
   - **Discord**: reply with \`authCard.discord\`
   - **Feishu/Lark**: reply with \`authCard.feishu\`
3. Reply with ONLY the authCard text — do NOT add extra words before or after it
4. After the user connects, retry the original action when they ask again

If \`authCard\` is missing, reply:
> I could not generate an authorization link for ${display.displayName}. Please try again.

## Disconnect

If the user wants to disconnect or revoke their ${display.displayName} authorization:

\`\`\`bash
node "$SKILL_DIR/scripts/composio-exec.js" --disconnect "${display.slug}"
\`\`\`

After disconnecting, tell the user their ${display.displayName} account has been unlinked. They will need to re-authorize if they want to use it again.

## Rules

- NEVER read, echo, or log the SKILL_API_TOKEN environment variable
- Always use the bundled composio-exec.js — do not call APIs directly
- Parse the JSON output and report results to the user naturally
- If successful is false, tell the user what went wrong using the error field
- If the error includes an authCard, use the pre-built payloads as-is — do NOT modify them or construct your own card
- After the user connects, retry the original action when they ask again
`;
}

// ---------------------------------------------------------------------------
// Action priority scoring — lower = more relevant to end-users
// ---------------------------------------------------------------------------

const LOW_PRIORITY_PATTERNS = [
  "_ACL_",
  "_CHANNELS_",
  "_WATCH",
  "_BATCH_",
  "_SETTINGS_",
  "_WEBHOOK",
  "_INSTANCES",
];

const ADMIN_PATTERNS = [
  "_CALENDAR_LIST_",
  "_CALENDARS_DELETE",
  "_CALENDARS_UPDATE",
  "_DUPLICATE_",
  "_CALENDARS_INSERT",
  "_STOP",
];

function actionPriority(slug: string): number {
  for (const p of LOW_PRIORITY_PATTERNS) {
    if (slug.includes(p)) return 2;
  }
  for (const p of ADMIN_PATTERNS) {
    if (slug.includes(p)) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  // Read cached actions
  const actionsPath = path.join(__dirname, "data", "composio-actions.json");
  if (!fs.existsSync(actionsPath)) {
    console.error(
      "Error: data/composio-actions.json not found. Run fetch-composio-actions first.",
    );
    process.exit(1);
  }

  const cachedToolkits: CachedToolkit[] = JSON.parse(
    fs.readFileSync(actionsPath, "utf-8"),
  );
  console.log(
    `Loaded ${cachedToolkits.length} toolkits from cached actions file`,
  );

  // Read executor script
  const execScriptPath = path.join(__dirname, "composio-exec.js");
  const execScriptContent = fs.readFileSync(execScriptPath, "utf-8");

  console.log("Seeding Composio skills...");
  const now = new Date().toISOString();

  let upserted = 0;
  let skipped = 0;

  for (const cached of cachedToolkits) {
    const display = TOOLKIT_DISPLAY[cached.slug];
    if (!display) {
      console.log(`  ⚠ Skipping unknown toolkit: ${cached.slug}`);
      skipped++;
      continue;
    }

    if (cached.actions.length === 0) {
      console.log(
        `  ⚠ Skipping ${cached.slug}: no actions fetched (API may have failed)`,
      );
      skipped++;
      continue;
    }

    const skillName = display.slug;
    // Sort: user-facing actions first, admin/low-level actions last, then cap at 15
    const sorted = [...cached.actions].sort(
      (a, b) => actionPriority(a.slug) - actionPriority(b.slug),
    );
    const cappedActions = sorted.slice(0, 15);
    const skillMd = buildSkillMd(display, cappedActions);
    const filesJson = JSON.stringify({
      "SKILL.md": skillMd,
      "scripts/composio-exec.js": execScriptContent,
    });

    // Upsert
    const [existing] = await db
      .select({ id: skills.id })
      .from(skills)
      .where(eq(skills.name, skillName))
      .limit(1);

    if (existing) {
      await db
        .update(skills)
        .set({
          content: skillMd,
          files: filesJson,
          status: "active",
          updatedAt: now,
        })
        .where(eq(skills.name, skillName));
    } else {
      await db.insert(skills).values({
        id: createId(),
        name: skillName,
        content: skillMd,
        files: filesJson,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    }
    upserted++;
    const cappedNote =
      cached.actions.length > 15
        ? ` (capped from ${cached.actions.length})`
        : "";
    console.log(
      `  ✓ ${skillName} (${cappedActions.length} actions${cappedNote})`,
    );
  }

  console.log(
    `\nUpserted ${upserted} skills, skipped ${skipped}. Publishing snapshot...`,
  );
  const snapshot = await publishSkillsSnapshot(db);
  console.log(`Snapshot published: version ${snapshot.version}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
