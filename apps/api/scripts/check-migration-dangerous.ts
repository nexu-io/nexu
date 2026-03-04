import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

type Violation = {
  filePath: string;
  line: number;
  message: string;
  snippet: string;
};

type RegexRule = {
  message: string;
  regex: RegExp;
};

const regexRules: RegexRule[] = [
  {
    message: "DROP TABLE is not allowed in PR-stage migrations",
    regex: /\bdrop\s+table\b/gi,
  },
  {
    message:
      "ALTER TABLE ... DROP COLUMN is not allowed in PR-stage migrations",
    regex: /\balter\s+table\b[\s\S]*?\bdrop\s+column\b/gi,
  },
  {
    message: "TRUNCATE TABLE is not allowed in PR-stage migrations",
    regex: /\btruncate\s+table\b/gi,
  },
];

const migrationsDirPath = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const cwd = process.cwd();
const reportPath = process.env.DB_MIGRATION_DANGEROUS_REPORT_PATH;

async function writeReport(content: string) {
  if (!reportPath) {
    return;
  }

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, content, "utf8");
}

async function collectSqlFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const sqlFiles: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const nestedFiles = await collectSqlFiles(fullPath);
      sqlFiles.push(...nestedFiles);
      continue;
    }

    if (entry.isFile() && extname(entry.name) === ".sql") {
      sqlFiles.push(fullPath);
    }
  }

  return sqlFiles;
}

function getLineNumber(source: string, index: number): number {
  const before = source.slice(0, index);
  return before.split("\n").length;
}

function getSnippet(source: string, index: number): string {
  const line = source.slice(0, index).split("\n").length;
  const target = source.split("\n")[line - 1] ?? "";
  return target.trim();
}

function collectRegexViolations(filePath: string, source: string): Violation[] {
  const violations: Violation[] = [];

  for (const rule of regexRules) {
    for (const match of source.matchAll(rule.regex)) {
      const matchIndex = match.index ?? 0;
      violations.push({
        filePath,
        line: getLineNumber(source, matchIndex),
        message: rule.message,
        snippet: getSnippet(source, matchIndex),
      });
    }
  }

  return violations;
}

function collectDeleteWithoutWhere(
  filePath: string,
  source: string,
): Violation[] {
  const violations: Violation[] = [];
  const statements = source.matchAll(/\bdelete\s+from\b[\s\S]*?;/gi);

  for (const statement of statements) {
    const sql = statement[0];
    if (/\bwhere\b/i.test(sql)) {
      continue;
    }

    const matchIndex = statement.index ?? 0;
    violations.push({
      filePath,
      line: getLineNumber(source, matchIndex),
      message: "DELETE without WHERE is not allowed in PR-stage migrations",
      snippet: getSnippet(source, matchIndex),
    });
  }

  return violations;
}

function collectUpdateWithoutWhere(
  filePath: string,
  source: string,
): Violation[] {
  const violations: Violation[] = [];
  const statements = source.matchAll(/\bupdate\b[\s\S]*?;/gi);

  for (const statement of statements) {
    const sql = statement[0];
    if (/\bwhere\b/i.test(sql)) {
      continue;
    }

    const matchIndex = statement.index ?? 0;
    violations.push({
      filePath,
      line: getLineNumber(source, matchIndex),
      message: "UPDATE without WHERE is not allowed in PR-stage migrations",
      snippet: getSnippet(source, matchIndex),
    });
  }

  return violations;
}

async function main() {
  const sqlFiles = await collectSqlFiles(migrationsDirPath);

  if (sqlFiles.length === 0) {
    await writeReport(
      "### ✅ Check dangerous migration SQL\n\nNo migration SQL files found.",
    );
    console.log("No migration SQL files found.");
    return;
  }

  const violations: Violation[] = [];

  for (const filePath of sqlFiles) {
    const source = await readFile(filePath, "utf8");
    violations.push(...collectRegexViolations(filePath, source));
    violations.push(...collectDeleteWithoutWhere(filePath, source));
    violations.push(...collectUpdateWithoutWhere(filePath, source));
  }

  if (violations.length === 0) {
    await writeReport(
      "### ✅ Check dangerous migration SQL\n\nNo dangerous SQL statements were detected.",
    );
    console.log("Migration dangerous-operation check passed.");
    return;
  }

  const reportLines: string[] = [
    "### ❌ Check dangerous migration SQL",
    "",
    "> [!CAUTION]",
    "> Required check failed. CI detected blocked SQL patterns in migration files.",
    "",
    "**Pass Criteria**",
    "- Migration SQL contains no blocked DDL (`DROP TABLE`, `TRUNCATE TABLE`, `ALTER TABLE ... DROP COLUMN`).",
    "- `UPDATE`/`DELETE` statements in migrations are bounded with `WHERE`.",
    "",
    "**Blocked Statements**",
    "```text",
    "",
  ];

  console.error("Dangerous migration statements detected:");
  for (const violation of violations) {
    const relativePath = relative(cwd, violation.filePath);
    reportLines.push(
      `${relativePath}:${violation.line} ${violation.message} -> ${violation.snippet}`,
    );
    console.error(
      `- ${relativePath}:${violation.line} ${violation.message} -> ${violation.snippet}`,
    );
  }

  reportLines.push(
    "```",
    "",
    "Review and adjust the listed SQL lines before re-running CI.",
  );
  await writeReport(reportLines.join("\n"));

  process.exitCode = 1;
}

await main();
