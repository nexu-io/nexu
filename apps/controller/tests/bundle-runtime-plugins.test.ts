import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDependencyNodeModules } from "../scripts/bundle-runtime-plugins.mjs";

describe("resolveDependencyNodeModules", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.map((rootDir) => rm(rootDir, { recursive: true, force: true })),
    );
    tempRoots.length = 0;
  });

  it("falls back to the pnpm virtual-store node_modules when the package-local directory only contains .bin", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "nexu-bundle-runtime-plugins-"),
    );
    tempRoots.push(rootDir);

    const packageRoot = path.join(
      rootDir,
      "node_modules",
      ".pnpm",
      "@scope+plugin@1.0.0",
      "node_modules",
      "@scope",
      "plugin",
    );
    const packageLocalNodeModules = path.join(packageRoot, "node_modules");
    const virtualStoreNodeModules = path.join(
      rootDir,
      "node_modules",
      ".pnpm",
      "@scope+plugin@1.0.0",
      "node_modules",
    );
    const dependencyDir = path.join(virtualStoreNodeModules, "dingtalk-stream");

    await mkdir(path.join(packageLocalNodeModules, ".bin"), {
      recursive: true,
    });
    await mkdir(dependencyDir, { recursive: true });
    await writeFile(
      path.join(dependencyDir, "package.json"),
      '{ "name": "dingtalk-stream" }\n',
      "utf8",
    );

    expect(resolveDependencyNodeModules(packageRoot)).toBe(
      virtualStoreNodeModules,
    );
  });

  it("prefers the package-local node_modules when it contains real dependencies", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "nexu-bundle-runtime-plugins-"),
    );
    tempRoots.push(rootDir);

    const packageRoot = path.join(rootDir, "plugin");
    const packageLocalNodeModules = path.join(packageRoot, "node_modules");
    const dependencyDir = path.join(packageLocalNodeModules, "silk-wasm");

    await mkdir(dependencyDir, { recursive: true });
    await writeFile(
      path.join(dependencyDir, "package.json"),
      '{ "name": "silk-wasm" }\n',
      "utf8",
    );

    expect(resolveDependencyNodeModules(packageRoot)).toBe(
      packageLocalNodeModules,
    );
  });
});
