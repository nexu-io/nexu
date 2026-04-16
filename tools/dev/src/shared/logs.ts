import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { devLogsPath } from "@nexu/dev-utils";

export const defaultLogTailLineCount = 200;

export type DevLogTail = {
  content: string;
  logFilePath: string;
  totalLineCount: number;
};

function normalizeLogLines(content: string): string[] {
  const lines = content.split(/\r?\n/);

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

export function renderLogTail(
  lines: string[],
  maxLines = defaultLogTailLineCount,
): string {
  if (lines.length === 0) {
    return "";
  }

  return `${lines.slice(-maxLines).join("\n")}\n`;
}

export async function readLogTailFromFile(
  logFilePath: string,
  maxLines = defaultLogTailLineCount,
): Promise<DevLogTail> {
  const content = await readFile(logFilePath, "utf8");
  const lines = normalizeLogLines(content);

  return {
    content: renderLogTail(lines, maxLines),
    logFilePath,
    totalLineCount: lines.length,
  };
}

export async function readLatestNamedLogTail(
  logFileName: string,
  maxLines = defaultLogTailLineCount,
): Promise<DevLogTail | null> {
  const entries = await readdir(devLogsPath, { withFileTypes: true }).catch(
    () => [],
  );

  const runDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  for (const runDirectory of runDirectories) {
    const logFilePath = join(devLogsPath, runDirectory, logFileName);

    try {
      await access(logFilePath);
      return await readLogTailFromFile(logFilePath, maxLines);
    } catch {}
  }

  return null;
}
