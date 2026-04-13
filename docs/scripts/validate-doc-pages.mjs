import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsDir = path.resolve(__dirname, "..");
const configPath = path.join(docsDir, ".vitepress", "config.ts");

function toDocPath(link) {
  if (link === "/") {
    return path.join(docsDir, "README.md");
  }

  if (link.startsWith("/zh/")) {
    const relative = link === "/zh/" ? "zh/index.md" : `zh/${link.slice("/zh/".length)}.md`;
    return path.join(docsDir, relative);
  }

  if (link.startsWith("/ja/")) {
    const relative = link === "/ja/" ? "ja/index.md" : `ja/${link.slice("/ja/".length)}.md`;
    return path.join(docsDir, relative);
  }

  if (link.startsWith("/ko/")) {
    const relative = link === "/ko/" ? "ko/index.md" : `ko/${link.slice("/ko/".length)}.md`;
    return path.join(docsDir, relative);
  }

  if (link.startsWith("/guide/")) {
    return path.join(docsDir, "en", `${link.slice(1)}.md`);
  }

  return null;
}

async function exists(pathname) {
  try {
    await fs.access(pathname);
    return true;
  } catch {
    return false;
  }
}

async function getMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return getMarkdownFiles(entryPath);
    }
    return entry.name.endsWith(".md") ? [entryPath] : [];
  }));
  return files.flat();
}

async function validateSidebarLinks(configContent) {
  const links = [...configContent.matchAll(/link:\s*"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((link) => link.startsWith("/"));

  const failures = [];

  for (const link of links) {
    const docPath = toDocPath(link);
    if (!docPath) {
      continue;
    }

    if (!(await exists(docPath))) {
      failures.push(`Missing source for sidebar link ${link}: ${path.relative(docsDir, docPath)}`);
      continue;
    }

    const content = await fs.readFile(docPath, "utf8");
    if (content.trim().length === 0) {
      failures.push(`Empty source for sidebar link ${link}: ${path.relative(docsDir, docPath)}`);
    }
  }

  return failures;
}

async function validateLocaleFiles() {
  const localeRoots = [
    path.join(docsDir, "en"),
    path.join(docsDir, "zh"),
    path.join(docsDir, "ja"),
    path.join(docsDir, "ko"),
  ];

  const failures = [];

  for (const localeRoot of localeRoots) {
    const files = await getMarkdownFiles(localeRoot);
    for (const filePath of files) {
      if (path.relative(docsDir, filePath) === "en/index.md") {
        continue;
      }
      const content = await fs.readFile(filePath, "utf8");
      if (content.trim().length === 0) {
        failures.push(`Empty markdown file: ${path.relative(docsDir, filePath)}`);
      }
    }
  }

  const rootReadme = path.join(docsDir, "README.md");
  const readmeContent = await fs.readFile(rootReadme, "utf8");
  if (readmeContent.trim().length === 0) {
    failures.push("Empty markdown file: README.md");
  }

  return failures;
}

async function main() {
  const configContent = await fs.readFile(configPath, "utf8");
  const failures = [
    ...(await validateSidebarLinks(configContent)),
    ...(await validateLocaleFiles()),
  ];

  if (failures.length > 0) {
    console.error("docs validation failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("docs validation passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
