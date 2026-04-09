import { readdirSync, realpathSync } from "node:fs";
import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const controllerRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(controllerRoot, "..", "..");
const outputRoot = path.join(controllerRoot, ".dist-runtime", "plugins");
const requireFromRepo = createRequire(path.join(repoRoot, "package.json"));

const bundledPlugins = [
  {
    id: "dingtalk-connector",
    npmName: "@dingtalk-real-ai/dingtalk-connector",
  },
  {
    id: "wecom",
    npmName: "@wecom/wecom-openclaw-plugin",
  },
  {
    id: "openclaw-qqbot",
    npmName: "@tencent-connect/openclaw-qqbot",
  },
];

const MANIFEST_ID_FIXES = {
  "wecom-openclaw-plugin": "wecom",
};

function shouldCopyPluginPath(source) {
  const basename = path.basename(source);
  return basename !== ".bin" && basename !== "node_modules";
}

function getVirtualStoreNodeModules(realPkgPath) {
  let currentPath = realPkgPath;
  while (currentPath !== dirname(currentPath)) {
    if (path.basename(currentPath) === "node_modules") {
      return currentPath;
    }
    currentPath = dirname(currentPath);
  }
  return null;
}

function getPackageNodeModules(packageRoot) {
  const candidate = path.join(packageRoot, "node_modules");
  try {
    readdirSync(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function listPackages(nodeModulesDir) {
  const result = [];

  for (const entry of readdirSync(nodeModulesDir)) {
    if (entry === ".bin") {
      continue;
    }

    const fullPath = path.join(nodeModulesDir, entry);
    if (entry.startsWith("@")) {
      let scopedEntries = [];
      try {
        scopedEntries = readdirSync(fullPath);
      } catch {
        continue;
      }

      for (const subEntry of scopedEntries) {
        result.push({
          name: `${entry}/${subEntry}`,
          fullPath: path.join(fullPath, subEntry),
        });
      }
      continue;
    }

    result.push({ name: entry, fullPath });
  }

  return result;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function maybeFixPluginManifest(outputDir) {
  const manifestPath = path.join(outputDir, "openclaw.plugin.json");
  try {
    const manifest = await readJson(manifestPath);
    const oldId = manifest.id;
    if (typeof oldId === "string" && MANIFEST_ID_FIXES[oldId]) {
      manifest.id = MANIFEST_ID_FIXES[oldId];
      await writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
    }
  } catch {
    // Ignore plugins that do not ship a manifest at bundle time.
  }

  const pkgPath = path.join(outputDir, "package.json");
  try {
    const pkg = await readJson(pkgPath);
    let modified = false;
    for (const [oldId, newId] of Object.entries(MANIFEST_ID_FIXES)) {
      if (typeof pkg.name === "string" && pkg.name.includes(oldId)) {
        pkg.name = pkg.name.replaceAll(oldId, newId);
        modified = true;
      }
    }
    if (modified) {
      await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    }

    const entryFiles = [pkg.main, pkg.module].filter(
      (value) => typeof value === "string" && value.length > 0,
    );
    for (const entryFile of entryFiles) {
      const entryPath = path.join(outputDir, entryFile);
      try {
        let content = await readFile(entryPath, "utf8");
        let patched = false;
        for (const [oldId, newId] of Object.entries(MANIFEST_ID_FIXES)) {
          const escapedOldId = oldId.replaceAll("-", "\\-");
          const pattern = new RegExp(
            `(\\bid\\s*:\\s*)(["'])${escapedOldId}\\2`,
            "g",
          );
          const nextContent = content.replace(pattern, `$1$2${newId}$2`);
          if (nextContent !== content) {
            content = nextContent;
            patched = true;
          }
        }
        if (patched) {
          await writeFile(entryPath, content, "utf8");
        }
      } catch {
        // Ignore missing entry files during bundle-time fixups.
      }
    }
  } catch {
    // Ignore plugins without a package manifest.
  }
}

async function bundlePlugin({ id, npmName }) {
  let packageJsonPath;
  try {
    packageJsonPath = requireFromRepo.resolve(`${npmName}/package.json`);
  } catch {
    throw new Error(
      `Missing ${npmName}. Run "pnpm install" at the repo root before building controller runtime plugins.`,
    );
  }

  const sourcePackageRoot = await realpath(path.dirname(packageJsonPath));
  const outputDir = path.join(outputRoot, id);

  await cp(sourcePackageRoot, outputDir, {
    recursive: true,
    force: true,
    dereference: true,
    filter: shouldCopyPluginPath,
  });
  await maybeFixPluginManifest(outputDir);

  const rootDependencyNodeModules =
    getPackageNodeModules(sourcePackageRoot) ??
    getVirtualStoreNodeModules(sourcePackageRoot);
  if (!rootDependencyNodeModules) {
    throw new Error(`Unable to resolve node_modules for ${npmName}`);
  }

  const packageJson = await readJson(path.join(outputDir, "package.json"));
  const skipPackages = new Set([
    "typescript",
    "@playwright/test",
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ]);
  const collected = new Map();
  const queue = [
    { nodeModulesDir: rootDependencyNodeModules, skipPkg: npmName },
  ];

  while (queue.length > 0) {
    const { nodeModulesDir, skipPkg } = queue.shift();
    for (const { name, fullPath } of listPackages(nodeModulesDir)) {
      if (
        name === skipPkg ||
        skipPackages.has(name) ||
        name.startsWith("@types/")
      ) {
        continue;
      }

      let realPackagePath;
      try {
        realPackagePath = realpathSync(fullPath);
      } catch {
        continue;
      }

      if (collected.has(realPackagePath)) {
        continue;
      }
      collected.set(realPackagePath, name);

      const depVirtualNodeModules = getVirtualStoreNodeModules(realPackagePath);
      if (depVirtualNodeModules && depVirtualNodeModules !== nodeModulesDir) {
        queue.push({ nodeModulesDir: depVirtualNodeModules, skipPkg: name });
      }
    }
  }

  const outputNodeModules = path.join(outputDir, "node_modules");
  await mkdir(outputNodeModules, { recursive: true });

  const copiedNames = new Set();
  for (const [realPackagePath, packageName] of collected) {
    if (copiedNames.has(packageName)) {
      continue;
    }
    copiedNames.add(packageName);

    const destinationPath = path.join(outputNodeModules, packageName);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await rm(destinationPath, { recursive: true, force: true });
    await cp(realPackagePath, destinationPath, {
      recursive: true,
      force: true,
      dereference: true,
      filter: shouldCopyPluginPath,
    });
  }
}

async function main() {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const plugin of bundledPlugins) {
    await bundlePlugin(plugin);
  }
}

await main();
