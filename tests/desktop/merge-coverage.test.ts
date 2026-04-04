import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildArtifactMatchSuffixes,
  getNodeSourceMapEntry,
  normalizeRelativePath,
  pickArtifactSourceMap,
  resolveCompiledRepoPath,
  resolveNodeCompiledRepoPath,
} from "../../e2e/desktop/scripts/merge-coverage.mjs";

describe("merge coverage helpers", () => {
  const desktopDistScriptUrl = pathToFileURL(
    join(process.cwd(), "apps", "desktop", "dist", "assets", "index.js"),
  ).href;
  const controllerSidecarScriptUrl = pathToFileURL(
    join(
      process.cwd(),
      ".tmp",
      "nexu-home",
      "runtime",
      "controller-sidecar",
      "dist",
      "index.js",
    ),
  ).href;

  it("maps web-dist artifacts to apps/web/dist", () => {
    expect(resolveCompiledRepoPath("web-dist/assets/index-abc123.js")).toBe(
      "apps/web/dist/assets/index-abc123.js",
    );
  });

  it("retains first-party paths under apps/desktop/shared", () => {
    const sharedPath = join(
      process.cwd(),
      "apps",
      "desktop",
      "shared",
      "runtime-config.ts",
    );

    expect(normalizeRelativePath(sharedPath, process.cwd())).toBe(
      "apps/desktop/shared/runtime-config.ts",
    );
  });

  it("builds artifact suffixes for dist and stripped runtime URLs", () => {
    expect(buildArtifactMatchSuffixes("dist/assets/main.js")).toEqual([
      "dist/assets/main.js",
      "assets/main.js",
    ]);

    expect(buildArtifactMatchSuffixes("web-dist/assets/web.js")).toEqual([
      "web-dist/assets/web.js",
      "assets/web.js",
    ]);
  });

  it("picks the source map with the longest matching suffix", () => {
    const shorter = {
      id: "shorter",
      matchSuffixes: ["assets/index.js"],
    };
    const longer = {
      id: "longer",
      matchSuffixes: ["dist/assets/index.js"],
    };

    expect(pickArtifactSourceMap(desktopDistScriptUrl, [shorter, longer])).toBe(
      longer,
    );

    expect(
      pickArtifactSourceMap("http://127.0.0.1:50810/assets/index.js", [
        shorter,
        longer,
      ]),
    ).toBe(shorter);
  });

  it("remaps packaged controller-sidecar paths into apps/controller/dist", () => {
    expect(
      resolveNodeCompiledRepoPath(
        "/Users/test/.nexu/runtime/controller-sidecar/dist/index.js",
        "/repo",
      ),
    ).toBe("apps/controller/dist/index.js");
  });

  it("returns node source-map entries with remapped compiled path and line lengths", () => {
    const rawNodeCoverage = {
      "source-map-cache": {
        [controllerSidecarScriptUrl]: {
          lineLengths: [42, 13],
          data: JSON.stringify({
            version: 3,
            names: [],
            sources: ["../src/index.ts"],
            mappings: "AAAA",
          }),
        },
      },
    };

    const entry = getNodeSourceMapEntry(
      rawNodeCoverage,
      controllerSidecarScriptUrl,
      "/repo",
    );

    expect(entry?.compiledRepoPath).toBe("apps/controller/dist/index.js");
    expect(entry?.lineLengths).toEqual([42, 13]);
    expect(entry?.sourceMap).toMatchObject({
      version: 3,
      sources: ["../src/index.ts"],
    });
    expect(entry?.sourceMapLines.length).toBeGreaterThan(0);
  });
});
