import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const openclawRoot = path.resolve(runtimeDir, "node_modules/openclaw");
const extensionsRoot = path.resolve(openclawRoot, "extensions");
const isDryRun = process.argv.includes("--dry-run");

const moduleSuffixes = ["", ".js", ".mjs", ".cjs", ".ts", ".json"];
const directoryIndexSuffixes = [
  "/index.js",
  "/index.mjs",
  "/index.cjs",
  "/index.ts",
  "/index.json",
];
const moduleReferencePattern =
  /(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gu;

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function collectRelativeSpecifiers(sourceText) {
  const specifiers = [];

  for (const match of sourceText.matchAll(moduleReferencePattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier?.startsWith(".")) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

async function resolveRelativeModule(fromFilePath, specifier) {
  const basePath = path.resolve(path.dirname(fromFilePath), specifier);

  for (const suffix of moduleSuffixes) {
    const candidatePath = `${basePath}${suffix}`;
    if (await exists(candidatePath)) {
      return candidatePath;
    }
  }

  for (const suffix of directoryIndexSuffixes) {
    const candidatePath = `${basePath}${suffix}`;
    if (await exists(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

async function validateModuleGraph({ entryPath, extensionName }) {
  const pendingPaths = [entryPath];
  const visitedPaths = new Set();
  const missingImports = [];

  while (pendingPaths.length > 0) {
    const currentPath = pendingPaths.pop();
    if (!currentPath || visitedPaths.has(currentPath)) {
      continue;
    }
    visitedPaths.add(currentPath);

    const sourceText = await readFile(currentPath, "utf8");
    const relativeSpecifiers = collectRelativeSpecifiers(sourceText);

    for (const specifier of relativeSpecifiers) {
      const resolvedPath = await resolveRelativeModule(currentPath, specifier);

      if (!resolvedPath) {
        missingImports.push({
          importer: path.relative(openclawRoot, currentPath),
          specifier,
        });
        continue;
      }

      if (
        resolvedPath.startsWith(path.resolve(extensionsRoot, extensionName))
      ) {
        pendingPaths.push(resolvedPath);
      }
    }
  }

  return missingImports;
}

async function getExtensionEntryPath(extensionRoot) {
  const packageJsonPath = path.resolve(extensionRoot, "package.json");
  if (!(await exists(packageJsonPath))) {
    return null;
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const extensionEntry = packageJson.openclaw?.extensions?.[0];
  if (typeof extensionEntry !== "string") {
    return null;
  }

  return path.resolve(extensionRoot, extensionEntry);
}

if (!(await exists(extensionsRoot))) {
  console.log("OpenClaw extensions directory is missing, nothing to validate.");
  process.exit(0);
}

const extensionEntries = await readdir(extensionsRoot, { withFileTypes: true });
const validationFailures = [];
let validatedCount = 0;

for (const entry of extensionEntries) {
  if (!entry.isDirectory()) {
    continue;
  }

  const extensionRoot = path.resolve(extensionsRoot, entry.name);
  const entryPath = await getExtensionEntryPath(extensionRoot);
  if (!entryPath) {
    continue;
  }

  validatedCount += 1;
  const missingImports = await validateModuleGraph({
    entryPath,
    extensionName: entry.name,
  });

  if (missingImports.length > 0) {
    validationFailures.push({
      extensionName: entry.name,
      missingImports,
    });
  }
}

if (validationFailures.length === 0) {
  console.log(
    `${isDryRun ? "Would validate" : "Validated"} ${validatedCount} OpenClaw extension entrypoint${validatedCount === 1 ? "" : "s"}.`,
  );
  process.exit(0);
}

for (const failure of validationFailures) {
  console.error(
    `Extension ${failure.extensionName} has missing relative imports:`,
  );
  for (const missingImport of failure.missingImports) {
    console.error(`- ${missingImport.importer} -> ${missingImport.specifier}`);
  }
}

throw new Error(
  `OpenClaw runtime validation failed for ${validationFailures.length} extension${validationFailures.length === 1 ? "" : "s"}.`,
);
