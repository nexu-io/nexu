import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  type CuratedInstallResult,
  copyStaticSkills,
  resolveCuratedSkillsToInstall,
} from "./curated-skills.js";
import type { SkillDb } from "./skill-db.js";
import type {
  CatalogMeta,
  InstalledSkill,
  MinimalSkill,
  SkillSource,
  SkillhubCatalogData,
} from "./types.js";

const execFileAsync = promisify(execFile);

const nodeRequire = createRequire(import.meta.url);

function resolveClawHubBin(): string {
  const pkgPath = nodeRequire.resolve("clawhub/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin?: Record<string, string>;
  };
  const binRel = pkg.bin?.clawhub ?? pkg.bin?.clawdhub ?? "bin/clawdhub.js";
  return resolve(dirname(pkgPath), binRel);
}

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,127}$/;

function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

function resolveSkillPath(skillsDir: string, slug: string): string | null {
  const rootDir = resolve(skillsDir);
  const skillPath = resolve(rootDir, slug);
  const normalizedRoot = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;

  if (skillPath === rootDir || !skillPath.startsWith(normalizedRoot)) {
    return null;
  }

  return skillPath;
}

export type SkillhubLogFn = (
  level: "info" | "error" | "warn",
  message: string,
) => void;

const noopLog: SkillhubLogFn = () => {};

const VERSION_CHECK_URL =
  "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/version.json";
const CATALOG_DOWNLOAD_URL =
  "https://skillhub-1251783334.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz";

const DAILY_MS = 24 * 60 * 60 * 1000;

export class CatalogManager {
  private readonly cacheDir: string;
  private readonly skillsDir: string;
  private readonly curatedSkillsDir: string;
  private readonly db: SkillDb;
  private readonly staticSkillsDir: string;
  private readonly metaPath: string;
  private readonly catalogPath: string;
  private readonly tempCatalogPath: string;
  private readonly log: SkillhubLogFn;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    cacheDir: string,
    opts: {
      skillsDir?: string;
      curatedSkillsDir?: string;
      staticSkillsDir?: string;
      skillDb: SkillDb;
      log?: SkillhubLogFn;
    },
  ) {
    this.cacheDir = cacheDir;
    this.skillsDir = opts.skillsDir ?? "";
    this.curatedSkillsDir = opts.curatedSkillsDir ?? "";
    this.db = opts.skillDb;
    this.staticSkillsDir = opts.staticSkillsDir ?? "";
    this.metaPath = resolve(this.cacheDir, "meta.json");
    this.catalogPath = resolve(this.cacheDir, "catalog.json");
    this.tempCatalogPath = resolve(this.cacheDir, ".catalog-next.json");
    this.log = opts.log ?? noopLog;
    mkdirSync(this.cacheDir, { recursive: true });
  }

  start(): void {
    if (process.env.CI) {
      this.log("info", "skillhub catalog sync skipped in CI");
      return;
    }

    void this.refreshCatalog().catch(() => {
      // Best-effort initial sync — cached catalog used as fallback.
    });

    this.intervalId = setInterval(() => {
      void this.refreshCatalog().catch(() => {});
    }, DAILY_MS);
  }

  async refreshCatalog(): Promise<{ ok: boolean; skillCount: number }> {
    const remoteVersion = await this.fetchRemoteVersion();

    const currentMeta = this.readMeta();
    if (currentMeta && currentMeta.version === remoteVersion) {
      return { ok: true, skillCount: currentMeta.skillCount };
    }

    const archivePath = resolve(this.cacheDir, "latest.tar.gz");
    const extractDir = resolve(this.cacheDir, ".extract-staging");

    try {
      const response = await fetch(CATALOG_DOWNLOAD_URL);

      if (!response.ok || !response.body) {
        throw new Error(`Catalog download failed: ${response.status}`);
      }

      const chunks: Uint8Array[] = [];
      const reader = response.body.getReader();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      writeFileSync(archivePath, Buffer.concat(chunks));

      rmSync(extractDir, { recursive: true, force: true });
      mkdirSync(extractDir, { recursive: true });
      await execFileAsync("tar", ["-xzf", archivePath, "-C", extractDir]);

      const skills = this.buildMinimalCatalog(extractDir);
      writeFileSync(this.tempCatalogPath, JSON.stringify(skills), "utf8");
      renameSync(this.tempCatalogPath, this.catalogPath);

      const meta: CatalogMeta = {
        version: remoteVersion,
        updatedAt: new Date().toISOString(),
        skillCount: skills.length,
      };
      this.writeMeta(meta);

      return { ok: true, skillCount: skills.length };
    } finally {
      rmSync(archivePath, { force: true });
      rmSync(extractDir, { recursive: true, force: true });
      rmSync(this.tempCatalogPath, { force: true });
    }
  }

  getCatalog(): SkillhubCatalogData {
    const skills = this.readCachedSkills();
    const dbRecords = this.db.getAllInstalled();

    const installedSkills: InstalledSkill[] = dbRecords.map((r) => {
      const dir =
        r.source === "curated" ? this.curatedSkillsDir : this.skillsDir;
      const skillMdPath = resolve(dir, r.slug, "SKILL.md");
      const { name, description } = this.parseFrontmatter(skillMdPath);
      return {
        slug: r.slug,
        source: r.source,
        name: name || r.slug,
        description: description || "",
      };
    });

    const installedSlugs = installedSkills.map((s) => s.slug);
    const meta = this.readMeta();

    return { skills, installedSlugs, installedSkills, meta };
  }

  async installSkill(slug: string): Promise<{ ok: boolean; error?: string }> {
    if (!isValidSlug(slug)) {
      this.log("warn", `install rejected slug=${slug} — invalid slug`);
      return { ok: false, error: "Invalid skill slug" };
    }

    this.log("info", `installing skill slug=${slug} dir=${this.skillsDir}`);
    try {
      const clawHubBin = resolveClawHubBin();
      this.log("info", `install resolved clawhub=${clawHubBin}`);
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [
          clawHubBin,
          "--workdir",
          this.skillsDir,
          "--dir",
          ".",
          "install",
          slug,
          "--force",
        ],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
      );
      if (stdout)
        this.log("info", `install stdout slug=${slug}: ${stdout.trim()}`);
      if (stderr)
        this.log("warn", `install stderr slug=${slug}: ${stderr.trim()}`);
      this.log("info", `install ok slug=${slug}`);
      await this.installSkillDeps(resolve(this.skillsDir, slug), slug);
      this.db.recordInstall(slug, "managed");
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("error", `install failed slug=${slug}: ${message}`);
      return { ok: false, error: message };
    }
  }

  async uninstallSkill(slug: string): Promise<{ ok: boolean; error?: string }> {
    if (!isValidSlug(slug)) {
      this.log("warn", `uninstall rejected slug=${slug} — invalid slug`);
      return { ok: false, error: "Invalid skill slug" };
    }

    this.log("info", `uninstalling skill slug=${slug}`);
    try {
      const managedPath = resolveSkillPath(this.skillsDir, slug);
      const curatedPath = resolveSkillPath(this.curatedSkillsDir, slug);

      let removed = false;

      if (managedPath && existsSync(managedPath)) {
        rmSync(managedPath, { recursive: true, force: true });
        removed = true;
        this.log("info", `uninstall ok (managed) slug=${slug}`);
        this.db.recordUninstall(slug, "managed");
      }

      if (curatedPath && existsSync(curatedPath)) {
        rmSync(curatedPath, { recursive: true, force: true });
        removed = true;
        this.log("info", `uninstall ok (curated) slug=${slug}`);
        this.db.recordUninstall(slug, "curated");
      }

      if (!removed) {
        this.log("warn", `uninstall skip slug=${slug} — dir not found`);
      }

      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("error", `uninstall failed slug=${slug}: ${message}`);
      return { ok: false, error: message };
    }
  }

  async installCuratedSkills(): Promise<CuratedInstallResult> {
    // Step 1: Copy static skills (not on ClawHub) from app bundle
    if (this.staticSkillsDir) {
      const { copied } = copyStaticSkills({
        staticDir: this.staticSkillsDir,
        curatedDir: this.curatedSkillsDir,
        skillDb: this.db,
      });
      if (copied.length > 0) {
        this.db.recordBulkInstall(copied, "curated");
        this.log("info", `curated static skills copied: ${copied.join(", ")}`);
      }
    }

    // Step 1b: Record any on-disk curated skills not yet tracked in DB
    // (handles static skills from a previous run when staticSkillsDir is unset)
    if (this.curatedSkillsDir && existsSync(this.curatedSkillsDir)) {
      const untracked: string[] = [];
      try {
        for (const entry of readdirSync(this.curatedSkillsDir, {
          withFileTypes: true,
        })) {
          if (
            entry.isDirectory() &&
            existsSync(
              resolve(this.curatedSkillsDir, entry.name, "SKILL.md"),
            ) &&
            !this.db.isInstalled(entry.name, "curated")
          ) {
            untracked.push(entry.name);
          }
        }
      } catch {
        // Directory not readable — skip
      }
      if (untracked.length > 0) {
        this.db.recordBulkInstall(untracked, "curated");
        this.log(
          "info",
          `curated on-disk skills recorded: ${untracked.join(", ")}`,
        );
      }
    }

    // Step 2: Install remaining from ClawHub
    const { toInstall, toSkip } = resolveCuratedSkillsToInstall({
      curatedDir: this.curatedSkillsDir,
      skillDb: this.db,
    });

    if (toInstall.length === 0) {
      this.log(
        "info",
        `curated skills: nothing to install (${toSkip.length} skipped)`,
      );
      return { installed: [], skipped: toSkip, failed: [] };
    }

    this.log("info", `curated skills: installing ${toInstall.length} skills`);

    const clawHubBin = resolveClawHubBin();
    const CONCURRENCY = 5;

    const installOne = async (
      slug: string,
    ): Promise<{ slug: string; ok: boolean }> => {
      try {
        this.log(
          "info",
          `curated installing: ${slug} -> ${this.curatedSkillsDir}`,
        );
        const { stdout, stderr } = await execFileAsync(
          process.execPath,
          [
            clawHubBin,
            "--workdir",
            this.curatedSkillsDir,
            "--dir",
            ".",
            "install",
            slug,
            "--force",
          ],
          { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
        );
        if (stdout) this.log("info", `curated stdout: ${stdout.trim()}`);
        if (stderr) this.log("warn", `curated stderr: ${stderr.trim()}`);
        this.log("info", `curated install ok: ${slug}`);
        return { slug, ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log("error", `curated install failed: ${slug} — ${message}`);
        return { slug, ok: false };
      }
    };

    // Download & extract in parallel batches
    const installed: string[] = [];
    const failed: string[] = [];

    for (let i = 0; i < toInstall.length; i += CONCURRENCY) {
      const batch = toInstall.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(installOne));
      for (const result of results) {
        if (result.status === "fulfilled" && result.value.ok) {
          installed.push(result.value.slug);
        } else {
          const slug =
            result.status === "fulfilled" ? result.value.slug : "unknown";
          failed.push(slug);
        }
      }
    }

    // Install npm deps in parallel for skills that have package.json
    if (installed.length > 0) {
      await Promise.allSettled(
        installed.map((slug) =>
          this.installSkillDeps(resolve(this.curatedSkillsDir, slug), slug),
        ),
      );
    }

    if (installed.length > 0) {
      this.db.recordBulkInstall(installed, "curated");
    }

    return { installed, skipped: toSkip, failed };
  }

  /**
   * Two-way sync between the DB ledger and what's actually on disk.
   * - DB records with missing SKILL.md → mark uninstalled
   * - Skill dirs on disk with no DB record → record as installed
   */
  reconcileDbWithDisk(): void {
    const dbRecords = this.db.getAllInstalled();

    // DB → disk: check each installed record has a SKILL.md on disk
    const missingFromDisk: Array<{ slug: string; source: SkillSource }> = [];
    for (const record of dbRecords) {
      const dir =
        record.source === "curated" ? this.curatedSkillsDir : this.skillsDir;
      if (!dir) continue;
      const skillMd = resolve(dir, record.slug, "SKILL.md");
      if (!existsSync(skillMd)) {
        missingFromDisk.push({ slug: record.slug, source: record.source });
      }
    }

    if (missingFromDisk.length > 0) {
      const curatedMissing = missingFromDisk
        .filter((r) => r.source === "curated")
        .map((r) => r.slug);
      const managedMissing = missingFromDisk
        .filter((r) => r.source === "managed")
        .map((r) => r.slug);

      if (curatedMissing.length > 0) {
        this.db.markUninstalledBySlugs(curatedMissing, "curated");
      }
      if (managedMissing.length > 0) {
        this.db.markUninstalledBySlugs(managedMissing, "managed");
      }
      this.log(
        "info",
        `reconcile: ${missingFromDisk.length} DB records marked uninstalled (missing from disk)`,
      );
    }

    // Disk → DB: scan both dirs for skills not in DB
    const diskOnly: Array<{ slug: string; source: SkillSource }> = [];

    for (const { dir, source } of [
      { dir: this.curatedSkillsDir, source: "curated" as const },
      { dir: this.skillsDir, source: "managed" as const },
    ]) {
      if (!dir || !existsSync(dir)) continue;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (
            entry.isDirectory() &&
            existsSync(resolve(dir, entry.name, "SKILL.md")) &&
            !this.db.isInstalled(entry.name, source)
          ) {
            diskOnly.push({ slug: entry.name, source });
          }
        }
      } catch {
        // Directory not readable — skip
      }
    }

    if (diskOnly.length > 0) {
      const curatedOnDisk = diskOnly
        .filter((r) => r.source === "curated")
        .map((r) => r.slug);
      const managedOnDisk = diskOnly
        .filter((r) => r.source === "managed")
        .map((r) => r.slug);

      if (curatedOnDisk.length > 0) {
        this.db.recordBulkInstall(curatedOnDisk, "curated");
      }
      if (managedOnDisk.length > 0) {
        this.db.recordBulkInstall(managedOnDisk, "managed");
      }
      this.log(
        "info",
        `reconcile: ${diskOnly.length} on-disk skills recorded in DB`,
      );
    }

    if (missingFromDisk.length === 0 && diskOnly.length === 0) {
      this.log("info", "reconcile: DB and disk are in sync");
    }
  }

  dispose(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.db.close();
  }

  private async installSkillDeps(
    skillDir: string,
    slug: string,
  ): Promise<void> {
    if (!existsSync(resolve(skillDir, "package.json"))) return;

    this.log("info", `installing npm deps: ${slug}`);
    try {
      const npmArgs = ["install", "--production", "--no-audit", "--no-fund"];
      await execFileAsync("npm", npmArgs, { cwd: skillDir });
      this.log("info", `npm deps installed: ${slug}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("warn", `npm deps failed for ${slug}: ${message}`);
    }
  }

  private parseFrontmatter(filePath: string): {
    name: string;
    description: string;
  } {
    try {
      const content = readFileSync(filePath, "utf8");
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match?.[1]) return { name: "", description: "" };
      const frontmatter = match[1];
      const nameMatch = frontmatter.match(/^name:\s*['"]?(.+?)['"]?\s*$/m);
      const descMatch = frontmatter.match(
        /^description:\s*['"]?(.+?)['"]?\s*$/m,
      );
      return {
        name: nameMatch?.[1]?.trim() ?? "",
        description: descMatch?.[1]?.trim() ?? "",
      };
    } catch {
      return { name: "", description: "" };
    }
  }

  private async fetchRemoteVersion(): Promise<string> {
    const response = await fetch(VERSION_CHECK_URL);

    if (!response.ok) {
      throw new Error(`Version check failed: ${response.status}`);
    }

    const data = (await response.json()) as { version: string };
    return data.version;
  }

  private buildMinimalCatalog(extractDir: string): MinimalSkill[] {
    const indexPath = this.findIndexFile(extractDir);

    if (!indexPath) {
      throw new Error("No index JSON found in extracted catalog archive");
    }

    const parsed = JSON.parse(readFileSync(indexPath, "utf8")) as unknown;

    // The index can be a plain array or a wrapper object with a `skills` array.
    const raw: unknown[] = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" &&
          parsed !== null &&
          "skills" in parsed &&
          Array.isArray((parsed as { skills: unknown }).skills)
        ? (parsed as { skills: unknown[] }).skills
        : [];

    return raw
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null,
      )
      .map((entry) => {
        const stats =
          typeof entry.stats === "object" && entry.stats !== null
            ? (entry.stats as Record<string, unknown>)
            : {};

        const updatedAtRaw = entry.updated_at ?? entry.updatedAt ?? "";
        const updatedAt =
          typeof updatedAtRaw === "number"
            ? new Date(updatedAtRaw).toISOString()
            : String(updatedAtRaw);

        return {
          slug: String(entry.slug ?? ""),
          name: String(entry.name ?? entry.slug ?? ""),
          description: String(entry.description ?? "").slice(0, 150),
          downloads: Number(stats.downloads ?? entry.downloads ?? 0),
          stars: Number(stats.stars ?? entry.stars ?? 0),
          tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 5) : [],
          version: String(entry.version ?? "0.0.0"),
          updatedAt,
        };
      });
  }

  private findIndexFile(dir: string): string | null {
    // Known file names in priority order
    const candidates = [
      "skills_index.local.json",
      "skills_index.json",
      "index.json",
      "catalog.json",
      "skills.json",
    ];

    // Check root and one level deep
    try {
      const dirs = [dir];
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push(resolve(dir, entry.name));
        }
      }

      for (const name of candidates) {
        for (const searchDir of dirs) {
          const path = resolve(searchDir, name);
          if (existsSync(path)) return path;
        }
      }
    } catch {
      // Directory not readable
    }

    return null;
  }

  private readCachedSkills(): MinimalSkill[] {
    if (!existsSync(this.catalogPath)) {
      return [];
    }

    try {
      return JSON.parse(
        readFileSync(this.catalogPath, "utf8"),
      ) as MinimalSkill[];
    } catch {
      return [];
    }
  }

  private readMeta(): CatalogMeta | null {
    if (!existsSync(this.metaPath)) {
      return null;
    }

    try {
      return JSON.parse(readFileSync(this.metaPath, "utf8")) as CatalogMeta;
    } catch {
      return null;
    }
  }

  private writeMeta(meta: CatalogMeta): void {
    writeFileSync(this.metaPath, JSON.stringify(meta, null, 2), "utf8");
  }
}
