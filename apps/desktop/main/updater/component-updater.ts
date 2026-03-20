import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { UpdateSource } from "../../shared/host";

const GITHUB_BASE_URL = "https://github.com/nexu-io/nexu/releases/download";
export const R2_BASE_URL = "https://desktop-releases.nexu.io";

export type ComponentInfo = {
  id: string;
  version: string;
  sha256: string;
  size: number;
  downloadUrl: string;
};

export type RemoteComponentManifest = {
  version: string;
  platform: string;
  arch: string;
  components: Record<string, Omit<ComponentInfo, "id" | "downloadUrl">>;
};

export type LocalComponentState = {
  components: Record<
    string,
    {
      version: string;
      sha256: string;
      installedAt: string;
    }
  >;
};

export type ComponentUpdate = {
  id: string;
  currentVersion: string | null;
  newVersion: string;
  sha256: string;
  size: number;
  downloadUrl: string;
};

export class ComponentUpdater {
  private readonly baseUrl: string;
  private readonly componentsDir: string;
  private readonly stateFilePath: string;

  constructor(source: UpdateSource = "r2") {
    const envOverride = process.env.NEXU_COMPONENT_FEED_URL;
    this.baseUrl =
      envOverride ?? (source === "r2" ? R2_BASE_URL : GITHUB_BASE_URL);
    this.componentsDir = join(app.getPath("userData"), "components");
    this.stateFilePath = join(this.componentsDir, "state.json");
    mkdirSync(this.componentsDir, { recursive: true });
  }

  async checkForUpdates(appVersion: string): Promise<ComponentUpdate[]> {
    const manifestUrl = this.buildManifestUrl(appVersion);
    const response = await fetch(manifestUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch component manifest: ${response.status}`);
    }

    const remote = (await response.json()) as RemoteComponentManifest;
    const local = this.readLocalState();
    const updates: ComponentUpdate[] = [];

    for (const [id, info] of Object.entries(remote.components)) {
      const localComponent = local.components[id];

      if (!localComponent || localComponent.sha256 !== info.sha256) {
        updates.push({
          id,
          currentVersion: localComponent?.version ?? null,
          newVersion: info.version,
          sha256: info.sha256,
          size: info.size,
          downloadUrl: this.buildDownloadUrl(appVersion, id),
        });
      }
    }

    return updates;
  }

  async installUpdate(
    update: ComponentUpdate,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    const stagingDir = join(this.componentsDir, `${update.id}.staging`);
    const targetDir = join(this.componentsDir, update.id);
    const archivePath = join(this.componentsDir, `${update.id}.tar.gz`);

    try {
      mkdirSync(stagingDir, { recursive: true });

      await this.downloadFile(
        update.downloadUrl,
        archivePath,
        update.size,
        onProgress,
      );

      const actualHash = await this.computeFileHash(archivePath);

      if (actualHash !== update.sha256) {
        throw new Error(
          `SHA-256 mismatch for ${update.id}: expected ${update.sha256}, got ${actualHash}`,
        );
      }

      execFileSync("tar", ["-xzf", archivePath, "-C", stagingDir]);

      if (existsSync(targetDir)) {
        const backupDir = join(this.componentsDir, `${update.id}.backup`);
        rmSync(backupDir, { recursive: true, force: true });
        renameSync(targetDir, backupDir);
      }

      renameSync(stagingDir, targetDir);
      this.updateLocalState(update);
    } finally {
      rmSync(archivePath, { force: true });
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  rollbackComponent(componentId: string): void {
    const targetDir = join(this.componentsDir, componentId);
    const backupDir = join(this.componentsDir, `${componentId}.backup`);

    if (existsSync(backupDir)) {
      rmSync(targetDir, { recursive: true, force: true });
      renameSync(backupDir, targetDir);
    } else {
      rmSync(targetDir, { recursive: true, force: true });
    }

    const state = this.readLocalState();
    delete state.components[componentId];
    this.writeLocalState(state);
  }

  getComponentPath(componentId: string): string | null {
    const dir = join(this.componentsDir, componentId);
    return existsSync(dir) ? dir : null;
  }

  private buildManifestUrl(appVersion: string): string {
    const platform = process.platform;
    const arch = process.arch;
    return `${this.baseUrl}/desktop-v${appVersion}/component-manifest-${platform}-${arch}.json`;
  }

  private buildDownloadUrl(appVersion: string, componentId: string): string {
    const platform = process.platform;
    const arch = process.arch;
    return `${this.baseUrl}/desktop-v${appVersion}/${componentId}-${platform}-${arch}.tar.gz`;
  }

  private async downloadFile(
    url: string,
    destPath: string,
    totalSize: number,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    const response = await fetch(url);

    if (!response.ok || !response.body) {
      throw new Error(`Download failed: ${response.status} ${url}`);
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = response.body.getReader();

    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      chunks.push(value);
      received += value.length;

      if (onProgress && totalSize > 0) {
        onProgress(Math.min(100, (received / totalSize) * 100));
      }
    }

    writeFileSync(destPath, Buffer.concat(chunks));
  }

  private async computeFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  private readLocalState(): LocalComponentState {
    if (!existsSync(this.stateFilePath)) {
      return { components: {} };
    }

    try {
      return JSON.parse(
        readFileSync(this.stateFilePath, "utf8"),
      ) as LocalComponentState;
    } catch {
      return { components: {} };
    }
  }

  private writeLocalState(state: LocalComponentState): void {
    writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), "utf8");
  }

  private updateLocalState(update: ComponentUpdate): void {
    const state = this.readLocalState();
    state.components[update.id] = {
      version: update.newVersion,
      sha256: update.sha256,
      installedAt: new Date().toISOString(),
    };
    this.writeLocalState(state);
  }
}
