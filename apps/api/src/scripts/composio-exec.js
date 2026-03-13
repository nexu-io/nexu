#!/usr/bin/env node

/**
 * Composio action executor — shared by all Composio-based skills.
 *
 * Usage:
 *   node composio-exec.js --action "GMAIL_SEND_EMAIL" --params '{"to":"user@example.com"}'
 *   node composio-exec.js --disconnect "gmail"
 *
 * Requires:
 *   - SKILL_API_TOKEN env var
 *   - nexu-context.json reachable via OPENCLAW_STATE_DIR or walk-up
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      action: { type: "string", short: "a" },
      params: { type: "string", short: "p", default: "{}" },
      disconnect: { type: "string", short: "d" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values.help) {
    console.log(
      'Usage: node composio-exec.js --action "ACTION_NAME" --params \'{"key":"value"}\'\n' +
        '       node composio-exec.js --disconnect "toolkit-slug"',
    );
    process.exit(0);
  }

  if (values.disconnect) {
    return { mode: "disconnect", toolkitSlug: values.disconnect };
  }

  if (!values.action) {
    console.error("Error: --action or --disconnect is required");
    process.exit(1);
  }

  let params = {};
  try {
    params = JSON.parse(values.params);
  } catch {
    console.error("Error: --params must be valid JSON");
    process.exit(1);
  }

  return { mode: "execute", action: values.action, params };
}

// ---------------------------------------------------------------------------
// Context resolution
// ---------------------------------------------------------------------------

function resolveContextFile() {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);

  if (process.env.OPENCLAW_STATE_DIR) {
    const p = path.join(process.env.OPENCLAW_STATE_DIR, "nexu-context.json");
    if (fs.existsSync(p)) return p;
  }

  // Walk up from script dir: scripts/ → skill/ → skills/ → stateDir/
  const stateDir = path.dirname(path.dirname(path.dirname(scriptDir)));
  const p = path.join(stateDir, "nexu-context.json");
  if (fs.existsSync(p)) return p;

  return null;
}

function readContext() {
  const contextFile = resolveContextFile();
  if (!contextFile) {
    console.error("Error: nexu-context.json not found");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(contextFile, "utf-8"));
}

function resolveBotId(ctx) {
  // 1. Explicit env var (future: set by OpenClaw per-agent)
  if (process.env.OPENCLAW_AGENT_ID) {
    return process.env.OPENCLAW_AGENT_ID;
  }

  // 2. Resolve from agents map in nexu-context.json
  if (ctx.agents && typeof ctx.agents === "object") {
    const entries = Object.entries(ctx.agents);
    if (entries.length === 1) {
      return entries[0][1]?.botId ?? entries[0][0];
    }
    if (entries.length > 1) {
      console.error(
        "Warning: Multiple bots in pool, using first. Set OPENCLAW_AGENT_ID for explicit routing.",
      );
      return entries[0][1]?.botId ?? entries[0][0];
    }
  }

  // 3. No agents yet — clear retryable error
  console.error(
    JSON.stringify({
      successful: false,
      error:
        "Bot context not ready. The system is still initializing — please try again in a few seconds.",
    }),
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseCliArgs();

  const token = process.env.SKILL_API_TOKEN;
  if (!token) {
    console.error("Error: SKILL_API_TOKEN environment variable is not set");
    process.exit(1);
  }

  const ctx = readContext();
  const apiUrl = ctx.apiUrl;
  if (!apiUrl) {
    console.error("Error: apiUrl not found in nexu-context.json");
    process.exit(1);
  }

  const botId = resolveBotId(ctx);

  if (args.mode === "disconnect") {
    const url = `${apiUrl}/api/internal/composio/disconnect`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": token,
      },
      body: JSON.stringify({ botId, toolkitSlug: args.toolkitSlug }),
    });

    let body;
    try {
      body = await res.json();
    } catch {
      console.error(
        JSON.stringify({
          successful: false,
          error: `API returned non-JSON response (HTTP ${res.status})`,
        }),
      );
      process.exit(1);
    }
    if (!res.ok) {
      console.error(
        JSON.stringify({
          successful: false,
          error: body.message ?? "Failed to disconnect",
        }),
      );
      process.exit(1);
    }
    console.log(JSON.stringify(body));
    process.exit(0);
  }

  // Execute mode
  const url = `${apiUrl}/api/internal/composio/execute`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": token,
    },
    body: JSON.stringify({ botId, action: args.action, params: args.params }),
  });

  let body;
  try {
    body = await res.json();
  } catch {
    console.error(
      JSON.stringify({
        successful: false,
        error: `API returned non-JSON response (HTTP ${res.status})`,
      }),
    );
    process.exit(1);
  }

  if (!res.ok) {
    const errorResult = {
      successful: false,
      error: body.message ?? "Unknown error",
    };
    if (body.connectUrl) {
      errorResult.connectUrl = body.connectUrl;
    }
    if (body.authCard) {
      errorResult.authCard = body.authCard;
    }
    console.error(JSON.stringify(errorResult));
    process.exit(1);
  }

  console.log(JSON.stringify(body));
  process.exit(body.successful ? 0 : 1);
}

main().catch((err) => {
  console.error(JSON.stringify({ successful: false, error: err.message }));
  process.exit(1);
});
