import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type StatusEntry = {
  code: string;
  filePath: string;
  raw: string;
};

type FailureReason =
  | "missing_migration"
  | "schema_migration_mismatch"
  | "migration_drift"
  | "generation_failed"
  | "status_failed";

type SyncMode = "all" | "missing" | "mismatch";

const reportPath = process.env.DB_MIGRATION_SYNC_REPORT_PATH;
const baseRef = process.env.DB_MIGRATION_BASE_REF;
const eventName = process.env.DB_MIGRATION_EVENT_NAME;
const maxDiffLines = 220;
const maxDiffChars = 16000;

function parseSyncMode(raw: string | undefined): SyncMode {
  if (raw === "missing" || raw === "mismatch") {
    return raw;
  }

  return "all";
}

const syncMode = parseSyncMode(process.env.DB_MIGRATION_SYNC_MODE);

function getCheckDisplayName(mode: SyncMode): string {
  if (mode === "missing") {
    return "Verify DB migration sync (missing migration files)";
  }

  if (mode === "mismatch") {
    return "Verify DB migration sync (schema/migration mismatch)";
  }

  return "Verify DB migration sync";
}

function classifyFailureReason(
  entries: StatusEntry[],
  pullRequestChangedMigrations: string[],
): FailureReason | null {
  if (entries.length === 0) {
    return null;
  }

  const hasUntracked = entries.some((entry) => entry.code === "??");
  const hasMigrationChangesInPr = pullRequestChangedMigrations.length > 0;

  if (hasUntracked && !hasMigrationChangesInPr) {
    return "missing_migration";
  }

  if (hasUntracked && hasMigrationChangesInPr) {
    return "schema_migration_mismatch";
  }

  return "migration_drift";
}

function shouldFailInMode(
  mode: SyncMode,
  reason: FailureReason | null,
): boolean {
  if (!reason) {
    return false;
  }

  if (mode === "all") {
    return true;
  }

  if (mode === "missing") {
    return reason === "missing_migration";
  }

  return reason !== "missing_migration";
}

async function writeReport(content: string) {
  if (!reportPath) {
    return;
  }

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, content, "utf8");
}

function runCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseStatusLine(line: string): StatusEntry | null {
  if (line.length < 4) {
    return null;
  }

  const code = line.slice(0, 2);
  const filePath = line.slice(3).trim();

  if (!filePath) {
    return null;
  }

  return {
    code,
    filePath,
    raw: line,
  };
}

function getPullRequestChangedFiles(pathSpec: string): string[] {
  if (eventName !== "pull_request" || !baseRef) {
    return [];
  }

  const diffResult = runCommand("git", [
    "diff",
    "--name-only",
    `origin/${baseRef}...HEAD`,
    "--",
    pathSpec,
  ]);

  if (diffResult.status !== 0) {
    return [];
  }

  return diffResult.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function truncateForCodeBlock(content: string): {
  text: string;
  truncated: boolean;
} {
  const rawLines = content.split("\n");
  const byLine = rawLines.slice(0, maxDiffLines).join("\n");
  const byChar = byLine.slice(0, maxDiffChars);
  const truncated =
    byLine.length < content.length || byChar.length < byLine.length;

  return {
    text: byChar,
    truncated,
  };
}

function getTrackedMigrationDiff(): string {
  const diffResult = runCommand("git", [
    "--no-pager",
    "diff",
    "--",
    "migrations",
  ]);
  return diffResult.stdout.trim();
}

function getUntrackedMigrationDiff(filePath: string): string {
  const diffResult = runCommand("git", [
    "--no-pager",
    "diff",
    "--no-index",
    "--",
    "/dev/null",
    filePath,
  ]);

  return diffResult.stdout.trim();
}

function getDiffPreview(entries: StatusEntry[]): {
  text: string;
  truncated: boolean;
} {
  const chunks: string[] = [];

  const trackedDiff = getTrackedMigrationDiff();
  if (trackedDiff.length > 0) {
    chunks.push(trackedDiff);
  }

  const untrackedEntries = entries.filter((entry) => entry.code === "??");
  for (const entry of untrackedEntries) {
    const diff = getUntrackedMigrationDiff(entry.filePath);
    if (diff.length > 0) {
      chunks.push(diff);
    }
  }

  if (chunks.length === 0) {
    return {
      text: "",
      truncated: false,
    };
  }

  return truncateForCodeBlock(chunks.join("\n\n"));
}

function formatFailureReport(
  entries: StatusEntry[],
  pullRequestChangedMigrations: string[],
  pullRequestChangedSchemas: string[],
  reason: FailureReason,
  mode: SyncMode,
): string {
  const diffPreview = getDiffPreview(entries);
  const checkDisplayName = getCheckDisplayName(mode);
  const hasMigrationChangesInPr = pullRequestChangedMigrations.length > 0;
  const generatedUntrackedMigrations = entries
    .filter((entry) => entry.code === "??")
    .map((entry) => entry.filePath);

  const lines: string[] = [
    `### ❌ ${checkDisplayName}`,
    "",
    "> [!CAUTION]",
    "> Required check failed. `drizzle-kit generate` produced migration drift not reflected in this PR.",
    "",
    "**Failure Classification**",
  ];

  if (reason === "missing_migration") {
    lines.push(
      "- Missing migration files in PR: schema changed but generated migration artifacts were not committed.",
    );
  }

  if (reason === "schema_migration_mismatch") {
    lines.push(
      "- Migration/schema mismatch: this PR edits migration files, but regeneration still produces additional files.",
    );
  }

  if (reason === "migration_drift") {
    lines.push(
      "- Migration drift: generated migration output differs from committed migration files.",
    );
  }

  if (reason === "generation_failed") {
    lines.push("- Migration generation failed before drift inspection.");
  }

  if (reason === "status_failed") {
    lines.push("- CI could not inspect migration status after generation.");
  }

  lines.push(
    "",
    "**Pass Criteria**",
    "- Re-running `drizzle-kit generate` introduces zero changes under `apps/api/migrations`.",
    "- All migration SQL and snapshot/journal artifacts needed by current schema are included in the PR.",
  );

  if (reason === "missing_migration") {
    lines.push("", "**Schemas Missing Corresponding Migration Files**");

    if (pullRequestChangedSchemas.length > 0) {
      for (const filePath of pullRequestChangedSchemas) {
        lines.push(`- ${filePath}`);
      }
    } else {
      lines.push("- Unable to infer schema files from PR diff.");
    }

    if (generatedUntrackedMigrations.length > 0) {
      lines.push("", "**Generated Migration Artifacts Not Included In PR**");
      for (const filePath of generatedUntrackedMigrations) {
        lines.push(`- ${filePath}`);
      }
    }
  }

  if (hasMigrationChangesInPr) {
    lines.push("", "**Migration Files Changed In This PR**");
    for (const filePath of pullRequestChangedMigrations) {
      lines.push(`- ${filePath}`);
    }
  }

  if (reason !== "missing_migration" && pullRequestChangedSchemas.length > 0) {
    lines.push("", "**Schema Files Changed In This PR**");
    for (const filePath of pullRequestChangedSchemas) {
      lines.push(`- ${filePath}`);
    }
  }

  lines.push(
    "",
    "**Detected Drift (git status --porcelain -- migrations)**",
    "```text",
  );

  for (const entry of entries) {
    lines.push(entry.raw);
  }

  lines.push("```");

  if (reason !== "missing_migration" && diffPreview.text.length > 0) {
    lines.push(
      "",
      "**Generated Diff Preview**",
      "```diff",
      diffPreview.text,
      "```",
    );
    if (diffPreview.truncated) {
      lines.push(
        "_Diff truncated for readability. See workflow logs for the full generated diff._",
      );
    }
  }

  return lines.join("\n");
}

async function main() {
  const generateResult = runCommand("pnpm", ["db:generate"]);
  const checkDisplayName = getCheckDisplayName(syncMode);

  if (generateResult.stdout) {
    process.stdout.write(generateResult.stdout);
  }

  if (generateResult.status !== 0) {
    if (generateResult.stderr) {
      process.stderr.write(generateResult.stderr);
    }

    const message = [
      `### ❌ ${checkDisplayName}`,
      "",
      "> [!CAUTION]",
      "> Required check failed before sync validation could run.",
      "",
      "**Pass Criteria**",
      "- `pnpm --filter @nexu/api db:generate` exits successfully.",
      "- Re-running generation introduces zero changes under `apps/api/migrations`.",
      "",
      "```text",
      generateResult.stderr.trim() || "Unknown drizzle generation error",
      "```",
    ].join("\n");

    await writeReport(message);
    process.exitCode = shouldFailInMode(syncMode, "generation_failed") ? 1 : 0;
    return;
  }

  const statusResult = runCommand("git", [
    "status",
    "--porcelain",
    "--",
    "migrations",
  ]);

  if (statusResult.status !== 0) {
    if (statusResult.stderr) {
      process.stderr.write(statusResult.stderr);
    }

    const message = [
      `### ❌ ${checkDisplayName}`,
      "",
      "> [!CAUTION]",
      "> Required check failed because CI could not inspect migration file status.",
      "",
      "```text",
      statusResult.stderr.trim() || "Unknown git status error",
      "```",
    ].join("\n");

    await writeReport(message);
    process.exitCode = shouldFailInMode(syncMode, "status_failed") ? 1 : 0;
    return;
  }

  const entries = statusResult.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map(parseStatusLine)
    .filter((entry): entry is StatusEntry => entry !== null);

  const pullRequestChangedMigrations = getPullRequestChangedFiles("migrations");
  const pullRequestChangedSchemas = getPullRequestChangedFiles("src/db/schema");

  const reason = classifyFailureReason(entries, pullRequestChangedMigrations);

  if (!reason) {
    const success = `### ✅ ${checkDisplayName}\n\nSchema and migration files are in sync.`;
    await writeReport(success);
    console.log("Migration sync check passed.");
    return;
  }

  const shouldFail = shouldFailInMode(syncMode, reason);

  if (!shouldFail) {
    const skipped = [
      `### ✅ ${checkDisplayName}`,
      "",
      "No failure for this check category.",
      "",
      "Current migration drift is classified under another check.",
    ].join("\n");
    await writeReport(skipped);
    console.log("Migration drift exists, but not in this check category.");
    return;
  }

  const report = formatFailureReport(
    entries,
    pullRequestChangedMigrations,
    pullRequestChangedSchemas,
    reason,
    syncMode,
  );
  await writeReport(report);
  console.error(report);
  process.exitCode = 1;
}

await main();
