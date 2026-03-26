#!/usr/bin/env node

/**
 * Send a Feishu interactive card when a GitHub Projects V2 item changes.
 *
 * Focused on Draft items (the primary way we track tasks & bugs in the project board).
 * Also handles Issue / PR items linked to the project.
 *
 * Triggers:
 *   - Draft created / edited (status change, assignee change, field change)
 *   - Draft archived / deleted / restored
 *
 * Environment variables:
 *   WEBHOOK_URL    — Feishu bot webhook URL
 *   ACTION         — projects_v2_item action (created | edited | reordered | converted | archived | deleted | restored)
 *   CHANGES_JSON   — JSON string of github.event.changes (field_value changes)
 *   ITEM_NODE_ID   — GraphQL node ID of the project item
 *   PROJECT_NUMBER — Project number
 *   SENDER         — Actor login who triggered the event
 *   ORG_OR_USER    — Organization or user login that owns the project
 *   GITHUB_TOKEN   — Token with project read scope (GraphQL)
 */

const webhookUrl = process.env.WEBHOOK_URL;
const action = process.env.ACTION ?? "edited";
const changesJson = process.env.CHANGES_JSON ?? "{}";
const itemNodeId = process.env.ITEM_NODE_ID ?? "";
const projectNumber = process.env.PROJECT_NUMBER ?? "";
const sender = process.env.SENDER ?? "";
const orgOrUser = process.env.ORG_OR_USER ?? "";
const ghToken = process.env.GITHUB_TOKEN ?? "";

if (!webhookUrl) {
  console.error("WEBHOOK_URL is required");
  process.exit(1);
}

const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError")
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function graphql(query, variables = {}) {
  const res = await fetchWithTimeout("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ghToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GraphQL request failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    console.warn("GraphQL warnings:", JSON.stringify(json.errors));
  }
  return json;
}

/**
 * Fetch full details of a project item, including all single-select fields
 * (Status, Priority, etc.), assignees, and content (Draft / Issue / PR).
 */
async function fetchItemDetails() {
  if (!ghToken || !itemNodeId) return null;

  const query = `
    query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2Item {
          type
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                field { ... on ProjectV2SingleSelectField { name } }
                name
              }
              ... on ProjectV2ItemFieldUserValue {
                field { ... on ProjectV2Field { name } }
                users(first: 10) { nodes { login } }
              }
              ... on ProjectV2ItemFieldTextValue {
                field { ... on ProjectV2Field { name } }
                text
              }
              ... on ProjectV2ItemFieldDateValue {
                field { ... on ProjectV2Field { name } }
                date
              }
              ... on ProjectV2ItemFieldIterationValue {
                field { ... on ProjectV2IterationField { name } }
                title
              }
            }
          }
          content {
            ... on DraftIssue {
              title
              body
              assignees(first: 10) { nodes { login } }
            }
            ... on Issue {
              title
              number
              url
              state
              assignees(first: 10) { nodes { login } }
              labels(first: 10) { nodes { name } }
            }
            ... on PullRequest {
              title
              number
              url
              state
              assignees(first: 10) { nodes { login } }
              labels(first: 10) { nodes { name } }
            }
          }
        }
      }
    }`;

  try {
    const { data } = await graphql(query, { id: itemNodeId });
    return data?.node ?? null;
  } catch (err) {
    console.warn("Failed to fetch item details:", err.message);
    return null;
  }
}

function parseChanges() {
  try {
    return JSON.parse(changesJson);
  } catch {
    return {};
  }
}

/** Extract a named single-select field value from fieldValues nodes. */
function getFieldValue(fieldNodes, fieldName) {
  for (const node of fieldNodes) {
    if (node.field?.name === fieldName && node.name) return node.name;
  }
  return null;
}

/** Extract assignees from the Assignees field (ProjectV2ItemFieldUserValue). */
function getFieldAssignees(fieldNodes) {
  for (const node of fieldNodes) {
    if (node.field?.name === "Assignees" && node.users) {
      return node.users.nodes.map((u) => u.login);
    }
  }
  return [];
}

function buildStatusChangeText(changes) {
  const fv = changes?.field_value;
  if (!fv) return null;
  const fieldName = fv.field_name ?? "Status";
  const from = fv.from?.name ?? fv.from ?? "—";
  const to = fv.to?.name ?? fv.to ?? "—";

  if (fieldName === "Assignees") {
    return { field: "Assignees", text: `**负责人变更:** ${from} → ${to}` };
  }
  return { field: fieldName, text: `**${fieldName}:** ${from} → ${to}` };
}

function buildProjectUrl() {
  if (orgOrUser && projectNumber) {
    return `https://github.com/orgs/${orgOrUser}/projects/${projectNumber}`;
  }
  return "";
}

const ACTION_CONFIG = {
  created: { text: "📋 新建需求/Bug", color: "blue" },
  edited: { text: "🔄 项目条目变更", color: "orange" },
  /** Often fired when dragging a card between columns (e.g. TODO → In progress). */
  reordered: { text: "📌 看板移动/重排", color: "orange" },
  /** Draft (or item) converted to a tracked issue/PR. */
  converted: { text: "🔗 已转为 Issue/PR", color: "turquoise" },
  archived: { text: "📦 已归档", color: "grey" },
  deleted: { text: "🗑️ 已删除", color: "red" },
  restored: { text: "♻️ 已恢复", color: "green" },
};

async function main() {
  const changes = parseChanges();
  const item = await fetchItemDetails();
  const content = item?.content ?? {};
  const itemType = item?.type ?? "UNKNOWN";
  const fieldNodes = item?.fieldValues?.nodes ?? [];

  const title = content.title ?? "(untitled)";
  const bodyRaw = content.body ?? "";
  const bodySnippet =
    bodyRaw.length > 300 ? `${bodyRaw.slice(0, 300)}…` : bodyRaw;

  // Assignees: prefer content-level (DraftIssue.assignees), fallback to field-level
  const contentAssignees = content.assignees?.nodes?.map((a) => a.login) ?? [];
  const fieldAssignees = getFieldAssignees(fieldNodes);
  const assignees = contentAssignees.length ? contentAssignees : fieldAssignees;
  const assigneesText = assignees.length ? assignees.join(", ") : "未分配";

  const status = getFieldValue(fieldNodes, "Status") ?? "—";
  const priority = getFieldValue(fieldNodes, "Priority");
  const labels = content.labels?.nodes?.map((l) => l.name).join(", ") || null;

  // Determine the URL: Issue/PR have their own url; Draft links to the project board
  const itemUrl = content.url || buildProjectUrl();

  const changeInfo = buildStatusChangeText(changes);

  // Refine action text for edited events
  let { text: actionText, color: headerColor } =
    ACTION_CONFIG[action] ?? ACTION_CONFIG.edited;

  if ((action === "edited" || action === "reordered") && changeInfo) {
    if (changeInfo.field === "Status") {
      actionText = "🔄 状态变更";
    } else if (changeInfo.field === "Assignees") {
      actionText = "👤 负责人变更";
      headerColor = "blue";
    } else if (changeInfo.field === "Priority") {
      actionText = "🔺 优先级变更";
      headerColor = "purple";
    } else {
      actionText = `🔄 ${changeInfo.field} 变更`;
    }
  }

  const typeMap = {
    DRAFT_ISSUE: "Draft",
    ISSUE: "Issue",
    PULL_REQUEST: "PR",
  };
  const typeText = typeMap[itemType] ?? itemType;
  const numberText = content.number ? ` #${content.number}` : "";

  // Build card elements
  const elements = [];

  elements.push({
    tag: "markdown",
    content: `**${typeText}${numberText}:** ${title}`,
  });

  if (changeInfo) {
    elements.push({ tag: "markdown", content: changeInfo.text });
  } else if (action !== "created") {
    elements.push({ tag: "markdown", content: `**当前状态:** ${status}` });
  }

  if (action === "created" && status !== "—") {
    elements.push({ tag: "markdown", content: `**状态:** ${status}` });
  }

  elements.push({ tag: "markdown", content: `**负责人:** ${assigneesText}` });

  if (priority) {
    elements.push({ tag: "markdown", content: `**优先级:** ${priority}` });
  }

  if (labels) {
    elements.push({ tag: "markdown", content: `**标签:** ${labels}` });
  }

  if (bodySnippet) {
    elements.push({ tag: "markdown", content: bodySnippet });
  }

  elements.push({ tag: "markdown", content: `**操作人:** ${sender}` });

  if (itemUrl) {
    elements.push({
      tag: "button",
      text: { tag: "plain_text", content: "查看详情" },
      url: itemUrl,
      type: "primary",
    });
  }

  const headerTitle = `[Project #${projectNumber}] ${actionText}: ${title}`;

  const payload = {
    msg_type: "interactive",
    card: {
      schema: "2.0",
      header: {
        title: { tag: "plain_text", content: headerTitle },
        template: headerColor,
      },
      body: {
        direction: "vertical",
        elements,
      },
    },
  };

  const response = await fetchWithTimeout(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Webhook request failed (${response.status}): ${text}`);
    process.exit(1);
  }

  console.log(`Feishu notification sent: ${actionText} — ${title}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
