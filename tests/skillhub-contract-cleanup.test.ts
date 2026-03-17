import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

describe("skillhub contract cleanup", () => {
  it("removes deleted /api/v1/skills endpoints from generated artifacts", () => {
    const files = [
      "apps/web/lib/api/sdk.gen.ts",
      "apps/web/lib/api/types.gen.ts",
      "apps/api/openapi.json",
    ];

    for (const relativePath of files) {
      const content = readFileSync(resolve(rootDir, relativePath), "utf8");
      expect(content).not.toContain("/api/v1/skills");
      expect(content).not.toContain("/api/v1/skills/{slug}");
    }
  });
});
