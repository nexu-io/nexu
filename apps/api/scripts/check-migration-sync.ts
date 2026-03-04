import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type StatusEntry = {
  code: string;
  filePath: string;
  raw: string;
};

const reportPath = process.env.DB_MIGRATION_SYNC_REPORT_PATH;
const baseRef = process.env.DB_MIGRATION_BASE_REF;
const eventName = process.env.DB_MIGRATION_EVENT_NAME;
const maxDiffLines = 220;
const maxDiffChars = 16000;

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
): string {
  const untracked = entries.filter((entry) => entry.code === "??");
  const tracked = entries.filter((entry) => entry.code !== "??");
  const hasMigrationChangesInPr = pullRequestChangedMigrations.length > 0;
  const diffPreview = getDiffPreview(entries);

  const lines: string[] = [
    "### ❌ Verify DB migration sync",
    "",
    "> [!CAUTION]",
    "> Required check failed. `drizzle-kit generate` produced migration drift not reflected in this PR.",
    "",
    "**Failure Classification**",
  ];

  if (untracked.length > 0 && !hasMigrationChangesInPr) {
    lines.push(
      "- Missing migration files in PR: schema changed but generated migration artifacts were not committed.",
    );
  }

  if (untracked.length > 0 && hasMigrationChangesInPr) {
    lines.push(
      "- Migration/schema mismatch: this PR edits migration files, but regeneration still produces additional files.",
    );
  }

  if (tracked.length > 0 && untracked.length === 0) {
    lines.push(
      "- Migration drift: generated migration output differs from committed migration files.",
    );
  }

  lines.push(
    "",
    "**Pass Criteria**",
    "- Re-running `drizzle-kit generate` introduces zero changes under `apps/api/migrations`.",
    "- All migration SQL and snapshot/journal artifacts needed by current schema are included in the PR.",
  );

  if (hasMigrationChangesInPr) {
    lines.push("", "**Migration Files Changed In This PR**");
    for (const filePath of pullRequestChangedMigrations) {
      lines.push(`- ${filePath}`);
    }
  }

  if (pullRequestChangedSchemas.length > 0) {
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

  if (diffPreview.text.length > 0) {
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

  if (generateResult.stdout) {
    process.stdout.write(generateResult.stdout);
  }

  if (generateResult.status !== 0) {
    if (generateResult.stderr) {
      process.stderr.write(generateResult.stderr);
    }

    const message = [
      "### ❌ Verify DB migration sync",
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
    process.exitCode = 1;
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
      "### ❌ Verify DB migration sync",
      "",
      "> [!CAUTION]",
      "> Required check failed because CI could not inspect migration file status.",
      "",
      "```text",
      statusResult.stderr.trim() || "Unknown git status error",
      "```",
    ].join("\n");

    await writeReport(message);
    process.exitCode = 1;
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

  if (entries.length === 0) {
    const success =
      "### ✅ Verify DB migration sync\n\nSchema and migration files are in sync.";
    await writeReport(success);
    console.log("Migration sync check passed.");
    return;
  }

  const report = formatFailureReport(
    entries,
    pullRequestChangedMigrations,
    pullRequestChangedSchemas,
  );
  await writeReport(report);
  console.error(report);
  process.exitCode = 1;
}

await main();
