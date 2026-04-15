import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, "..", "..");

async function walkTypescriptFiles(rootDir, currentDir = rootDir, files = []) {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "node_modules") {
      continue;
    }

    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walkTypescriptFiles(rootDir, entryPath, files);
      continue;
    }

    if (
      !entry.isFile() ||
      !entry.name.endsWith(".ts") ||
      entry.name.endsWith(".d.ts")
    ) {
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

function transpileTsToJs(sourceText, sourcePath) {
  return ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      verbatimModuleSyntax: true,
      isolatedModules: true,
    },
    fileName: sourcePath,
    reportDiagnostics: false,
  }).outputText;
}

export async function precompileFeishuPlugin(runtimeDir) {
  const feishuRoot = path.join(
    runtimeDir,
    "node_modules",
    "openclaw",
    "extensions",
    "feishu",
  );
  const packageJsonPath = path.join(feishuRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

  if (!Array.isArray(packageJson.openclaw?.extensions)) {
    throw new Error("feishu package.json is missing openclaw.extensions");
  }

  const tsFiles = await walkTypescriptFiles(feishuRoot);
  let transpiledCount = 0;

  for (const tsFilePath of tsFiles) {
    const sourceText = await readFile(tsFilePath, "utf8");
    const jsOutputPath = tsFilePath.replace(/\.ts$/u, ".js");
    const jsOutput = transpileTsToJs(sourceText, tsFilePath);
    await writeFile(jsOutputPath, jsOutput, "utf8");
    transpiledCount += 1;
  }

  packageJson.openclaw.extensions = packageJson.openclaw.extensions.map(
    (entry) => (entry === "./index.ts" ? "./index.js" : entry),
  );
  await writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );

  return {
    pluginId: "feishu",
    transpiledCount,
    packageJsonPath,
  };
}

async function transpilePluginTypescriptTree(sourceRoot, targetRoot) {
  const tsFiles = await walkTypescriptFiles(sourceRoot);
  let transpiledCount = 0;

  for (const tsFilePath of tsFiles) {
    const sourceText = await readFile(tsFilePath, "utf8");
    const relativePath = path.relative(sourceRoot, tsFilePath);
    const jsOutputPath = path
      .join(targetRoot, relativePath)
      .replace(/\.ts$/u, ".js");
    const jsOutput = transpileTsToJs(sourceText, tsFilePath);
    await mkdir(path.dirname(jsOutputPath), { recursive: true });
    await writeFile(jsOutputPath, jsOutput, "utf8");
    transpiledCount += 1;
  }

  return transpiledCount;
}

function rewriteWeixinRuntimePackage(sourcePackageJson) {
  const { devDependencies: _devDependencies, ...runtimePackageJson } = {
    ...sourcePackageJson,
    openclaw: {
      ...sourcePackageJson.openclaw,
      extensions: Array.isArray(sourcePackageJson.openclaw?.extensions)
        ? sourcePackageJson.openclaw.extensions.map((entry) =>
            entry === "./index.ts"
              ? "./index.js"
              : entry.replace(/\.ts$/u, ".js"),
          )
        : sourcePackageJson.openclaw?.extensions,
    },
  };
  return runtimePackageJson;
}

export async function prepareBuiltinWeixinPlugin(runtimeDir) {
  const sourceRoot = path.join(
    repoRoot,
    "packages",
    "slimclaw",
    "runtime-plugins",
    "openclaw-weixin",
  );
  const targetRoot = path.join(
    runtimeDir,
    "node_modules",
    "openclaw",
    "extensions",
    "openclaw-weixin",
  );
  const sourcePackageJsonPath = path.join(sourceRoot, "package.json");
  const targetPackageJsonPath = path.join(targetRoot, "package.json");
  const runtimeDependencyPaths = [
    path.join(runtimeDir, "node_modules", "qrcode-terminal", "package.json"),
    path.join(runtimeDir, "node_modules", "zod", "package.json"),
  ];
  const sourcePackageJson = JSON.parse(
    await readFile(sourcePackageJsonPath, "utf8"),
  );

  for (const runtimeDependencyPath of runtimeDependencyPaths) {
    await readFile(runtimeDependencyPath, "utf8");
  }

  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });

  const transpiledCount = await transpilePluginTypescriptTree(
    sourceRoot,
    targetRoot,
  );

  await writeFile(
    targetPackageJsonPath,
    `${JSON.stringify(rewriteWeixinRuntimePackage(sourcePackageJson), null, 2)}\n`,
    "utf8",
  );

  await cp(
    path.join(sourceRoot, "openclaw.plugin.json"),
    path.join(targetRoot, "openclaw.plugin.json"),
    {
      force: true,
    },
  );

  return {
    pluginId: "openclaw-weixin",
    transpiledCount,
    packageJsonPath: targetPackageJsonPath,
  };
}
