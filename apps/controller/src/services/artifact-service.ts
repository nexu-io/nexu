import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CreateArtifactInput, UpdateArtifactInput } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import type { ArtifactsStore } from "../store/artifacts-store.js";
import type { ControllerArtifact } from "../store/schemas.js";

export class ArtifactService {
  constructor(
    private readonly artifactsStore: ArtifactsStore,
    private readonly env: ControllerEnv,
  ) {}

  async listArtifacts(params: {
    limit: number;
    offset: number;
    sessionKey?: string;
  }) {
    let artifacts = await this.artifactsStore.listArtifacts();
    if (params.sessionKey) {
      artifacts = artifacts.filter(
        (artifact) => artifact.sessionKey === params.sessionKey,
      );
    }
    return {
      artifacts: artifacts.slice(params.offset, params.offset + params.limit),
      total: artifacts.length,
      limit: params.limit,
      offset: params.offset,
    };
  }

  async getArtifact(id: string) {
    return this.artifactsStore.getArtifact(id);
  }

  async createArtifact(input: CreateArtifactInput) {
    return this.artifactsStore.createArtifact(input);
  }

  async updateArtifact(id: string, input: UpdateArtifactInput) {
    return this.artifactsStore.updateArtifact(id, input);
  }

  async deleteArtifact(id: string) {
    return this.artifactsStore.deleteArtifact(id);
  }

  async deleteArtifactsForSession(
    botId: string,
    sessionKey: string,
  ): Promise<{
    deletedArtifacts: number;
    deletedFiles: number;
  }> {
    const deletedArtifacts =
      await this.artifactsStore.deleteArtifactsForSession(botId, sessionKey);
    let deletedFiles = 0;

    for (const artifact of deletedArtifacts) {
      const filePaths = this.collectManagedFilePaths(artifact);
      for (const filePath of filePaths) {
        try {
          const stats = await lstat(filePath);
          await rm(filePath, {
            force: true,
            recursive: stats.isDirectory(),
          });
          deletedFiles += 1;
        } catch {
          // Ignore per-file cleanup failures so session deletion still completes.
        }
      }
    }

    return {
      deletedArtifacts: deletedArtifacts.length,
      deletedFiles,
    };
  }

  async getStats() {
    const artifacts = await this.artifactsStore.listArtifacts();
    return {
      totalArtifacts: artifacts.length,
      liveCount: artifacts.filter((artifact) => artifact.status === "live")
        .length,
      buildingCount: artifacts.filter(
        (artifact) => artifact.status === "building",
      ).length,
      failedCount: artifacts.filter((artifact) => artifact.status === "failed")
        .length,
      codingCount: artifacts.filter((artifact) => artifact.source === "coding")
        .length,
      contentCount: artifacts.filter(
        (artifact) => artifact.source === "content",
      ).length,
      totalLinesOfCode: artifacts.reduce(
        (total, artifact) => total + (artifact.linesOfCode ?? 0),
        0,
      ),
    };
  }

  private collectManagedFilePaths(artifact: ControllerArtifact): string[] {
    const candidatePaths = new Set<string>();

    this.addCandidatePath(candidatePaths, artifact.previewUrl);
    this.addCandidatePath(candidatePaths, artifact.deployTarget);
    this.addCandidateFromMetadata(candidatePaths, artifact.metadata);

    return [...candidatePaths].filter((candidate) =>
      this.isManagedPath(candidate),
    );
  }

  private addCandidateFromMetadata(
    candidatePaths: Set<string>,
    metadata: Record<string, unknown> | null,
  ): void {
    if (!metadata) {
      return;
    }

    const directKeys = [
      "filePath",
      "path",
      "localPath",
      "outputPath",
      "artifactPath",
      "imagePath",
      "previewPath",
      "directoryPath",
      "dirPath",
      "workspacePath",
    ] as const;

    for (const key of directKeys) {
      this.addCandidateUnknown(candidatePaths, metadata[key]);
    }

    const nestedKeys = ["files", "paths", "outputs", "artifacts"] as const;
    for (const key of nestedKeys) {
      this.addCandidateUnknown(candidatePaths, metadata[key]);
    }
  }

  private addCandidateUnknown(
    candidatePaths: Set<string>,
    value: unknown,
  ): void {
    if (typeof value === "string") {
      this.addCandidatePath(candidatePaths, value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        this.addCandidateUnknown(candidatePaths, item);
      }
      return;
    }

    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      this.addCandidateUnknown(candidatePaths, record.path);
      this.addCandidateUnknown(candidatePaths, record.filePath);
      this.addCandidateUnknown(candidatePaths, record.localPath);
      this.addCandidateUnknown(candidatePaths, record.outputPath);
      this.addCandidateUnknown(candidatePaths, record.directoryPath);
    }
  }

  private addCandidatePath(
    candidatePaths: Set<string>,
    value: string | null | undefined,
  ): void {
    const normalized = this.parseLocalPath(value);
    if (normalized) {
      candidatePaths.add(normalized);
    }
  }

  private parseLocalPath(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    if (value.startsWith("file://")) {
      try {
        return path.resolve(fileURLToPath(value));
      } catch {
        return null;
      }
    }

    if (/^[a-z]+:\/\//i.test(value)) {
      return null;
    }

    if (!path.isAbsolute(value)) {
      return null;
    }

    return path.resolve(value);
  }

  private isManagedPath(candidate: string): boolean {
    const managedRoots = [
      this.env.nexuHomeDir,
      this.env.openclawStateDir,
      path.dirname(this.env.artifactsIndexPath),
    ].map((root) => path.resolve(root));

    return managedRoots.some((root) => {
      if (candidate === root) {
        return false;
      }

      const relative = path.relative(root, candidate);
      return !relative.startsWith("..") && !path.isAbsolute(relative);
    });
  }
}
