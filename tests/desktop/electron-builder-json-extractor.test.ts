import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  extractJsonFromPossiblyPollutedOutput,
}: {
  extractJsonFromPossiblyPollutedOutput: (shellOutput: string) => unknown;
} = require("../../apps/desktop/scripts/electron-builder-json-extractor.cjs");

describe("electron-builder JSON extraction", () => {
  it("parses clean JSON arrays", () => {
    expect(
      extractJsonFromPossiblyPollutedOutput('[{"name":"@nexu/desktop"}]'),
    ).toEqual([{ name: "@nexu/desktop" }]);
  });

  it("extracts JSON after noisy bracketed logs", () => {
    expect(
      extractJsonFromPossiblyPollutedOutput(
        [
          "[warn] recursive workspace output follows",
          "Scope: all 5 workspace projects",
          '[{"name":"@nexu/desktop","dependencies":{"react":{"version":"19.2.4"}}}]',
          "Done in 1.2s",
        ].join("\n"),
      ),
    ).toEqual([
      {
        name: "@nexu/desktop",
        dependencies: {
          react: {
            version: "19.2.4",
          },
        },
      },
    ]);
  });

  it("throws when no JSON exists", () => {
    expect(() =>
      extractJsonFromPossiblyPollutedOutput("workspace scan failed"),
    ).toThrow("No JSON content found in output");
  });
});
