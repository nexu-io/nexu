import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(scriptDir, "..", "package.json");

async function readPackageJson() {
  return JSON.parse(await readFile(packageJsonPath, "utf8"));
}

async function main() {
  const command = process.argv[2];

  if (command === "get") {
    const pkg = await readPackageJson();
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  if (command === "set") {
    const version = process.argv[3]?.trim();
    if (!version) {
      throw new Error("[desktop-package-version] missing version argument");
    }

    const pkg = await readPackageJson();
    pkg.version = version;
    await writeFile(
      packageJsonPath,
      `${JSON.stringify(pkg, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`${version}\n`);
    return;
  }

  throw new Error("[desktop-package-version] expected 'get' or 'set'");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
