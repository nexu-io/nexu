import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cacheInputs,
  computeFingerprint,
} from "../../packages/slimclaw/postinstall-cache.mjs";

const tempDirs = [] as string[];
const originalCacheInputs = [...cacheInputs];

async function createRuntimeFixture() {
  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "slimclaw-runtime-cache-"),
  );
  tempDirs.push(tempRoot);

  const rewrittenCacheInputs = originalCacheInputs.map((inputPath) =>
    path.join(tempRoot, path.basename(inputPath)),
  );
  cacheInputs.splice(0, cacheInputs.length, ...rewrittenCacheInputs);

  for (const absolutePath of cacheInputs) {
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `${absolutePath}\n`, "utf8");
  }

  const runtimeDir = path.join(tempRoot, "runtime-root");
  await mkdir(path.join(runtimeDir, "node_modules"), { recursive: true });
  await writeFile(path.join(runtimeDir, "README.md"), "docs v1\n", "utf8");

  return runtimeDir;
}

afterEach(async () => {
  cacheInputs.splice(0, cacheInputs.length, ...originalCacheInputs);
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("slimclaw runtime postinstall cache fingerprint", () => {
  it("ignores docs-only changes outside cache inputs", async () => {
    const runtimeDir = await createRuntimeFixture();
    const before = await computeFingerprint(runtimeDir);

    await writeFile(path.join(runtimeDir, "README.md"), "docs v2\n", "utf8");

    const after = await computeFingerprint(runtimeDir);
    expect(after).toBe(before);
  });

  it("changes when a tracked install input changes", async () => {
    const runtimeDir = await createRuntimeFixture();
    const before = await computeFingerprint(runtimeDir);

    await writeFile(
      cacheInputs.find((filePath) =>
        filePath.endsWith("prune-runtime-paths.mjs"),
      ) ?? cacheInputs[0],
      "export const pruneTargets = ['node_modules/foo'];\n",
      "utf8",
    );

    const after = await computeFingerprint(runtimeDir);
    expect(after).not.toBe(before);
  });

  it("changes when a tracked file goes missing", async () => {
    const runtimeDir = await createRuntimeFixture();
    const before = await computeFingerprint(runtimeDir);

    await rm(
      cacheInputs.find((filePath) =>
        filePath.endsWith("postinstall-cache.mjs"),
      ) ?? cacheInputs[0],
      { force: true },
    );

    const after = await computeFingerprint(runtimeDir);
    expect(after).not.toBe(before);
  });
});
