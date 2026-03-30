import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = {
    coverageDir: path.resolve(process.cwd(), "captures", "coverage"),
    topFiles: 10,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--coverage-dir") {
      args.coverageDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--top-files") {
      args.topFiles = Number.parseInt(argv[index + 1] ?? "10", 10);
      index += 1;
    }
  }

  return args;
}

function formatPct(value) {
  return `${Number(value ?? 0).toFixed(2)}%`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await readJson(path.join(args.coverageDir, "summary.json"));
  const meta = await readJson(path.join(args.coverageDir, "meta.json"));

  const topFiles = (summary.topUncoveredFiles ?? []).slice(0, args.topFiles);
  const lines = [
    `Desktop E2E coverage (${summary.kind})`,
    `Run: ${meta.workflowRunId ?? "unknown"}`,
    `Mode: ${meta.mode ?? "unknown"}`,
    `Source: ${meta.source ?? "unknown"}`,
    `Lines: ${summary.total.lines.covered}/${summary.total.lines.total} (${formatPct(summary.total.lines.pct)})`,
  ];

  if (topFiles.length > 0) {
    lines.push("Top uncovered files:");
    for (const file of topFiles) {
      lines.push(`- ${file.path} (${file.uncoveredLineCount} uncovered lines)`);
    }
  }

  const output = `${lines.join("\n")}\n`;
  process.stdout.write(output);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const markdown = [
      "## Desktop E2E coverage",
      "",
      `- Run: \`${meta.workflowRunId ?? "unknown"}\``,
      `- Mode: \`${meta.mode ?? "unknown"}\``,
      `- Source: \`${meta.source ?? "unknown"}\``,
      `- Lines: **${summary.total.lines.covered}/${summary.total.lines.total}** (${formatPct(summary.total.lines.pct)})`,
      "",
      "### Top uncovered files",
      "",
      ...topFiles.map((file) => `- \`${file.path}\` — ${file.uncoveredLineCount} uncovered lines`),
      "",
    ].join("\n");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, "utf8");
  }
}

await main();
