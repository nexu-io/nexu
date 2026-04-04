import { readFile } from "node:fs/promises";

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
