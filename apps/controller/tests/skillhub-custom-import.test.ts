import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/skillhub/zip-importer.js", () => ({
  importSkillZip: vi.fn(),
  MAX_ZIP_SIZE: 50 * 1024 * 1024,
}));

vi.mock("../src/services/skillhub/npm-runner.js", () => ({
  ensureNpmAvailable: vi.fn(),
  runNpmInstall: vi.fn(),
}));

const { importSkillZip: extractZipMock } = await import(
  "../src/services/skillhub/zip-importer.js"
);
const { ensureNpmAvailable, runNpmInstall } = await import(
  "../src/services/skillhub/npm-runner.js"
);
const { CatalogManager } = await import(
  "../src/services/skillhub/catalog-manager.js"
);
const { SkillDb } = await import("../src/services/skillhub/skill-db.js");

function stubExtractTo(
  slug: string,
  _skillsDir: string,
  opts: { withPackageJson?: boolean } = {},
) {
  vi.mocked(extractZipMock).mockImplementationOnce(
    (_buffer, target: string) => {
      const skillDir = path.join(target, slug);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        path.join(skillDir, "SKILL.md"),
        `---\nname: ${slug}\ndescription: test\n---\n`,
      );
      if (opts.withPackageJson) {
        writeFileSync(
          path.join(skillDir, "package.json"),
          JSON.stringify({ name: slug, version: "0.1.0" }),
        );
      }
      return { ok: true, slug };
    },
  );
}

describe("CatalogManager.importSkillZip", () => {
  let tmpDir: string;
  let skillsDir: string;
  let cacheDir: string;
  let skillDb: InstanceType<typeof SkillDb>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "nexu-custom-import-"));
    skillsDir = path.join(tmpDir, "skills");
    cacheDir = path.join(tmpDir, "cache");
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    skillDb = await SkillDb.create(path.join(tmpDir, "skill-ledger.json"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    skillDb.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("records install when extraction succeeds and skill has no deps", async () => {
    stubExtractTo("no-deps", skillsDir);
    const catalog = new CatalogManager(cacheDir, { skillsDir, skillDb });

    const result = await catalog.importSkillZip(Buffer.from("zip"));

    expect(result).toEqual({ ok: true, slug: "no-deps" });
    expect(existsSync(path.join(skillsDir, "no-deps", "SKILL.md"))).toBe(true);
    expect(skillDb.getAllKnownSlugs().has("no-deps")).toBe(true);
    expect(skillDb.getInstalledRecordsBySlug("no-deps")[0]?.status).toBe(
      "installed",
    );
    expect(vi.mocked(ensureNpmAvailable)).not.toHaveBeenCalled();
  });

  it("rolls back extracted files and skips DB write when deps install fails with npm_missing", async () => {
    stubExtractTo("needs-npm", skillsDir, { withPackageJson: true });
    vi.mocked(ensureNpmAvailable).mockRejectedValueOnce(
      new Error("NPM_MISSING: npm executable not found on PATH"),
    );
    const catalog = new CatalogManager(cacheDir, { skillsDir, skillDb });

    const result = await catalog.importSkillZip(Buffer.from("zip"));

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("npm_missing");
    expect(result.error).toMatch(/NPM_MISSING/);
    expect(existsSync(path.join(skillsDir, "needs-npm"))).toBe(false);
    expect(skillDb.getAllKnownSlugs().has("needs-npm")).toBe(false);
  });

  it("rolls back and surfaces deps_install_failed when npm install throws", async () => {
    stubExtractTo("broken-deps", skillsDir, { withPackageJson: true });
    vi.mocked(ensureNpmAvailable).mockResolvedValueOnce(undefined);
    vi.mocked(runNpmInstall).mockRejectedValueOnce(
      new Error("npm ERR! ETIMEDOUT"),
    );
    const catalog = new CatalogManager(cacheDir, { skillsDir, skillDb });

    const result = await catalog.importSkillZip(Buffer.from("zip"));

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("deps_install_failed");
    expect(existsSync(path.join(skillsDir, "broken-deps"))).toBe(false);
    expect(skillDb.getAllKnownSlugs().has("broken-deps")).toBe(false);
  });

  it("propagates extraction failures without touching the DB", async () => {
    vi.mocked(extractZipMock).mockReturnValueOnce({
      ok: false,
      error: "Zip contains unsafe paths",
    });
    const catalog = new CatalogManager(cacheDir, { skillsDir, skillDb });

    const result = await catalog.importSkillZip(Buffer.from("zip"));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Zip contains unsafe paths");
    expect(skillDb.getAllKnownSlugs().size).toBe(0);
  });
});
