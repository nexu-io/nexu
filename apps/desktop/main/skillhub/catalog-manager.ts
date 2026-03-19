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
  getOpenclawCuratedSkillsDir,
  getOpenclawSkillsDir,
} from "../../shared/desktop-paths";
import type {
  CatalogMeta,
  InstalledSkill,
  MinimalSkill,
  SkillSource,
  SkillhubCatalogData,
} from "../../shared/skillhub-types";
import {
  type CuratedInstallResult,
  copyStaticSkills,
  recordCuratedInstallation,
  recordCuratedRemoval,
  resolveCuratedSkillsToInstall,
} from "./curated-skills";

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

function resolveNpmBin(): string {
  const pkgPath = nodeRequire.resolve("npm/package.json");
  return resolve(dirname(pkgPath), "bin/npm-cli.js");
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
  private readonly curatedStatePath: string;
  private readonly staticSkillsDir: string;
  private readonly metaPath: string;
  private readonly catalogPath: string;
  private readonly tempCatalogPath: string;
  private readonly log: SkillhubLogFn;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    userDataPath: string,
    opts?: { staticSkillsDir?: string; log?: SkillhubLogFn },
  ) {
    this.cacheDir = resolve(userDataPath, "runtime/skillhub-cache");
    this.skillsDir = getOpenclawSkillsDir(userDataPath);
    this.curatedSkillsDir = getOpenclawCuratedSkillsDir(userDataPath);
    this.curatedStatePath = resolve(
      this.curatedSkillsDir,
      ".curated-state.json",
    );
    this.staticSkillsDir = opts?.staticSkillsDir ?? "";
    this.metaPath = resolve(this.cacheDir, "meta.json");
    this.catalogPath = resolve(this.cacheDir, "catalog.json");
    this.tempCatalogPath = resolve(this.cacheDir, ".catalog-next.json");
    this.log = opts?.log ?? noopLog;
    mkdirSync(this.cacheDir, { recursive: true });
  }

  start(): void {
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
    const installedSkills = this.scanAllSources();
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
      }

      if (curatedPath && existsSync(curatedPath)) {
        rmSync(curatedPath, { recursive: true, force: true });
        removed = true;
        this.log("info", `uninstall ok (curated) slug=${slug}`);
        recordCuratedRemoval({ slug, statePath: this.curatedStatePath });
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
        statePath: this.curatedStatePath,
      });
      if (copied.length > 0) {
        this.log("info", `curated static skills copied: ${copied.join(", ")}`);
      }
    }

    // Step 2: Install remaining from ClawHub
    const { toInstall, toSkip } = resolveCuratedSkillsToInstall({
      curatedDir: this.curatedSkillsDir,
      statePath: this.curatedStatePath,
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

    recordCuratedInstallation({
      statePath: this.curatedStatePath,
      installed,
    });

    return { installed, skipped: toSkip, failed };
  }

  dispose(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async installSkillDeps(
    skillDir: string,
    slug: string,
  ): Promise<void> {
    if (!existsSync(resolve(skillDir, "package.json"))) return;

    this.log("info", `installing npm deps: ${slug}`);
    try {
      const npmBin = resolveNpmBin();
      await execFileAsync(
        process.execPath,
        [npmBin, "install", "--production", "--no-audit", "--no-fund"],
        {
          cwd: skillDir,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        },
      );
      this.log("info", `npm deps installed: ${slug}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("warn", `npm deps failed for ${slug}: ${message}`);
    }
  }

  private scanAllSources(): InstalledSkill[] {
    const merged = new Map<string, InstalledSkill>();

    for (const skill of this.scanDirWithMeta(
      this.curatedSkillsDir,
      "curated",
    )) {
      merged.set(skill.slug, skill);
    }

    for (const skill of this.scanDirWithMeta(this.skillsDir, "managed")) {
      merged.set(skill.slug, skill);
    }

    return Array.from(merged.values());
  }

  private scanDirWithMeta(dir: string, source: SkillSource): InstalledSkill[] {
    if (!dir || !existsSync(dir)) return [];
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            existsSync(resolve(dir, entry.name, "SKILL.md")),
        )
        .map((entry) => {
          const { name, description } = this.parseFrontmatter(
            resolve(dir, entry.name, "SKILL.md"),
          );
          return {
            slug: entry.name,
            source,
            name: name || entry.name,
            description: description || "",
          };
        });
    } catch {
      return [];
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
