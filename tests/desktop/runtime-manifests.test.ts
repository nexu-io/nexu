import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSkillNodePath } from "#desktop/main/runtime/manifests";

describe("desktop runtime manifests", () => {
  describe("buildSkillNodePath", () => {
    it("prefers bundled desktop node_modules in dev", () => {
      const result = buildSkillNodePath("/repo/apps/desktop", false, "");

      expect(result).toBe("/repo/apps/desktop/node_modules");
    });

    it("prefers packaged bundled-node-modules for desktop dist", () => {
      const result = buildSkillNodePath(
        "/Applications/Nexu.app/Contents/Resources",
        true,
        "",
      );

      expect(result).toBe(
        "/Applications/Nexu.app/Contents/Resources/bundled-node-modules",
      );
    });

    it("preserves inherited NODE_PATH entries without duplication", () => {
      const bundledPath = "/repo/apps/desktop/node_modules";
      const inherited = [
        bundledPath,
        "/usr/local/lib/node_modules",
        "/opt/custom/node_modules",
      ].join(path.delimiter);

      const result = buildSkillNodePath("/repo/apps/desktop", false, inherited);

      expect(result).toBe(
        [
          bundledPath,
          "/usr/local/lib/node_modules",
          "/opt/custom/node_modules",
        ].join(path.delimiter),
      );
    });
  });
});
