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
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { proxyFetch } from "../../lib/proxy-fetch.js";
import {
  CURATED_SKILL_SLUGS,
  type CuratedInstallResult,
  copyStaticSkills,
  resolveCuratedSkillsToInstall,
} from "./curated-skills.js";
import type { SkillDb, SkillRecord } from "./skill-db.js";
import type {
  CatalogMeta,
  InstalledSkill,
  MinimalSkill,
  SkillSource,
  SkillhubCatalogData,
} from "./types.js";
import { importSkillZip as extractZip } from "./zip-importer.js";

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

const DEFAULT_DOWNLOAD_COUNT = 1000;

/**
 * Corrects known broken slugs in the ClawHub catalog.
 * Key = broken slug in catalog data, Value = correct slug on ClawHub.
 */
const SLUG_CORRECTIONS: Record<string, string> = {
  "find-skills": "find-skill",
};

/**
 * Skills listed in the ClawHub catalog but no longer available for install.
 * Filtered out from the catalog response to avoid confusing users.
 */
const CATALOG_BLOCKLIST = new Set(["self-improving-agent"]);

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

export type SkillUninstallRequest = {
  slug: string;
  source?: SkillSource;
  agentId?: string | null;
};

/**
 * All skills (curated, managed, custom) live in a single `skillsDir`.
 * The lowdb ledger (`SkillDb`) is the single source of truth for source categorization.
 */
export class CatalogManager {
  private readonly cacheDir: string;
  private readonly skillsDir: string;
  private readonly db: SkillDb;
  private readonly staticSkillsDir: string;
  private readonly metaPath: string;
  private readonly catalogPath: string;
  private readonly tempCatalogPath: string;
  private readonly log: SkillhubLogFn;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private readonly userSkillsDir: string;

  constructor(
    cacheDir: string,
    opts: {
      skillsDir?: string;
      userSkillsDir?: string;
      staticSkillsDir?: string;
      skillDb: SkillDb;
      log?: SkillhubLogFn;
    },
  ) {
    this.cacheDir = cacheDir;
    this.skillsDir = opts.skillsDir ?? "";
    this.userSkillsDir = opts.userSkillsDir ?? "";
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
      const response = await proxyFetch(CATALOG_DOWNLOAD_URL);

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
      // tar on Windows quirks (only GNU tar — Git Bash's tar.exe — which
      // commonly precedes the system bsdtar in PATH):
      //  1. Parses a leading `C:` as a remote rsh `host:path` spec and
      //     dies with "Cannot connect to C: resolve failed". `--force-local`
      //     disables that. bsdtar (macOS / Windows System32) does not
      //     accept `--force-local`, so the flag is Windows-only.
      //  2. GNU tar also chokes on backslashes inside paths (treats `\n`
      //     etc. as escape sequences). Forward-slash paths work for both
      //     GNU tar and bsdtar everywhere, so normalizing is harmless and
      //     applied unconditionally.
      const toPosixPath = (p: string): string => p.replace(/\\/g, "/");
      const baseTarArgs = [
        "-xzf",
        toPosixPath(archivePath),
        "-C",
        toPosixPath(extractDir),
      ];
      if (process.platform === "win32") {
        // Try with --force-local first (GNU tar needs it for `C:` paths).
        // Fall back without it for bsdtar (System32\tar.exe) which rejects
        // the flag.
        try {
          await execFileAsync("tar", ["--force-local", ...baseTarArgs]);
        } catch {
          await execFileAsync("tar", baseTarArgs);
        }
      } else {
        await execFileAsync("tar", baseTarArgs);
      }

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

  /**
   * Returns the skill catalog. Installed skills come from the DB ledger
   * (single source of truth), enriched with name/description from SKILL.md on disk.
   */
  getCatalog(): SkillhubCatalogData {
    const skills = this.readCachedSkills();
    const dbRecords = this.db.getAllInstalled();

    const installedSkills: InstalledSkill[] = dbRecords
      .map((r) => {
        const skillMdDir = this.resolveSkillMdDir(r);
        const skillMdPath = resolve(skillMdDir, "SKILL.md");
        const { name, catalogName, description } =
          this.parseFrontmatter(skillMdPath);
        return {
          slug: r.slug,
          source: r.source,
          name: catalogName || name || r.slug,
          description: description || "",
          installedAt: r.installedAt,
          agentId: r.agentId ?? null,
        };
      })
      .sort((a, b) => {
        if (a.installedAt && b.installedAt) {
          const cmp = a.installedAt.localeCompare(b.installedAt);
          if (cmp !== 0) return cmp;
        } else if (a.installedAt && !b.installedAt) {
          return -1;
        } else if (!a.installedAt && b.installedAt) {
          return 1;
        }
        return a.name.localeCompare(b.name);
      });

    const installedSlugs = installedSkills.map((s) => s.slug);
    const meta = this.readMeta();

    return { skills, installedSlugs, installedSkills, meta };
  }

  /**
   * Install a skill from ClawHub marketplace.
   * Step A: Download via clawhub into skillsDir
   * Step B: Record in DB with source "managed"
   */
  async installSkill(
    rawSlug: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const slug = SLUG_CORRECTIONS[rawSlug] ?? rawSlug;
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

  /**
   * Execute a single clawhub install + npm deps. Does NOT record in DB.
   * Used by InstallQueue as the executor function.
   */
  async executeInstall(rawSlug: string): Promise<void> {
    const slug = SLUG_CORRECTIONS[rawSlug] ?? rawSlug;
    if (!isValidSlug(slug)) {
      throw new Error(`Invalid skill slug: ${slug}`);
    }

    this.log("info", `installing: ${slug} -> ${this.skillsDir}`);
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
    if (stdout) this.log("info", `install stdout ${slug}: ${stdout.trim()}`);
    if (stderr) this.log("warn", `install stderr ${slug}: ${stderr.trim()}`);

    await this.installSkillDeps(resolve(this.skillsDir, slug), slug);
  }

  /**
   * Returns curated slugs that have no record in the ledger.
   * Used by SkillhubService to enqueue on startup.
   */
  canonicalizeSlug(rawSlug: string): string {
    return SLUG_CORRECTIONS[rawSlug] ?? rawSlug;
  }

  getCuratedSlugsToEnqueue(): string[] {
    const knownSlugs = this.db.getAllKnownSlugs();
    return CURATED_SKILL_SLUGS.filter((slug) => !knownSlugs.has(slug));
  }

  /**
   * Uninstall a skill.
   * Step A: Look up source from DB record
   * Step B: Delete skill folder from skillsDir
   * Step C: Record uninstall in DB with correct source
   */
  async uninstallSkill(
    request: string | SkillUninstallRequest,
  ): Promise<{ ok: boolean; error?: string }> {
    const payload =
      typeof request === "string" ? { slug: request } : { ...request };
    const slug = SLUG_CORRECTIONS[payload.slug] ?? payload.slug;
    if (!isValidSlug(slug)) {
      this.log("warn", `uninstall rejected slug=${slug} — invalid slug`);
      return { ok: false, error: "Invalid skill slug" };
    }

    if (payload.source === "workspace" && !payload.agentId) {
      this.log(
        "warn",
        `uninstall rejected slug=${slug} — workspace uninstall missing agentId`,
      );
      return { ok: false, error: "Workspace uninstall requires agentId" };
    }

    this.log("info", `uninstalling skill slug=${slug}`);
    try {
      const dbRecords = this.db.getInstalledRecordsBySlug(slug);
      const record = this.resolveInstalledRecord(dbRecords, payload);
      if (!record && payload.source === "workspace") {
        return {
          ok: false,
          error: "Workspace skill not installed for the selected agent",
        };
      }
      if (
        !record &&
        !payload.source &&
        dbRecords.some((item) => item.source === "workspace")
      ) {
        return { ok: false, error: "Workspace uninstall requires agentId" };
      }

      const skillPath = record
        ? this.resolveSkillMdDir(record)
        : resolveSkillPath(this.skillsDir, slug);
      if (skillPath && existsSync(skillPath)) {
        rmSync(skillPath, { recursive: true, force: true });
        const source: SkillSource =
          record?.source ?? payload.source ?? "managed";
        this.log("info", `uninstall ok (${source}) slug=${slug}`);
        this.db.recordUninstall(
          slug,
          source,
          record?.agentId ?? payload.agentId,
        );
      } else {
        this.log("warn", `uninstall skip slug=${slug} — dir not found`);
      }

      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("error", `uninstall failed slug=${slug}: ${message}`);
      return { ok: false, error: message };
    }
  }

  /**
   * @deprecated Replaced by the InstallQueue-based flow in SkillhubService.start().
   * Curated slugs are now resolved via {@link getCuratedSlugsToEnqueue} (ledger-only)
   * and enqueued into the InstallQueue. This method is retained for backward compatibility.
   */
  async installCuratedSkills(): Promise<CuratedInstallResult> {
    // Step 1: Copy static skills (not on ClawHub) from app bundle into skillsDir
    if (this.staticSkillsDir) {
      const { copied } = copyStaticSkills({
        staticDir: this.staticSkillsDir,
        targetDir: this.skillsDir,
        skillDb: this.db,
      });
      if (copied.length > 0) {
        this.db.recordBulkInstall(copied, "managed");
        this.log("info", `curated static skills copied: ${copied.join(", ")}`);
      }
    }

    // Step 1b: Record any on-disk skills in skillsDir not yet tracked in DB
    if (this.skillsDir && existsSync(this.skillsDir)) {
      const untracked: string[] = [];
      try {
        for (const entry of readdirSync(this.skillsDir, {
          withFileTypes: true,
        })) {
          if (
            entry.isDirectory() &&
            existsSync(resolve(this.skillsDir, entry.name, "SKILL.md")) &&
            !this.db.isInstalled(entry.name, "managed") &&
            !this.db.isInstalled(entry.name, "managed") &&
            !this.db.isInstalled(entry.name, "custom")
          ) {
            untracked.push(entry.name);
          }
        }
      } catch {
        // Directory not readable — skip
      }
      if (untracked.length > 0) {
        this.db.recordBulkInstall(untracked, "managed");
        this.log(
          "info",
          `curated on-disk skills recorded: ${untracked.join(", ")}`,
        );
      }
    }

    // Step 2: Install remaining curated skills from ClawHub into skillsDir
    const { toInstall, toSkip } = resolveCuratedSkillsToInstall({
      targetDir: this.skillsDir,
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
        this.log("info", `curated installing: ${slug} -> ${this.skillsDir}`);
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

    if (installed.length > 0) {
      await Promise.allSettled(
        installed.map((slug) =>
          this.installSkillDeps(resolve(this.skillsDir, slug), slug),
        ),
      );
    }

    if (installed.length > 0) {
      this.db.recordBulkInstall(installed, "managed");
    }

    return { installed, skipped: toSkip, failed };
  }

  async importSkillZip(
    zipBuffer: Buffer,
  ): Promise<{ ok: boolean; slug?: string; error?: string }> {
    this.log("info", "importing custom skill from zip");
    const result = extractZip(zipBuffer, this.skillsDir);
    if (result.ok && result.slug) {
      this.db.recordInstall(result.slug, "custom");
      this.log("info", `custom skill imported: ${result.slug}`);
      await this.installSkillDeps(
        resolve(this.skillsDir, result.slug),
        result.slug,
      );
    } else {
      this.log("error", `custom skill import failed: ${result.error}`);
    }
    return result;
  }

  /**
   * One-way sync: scan skillsDir for skills not tracked in DB and record them.
   * Also marks DB records as uninstalled if the skill folder is missing.
   */
  reconcileDbWithDisk(): void {
    if (!this.skillsDir || !existsSync(this.skillsDir)) return;

    // Clean up known junk that confuses clawhub CLI
    for (const junk of [".clawhub", "skills"]) {
      const junkPath = resolve(this.skillsDir, junk);
      if (existsSync(junkPath)) {
        const hasSkillMd = existsSync(resolve(junkPath, "SKILL.md"));
        if (!hasSkillMd) {
          rmSync(junkPath, { recursive: true, force: true });
          this.log("info", `reconcile: removed junk directory ${junk}`);
        }
      }
    }

    const dbRecords = this.db.getAllInstalled();

    // DB → disk: handle "installed" records whose SKILL.md is missing from disk
    const missingBySource = new Map<string, string[]>();
    for (const record of dbRecords) {
      const skillMd = resolve(this.resolveSkillMdDir(record), "SKILL.md");
      if (!existsSync(skillMd)) {
        const key =
          record.source === "workspace"
            ? `${record.source}:${record.agentId ?? ""}`
            : record.source;
        const list = missingBySource.get(key) ?? [];
        list.push(record.slug);
        missingBySource.set(key, list);
      }
    }

    let totalMissing = 0;
    for (const [key, slugs] of missingBySource) {
      const [source, agentId] = key.split(":");
      this.db.markUninstalledBySlugs(
        slugs,
        source as SkillSource,
        source === "workspace" ? agentId || null : undefined,
      );
      totalMissing += slugs.length;
    }
    if (totalMissing > 0) {
      this.log(
        "info",
        `reconcile: ${totalMissing} installed records marked uninstalled (missing from disk)`,
      );
    }

    // Disk → DB: record untracked skills as "managed"
    const trackedSlugs = new Set(this.db.getAllInstalled().map((r) => r.slug));
    const diskOnly: string[] = [];

    try {
      const entries = readdirSync(this.skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          existsSync(resolve(this.skillsDir, entry.name, "SKILL.md")) &&
          !trackedSlugs.has(entry.name)
        ) {
          diskOnly.push(entry.name);
        }
      }
    } catch {
      // Directory not readable — skip
    }

    if (diskOnly.length > 0) {
      this.db.recordBulkInstall(diskOnly, "managed");
      this.log(
        "info",
        `reconcile: ${diskOnly.length} on-disk skills recorded in DB`,
      );
    }

    if (totalMissing === 0 && diskOnly.length === 0) {
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

  /**
   * Resolves the directory containing SKILL.md for a given skill record.
   * Workspace skills live under `agents/<agentId>/skills/<slug>`,
   * while shared skills live under the common `skillsDir/<slug>`.
   */
  private resolveSkillMdDir(record: SkillRecord): string {
    if (record.source === "workspace" && record.agentId) {
      const stateDir = dirname(this.skillsDir);
      return join(stateDir, "agents", record.agentId, "skills", record.slug);
    }
    if (record.source === "user" && this.userSkillsDir) {
      return join(this.userSkillsDir, record.slug);
    }
    return resolve(this.skillsDir, record.slug);
  }

  private resolveInstalledRecord(
    records: readonly SkillRecord[],
    request: SkillUninstallRequest,
  ): SkillRecord | undefined {
    if (request.source === "workspace") {
      return records.find(
        (record) =>
          record.source === "workspace" && record.agentId === request.agentId,
      );
    }

    if (request.source) {
      return records.find((record) => record.source === request.source);
    }

    const sharedRecord = records.find(
      (record) => record.source !== "workspace",
    );
    if (sharedRecord) {
      return sharedRecord;
    }

    if (records.length === 1) {
      return records[0];
    }

    return undefined;
  }

  private parseFrontmatter(filePath: string): {
    name: string;
    catalogName: string;
    description: string;
  } {
    try {
      const content = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match?.[1]) return { name: "", catalogName: "", description: "" };
      const frontmatter = match[1];
      const nameMatch = frontmatter.match(/^name:\s*['"]?(.+?)['"]?\s*$/m);
      const catalogNameMatch = frontmatter.match(
        /^catalog-name:\s*['"]?(.+?)['"]?\s*$/m,
      );

      // Match description: single line, or multiline block after | or >
      let description = "";
      const descMatch = frontmatter.match(
        /^description:\s*['"]?(.+?)['"]?\s*$/m,
      );
      const rawDesc = descMatch?.[1]?.trim() ?? "";
      if (rawDesc && rawDesc !== "|" && rawDesc !== ">") {
        description = rawDesc;
      } else {
        // Multiline: collect indented lines after description:
        const descBlockMatch = frontmatter.match(
          /^description:\s*[|>]?\s*\n((?:[ \t]+.+\n?)+)/m,
        );
        if (descBlockMatch?.[1]) {
          description = descBlockMatch[1]
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .join(" ");
        }
      }

      return {
        name: nameMatch?.[1]?.trim() ?? "",
        catalogName: catalogNameMatch?.[1]?.trim() ?? "",
        description,
      };
    } catch {
      return { name: "", catalogName: "", description: "" };
    }
  }

  private async fetchRemoteVersion(): Promise<string> {
    const response = await proxyFetch(VERSION_CHECK_URL);

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

        const rawDownloads = Number(stats.downloads ?? entry.downloads ?? 0);

        return {
          slug: String(entry.slug ?? ""),
          name: String(entry.name ?? entry.slug ?? ""),
          description: String(entry.description ?? "").slice(0, 150),
          downloads: rawDownloads > 0 ? rawDownloads : DEFAULT_DOWNLOAD_COUNT,
          stars: Number(stats.stars ?? entry.stars ?? 0),
          tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 5) : [],
          version: String(entry.version ?? "0.0.0"),
          updatedAt,
        };
      });
  }

  private findIndexFile(dir: string): string | null {
    const candidates = [
      "skills_index.local.json",
      "skills_index.json",
      "index.json",
      "catalog.json",
      "skills.json",
    ];

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
      const skills = JSON.parse(
        readFileSync(this.catalogPath, "utf8"),
      ) as MinimalSkill[];
      return skills
        .filter((s) => !CATALOG_BLOCKLIST.has(s.slug))
        .map((s) => {
          const corrected = SLUG_CORRECTIONS[s.slug];
          return corrected ? { ...s, slug: corrected } : s;
        });
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
