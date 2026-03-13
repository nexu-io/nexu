// ─── Toolkit Permissions Map ────────────────────────────────
// Static map from toolkit slug to human-readable permission descriptions.
// Covers all 26 supported Composio toolkits.
// Unknown toolkits fall back to generic descriptions.

const TOOLKIT_PERMISSIONS: Record<string, string[]> = {
  // ── Google Suite ──────────────────────────────────────────
  gmail: [
    "Read your Gmail messages and threads",
    "Send emails and manage drafts on your behalf",
    "Access scoped to nexu tasks only",
  ],
  googlecalendar: [
    "View and manage your Google Calendar events",
    "Create, update, and delete events on your behalf",
    "Access scoped to nexu tasks only",
  ],
  "google-docs": [
    "Read and edit your Google Docs",
    "Create new documents on your behalf",
    "Access scoped to nexu tasks only",
  ],
  "google-sheets": [
    "Read and edit your Google Sheets",
    "Create new spreadsheets on your behalf",
    "Access scoped to nexu tasks only",
  ],
  "google-drive": [
    "Browse and read files in your Google Drive",
    "Create and organize files on your behalf",
    "Access scoped to nexu tasks only",
  ],

  "google-meet": [
    "Create and manage Google Meet meeting spaces",
    "Access recordings and transcripts",
    "Access scoped to nexu tasks only",
  ],
  "google-slides": [
    "Read and edit your Google Slides presentations",
    "Create new presentations on your behalf",
    "Access scoped to nexu tasks only",
  ],
  "google-tasks": [
    "Read and manage your Google Tasks lists",
    "Create and update tasks on your behalf",
    "Access scoped to nexu tasks only",
  ],

  // ── Communication ─────────────────────────────────────────
  slack: [
    "Read messages in channels nexu is invited to",
    "Send messages and respond on your behalf",
    "Access scoped to nexu tasks only",
  ],
  zoom: [
    "Create and manage Zoom meetings",
    "View meeting details and participants",
    "Access scoped to nexu tasks only",
  ],

  // ── Email & Marketing ─────────────────────────────────────
  sendgrid: [
    "Send transactional and marketing emails via SendGrid",
    "Manage contacts and email templates",
    "Access scoped to nexu tasks only",
  ],
  mailchimp: [
    "Manage campaigns and subscriber lists in Mailchimp",
    "Send and schedule email campaigns on your behalf",
    "Access scoped to nexu tasks only",
  ],

  // ── Project Management ────────────────────────────────────
  notion: [
    "Read your Notion pages and databases",
    "Create and update pages on your behalf",
    "Access scoped to nexu tasks only",
  ],
  linear: [
    "Read your Linear issues and projects",
    "Create and update issues on your behalf",
    "Access scoped to nexu tasks only",
  ],
  jira: [
    "Read and manage Jira issues and projects",
    "Create and update issues on your behalf",
    "Access scoped to nexu tasks only",
  ],
  asana: [
    "Read your Asana tasks and projects",
    "Create and update tasks on your behalf",
    "Access scoped to nexu tasks only",
  ],
  trello: [
    "Read your Trello boards, lists, and cards",
    "Create and move cards on your behalf",
    "Access scoped to nexu tasks only",
  ],
  clickup: [
    "Read your ClickUp tasks and spaces",
    "Create and update tasks on your behalf",
    "Access scoped to nexu tasks only",
  ],
  monday: [
    "Read your Monday.com boards and items",
    "Create and update items on your behalf",
    "Access scoped to nexu tasks only",
  ],

  // ── Developer Tools ───────────────────────────────────────
  github: [
    "Access your repositories and issues",
    "Create pull requests and comments on your behalf",
    "Access scoped to nexu tasks only",
  ],

  // ── CRM & Sales ───────────────────────────────────────────
  hubspot: [
    "Read contacts, deals, and companies in HubSpot",
    "Create and update CRM records on your behalf",
    "Access scoped to nexu tasks only",
  ],
  salesforce: [
    "Read leads, contacts, and opportunities in Salesforce",
    "Create and update records on your behalf",
    "Access scoped to nexu tasks only",
  ],

  // ── E-Commerce & Payments ─────────────────────────────────
  stripe: [
    "Read payment, customer, and subscription data in Stripe",
    "Create and manage payments on your behalf",
    "Access scoped to nexu tasks only",
  ],

  // ── Data & Databases ──────────────────────────────────────
  airtable: [
    "Read and write records in your Airtable bases",
    "Create and manage tables on your behalf",
    "Access scoped to nexu tasks only",
  ],

  // ── File Storage ──────────────────────────────────────────
  dropbox: [
    "Browse and read files in your Dropbox",
    "Upload and organize files on your behalf",
    "Access scoped to nexu tasks only",
  ],

  // ── Design ────────────────────────────────────────────────
  figma: [
    "Access your Figma files and components",
    "Read design data and export assets",
    "Access scoped to nexu tasks only",
  ],

  // ── Support ───────────────────────────────────────────────
  zendesk: [
    "Read and manage Zendesk tickets and users",
    "Create and update support tickets on your behalf",
    "Access scoped to nexu tasks only",
  ],
};

export function getToolkitPermissions(
  slug: string,
  displayName: string,
): string[] {
  const specific = TOOLKIT_PERMISSIONS[slug];
  if (specific) return specific;

  return [
    `Read your ${displayName} data`,
    "Perform actions on your behalf",
    "Access scoped to nexu tasks only",
  ];
}
