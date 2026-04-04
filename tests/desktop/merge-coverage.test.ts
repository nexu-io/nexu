import { describe, expect, it } from "vitest";

import {
  buildArtifactMatchSuffixes,
  getNodeSourceMapEntry,
  pickArtifactSourceMap,
  resolveCompiledRepoPath,
  resolveNodeCompiledRepoPath,
} from "../../e2e/desktop/scripts/merge-coverage.mjs";

describe("merge coverage helpers", () => {
  it("maps web-dist artifacts to apps/web/dist", () => {
    expect(resolveCompiledRepoPath("web-dist/assets/index-abc123.js")).toBe(
      "apps/web/dist/assets/index-abc123.js",
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

    expect(
      pickArtifactSourceMap("file:///tmp/apps/desktop/dist/assets/index.js", [
        shorter,
        longer,
      ]),
    ).toBe(longer);

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
    const scriptUrl =
      "file:///Users/test/.nexu/runtime/controller-sidecar/dist/index.js";
    const rawNodeCoverage = {
      "source-map-cache": {
        [scriptUrl]: {
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

    const entry = getNodeSourceMapEntry(rawNodeCoverage, scriptUrl, "/repo");

    expect(entry?.compiledRepoPath).toBe("apps/controller/dist/index.js");
    expect(entry?.lineLengths).toEqual([42, 13]);
    expect(entry?.sourceMap).toMatchObject({
      version: 3,
      sources: ["../src/index.ts"],
    });
    expect(entry?.sourceMapLines.length).toBeGreaterThan(0);
  });
});
