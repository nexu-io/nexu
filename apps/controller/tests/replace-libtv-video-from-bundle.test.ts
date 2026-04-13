import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replaceLibtvVideoFromBundle } from "../src/services/skillhub/curated-skills.js";
import { SkillDb } from "../src/services/skillhub/skill-db.js";

/**
 * Seed a fake bundled libtv-video source directory at <root>/bundle/libtv-video/
 * containing a minimal SKILL.md and one script file. Content is deterministic
 * so tests can assert exact equality after the copy.
 */
function seedBundle(bundleRoot: string, scriptContent: string): string {
  const srcDir = resolve(bundleRoot, "libtv-video");
  mkdirSync(resolve(srcDir, "scripts"), { recursive: true });
  writeFileSync(
    resolve(srcDir, "SKILL.md"),
    [
      "---",
      "name: libtv-video",
      "description: bundled test fixture",
      "---",
      "",
      "# LibTV Video (test fixture)",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    resolve(srcDir, "scripts", "libtv_video.py"),
    scriptContent,
    "utf8",
  );
  return srcDir;
}

describe("replaceLibtvVideoFromBundle", () => {
  let workspaceRoot: string;
  let bundleRoot: string;
  let targetRoot: string;
  let ledgerPath: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(resolve(tmpdir(), "nexu-libtv-refresh-"));
    bundleRoot = resolve(workspaceRoot, "bundle");
    targetRoot = resolve(workspaceRoot, "state-skills");
    ledgerPath = resolve(workspaceRoot, "skill-ledger.json");
    mkdirSync(bundleRoot, { recursive: true });
    mkdirSync(targetRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("installs fresh when the state dir is empty and the ledger has no record", async () => {
    seedBundle(bundleRoot, "# fresh bundle v1\n");
    const db = await SkillDb.create(ledgerPath);

    const result = replaceLibtvVideoFromBundle({
      staticDir: bundleRoot,
      targetDir: targetRoot,
      skillDb: db,
    });

    expect(result).toEqual({ installed: true, reason: "fresh-install" });

    const destSkillMd = resolve(targetRoot, "libtv-video", "SKILL.md");
    expect(existsSync(destSkillMd)).toBe(true);
    expect(readFileSync(destSkillMd, "utf8")).toContain("name: libtv-video");

    const destScript = resolve(
      targetRoot,
      "libtv-video",
      "scripts",
      "libtv_video.py",
    );
    expect(readFileSync(destScript, "utf8")).toBe("# fresh bundle v1\n");

    const installed = db.getAllInstalled();
    const libtvRecord = installed.find((r) => r.slug === "libtv-video");
    expect(libtvRecord).toBeDefined();
    expect(libtvRecord?.source).toBe("managed");
    expect(libtvRecord?.status).toBe("installed");
  });

  it("replaces stale state-dir content and keeps the managed record installed", async () => {
    // First install with bundle v1
    seedBundle(bundleRoot, "# bundle v1\n");
    const db = await SkillDb.create(ledgerPath);
    replaceLibtvVideoFromBundle({
      staticDir: bundleRoot,
      targetDir: targetRoot,
      skillDb: db,
    });

    // Simulate a bundled update: v2 content in the source dir.
    seedBundle(bundleRoot, "# bundle v2 — refactored\n");

    const result = replaceLibtvVideoFromBundle({
      staticDir: bundleRoot,
      targetDir: targetRoot,
      skillDb: db,
    });

    expect(result).toEqual({ installed: true, reason: "replaced" });

    const destScript = resolve(
      targetRoot,
      "libtv-video",
      "scripts",
      "libtv_video.py",
    );
    expect(readFileSync(destScript, "utf8")).toBe("# bundle v2 — refactored\n");

    const libtvRecord = db
      .getAllInstalled()
      .find((r) => r.slug === "libtv-video");
    expect(libtvRecord?.status).toBe("installed");
    expect(libtvRecord?.source).toBe("managed");
  });

  it("resurrects over an uninstalled managed record instead of honoring it", async () => {
    seedBundle(bundleRoot, "# bundle resurrect\n");

    // Pre-seed the ledger file with an uninstalled managed record so the
    // newly-created SkillDb parses it through the schema at load time.
    const seededLedger = {
      skills: [
        {
          slug: "libtv-video",
          source: "managed",
          status: "uninstalled",
          version: null,
          installedAt: "2024-01-01T00:00:00.000Z",
          uninstalledAt: "2024-06-01T00:00:00.000Z",
          agentId: null,
        },
      ],
    };
    writeFileSync(ledgerPath, JSON.stringify(seededLedger, null, 2), "utf8");

    const db = await SkillDb.create(ledgerPath);

    const result = replaceLibtvVideoFromBundle({
      staticDir: bundleRoot,
      targetDir: targetRoot,
      skillDb: db,
    });

    expect(result).toEqual({ installed: true, reason: "fresh-install" });

    // State dir has the skill and the ledger record is flipped back to
    // installed — libtv-video is treated as a core bundled capability
    // that always tracks the shipped version, so uninstall is NOT
    // honored.
    const destSkillMd = resolve(targetRoot, "libtv-video", "SKILL.md");
    expect(existsSync(destSkillMd)).toBe(true);

    const libtvRecord = db
      .getAllInstalled()
      .find((r) => r.slug === "libtv-video");
    expect(libtvRecord?.status).toBe("installed");
    expect(libtvRecord?.source).toBe("managed");
  });

  it("leaves workspace records for the same slug untouched", async () => {
    seedBundle(bundleRoot, "# bundle coexistence\n");

    // Seed ledger with BOTH a managed libtv-video and a workspace-scoped
    // libtv-video under a specific agent. The refresh must only modify
    // the managed record.
    const seededLedger = {
      skills: [
        {
          slug: "libtv-video",
          source: "managed",
          status: "installed",
          version: null,
          installedAt: "2024-01-01T00:00:00.000Z",
          uninstalledAt: null,
          agentId: null,
        },
        {
          slug: "libtv-video",
          source: "workspace",
          status: "installed",
          version: "user-local-v0.1",
          installedAt: "2024-02-01T00:00:00.000Z",
          uninstalledAt: null,
          agentId: "agent-xyz",
        },
      ],
    };
    writeFileSync(ledgerPath, JSON.stringify(seededLedger, null, 2), "utf8");

    const db = await SkillDb.create(ledgerPath);

    replaceLibtvVideoFromBundle({
      staticDir: bundleRoot,
      targetDir: targetRoot,
      skillDb: db,
    });

    const installed = db.getAllInstalled();
    const managedRecord = installed.find(
      (r) => r.slug === "libtv-video" && r.source === "managed",
    );
    const workspaceRecord = installed.find(
      (r) => r.slug === "libtv-video" && r.source === "workspace",
    );

    // Managed record is still present and installed.
    expect(managedRecord?.status).toBe("installed");

    // Workspace record is byte-identical to the seeded one — not
    // clobbered by the refresh.
    expect(workspaceRecord).toBeDefined();
    expect(workspaceRecord?.agentId).toBe("agent-xyz");
    expect(workspaceRecord?.status).toBe("installed");
    expect(workspaceRecord?.version).toBe("user-local-v0.1");
    expect(workspaceRecord?.installedAt).toBe("2024-02-01T00:00:00.000Z");
  });

  it("returns bundle-missing when the bundled source directory is absent", async () => {
    // Intentionally do NOT seed the bundle.
    const db = await SkillDb.create(ledgerPath);

    const result = replaceLibtvVideoFromBundle({
      staticDir: bundleRoot,
      targetDir: targetRoot,
      skillDb: db,
    });

    expect(result).toEqual({ installed: false, reason: "bundle-missing" });
    expect(existsSync(resolve(targetRoot, "libtv-video"))).toBe(false);
    expect(db.getAllInstalled()).toHaveLength(0);
  });
});
