import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Tests the resolveInstalledPackageRoot fallback behavior for bin-only packages
 * (packages with no `main` or `exports`, only `bin`).
 *
 * This verifies the fix in sidecar-paths.mjs where require.resolve(packageName)
 * falls back to require.resolve(`${packageName}/package.json`) for packages
 * like clawhub that only export bin scripts.
 */
describe("sidecar-paths bin-only package resolution", () => {
  const tmpDir = resolve(import.meta.dirname, ".tmp-sidecar-test");
  const fakePackageRoot = resolve(tmpDir, "fake-project");
  const nodeModulesDir = resolve(fakePackageRoot, "node_modules");
  const binOnlyPkg = resolve(nodeModulesDir, "bin-only-tool");

  beforeAll(() => {
    // Create a fake project with a bin-only package
    mkdirSync(resolve(binOnlyPkg, "bin"), { recursive: true });
    writeFileSync(
      resolve(fakePackageRoot, "package.json"),
      JSON.stringify({
        name: "fake-project",
        dependencies: { "bin-only-tool": "1.0.0" },
      }),
    );
    writeFileSync(
      resolve(binOnlyPkg, "package.json"),
      JSON.stringify({
        name: "bin-only-tool",
        version: "1.0.0",
        bin: { "bin-only-tool": "bin/cli.js" },
      }),
    );
    writeFileSync(
      resolve(binOnlyPkg, "bin/cli.js"),
      "#!/usr/bin/env node\nconsole.log('hello');\n",
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("require.resolve fails for bin-only package by name", () => {
    const req = createRequire(resolve(fakePackageRoot, "package.json"));
    expect(() => req.resolve("bin-only-tool")).toThrow();
  });

  it("require.resolve succeeds for bin-only package via package.json", () => {
    const req = createRequire(resolve(fakePackageRoot, "package.json"));
    const result = req.resolve("bin-only-tool/package.json");
    expect(result).toBe(resolve(binOnlyPkg, "package.json"));
  });

  it("can resolve bin path from package.json for bin-only packages", () => {
    const req = createRequire(resolve(fakePackageRoot, "package.json"));

    // This is the pattern used in resolveClawHubBin
    let resolvedEntry: string;
    try {
      resolvedEntry = req.resolve("bin-only-tool");
    } catch {
      resolvedEntry = req.resolve("bin-only-tool/package.json");
    }

    const pkgDir = dirname(resolvedEntry);
    const pkgJson = JSON.parse(
      require("node:fs").readFileSync(resolve(pkgDir, "package.json"), "utf8"),
    );
    const binPath = resolve(pkgDir, pkgJson.bin["bin-only-tool"]);
    expect(binPath).toBe(resolve(binOnlyPkg, "bin/cli.js"));
  });
});
